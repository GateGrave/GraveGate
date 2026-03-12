"use strict";

const LOOT_TABLE_SCHEMA = {
  table_id: "string",
  source_type: "string",
  source_id: "string",
  possible_drops: "array<object>",
  drop_weights: "object",
  guaranteed_drops: "array<object>",
  rarity_rules: "object"
};

function createLootTableRecord(input) {
  const data = input || {};

  if (!data.table_id) throw new Error("createLootTable requires table_id");
  if (!data.source_type) throw new Error("createLootTable requires source_type");
  if (!data.source_id) throw new Error("createLootTable requires source_id");

  return {
    table_id: String(data.table_id),
    source_type: String(data.source_type),
    source_id: String(data.source_id),
    possible_drops: Array.isArray(data.possible_drops) ? data.possible_drops : [],
    drop_weights: data.drop_weights && typeof data.drop_weights === "object" ? data.drop_weights : {},
    guaranteed_drops: Array.isArray(data.guaranteed_drops) ? data.guaranteed_drops : [],
    rarity_rules: data.rarity_rules && typeof data.rarity_rules === "object" ? data.rarity_rules : {}
  };
}

module.exports = {
  LOOT_TABLE_SCHEMA,
  createLootTableRecord
};

