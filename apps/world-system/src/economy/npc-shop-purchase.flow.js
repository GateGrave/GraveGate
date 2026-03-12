"use strict";

const { InventoryGrantAdapter } = require("../loot/grants/inventory-grant.adapter");
const { createInventoryRecord } = require("../../../inventory-system/src/inventory.schema");
const {
  addItemToInventory: canonicalAddItemToInventory,
  normalizeInventoryShape: canonicalNormalizeInventoryShape
} = require("../../../inventory-system/src/mutationHelpers");

class ProcessedNpcShopPurchaseStore {
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

function createFailure(reason, extra) {
  return {
    ok: false,
    event_type: "npc_shop_purchase_failed",
    payload: {
      reason,
      ...(extra || {})
    }
  };
}

function isInventoryServiceValid(service) {
  return Boolean(
    service &&
      typeof service.getInventory === "function" &&
      typeof service.saveInventory === "function"
  );
}

function extractInventoryFromResult(result) {
  if (!result) return null;
  if (result.ok === true && result.payload && result.payload.inventory) {
    return result.payload.inventory;
  }
  if (result.ok === false) {
    return null;
  }
  if (typeof result === "object") {
    return result;
  }
  return null;
}

function resolveMutationHelpers(data) {
  const injected = data && data.mutation_helpers && typeof data.mutation_helpers === "object"
    ? data.mutation_helpers
    : null;

  return {
    addItemToInventory:
      injected && typeof injected.addItemToInventory === "function"
        ? injected.addItemToInventory
        : canonicalAddItemToInventory,
    normalizeInventoryShape:
      injected && typeof injected.normalizeInventoryShape === "function"
        ? injected.normalizeInventoryShape
        : canonicalNormalizeInventoryShape
  };
}

function addPurchasedItemToCanonicalInventory(input) {
  const data = input || {};
  const inventoryService = data.inventoryService;
  const mutationHelpers = resolveMutationHelpers(data);

  if (!isInventoryServiceValid(inventoryService)) {
    return {
      ok: false,
      reason: "invalid_inventory_service"
    };
  }

  const inventoryId = String(data.inventory_id);
  const ownerId = String(data.owner_id);
  const itemId = String(data.item_id);
  const quantity = Number.isFinite(data.quantity) ? Math.max(1, Math.floor(data.quantity)) : 1;
  const rarity = data.rarity ? String(data.rarity) : "common";
  const itemType = data.item_type ? String(data.item_type).toLowerCase() : "stackable";
  const nonStackTypes = new Set(["equipment", "magical", "unidentified", "quest"]);
  const stackable = !nonStackTypes.has(itemType);

  let inventory = extractInventoryFromResult(inventoryService.getInventory(inventoryId));
  if (!inventory) {
    inventory = createInventoryRecord({
      inventory_id: inventoryId,
      owner_type: "player",
      owner_id: ownerId
    });
  }

  const normalized = mutationHelpers.normalizeInventoryShape(inventory);
  if (!normalized.ok) {
    return {
      ok: false,
      reason: "inventory_normalization_failed",
      normalize_result: normalized
    };
  }
  inventory = normalized.payload.inventory;

  const mutationItem = {
    item_id: itemId,
    item_name: data.item_name || itemId,
    item_type: itemType,
    rarity,
    quantity,
    stackable,
    owner_player_id: ownerId,
    metadata: {
      source: "npc_shop_purchase",
      granted_at: new Date().toISOString()
    }
  };
  const addResult = mutationHelpers.addItemToInventory(inventory, mutationItem);
  if (!addResult.ok) {
    return {
      ok: false,
      reason: "inventory_add_failed",
      add_result: addResult
    };
  }
  inventory = addResult.payload.inventory;

  const saveResult = inventoryService.saveInventory(inventory);
  if (saveResult && saveResult.ok === false) {
    return {
      ok: false,
      reason: "inventory_save_failed",
      save_result: saveResult
    };
  }

  return {
    ok: true,
    inventory_id: inventoryId,
    quantity_applied: quantity,
    item_type: itemType,
    inventory,
    mutation_result: addResult.payload.added || null
  };
}

function makePurchaseKey(data) {
  return (
    data.purchase_key ||
    data.event_id ||
    `${data.player_id || "unknown"}:${data.vendor_id || "unknown"}:${data.item_id || "unknown"}:${data.quantity || 0}`
  );
}

function processNpcShopPurchase(input) {
  const data = input || {};
  const npcShopManager = data.npcShopManager;
  const currencyManager = data.currencyManager;
  const transactionManager = data.transactionManager;
  const processedPurchaseStore = data.processedPurchaseStore || null;
  const worldStorage = data.worldStorage || null;
  const inventoryService = data.inventoryService || null;
  const inventoryAdapter =
    data.inventoryAdapter ||
    (worldStorage?.inventories && worldStorage?.items
      ? new InventoryGrantAdapter({
          inventoryStore: worldStorage.inventories,
          itemStore: worldStorage.items
        })
      : null);

  if (!npcShopManager || !currencyManager || !transactionManager || (!inventoryAdapter && !inventoryService)) {
    return createFailure("required_manager_missing", {
      requires: [
        "npcShopManager",
        "currencyManager",
        "transactionManager",
        "inventoryAdapter_or_worldStorage_or_inventoryService"
      ]
    });
  }

  if (inventoryService && !isInventoryServiceValid(inventoryService)) {
    return createFailure("invalid_inventory_service");
  }

  const player_id = data.player_id;
  const vendor_id = data.vendor_id;
  const item_id = data.item_id;
  const quantity = Number.isFinite(data.quantity) ? Math.floor(data.quantity) : NaN;
  const purchase_key = makePurchaseKey(data);

  if (!player_id || String(player_id).trim() === "") {
    return createFailure("player_id_required");
  }
  if (!vendor_id || String(vendor_id).trim() === "") {
    return createFailure("vendor_id_required");
  }
  if (!item_id || String(item_id).trim() === "") {
    return createFailure("item_id_required");
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return createFailure("invalid_quantity", { quantity_requested: data.quantity });
  }

  if (processedPurchaseStore && typeof processedPurchaseStore.has === "function") {
    if (processedPurchaseStore.has(purchase_key)) {
      return {
        ok: true,
        event_type: "npc_shop_purchase_skipped",
        payload: {
          reason: "duplicate_purchase_key",
          purchase_key,
          player_id: String(player_id),
          vendor_id: String(vendor_id),
          item_id: String(item_id),
          quantity
        }
      };
    }
  }

  const shop = npcShopManager.getNpcShop(vendor_id);
  if (!shop) {
    return createFailure("shop_not_found", { vendor_id: String(vendor_id) });
  }
  if (!shop.shop_active) {
    return createFailure("shop_inactive", { vendor_id: String(vendor_id) });
  }

  const itemStatus = npcShopManager.isItemAvailableInNpcShop({
    vendor_id,
    item_id
  });
  if (!itemStatus.ok && itemStatus.reason === "vendor_id_required") {
    return createFailure("vendor_id_required");
  }
  if (!itemStatus.ok && itemStatus.reason === "item_id_required") {
    return createFailure("item_id_required");
  }
  if (!itemStatus.item_available) {
    return createFailure(itemStatus.reason || "item_unavailable", {
      vendor_id: String(vendor_id),
      item_id: String(item_id)
    });
  }

  const unitPrice = Number.isFinite(shop.price_map?.[item_id])
    ? Math.max(0, Math.floor(shop.price_map[item_id]))
    : 0;
  const goldCost = unitPrice * quantity;

  if (!currencyManager.hasSufficientFunds({ player_id, amount: goldCost, currency: "gold" })) {
    return createFailure("insufficient_gold", {
      player_id: String(player_id),
      required_gold: goldCost
    });
  }

  const isInfinite = shop.infinite_stock_items.includes(String(item_id));
  const currentStock = Number.isFinite(shop.quantity_map?.[item_id])
    ? Math.max(0, Math.floor(shop.quantity_map[item_id]))
    : 0;
  if (!isInfinite && currentStock < quantity) {
    return createFailure("out_of_stock", {
      item_id: String(item_id),
      quantity_requested: quantity,
      quantity_available: currentStock
    });
  }

  // Step 1: Deduct gold.
  const deductResult = currencyManager.subtractCurrency({
    player_id,
    amount: goldCost,
    currency: "gold",
    reason: "npc_shop_purchase",
    source_event_id: data.event_id || null
  });
  if (!deductResult.ok) {
    return createFailure("currency_deduction_failed", {
      player_id: String(player_id),
      currency_result: deductResult
    });
  }

  // Step 2: Reserve/reduce stock if limited.
  let stockReserved = false;
  if (!isInfinite) {
    const updated = npcShopManager.updateNpcShop(vendor_id, {
      quantity_map: {
        ...(shop.quantity_map || {}),
        [item_id]: currentStock - quantity
      }
    });

    if (!updated) {
      currencyManager.addCurrency({
        player_id,
        amount: goldCost,
        currency: "gold",
        reason: "npc_shop_purchase_refund_stock_update_failed",
        source_event_id: data.event_id || null
      });
      return createFailure("stock_update_failed", {
        vendor_id: String(vendor_id),
        item_id: String(item_id)
      });
    }
    stockReserved = true;
  }

  // Step 3: Grant item(s) into inventory.
  const inventory_id = data.inventory_id || `inv-${player_id}`;
  let grantResult;
  if (inventoryService) {
    const itemRecord = worldStorage?.items?.loadItem ? worldStorage.items.loadItem(String(item_id)) : null;
    grantResult = addPurchasedItemToCanonicalInventory({
      inventoryService,
      mutation_helpers: data.mutation_helpers,
      inventory_id,
      owner_id: String(player_id),
      item_id: String(item_id),
      quantity,
      rarity: data.rarity || itemRecord?.rarity || "common",
      item_type: data.item_type || itemRecord?.item_type || "stackable"
    });
  } else {
    grantResult = inventoryAdapter.addDropToInventory({
      inventory_id,
      owner_character_id: player_id,
      drop: {
        item_id: String(item_id),
        quantity,
        rarity: data.rarity || "common"
      }
    });
  }

  if (!grantResult.ok) {
    // Rollback: refund gold.
    currencyManager.addCurrency({
      player_id,
      amount: goldCost,
      currency: "gold",
      reason: "npc_shop_purchase_refund_inventory_grant_failed",
      source_event_id: data.event_id || null
    });

    // Rollback: restore stock for limited items.
    if (stockReserved && !isInfinite) {
      npcShopManager.updateNpcShop(vendor_id, (existing) => ({
        quantity_map: {
          ...(existing.quantity_map || {}),
          [item_id]: (Number.isFinite(existing.quantity_map?.[item_id]) ? existing.quantity_map[item_id] : 0) + quantity
        }
      }));
    }

    return createFailure("inventory_grant_failed", {
      grant_result: grantResult,
      purchase_key
    });
  }

  // Step 4: Record transaction.
  const transaction_id =
    data.transaction_id ||
    `txn-shop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const transaction = transactionManager.createTransaction({
    transaction_id,
    transaction_type: "npc_shop_purchase",
    source_player_id: String(player_id),
    target_player_id: null,
    npc_vendor_id: String(vendor_id),
    item_id: String(item_id),
    quantity,
    gold_amount: goldCost,
    result: "success"
  });

  if (processedPurchaseStore && typeof processedPurchaseStore.add === "function") {
    processedPurchaseStore.add(purchase_key);
  }

  const account = currencyManager.getCurrencyAccount(player_id);
  const updatedShop = npcShopManager.getNpcShop(vendor_id);

  return {
    ok: true,
    event_type: "npc_shop_purchase_success",
    payload: {
      purchase_key,
      transaction_id: transaction.transaction_id,
      player_id: String(player_id),
      vendor_id: String(vendor_id),
      item_id: String(item_id),
      quantity,
      gold_spent: goldCost,
      gold_balance_after: account?.gold_balance ?? null,
      inventory_id,
      item_grant_result: grantResult,
      stock_after:
        updatedShop && !isInfinite
          ? Number.isFinite(updatedShop.quantity_map?.[item_id])
            ? updatedShop.quantity_map[item_id]
            : 0
          : null,
      purchase_result: "success",
      processed_at: new Date().toISOString()
    }
  };
}

module.exports = {
  ProcessedNpcShopPurchaseStore,
  processNpcShopPurchase
};
