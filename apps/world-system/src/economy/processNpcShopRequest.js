"use strict";

const { createInventoryCurrencyManager } = require("./inventoryCurrencyManager");
const { processNpcShopPurchase } = require("./npc-shop-purchase.flow");
const { processNpcShopSell } = require("./npc-shop-sell.flow");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(event_type, payload) {
  return {
    ok: true,
    event_type,
    payload: payload || {},
    error: null
  };
}

function failure(event_type, error, payload) {
  return {
    ok: false,
    event_type,
    payload: payload || {},
    error
  };
}

function loadPlayerCharacter(context, playerId) {
  const persistence = context && context.characterPersistence;
  if (!persistence || typeof persistence.listCharacters !== "function") {
    return null;
  }
  const listed = persistence.listCharacters();
  if (!listed || listed.ok !== true) {
    return null;
  }
  const rows = Array.isArray(listed.payload.characters) ? listed.payload.characters : [];
  return rows.find((entry) => String(entry && entry.player_id || "") === String(playerId || "")) || null;
}

function createInventoryService(inventoryPersistence) {
  if (!inventoryPersistence) {
    return null;
  }
  return {
    getInventory(inventoryId) {
      return inventoryPersistence.loadInventoryById(inventoryId);
    },
    saveInventory(inventory) {
      return inventoryPersistence.saveInventory(inventory);
    },
    listInventories() {
      return inventoryPersistence.listInventories();
    }
  };
}

function resolveItemIndex(context) {
  if (!context || typeof context.loadContentBundle !== "function") {
    return {};
  }
  const loaded = context.loadContentBundle();
  if (!loaded || loaded.ok !== true) {
    return {};
  }
  const content = loaded.payload && loaded.payload.content ? loaded.payload.content : {};
  const rows = Array.isArray(content.items) ? content.items : [];
  return rows.reduce((out, entry) => {
    const itemId = String(entry && entry.item_id || "").trim();
    if (itemId) {
      out[itemId] = clone(entry);
    }
    return out;
  }, {});
}

function resolveShopEntryFromContent(context, vendorId) {
  if (!context || typeof context.loadContentBundle !== "function") {
    return null;
  }
  const loaded = context.loadContentBundle();
  if (!loaded || loaded.ok !== true) {
    return null;
  }
  const content = loaded.payload && loaded.payload.content ? loaded.payload.content : {};
  const shops = Array.isArray(content.npc_shops) ? content.npc_shops : [];
  return shops.find((entry) => String(entry && entry.vendor_id || "") === String(vendorId || "")) || null;
}

function listShopEntriesFromContent(context) {
  if (!context || typeof context.loadContentBundle !== "function") {
    return [];
  }
  const loaded = context.loadContentBundle();
  if (!loaded || loaded.ok !== true) {
    return [];
  }
  const content = loaded.payload && loaded.payload.content ? loaded.payload.content : {};
  return Array.isArray(content.npc_shops) ? content.npc_shops : [];
}

function loadInventory(context, inventoryId) {
  const persistence = context && context.inventoryPersistence;
  if (!persistence || typeof persistence.loadInventoryById !== "function" || !inventoryId) {
    return null;
  }
  const loaded = persistence.loadInventoryById(inventoryId);
  if (!loaded || loaded.ok !== true || !loaded.payload || !loaded.payload.inventory) {
    return null;
  }
  return clone(loaded.payload.inventory);
}

function isSellableItem(item) {
  return Boolean(item && item.sellable === true);
}

function summarizeSellableInventory(inventory, itemIndex, playerId, vendorPriceMap) {
  const byItemId = new Map();
  const rows = Array.isArray(inventory && inventory.stackable_items) ? inventory.stackable_items : [];
  for (let i = 0; i < rows.length; i += 1) {
    const entry = rows[i];
    const itemId = String(entry && entry.item_id || "").trim();
    if (!itemId) continue;
    if (String(entry && entry.owner_player_id || "") !== String(playerId || "")) continue;
    const item = itemIndex[itemId] || null;
    if (!isSellableItem(item)) continue;
    const quantity = Number.isFinite(Number(entry.quantity)) ? Math.max(1, Math.floor(Number(entry.quantity))) : 1;
    if (!byItemId.has(itemId)) {
      byItemId.set(itemId, {
        item_id: itemId,
        item_name: item && item.name ? item.name : itemId,
        quantity: 0,
        sell_price_gold: Number.isFinite(Number(vendorPriceMap && vendorPriceMap[itemId]))
          ? Math.floor(Number(vendorPriceMap[itemId]) * 0.5)
          : 0
      });
    }
    byItemId.get(itemId).quantity += quantity;
  }
  return Array.from(byItemId.values())
    .filter((entry) => entry.quantity > 0)
    .sort((a, b) => a.item_name.localeCompare(b.item_name));
}

function ensureNpcShopSeeded(context, vendorId) {
  const npcShopManager = context && context.npcShopManager;
  if (!npcShopManager || typeof npcShopManager.getNpcShop !== "function") {
    return null;
  }
  const existing = npcShopManager.getNpcShop(vendorId);
  if (existing) {
    return existing;
  }

  const contentEntry = resolveShopEntryFromContent(context, vendorId);
  if (!contentEntry) {
    return null;
  }

  return npcShopManager.createNpcShop({
    vendor_id: contentEntry.vendor_id,
    vendor_name: contentEntry.vendor_name,
    stock_items: contentEntry.stock_items,
    price_map: contentEntry.price_map,
    quantity_map: contentEntry.quantity_map,
    infinite_stock_items: contentEntry.infinite_stock_items,
    shop_active: contentEntry.metadata && contentEntry.metadata.active !== false
  });
}

function listNpcShopForPlayer(input) {
  const data = input || {};
  const context = data.context || {};
  const vendorId = String(data.vendor_id || "vendor_starter_quartermaster").trim();
  const playerId = String(data.player_id || "").trim();

  if (!playerId) {
    return failure("player_shop_request_failed", "player_id is required");
  }

  const shop = ensureNpcShopSeeded(context, vendorId);
  if (!shop) {
    return failure("player_shop_request_failed", "shop not found", {
      vendor_id: vendorId
    });
  }
  const contentEntry = resolveShopEntryFromContent(context, vendorId);

  const playerCharacter = loadPlayerCharacter(context, playerId);
  const inventoryService = createInventoryService(context.inventoryPersistence);
  const currencyManager = createInventoryCurrencyManager({ inventoryService });
  const itemIndex = resolveItemIndex(context);
  const inventory = playerCharacter && playerCharacter.inventory_id ? loadInventory(context, playerCharacter.inventory_id) : null;
  const vendorEntries = listShopEntriesFromContent(context).map((entry) => ({
    vendor_id: entry.vendor_id,
    vendor_name: entry.vendor_name
  }));

  const stock = (context.npcShopManager.listNpcShopItems(vendorId) || []).map((entry) => {
    const item = itemIndex[String(entry.item_id || "")] || {};
    return {
      item_id: entry.item_id,
      item_name: item.name || entry.item_id,
      item_type: item.item_type || null,
      price_gold: entry.price_gold,
      quantity_available: entry.quantity_available,
      infinite_stock: entry.infinite_stock,
      item_available: entry.item_available
    };
  });

  const account = currencyManager.getCurrencyAccount(playerId);
  return success("player_shop_loaded", {
    vendor_id: vendorId,
    vendor_name: shop.vendor_name || vendorId,
    vendor_description:
      contentEntry && contentEntry.metadata && typeof contentEntry.metadata.description === "string"
        ? contentEntry.metadata.description
        : null,
    stock,
    vendors: vendorEntries,
    sellable_items: summarizeSellableInventory(inventory, itemIndex, playerId, shop.price_map || {}),
    gold: Number.isFinite(Number(account.gold_balance)) ? Number(account.gold_balance) : 0,
    inventory_id: playerCharacter && playerCharacter.inventory_id ? playerCharacter.inventory_id : null
  });
}

function processNpcShopBuyRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const vendorId = String(data.vendor_id || "vendor_starter_quartermaster").trim();
  const playerId = String(data.player_id || "").trim();
  const itemId = String(data.item_id || "").trim();
  const quantity = Number.isFinite(data.quantity) ? Math.max(1, Math.floor(Number(data.quantity))) : 1;

  if (!playerId) return failure("player_shop_buy_failed", "player_id is required");
  if (!itemId) return failure("player_shop_buy_failed", "item_id is required");

  ensureNpcShopSeeded(context, vendorId);

  const playerCharacter = loadPlayerCharacter(context, playerId);
  if (!playerCharacter || !playerCharacter.inventory_id) {
    return failure("player_shop_buy_failed", "player inventory is not available");
  }

  const inventoryService = createInventoryService(context.inventoryPersistence);
  const currencyManager = createInventoryCurrencyManager({ inventoryService });
  const out = processNpcShopPurchase({
    event_id: data.event_id || null,
    purchase_key: data.purchase_key || data.event_id || null,
    player_id: playerId,
    vendor_id: vendorId,
    item_id: itemId,
    quantity,
    inventory_id: playerCharacter.inventory_id,
    inventoryService,
    npcShopManager: context.npcShopManager,
    currencyManager,
    transactionManager: context.transactionManager,
    processedPurchaseStore: context.processedNpcShopPurchaseStore || null
  });

  if (!out.ok) {
    return failure("player_shop_buy_failed", out.payload && out.payload.reason ? out.payload.reason : (out.error || "shop purchase failed"), out.payload);
  }

  const account = currencyManager.getCurrencyAccount(playerId);
  const refreshed = listNpcShopForPlayer({
    context,
    player_id: playerId,
    vendor_id: vendorId
  });
  return success("player_shop_buy_processed", {
    vendor_id: vendorId,
    item_id: itemId,
    quantity,
    gold: Number(account.gold_balance || 0),
    result: out.payload || {},
    vendor_name: refreshed.ok ? refreshed.payload.vendor_name : null,
    stock: refreshed.ok ? refreshed.payload.stock : []
  });
}

function processNpcShopSellRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const vendorId = String(data.vendor_id || "vendor_starter_quartermaster").trim();
  const playerId = String(data.player_id || "").trim();
  const itemId = String(data.item_id || "").trim();
  const quantity = Number.isFinite(data.quantity) ? Math.max(1, Math.floor(Number(data.quantity))) : 1;

  if (!playerId) return failure("player_shop_sell_failed", "player_id is required");
  if (!itemId) return failure("player_shop_sell_failed", "item_id is required");

  ensureNpcShopSeeded(context, vendorId);

  const playerCharacter = loadPlayerCharacter(context, playerId);
  if (!playerCharacter || !playerCharacter.inventory_id) {
    return failure("player_shop_sell_failed", "player inventory is not available");
  }

  const inventoryService = createInventoryService(context.inventoryPersistence);
  const currencyManager = createInventoryCurrencyManager({ inventoryService });
  const itemIndex = resolveItemIndex(context);

  const out = processNpcShopSell({
    event_id: data.event_id || null,
    sell_key: data.sell_key || data.event_id || null,
    player_id: playerId,
    vendor_id: vendorId,
    item_id: itemId,
    quantity,
    inventory_id: playerCharacter.inventory_id,
    inventoryService,
    resolve_item_metadata(requestedItemId) {
      return itemIndex[String(requestedItemId || "")] || null;
    },
    npcShopManager: context.npcShopManager,
    currencyManager,
    transactionManager: context.transactionManager,
    processedSellStore: context.processedNpcShopSellStore || null
  });

  if (!out.ok) {
    return failure("player_shop_sell_failed", out.payload && out.payload.reason ? out.payload.reason : (out.error || "shop sell failed"), out.payload);
  }

  const account = currencyManager.getCurrencyAccount(playerId);
  const refreshed = listNpcShopForPlayer({
    context,
    player_id: playerId,
    vendor_id: vendorId
  });
  return success("player_shop_sell_processed", {
    vendor_id: vendorId,
    item_id: itemId,
    quantity,
    gold: Number(account.gold_balance || 0),
    result: out.payload || {},
    vendor_name: refreshed.ok ? refreshed.payload.vendor_name : null,
    stock: refreshed.ok ? refreshed.payload.stock : []
  });
}

module.exports = {
  listNpcShopForPlayer,
  processNpcShopBuyRequest,
  processNpcShopSellRequest
};
