"use strict";

/**
 * Listing model choice:
 * - Listed items are REMOVED from seller inventory at listing time.
 * - This behaves like escrow and prevents double-selling from the same stack.
 * - The removed quantity is tracked on the listing record.
 */

class ProcessedPlayerListingStore {
  constructor() {
    this.processed = new Set();
  }

  has(listing_key) {
    if (!listing_key) return false;
    return this.processed.has(String(listing_key));
  }

  add(listing_key) {
    if (!listing_key) return;
    this.processed.add(String(listing_key));
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeListingKey(data) {
  return (
    data.listing_key ||
    data.event_id ||
    `${data.shop_id || "unknown"}:${data.owner_player_id || "unknown"}:${data.item_id || "unknown"}:${data.quantity || 0}:${data.price_gold || 0}`
  );
}

function createFailure(reason, extra) {
  return {
    ok: false,
    event_type: "player_listing_failed",
    payload: {
      reason,
      ...(extra || {})
    }
  };
}

function removeInventoryQuantity(input) {
  const data = input || {};
  const inventoryStore = data.inventoryStore;
  const inventory_id = data.inventory_id;
  const item_id = data.item_id;
  const quantity = data.quantity;

  const inventory = inventoryStore.loadInventory(inventory_id);
  if (!inventory) {
    return { ok: false, reason: "inventory_not_found" };
  }

  const entries = Array.isArray(inventory.item_entries) ? inventory.item_entries : [];
  const matching = entries.filter((x) => x.item_id === item_id);
  if (matching.length === 0) {
    return { ok: false, reason: "item_not_owned" };
  }

  const owned = matching.reduce(
    (sum, entry) => sum + (Number.isFinite(entry.quantity) ? Math.floor(entry.quantity) : 1),
    0
  );
  if (owned < quantity) {
    return {
      ok: false,
      reason: "insufficient_item_quantity",
      quantity_owned: owned,
      quantity_requested: quantity
    };
  }

  const before = clone(inventory);
  const working = clone(entries);
  let remaining = quantity;

  for (const entry of working) {
    if (entry.item_id !== item_id) continue;
    if (remaining <= 0) break;

    const entryQty = Number.isFinite(entry.quantity) ? Math.max(0, Math.floor(entry.quantity)) : 1;
    if (entryQty <= remaining) {
      entry.quantity = 0;
      remaining -= entryQty;
    } else {
      entry.quantity = entryQty - remaining;
      remaining = 0;
    }
  }

  const next = {
    ...before,
    item_entries: working.filter((x) => (Number.isFinite(x.quantity) ? x.quantity : 1) > 0)
  };

  inventoryStore.saveInventory(next);
  return {
    ok: true,
    before_inventory: before,
    after_inventory: next,
    removed_quantity: quantity
  };
}

function processPlayerListing(input) {
  const data = input || {};
  const playerShopManager = data.playerShopManager;
  const transactionManager = data.transactionManager;
  const processedListingStore = data.processedListingStore || null;
  const worldStorage = data.worldStorage || null;
  const inventoryStore = worldStorage?.inventories;
  const itemStore = worldStorage?.items;

  if (!playerShopManager || !transactionManager || !inventoryStore || !itemStore) {
    return createFailure("required_manager_missing", {
      requires: ["playerShopManager", "transactionManager", "worldStorage.inventories", "worldStorage.items"]
    });
  }

  const shop_id = data.shop_id;
  const owner_player_id = data.owner_player_id;
  const item_id = data.item_id;
  const quantity = Number.isFinite(data.quantity) ? Math.floor(data.quantity) : NaN;
  const price_gold = Number.isFinite(data.price_gold) ? Math.floor(data.price_gold) : NaN;
  const inventory_id = data.inventory_id || `inv-${owner_player_id || "unknown"}`;
  const listing_key = makeListingKey(data);

  if (!shop_id || String(shop_id).trim() === "") {
    return createFailure("shop_id_required");
  }
  if (!owner_player_id || String(owner_player_id).trim() === "") {
    return createFailure("owner_player_id_required");
  }
  if (!item_id || String(item_id).trim() === "") {
    return createFailure("item_id_required");
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return createFailure("invalid_quantity", { quantity_requested: data.quantity });
  }
  if (!Number.isFinite(price_gold) || price_gold <= 0) {
    return createFailure("invalid_price", { price_gold: data.price_gold });
  }

  if (processedListingStore && typeof processedListingStore.has === "function") {
    if (processedListingStore.has(listing_key)) {
      return {
        ok: true,
        event_type: "player_listing_skipped",
        payload: {
          reason: "duplicate_listing_key",
          listing_key,
          shop_id: String(shop_id),
          owner_player_id: String(owner_player_id),
          item_id: String(item_id)
        }
      };
    }
  }

  const shop = playerShopManager.getPlayerShop(shop_id);
  if (!shop) {
    return createFailure("player_shop_not_found", { shop_id: String(shop_id) });
  }
  if (!shop.shop_active) {
    return createFailure("player_shop_inactive", { shop_id: String(shop_id) });
  }
  if (shop.owner_player_id !== String(owner_player_id)) {
    return createFailure("shop_owner_mismatch", {
      shop_id: String(shop_id),
      owner_player_id: String(owner_player_id)
    });
  }

  const item = itemStore.loadItem(item_id);
  const allowedToList =
    data.force_listable === true
      ? true
      : item?.listing_blocked === true || item?.flags?.listing_blocked === true || item?.sellable === false
        ? false
        : true;
  if (!allowedToList) {
    return createFailure("item_listing_blocked", { item_id: String(item_id) });
  }

  // Step 1: remove listed quantity from inventory (escrow model).
  const removal = removeInventoryQuantity({
    inventoryStore,
    inventory_id,
    item_id: String(item_id),
    quantity
  });
  if (!removal.ok) {
    return createFailure("inventory_reserve_failed", {
      reserve_result: removal
    });
  }

  // Step 2: create listing in player shop.
  const listing_id =
    data.listing_id ||
    `plist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const createdListing = {
    listing_id,
    item_id: String(item_id),
    quantity,
    price_gold,
    listing_active: true,
    listing_model: "removed_from_inventory_escrow",
    seller_player_id: String(owner_player_id),
    created_at: new Date().toISOString()
  };

  let updatedShop;
  try {
    updatedShop = playerShopManager.updatePlayerShop(shop_id, (existing) => ({
      listings: [...(Array.isArray(existing.listings) ? existing.listings : []), createdListing]
    }));
  } catch (error) {
    inventoryStore.saveInventory(removal.before_inventory);
    return createFailure("listing_creation_failed", {
      message: error.message
    });
  }

  if (!updatedShop) {
    inventoryStore.saveInventory(removal.before_inventory);
    return createFailure("listing_creation_failed", {
      reason_detail: "player_shop_update_failed"
    });
  }

  // Step 3: record listing transaction event.
  let transaction;
  try {
    transaction = transactionManager.createTransaction({
      transaction_id:
        data.transaction_id ||
        `txn-list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      transaction_type: "player_listing_created",
      source_player_id: String(owner_player_id),
      target_player_id: null,
      npc_vendor_id: null,
      item_id: String(item_id),
      quantity,
      gold_amount: price_gold,
      result: "success"
    });
  } catch (error) {
    // Roll back shop + inventory if transaction recording fails.
    playerShopManager.updatePlayerShop(shop_id, (existing) => ({
      listings: (existing.listings || []).filter((x) => x.listing_id !== listing_id)
    }));
    inventoryStore.saveInventory(removal.before_inventory);
    return createFailure("transaction_record_failed", {
      message: error.message
    });
  }

  if (processedListingStore && typeof processedListingStore.add === "function") {
    processedListingStore.add(listing_key);
  }

  return {
    ok: true,
    event_type: "player_listing_created",
    payload: {
      listing_key,
      listing_id,
      shop_id: String(shop_id),
      owner_player_id: String(owner_player_id),
      item_id: String(item_id),
      quantity,
      price_gold,
      listing_model: "removed_from_inventory_escrow",
      inventory_id,
      transaction_id: transaction.transaction_id,
      created_at: createdListing.created_at
    }
  };
}

module.exports = {
  ProcessedPlayerListingStore,
  processPlayerListing
};

