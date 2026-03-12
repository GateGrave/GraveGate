"use strict";

const { createLootTableObject } = require("./lootTableModel");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {},
    error: null
  };
}

function failure(eventType, message, payload) {
  return {
    ok: false,
    event_type: eventType,
    payload: payload || {},
    error: message
  };
}

class LootTableCoreManager {
  constructor() {
    // In-memory table store keyed by loot_table_id.
    this.tables = new Map();
  }

  createLootTable(input) {
    try {
      const table = createLootTableObject(input);
      if (this.tables.has(table.loot_table_id)) {
        return failure("loot_table_create_failed", "loot_table_id already exists", {
          loot_table_id: table.loot_table_id
        });
      }

      this.tables.set(table.loot_table_id, clone(table));
      return success("loot_table_created", {
        loot_table: clone(table)
      });
    } catch (error) {
      return failure("loot_table_create_failed", error.message);
    }
  }

  getLootTableById(lootTableId) {
    if (!lootTableId || String(lootTableId).trim() === "") {
      return failure("loot_table_fetch_failed", "loot_table_id is required");
    }

    const table = this.tables.get(String(lootTableId));
    if (!table) {
      return failure("loot_table_fetch_failed", "loot table not found", {
        loot_table_id: String(lootTableId)
      });
    }

    return success("loot_table_found", {
      loot_table: clone(table)
    });
  }

  listWeightedEntries(lootTableId) {
    const found = this.getLootTableById(lootTableId);
    if (!found.ok) {
      return failure("loot_table_weighted_list_failed", found.error, found.payload);
    }

    return success("loot_table_weighted_entries_listed", {
      loot_table_id: String(lootTableId),
      weighted_entries: clone(found.payload.loot_table.weighted_entries)
    });
  }

  listGuaranteedEntries(lootTableId) {
    const found = this.getLootTableById(lootTableId);
    if (!found.ok) {
      return failure("loot_table_guaranteed_list_failed", found.error, found.payload);
    }

    return success("loot_table_guaranteed_entries_listed", {
      loot_table_id: String(lootTableId),
      guaranteed_entries: clone(found.payload.loot_table.guaranteed_entries)
    });
  }
}

module.exports = {
  LootTableCoreManager
};
