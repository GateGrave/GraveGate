"use strict";

const { createRaidRecord } = require("./raid.schema");

class InMemoryRaidStore {
  constructor() {
    this.raids = new Map();
  }

  save(raid) {
    this.raids.set(raid.raid_id, raid);
    return raid;
  }

  load(raidId) {
    if (!raidId) return null;
    return this.raids.get(String(raidId)) || null;
  }

  remove(raidId) {
    if (!raidId) return false;
    return this.raids.delete(String(raidId));
  }

  list() {
    return Array.from(this.raids.values());
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class RaidManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryRaidStore();
  }

  createRaidInstance(input) {
    const record = createRaidRecord(input);
    if (this.store.load(record.raid_id)) {
      throw new Error("createRaidInstance requires unique raid_id");
    }
    this.store.save(record);
    return clone(record);
  }

  getRaidInstance(raid_id) {
    const raid = this.store.load(raid_id);
    return raid ? clone(raid) : null;
  }

  updateRaidInstance(raid_id, updater) {
    const current = this.store.load(raid_id);
    if (!current) return null;

    let patch;
    if (typeof updater === "function") {
      patch = updater(clone(current));
    } else {
      patch = updater || {};
    }

    const merged = {
      ...current,
      ...patch,
      raid_id: current.raid_id,
      created_at: current.created_at,
      updated_at: new Date().toISOString()
    };

    const validated = createRaidRecord(merged);
    this.store.save(validated);
    return clone(validated);
  }

  deleteRaidInstance(raid_id) {
    return this.store.remove(raid_id);
  }

  listRaidParticipants(raid_id) {
    const raid = this.store.load(raid_id);
    if (!raid) {
      return {
        participating_party_ids: [],
        participating_player_ids: []
      };
    }

    return {
      participating_party_ids: clone(raid.participating_party_ids || []),
      participating_player_ids: clone(raid.participating_player_ids || [])
    };
  }
}

module.exports = {
  InMemoryRaidStore,
  RaidManager
};

