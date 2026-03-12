"use strict";

const { createLootDropRecord } = require("./loot-drop.schema");

class InMemoryLootDropStore {
  constructor() {
    this.lootDrops = new Map();
  }

  save(lootDrop) {
    this.lootDrops.set(lootDrop.loot_id, lootDrop);
    return lootDrop;
  }

  load(lootId) {
    if (!lootId) return null;
    return this.lootDrops.get(lootId) || null;
  }

  remove(lootId) {
    if (!lootId) return false;
    return this.lootDrops.delete(lootId);
  }

  list() {
    return Array.from(this.lootDrops.values());
  }
}

class LootDropManager {
  constructor(options) {
    const config = options || {};
    this.store = config.store || new InMemoryLootDropStore();
  }

  createLootDrop(input) {
    const record = createLootDropRecord(input);
    this.store.save(record);
    return record;
  }

  getLootDrop(loot_id) {
    return this.store.load(loot_id);
  }

  updateLootDrop(loot_id, updater) {
    const current = this.getLootDrop(loot_id);
    if (!current) return null;

    let next;
    if (typeof updater === "function") {
      next = updater(current);
    } else {
      next = { ...current, ...(updater || {}) };
    }

    const finalRecord = {
      ...current,
      ...next,
      loot_id: current.loot_id,
      created_at: current.created_at
    };

    this.store.save(finalRecord);
    return finalRecord;
  }

  deleteLootDrop(loot_id) {
    return this.store.remove(loot_id);
  }

  listLootDropsBySource(source_type, source_id) {
    if (!source_type || !source_id) {
      return [];
    }

    return this.store
      .list()
      .filter((drop) => drop.source_type === source_type && drop.source_id === source_id);
  }
}

module.exports = {
  InMemoryLootDropStore,
  LootDropManager
};
