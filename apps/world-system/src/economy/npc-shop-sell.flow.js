"use strict";

const { createInventoryRecord } = require("../../../inventory-system/src/inventory.schema");
const {
  removeItemFromInventory: canonicalRemoveItemFromInventory,
  normalizeInventoryShape: canonicalNormalizeInventoryShape
} = require("../../../inventory-system/src/mutationHelpers");

class ProcessedNpcShopSellStore {
  constructor() {
    this.processed = new Set();
  }

  has(sell_key) {
    if (!sell_key) return false;
    return this.processed.has(String(sell_key));
  }

  add(sell_key) {
    if (!sell_key) return;
    this.processed.add(String(sell_key));
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFailure(reason, extra) {
  return {
    ok: false,
    event_type: "npc_shop_sell_failed",
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
  if (result.ok === false) return null;
  if (typeof result === "object") return result;
  return null;
}

function cloneCanonicalInventory(inv) {
  return JSON.parse(JSON.stringify(inv));
}

function resolveMutationHelpers(data) {
  const injected = data && data.mutation_helpers && typeof data.mutation_helpers === "object"
    ? data.mutation_helpers
    : null;

  return {
    removeItemFromInventory:
      injected && typeof injected.removeItemFromInventory === "function"
        ? injected.removeItemFromInventory
        : canonicalRemoveItemFromInventory,
    normalizeInventoryShape:
      injected && typeof injected.normalizeInventoryShape === "function"
        ? injected.normalizeInventoryShape
        : canonicalNormalizeInventoryShape
  };
}

function isExplicitlySharedOrUnownedEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.shared === true) return true;
  if (entry.unowned === true) return true;
  if (entry.owner_scope === "shared" || entry.owner_scope === "unowned") return true;
  if (entry.ownership_type === "shared" || entry.ownership_type === "unowned") return true;

  const meta = entry.metadata;
  if (meta && typeof meta === "object") {
    if (meta.shared === true || meta.unowned === true) return true;
    if (meta.owner_scope === "shared" || meta.owner_scope === "unowned") return true;
    if (meta.ownership_type === "shared" || meta.ownership_type === "unowned") return true;
  }

  return false;
}

function classifyEntryOwnershipForPlayer(entry, playerId) {
  if (!playerId) return "allowed";
  if (isExplicitlySharedOrUnownedEntry(entry)) return "allowed";

  const ownerPlayerId =
    entry && Object.prototype.hasOwnProperty.call(entry, "owner_player_id")
      ? String(entry.owner_player_id || "").trim()
      : "";

  if (!ownerPlayerId) return "ownership_unknown";
  if (ownerPlayerId !== String(playerId)) return "wrong_owner";
  return "allowed";
}

function removeItemFromCanonicalInventory(input) {
  const data = input || {};
  const inventoryService = data.inventoryService;
  const mutationHelpers = resolveMutationHelpers(data);
  const inventoryId = String(data.inventory_id);
  const playerId = String(data.player_id || "");
  const itemId = String(data.item_id);
  const quantity = Number.isFinite(data.quantity) ? Math.floor(data.quantity) : 0;

  if (!isInventoryServiceValid(inventoryService)) {
    return { ok: false, reason: "invalid_inventory_service" };
  }

  let inventory = extractInventoryFromResult(inventoryService.getInventory(inventoryId));
  if (!inventory) {
    inventory = createInventoryRecord({
      inventory_id: inventoryId,
      owner_type: "player",
      owner_id: playerId || null
    });
  }

  const normalized = mutationHelpers.normalizeInventoryShape(inventory);
  if (!normalized.ok) {
    return { ok: false, reason: "inventory_normalization_failed", normalize_result: normalized };
  }
  inventory = normalized.payload.inventory;
  const before = cloneCanonicalInventory(inventory);

  const buckets = ["stackable_items", "equipment_items", "quest_items"];
  const matches = [];
  let ownershipUnknownFound = false;

  for (const bucket of buckets) {
    for (const entry of inventory[bucket]) {
      if (!entry || entry.item_id !== itemId) continue;

      const ownership = classifyEntryOwnershipForPlayer(entry, playerId);
      if (ownership === "ownership_unknown") {
        ownershipUnknownFound = true;
        continue;
      }
      if (ownership !== "allowed") continue;
      matches.push({ bucket, entry });
    }
  }

  if (matches.length === 0) {
    if (ownershipUnknownFound) {
      return {
        ok: false,
        reason: "ownership_unknown",
        item_id: itemId
      };
    }
    return { ok: false, reason: "item_not_owned" };
  }

  const totalOwned = matches.reduce((sum, wrapped) => {
    const qty = Number.isFinite(wrapped.entry.quantity) ? Math.max(1, Math.floor(wrapped.entry.quantity)) : 1;
    return sum + qty;
  }, 0);
  if (totalOwned < quantity) {
    return {
      ok: false,
      reason: "insufficient_item_quantity",
      quantity_owned: totalOwned,
      quantity_requested: quantity
    };
  }

  const removeResult = mutationHelpers.removeItemFromInventory(inventory, itemId, quantity, {
    canRemoveEntry(entry) {
      return classifyEntryOwnershipForPlayer(entry, playerId) === "allowed";
    }
  });
  if (!removeResult || removeResult.ok !== true || !removeResult.payload || !removeResult.payload.inventory) {
    return {
      ok: false,
      reason: removeResult?.error || "inventory_remove_failed",
      remove_result: removeResult || null
    };
  }
  inventory = removeResult.payload.inventory;

  const saveResult = inventoryService.saveInventory(inventory);
  if (saveResult && saveResult.ok === false) {
    return { ok: false, reason: "inventory_save_failed", save_result: saveResult };
  }

  return {
    ok: true,
    removed_quantity: quantity,
    before_inventory: before,
    after_inventory: cloneCanonicalInventory(inventory),
    mutation_result: removeResult.payload.removed || null
  };
}

function makeSellKey(data) {
  return (
    data.sell_key ||
    data.event_id ||
    `${data.player_id || "unknown"}:${data.vendor_id || "unknown"}:${data.item_id || "unknown"}:${data.quantity || 0}`
  );
}

function hasExplicitSellableFlag(itemRecord) {
  if (!itemRecord || typeof itemRecord !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(itemRecord, "sellable")) return true;
  if (
    itemRecord.flags &&
    typeof itemRecord.flags === "object" &&
    Object.prototype.hasOwnProperty.call(itemRecord.flags, "sellable")
  ) {
    return true;
  }
  return false;
}

function isMarkedUnsellable(itemRecord) {
  return Boolean(
    itemRecord?.sellable === false ||
      (itemRecord?.flags && typeof itemRecord.flags === "object" && itemRecord.flags.sellable === false)
  );
}

function resolveItemMetadataForSell(data, itemStore, itemId) {
  if (itemStore && typeof itemStore.loadItem === "function") {
    return itemStore.loadItem(itemId);
  }

  if (data.item_record && typeof data.item_record === "object") {
    return data.item_record;
  }

  if (typeof data.resolve_item_metadata === "function") {
    return data.resolve_item_metadata(itemId);
  }

  return null;
}

function defaultRemoveItemFromInventory(input) {
  const data = input || {};
  const inventoryStore = data.inventoryStore;
  const inventory_id = data.inventory_id;
  const item_id = data.item_id;
  const quantity = data.quantity;

  if (!inventoryStore) {
    return { ok: false, reason: "inventory_store_required" };
  }

  const inventory = inventoryStore.loadInventory(inventory_id);
  if (!inventory) {
    return { ok: false, reason: "inventory_not_found" };
  }

  const entries = Array.isArray(inventory.item_entries) ? inventory.item_entries : [];
  const matchingEntries = entries.filter((x) => x.item_id === item_id);
  if (matchingEntries.length === 0) {
    return { ok: false, reason: "item_not_owned" };
  }

  const totalOwned = matchingEntries.reduce(
    (sum, entry) => sum + (Number.isFinite(entry.quantity) ? Math.floor(entry.quantity) : 1),
    0
  );
  if (totalOwned < quantity) {
    return {
      ok: false,
      reason: "insufficient_item_quantity",
      quantity_owned: totalOwned,
      quantity_requested: quantity
    };
  }

  const before = clone(inventory);
  const workingEntries = clone(entries);

  let remaining = quantity;
  for (const entry of workingEntries) {
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
    item_entries: workingEntries.filter((x) => (Number.isFinite(x.quantity) ? x.quantity : 1) > 0)
  };

  inventoryStore.saveInventory(next);
  return {
    ok: true,
    removed_quantity: quantity,
    before_inventory: before,
    after_inventory: next
  };
}

function processNpcShopSell(input) {
  const data = input || {};
  const npcShopManager = data.npcShopManager;
  const currencyManager = data.currencyManager;
  const transactionManager = data.transactionManager;
  const processedSellStore = data.processedSellStore || null;
  const worldStorage = data.worldStorage || null;
  const inventoryService = data.inventoryService || null;
  const inventoryStore = worldStorage?.inventories || null;
  const itemStore = worldStorage?.items || null;
  const removeItemFromInventory = data.removeItemFromInventory || defaultRemoveItemFromInventory;

  const hasLegacyStorage = Boolean(inventoryStore && itemStore);
  if (!npcShopManager || !currencyManager || !transactionManager || (!hasLegacyStorage && !inventoryService)) {
    return createFailure("required_manager_missing", {
      requires: [
        "npcShopManager",
        "currencyManager",
        "transactionManager",
        "worldStorage.inventories+worldStorage.items_or_inventoryService"
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
  const sell_key = makeSellKey(data);
  const inventory_id = data.inventory_id || `inv-${player_id || "unknown"}`;

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

  if (processedSellStore && typeof processedSellStore.has === "function") {
    if (processedSellStore.has(sell_key)) {
      return {
        ok: true,
        event_type: "npc_shop_sell_skipped",
        payload: {
          reason: "duplicate_sell_key",
          sell_key,
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

  const itemRecord = resolveItemMetadataForSell(data, itemStore, item_id);
  if (data.force_sellable !== true && !hasExplicitSellableFlag(itemRecord)) {
    return createFailure("item_sellability_unknown", {
      item_id: String(item_id)
    });
  }

  const isSellable = data.force_sellable === true ? true : !isMarkedUnsellable(itemRecord);
  if (!isSellable) {
    return createFailure("item_unsellable", {
      item_id: String(item_id)
    });
  }

  // Step 1: Remove items from inventory.
  let removalResult;
  try {
    if (inventoryService) {
      removalResult = removeItemFromCanonicalInventory({
        inventoryService,
        mutation_helpers: data.mutation_helpers,
        inventory_id,
        player_id,
        item_id: String(item_id),
        quantity
      });
    } else {
      removalResult = removeItemFromInventory({
        inventoryStore,
        inventory_id,
        player_id,
        item_id: String(item_id),
        quantity
      });
    }
  } catch (error) {
    return createFailure("inventory_removal_failed", {
      message: error.message
    });
  }

  if (!removalResult || !removalResult.ok) {
    return createFailure("inventory_removal_failed", {
      remove_result: removalResult || null
    });
  }

  // Step 2: Pay gold.
  const basePrice = Number.isFinite(shop.price_map?.[item_id]) ? Math.max(0, Math.floor(shop.price_map[item_id])) : 0;
  const sellRatio = Number.isFinite(data.sell_ratio) ? Math.max(0, data.sell_ratio) : 0.5;
  const goldPerItem =
    Number.isFinite(data.gold_per_item) && data.gold_per_item >= 0
      ? Math.floor(data.gold_per_item)
      : Math.floor(basePrice * sellRatio);
  const payoutGold = goldPerItem * quantity;

  const payoutResult = currencyManager.addCurrency({
    player_id,
    amount: payoutGold,
    currency: "gold",
    reason: "npc_shop_sell",
    source_event_id: data.event_id || null
  });

  if (!payoutResult.ok) {
    // Roll back inventory removal when payout fails.
    if (removalResult.before_inventory) {
      try {
        if (inventoryService) {
          inventoryService.saveInventory(removalResult.before_inventory);
        } else {
          inventoryStore.saveInventory(removalResult.before_inventory);
        }
      } catch (error) {
        return createFailure("currency_payout_failed_and_inventory_rollback_failed", {
          payout_result: payoutResult,
          rollback_error: error.message
        });
      }
    }
    return createFailure("currency_payout_failed", {
      payout_result: payoutResult
    });
  }

  // Step 3: Optional vendor stock update.
  let stockUpdateStatus = "skipped";
  if (data.add_to_vendor_stock === true) {
    const current = Number.isFinite(shop.quantity_map?.[item_id]) ? Math.floor(shop.quantity_map[item_id]) : 0;
    const stockItems = Array.isArray(shop.stock_items) ? [...shop.stock_items] : [];
    if (!stockItems.includes(String(item_id))) stockItems.push(String(item_id));

    const updated = npcShopManager.updateNpcShop(vendor_id, {
      stock_items: stockItems,
      quantity_map: {
        ...(shop.quantity_map || {}),
        [item_id]: current + quantity
      }
    });
    stockUpdateStatus = updated ? "updated" : "failed_to_update";
  }

  // Step 4: Record transaction.
  const transaction_id =
    data.transaction_id ||
    `txn-shop-sell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const transaction = transactionManager.createTransaction({
    transaction_id,
    transaction_type: "npc_shop_sell",
    source_player_id: String(player_id),
    target_player_id: null,
    npc_vendor_id: String(vendor_id),
    item_id: String(item_id),
    quantity,
    gold_amount: payoutGold,
    result: "success"
  });

  if (processedSellStore && typeof processedSellStore.add === "function") {
    processedSellStore.add(sell_key);
  }

  const account = currencyManager.getCurrencyAccount(player_id);
  return {
    ok: true,
    event_type: "npc_shop_sell_success",
    payload: {
      sell_key,
      transaction_id: transaction.transaction_id,
      player_id: String(player_id),
      vendor_id: String(vendor_id),
      item_id: String(item_id),
      quantity,
      gold_earned: payoutGold,
      gold_balance_after: account?.gold_balance ?? null,
      inventory_id,
      stock_update_status: stockUpdateStatus,
      sell_result: "success",
      processed_at: new Date().toISOString()
    }
  };
}

module.exports = {
  ProcessedNpcShopSellStore,
  processNpcShopSell,
  defaultRemoveItemFromInventory
};
