"use strict";

const { createNpcShopRecord } = require("./npc-shop.schema");

class InMemoryNpcShopStore {
  constructor() {
    this.shops = new Map();
  }

  save(shop) {
    this.shops.set(shop.vendor_id, shop);
    return shop;
  }

  load(vendorId) {
    if (!vendorId) return null;
    return this.shops.get(String(vendorId)) || null;
  }

  list() {
    return Array.from(this.shops.values());
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class NpcShopManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryNpcShopStore();
  }

  createNpcShop(input) {
    const record = createNpcShopRecord(input);
    this.store.save(record);
    return clone(record);
  }

  getNpcShop(vendor_id) {
    const loaded = this.store.load(vendor_id);
    return loaded ? clone(loaded) : null;
  }

  updateNpcShop(vendor_id, updater) {
    const current = this.store.load(vendor_id);
    if (!current) return null;

    let next;
    if (typeof updater === "function") {
      next = updater(clone(current));
    } else {
      next = updater || {};
    }

    const merged = {
      ...current,
      ...next,
      vendor_id: current.vendor_id,
      updated_at: new Date().toISOString()
    };

    const finalRecord = createNpcShopRecord(merged);
    this.store.save(finalRecord);
    return clone(finalRecord);
  }

  listNpcShopItems(vendor_id) {
    const shop = this.store.load(vendor_id);
    if (!shop || !shop.shop_active) return [];

    return shop.stock_items.map((item_id) => {
      const isInfinite = shop.infinite_stock_items.includes(item_id);
      const quantity = isInfinite
        ? null
        : Number.isFinite(shop.quantity_map[item_id])
          ? Math.max(0, Math.floor(shop.quantity_map[item_id]))
          : 0;

      return {
        vendor_id: shop.vendor_id,
        item_id,
        price_gold: Number.isFinite(shop.price_map[item_id])
          ? Math.max(0, Math.floor(shop.price_map[item_id]))
          : 0,
        quantity_available: quantity,
        infinite_stock: isInfinite,
        item_available: isInfinite || quantity > 0
      };
    });
  }

  isItemAvailableInNpcShop(input) {
    const data = input || {};
    const vendorId = data.vendor_id;
    const itemId = data.item_id;

    if (!vendorId || String(vendorId).trim() === "") {
      return {
        ok: false,
        reason: "vendor_id_required",
        item_available: false
      };
    }
    if (!itemId || String(itemId).trim() === "") {
      return {
        ok: false,
        reason: "item_id_required",
        item_available: false
      };
    }

    const shop = this.store.load(vendorId);
    if (!shop) {
      return {
        ok: false,
        reason: "shop_not_found",
        item_available: false
      };
    }
    if (!shop.shop_active) {
      return {
        ok: true,
        reason: "shop_inactive",
        item_available: false
      };
    }

    const itemKey = String(itemId);
    if (!shop.stock_items.includes(itemKey)) {
      return {
        ok: true,
        reason: "item_not_stocked",
        item_available: false
      };
    }

    const infinite = shop.infinite_stock_items.includes(itemKey);
    const quantity = Number.isFinite(shop.quantity_map[itemKey])
      ? Math.max(0, Math.floor(shop.quantity_map[itemKey]))
      : 0;

    return {
      ok: true,
      reason: infinite || quantity > 0 ? "available" : "out_of_stock",
      item_available: infinite || quantity > 0,
      infinite_stock: infinite,
      quantity_available: infinite ? null : quantity
    };
  }
}

module.exports = {
  InMemoryNpcShopStore,
  NpcShopManager
};

