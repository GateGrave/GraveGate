"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createId(prefix) {
  return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function createLootEntryObject(input) {
  const data = input || {};

  if (!data.item_id || String(data.item_id).trim() === "") {
    throw new Error("item_id is required");
  }

  const quantity = Number.isFinite(data.quantity)
    ? Math.max(1, Math.floor(Number(data.quantity)))
    : 1;

  return {
    loot_id: data.loot_id ? String(data.loot_id) : createId("loot"),
    item_id: String(data.item_id),
    item_name: data.item_name ? String(data.item_name) : "Unknown Item",
    rarity: data.rarity ? String(data.rarity) : "common",
    quantity,
    source_type: data.source_type ? String(data.source_type) : "unknown",
    source_id: data.source_id ? String(data.source_id) : "unknown",
    target_player_id: data.target_player_id ? String(data.target_player_id) : null,
    metadata: data.metadata && typeof data.metadata === "object" ? clone(data.metadata) : {}
  };
}

function createLootBundleObject(input) {
  const data = input || {};
  const entriesInput = Array.isArray(data.entries) ? data.entries : [];
  const entries = entriesInput.map((entry) => createLootEntryObject(entry));

  return {
    drop_id: data.drop_id ? String(data.drop_id) : createId("drop"),
    source_type: data.source_type ? String(data.source_type) : "unknown",
    source_id: data.source_id ? String(data.source_id) : "unknown",
    entries,
    metadata: data.metadata && typeof data.metadata === "object" ? clone(data.metadata) : {},
    created_at: data.created_at ? String(data.created_at) : new Date().toISOString()
  };
}

module.exports = {
  createLootEntryObject,
  createLootBundleObject
};
