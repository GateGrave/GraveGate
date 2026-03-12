"use strict";

const { InventoryGrantAdapter } = require("../loot/grants/inventory-grant.adapter");
const { defaultRemoveItemFromInventory } = require("./npc-shop-sell.flow");

class ProcessedPlayerShopPurchaseStore {
  constructor() {
    this.processed = new Set();
  }

  has(purchase_key) {
    if (!purchase_key) return false;
    return this.processed.has(String(purchase_key));
  }

  add(purchase_key) {
    if (!purchase_key) return;
    this.processed.add(String(purchase_key));
  }
}

class PlayerListingLockStore {
  constructor() {
    this.locked = new Set();
  }

  tryLock(lock_key) {
    if (!lock_key) return false;
    const key = String(lock_key);
    if (this.locked.has(key)) return false;
    this.locked.add(key);
    return true;
  }

  unlock(lock_key) {
    if (!lock_key) return;
    this.locked.delete(String(lock_key));
  }

  isLocked(lock_key) {
    if (!lock_key) return false;
    return this.locked.has(String(lock_key));
  }
}

function createFailure(reason, extra) {
  return {
    ok: false,
    event_type: "player_shop_purchase_failed",
    payload: {
      reason,
      ...(extra || {})
    }
  };
}

function makePurchaseKey(data) {
  return (
    data.purchase_key ||
    data.event_id ||
    `${data.shop_id || "unknown"}:${data.listing_id || "unknown"}:${data.buyer_player_id || "unknown"}:${data.quantity || 0}`
  );
}

function getListing(shop, listing_id) {
  const listings = Array.isArray(shop?.listings) ? shop.listings : [];
  return listings.find((x) => x.listing_id === String(listing_id)) || null;
}

function withListingUpdate(playerShopManager, shop_id, listing_id, patcher) {
  return playerShopManager.updatePlayerShop(shop_id, (existing) => {
    const listings = Array.isArray(existing.listings) ? [...existing.listings] : [];
    const idx = listings.findIndex((x) => x.listing_id === String(listing_id));
    if (idx < 0) {
      return null;
    }

    const current = listings[idx];
    const next = patcher(current);
    if (!next) return null;
    listings[idx] = {
      ...current,
      ...next
    };
    return { listings };
  });
}

function restoreListingState(playerShopManager, shop_id, listing_id, previous) {
  return withListingUpdate(playerShopManager, shop_id, listing_id, () => ({
    quantity: previous.quantity,
    listing_active: previous.listing_active
  }));
}

function processPlayerShopPurchase(input) {
  const data = input || {};
  const playerShopManager = data.playerShopManager;
  const currencyManager = data.currencyManager;
  const transactionManager = data.transactionManager;
  const processedPurchaseStore = data.processedPurchaseStore || null;
  const listingLockStore = data.listingLockStore || new PlayerListingLockStore();
  const worldStorage = data.worldStorage || null;
  const inventoryStore = worldStorage?.inventories;
  const itemStore = worldStorage?.items;
  const inventoryAdapter =
    data.inventoryAdapter ||
    (inventoryStore && itemStore
      ? new InventoryGrantAdapter({
          inventoryStore,
          itemStore
        })
      : null);

  if (!playerShopManager || !currencyManager || !transactionManager || !inventoryStore || !itemStore || !inventoryAdapter) {
    return createFailure("required_manager_missing", {
      requires: [
        "playerShopManager",
        "currencyManager",
        "transactionManager",
        "worldStorage.inventories",
        "worldStorage.items",
        "inventoryAdapter_or_worldStorage"
      ]
    });
  }

  const shop_id = data.shop_id;
  const listing_id = data.listing_id;
  const buyer_player_id = data.buyer_player_id;
  const quantity = Number.isFinite(data.quantity) ? Math.floor(data.quantity) : NaN;
  const buyer_inventory_id = data.buyer_inventory_id || `inv-${buyer_player_id || "unknown"}`;
  const purchase_key = makePurchaseKey(data);

  if (!shop_id || String(shop_id).trim() === "") {
    return createFailure("shop_id_required");
  }
  if (!listing_id || String(listing_id).trim() === "") {
    return createFailure("listing_id_required");
  }
  if (!buyer_player_id || String(buyer_player_id).trim() === "") {
    return createFailure("buyer_player_id_required");
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return createFailure("invalid_quantity", { quantity_requested: data.quantity });
  }

  if (processedPurchaseStore && typeof processedPurchaseStore.has === "function") {
    if (processedPurchaseStore.has(purchase_key)) {
      return {
        ok: true,
        event_type: "player_shop_purchase_skipped",
        payload: {
          reason: "duplicate_purchase_key",
          purchase_key,
          shop_id: String(shop_id),
          listing_id: String(listing_id),
          buyer_player_id: String(buyer_player_id)
        }
      };
    }
  }

  const lock_key = `${shop_id}:${listing_id}`;
  if (!listingLockStore.tryLock(lock_key)) {
    return createFailure("listing_locked", {
      shop_id: String(shop_id),
      listing_id: String(listing_id)
    });
  }

  try {
    if (typeof data.debug_on_lock_acquired === "function") {
      data.debug_on_lock_acquired();
    }

    const shop = playerShopManager.getPlayerShop(shop_id);
    if (!shop || !shop.shop_active) {
      return createFailure("player_shop_unavailable", { shop_id: String(shop_id) });
    }

    const listing = getListing(shop, listing_id);
    if (!listing || listing.listing_active === false) {
      return createFailure("listing_inactive_or_missing", {
        shop_id: String(shop_id),
        listing_id: String(listing_id)
      });
    }

    const listingQty = Number.isFinite(listing.quantity) ? Math.floor(listing.quantity) : 0;
    if (listingQty < quantity) {
      return createFailure("listing_quantity_unavailable", {
        quantity_requested: quantity,
        quantity_available: listingQty
      });
    }

    const seller_player_id = listing.seller_player_id || shop.owner_player_id;
    const allowSelfPurchase = Boolean(data.allow_self_purchase);
    if (!allowSelfPurchase && String(seller_player_id) === String(buyer_player_id)) {
      return createFailure("self_purchase_not_allowed", {
        buyer_player_id: String(buyer_player_id),
        seller_player_id: String(seller_player_id)
      });
    }

    const unitPrice = Number.isFinite(listing.price_gold) ? Math.max(0, Math.floor(listing.price_gold)) : 0;
    const totalCost = unitPrice * quantity;
    if (!currencyManager.hasSufficientFunds({ player_id: buyer_player_id, amount: totalCost, currency: "gold" })) {
      return createFailure("insufficient_buyer_funds", {
        buyer_player_id: String(buyer_player_id),
        required_gold: totalCost
      });
    }

    // Step 1: reserve listing quantity so competing buyers cannot consume it.
    const previousListingState = {
      quantity: listingQty,
      listing_active: listing.listing_active !== false
    };
    const reservedQty = listingQty - quantity;
    const reserveUpdated = withListingUpdate(playerShopManager, shop_id, listing_id, () => ({
      quantity: reservedQty,
      listing_active: reservedQty > 0
    }));
    if (!reserveUpdated) {
      return createFailure("listing_reservation_failed", {
        shop_id: String(shop_id),
        listing_id: String(listing_id)
      });
    }

    // Step 2: move gold buyer -> seller.
    const buyerDeduct = currencyManager.subtractCurrency({
      player_id: buyer_player_id,
      amount: totalCost,
      currency: "gold",
      reason: "player_shop_purchase",
      source_event_id: data.event_id || null
    });
    if (!buyerDeduct.ok) {
      restoreListingState(playerShopManager, shop_id, listing_id, previousListingState);
      return createFailure("buyer_gold_deduction_failed", { currency_result: buyerDeduct });
    }

    const sellerAdd = currencyManager.addCurrency({
      player_id: seller_player_id,
      amount: totalCost,
      currency: "gold",
      reason: "player_shop_sale_payout",
      source_event_id: data.event_id || null
    });
    if (!sellerAdd.ok) {
      currencyManager.addCurrency({
        player_id: buyer_player_id,
        amount: totalCost,
        currency: "gold",
        reason: "player_shop_purchase_refund_seller_payout_failed",
        source_event_id: data.event_id || null
      });
      restoreListingState(playerShopManager, shop_id, listing_id, previousListingState);
      return createFailure("seller_gold_payout_failed", { currency_result: sellerAdd });
    }

    // Step 3: transfer item to buyer inventory.
    const itemGrant = inventoryAdapter.addDropToInventory({
      inventory_id: buyer_inventory_id,
      owner_character_id: buyer_player_id,
      drop: {
        item_id: String(listing.item_id),
        quantity,
        rarity: listing.rarity || "common",
        item_type: listing.item_type || null
      }
    });
    if (!itemGrant.ok) {
      // Roll back gold and listing reservation.
      currencyManager.subtractCurrency({
        player_id: seller_player_id,
        amount: totalCost,
        currency: "gold",
        reason: "player_shop_purchase_rollback_item_grant_failed"
      });
      currencyManager.addCurrency({
        player_id: buyer_player_id,
        amount: totalCost,
        currency: "gold",
        reason: "player_shop_purchase_refund_item_grant_failed"
      });
      restoreListingState(playerShopManager, shop_id, listing_id, previousListingState);
      return createFailure("item_transfer_failed", {
        item_grant_result: itemGrant
      });
    }

    // Step 4: record transaction; rollback everything if this fails.
    let transaction;
    try {
      transaction = transactionManager.createTransaction({
        transaction_id:
          data.transaction_id ||
          `txn-pshop-buy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        transaction_type: "player_shop_purchase",
        source_player_id: String(buyer_player_id),
        target_player_id: String(seller_player_id),
        npc_vendor_id: null,
        item_id: String(listing.item_id),
        quantity,
        gold_amount: totalCost,
        result: "success"
      });
    } catch (error) {
      defaultRemoveItemFromInventory({
        inventoryStore,
        inventory_id: buyer_inventory_id,
        item_id: String(listing.item_id),
        quantity
      });
      currencyManager.subtractCurrency({
        player_id: seller_player_id,
        amount: totalCost,
        currency: "gold",
        reason: "player_shop_purchase_rollback_transaction_failed"
      });
      currencyManager.addCurrency({
        player_id: buyer_player_id,
        amount: totalCost,
        currency: "gold",
        reason: "player_shop_purchase_refund_transaction_failed"
      });
      restoreListingState(playerShopManager, shop_id, listing_id, previousListingState);
      return createFailure("transaction_record_failed", {
        message: error.message
      });
    }

    if (processedPurchaseStore && typeof processedPurchaseStore.add === "function") {
      processedPurchaseStore.add(purchase_key);
    }

    return {
      ok: true,
      event_type: "player_shop_purchase_success",
      payload: {
        purchase_key,
        transaction_id: transaction.transaction_id,
        shop_id: String(shop_id),
        listing_id: String(listing_id),
        buyer_player_id: String(buyer_player_id),
        seller_player_id: String(seller_player_id),
        item_id: String(listing.item_id),
        quantity,
        gold_spent: totalCost,
        buyer_inventory_id,
        listing_quantity_after: reservedQty,
        listing_active_after: reservedQty > 0,
        processed_at: new Date().toISOString()
      }
    };
  } finally {
    listingLockStore.unlock(lock_key);
  }
}

module.exports = {
  ProcessedPlayerShopPurchaseStore,
  PlayerListingLockStore,
  processPlayerShopPurchase
};

