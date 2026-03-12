"use strict";

const { createGuildStorageRecord } = require("./guild-storage.schema");

class InMemoryGuildStorageStore {
  constructor() {
    this.storages = new Map();
  }

  save(storage) {
    this.storages.set(storage.guild_id, storage);
    return storage;
  }

  load(guildId) {
    if (!guildId) return null;
    return this.storages.get(String(guildId)) || null;
  }

  remove(guildId) {
    if (!guildId) return false;
    return this.storages.delete(String(guildId));
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class GuildStorageManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryGuildStorageStore();
  }

  ensureGuildStorage(guild_id) {
    const existing = this.store.load(guild_id);
    if (existing) return clone(existing);

    const created = createGuildStorageRecord({
      guild_id,
      storage_items: []
    });
    this.store.save(created);
    return clone(created);
  }

  getGuildStorage(guild_id) {
    const loaded = this.store.load(guild_id);
    return loaded ? clone(loaded) : null;
  }

  saveGuildStorage(storage) {
    const validated = createGuildStorageRecord(storage);
    this.store.save(validated);
    return clone(validated);
  }

  listStorageContents(guild_id) {
    const storage = this.store.load(guild_id);
    if (!storage) return [];
    return clone(storage.storage_items || []);
  }
}

module.exports = {
  InMemoryGuildStorageStore,
  GuildStorageManager
};

