"use strict";

const { createPlayerShopRecord } = require("./player-shop.schema");

class InMemoryPlayerShopStore {
  constructor() {
    this.shops = new Map();
  }

  save(shop) {
    this.shops.set(shop.shop_id, shop);
    return shop;
  }

  load(shopId) {
    if (!shopId) return null;
    return this.shops.get(String(shopId)) || null;
  }

  list() {
    return Array.from(this.shops.values());
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class PlayerShopManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryPlayerShopStore();
  }

  createPlayerShop(input) {
    const record = createPlayerShopRecord(input);
    this.store.save(record);
    return clone(record);
  }

  getPlayerShop(shop_id) {
    const loaded = this.store.load(shop_id);
    return loaded ? clone(loaded) : null;
  }

  updatePlayerShop(shop_id, updater) {
    const current = this.store.load(shop_id);
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
      shop_id: current.shop_id,
      owner_player_id: current.owner_player_id,
      created_at: current.created_at,
      updated_at: new Date().toISOString()
    };

    const finalRecord = createPlayerShopRecord(merged);
    this.store.save(finalRecord);
    return clone(finalRecord);
  }

  listPlayerShopListings(shop_id) {
    const shop = this.store.load(shop_id);
    if (!shop || !shop.shop_active) return [];
    return clone(shop.listings || []);
  }

  deactivatePlayerShop(shop_id) {
    const current = this.store.load(shop_id);
    if (!current) return null;
    return this.updatePlayerShop(shop_id, { shop_active: false });
  }
}

module.exports = {
  InMemoryPlayerShopStore,
  PlayerShopManager
};
