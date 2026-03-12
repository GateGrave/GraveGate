"use strict";

// Loot drop core shape.
// This model is intentionally separate from inventory application logic.
const LOOT_DROP_SCHEMA = {
  loot_id: "string",
  source_type: "string",
  source_id: "string",
  party_id: "string|null",
  player_id: "string|null",
  item_id: "string",
  quantity: "number",
  rarity: "string",
  drop_type: "string",
  granted: "boolean",
  created_at: "string (ISO date)"
};

function createLootDropRecord(input) {
  const data = input || {};

  if (!data.loot_id) {
    throw new Error("createLootDrop requires loot_id");
  }
  if (!data.source_type) {
    throw new Error("createLootDrop requires source_type");
  }
  if (!data.source_id) {
    throw new Error("createLootDrop requires source_id");
  }
  if (!data.item_id) {
    throw new Error("createLootDrop requires item_id");
  }

  return {
    loot_id: String(data.loot_id),
    source_type: String(data.source_type),
    source_id: String(data.source_id),
    party_id: data.party_id ? String(data.party_id) : null,
    player_id: data.player_id ? String(data.player_id) : null,
    item_id: String(data.item_id),
    quantity: Number.isFinite(data.quantity) ? data.quantity : 1,
    rarity: String(data.rarity || "common"),
    drop_type: String(data.drop_type || "standard"),
    granted: Boolean(data.granted),
    created_at: data.created_at || new Date().toISOString()
  };
}

module.exports = {
  LOOT_DROP_SCHEMA,
  createLootDropRecord
};

