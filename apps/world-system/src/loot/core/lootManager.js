"use strict";

const { createLootEntryObject, createLootBundleObject } = require("./lootModel");

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

class LootManager {
  constructor() {
    // In-memory bundle store keyed by drop_id.
    this.bundles = new Map();
  }

  createLootEntry(input) {
    try {
      const lootEntry = createLootEntryObject(input);
      return success("loot_entry_created", {
        loot_entry: clone(lootEntry)
      });
    } catch (error) {
      return failure("loot_entry_create_failed", error.message);
    }
  }

  createLootBundle(input) {
    try {
      const lootBundle = createLootBundleObject(input);
      this.bundles.set(lootBundle.drop_id, clone(lootBundle));

      return success("loot_bundle_created", {
        loot_bundle: clone(lootBundle)
      });
    } catch (error) {
      return failure("loot_bundle_create_failed", error.message);
    }
  }

  listBundleEntries(dropId) {
    if (!dropId || String(dropId).trim() === "") {
      return failure("loot_bundle_entries_list_failed", "drop_id is required");
    }

    const bundle = this.bundles.get(String(dropId));
    if (!bundle) {
      return failure("loot_bundle_entries_list_failed", "bundle not found", {
        drop_id: String(dropId)
      });
    }

    return success("loot_bundle_entries_listed", {
      drop_id: String(dropId),
      entries: clone(bundle.entries)
    });
  }
}

module.exports = {
  LootManager
};
