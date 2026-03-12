"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createId(prefix) {
  return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function normalizeQuantityFields(input) {
  const data = input || {};

  const hasFixedQuantity = Number.isFinite(data.quantity);
  const quantity = hasFixedQuantity ? Math.max(1, Math.floor(Number(data.quantity))) : null;

  const min = Number.isFinite(data.quantity_min)
    ? Math.max(1, Math.floor(Number(data.quantity_min)))
    : null;
  const max = Number.isFinite(data.quantity_max)
    ? Math.max(1, Math.floor(Number(data.quantity_max)))
    : null;

  if (quantity !== null) {
    return {
      quantity,
      quantity_min: null,
      quantity_max: null
    };
  }

  if (min !== null || max !== null) {
    const safeMin = min !== null ? min : 1;
    const safeMax = max !== null ? max : safeMin;

    return {
      quantity: null,
      quantity_min: Math.min(safeMin, safeMax),
      quantity_max: Math.max(safeMin, safeMax)
    };
  }

  return {
    quantity: 1,
    quantity_min: null,
    quantity_max: null
  };
}

function normalizeWeightedEntry(input) {
  const data = input || {};
  if (!data.item_id || String(data.item_id).trim() === "") {
    throw new Error("weighted entry item_id is required");
  }

  const quantityFields = normalizeQuantityFields(data);
  const weight = Number.isFinite(data.weight) ? Math.max(0, Number(data.weight)) : 0;

  return {
    item_id: String(data.item_id),
    item_name: data.item_name ? String(data.item_name) : "Unknown Item",
    weight,
    rarity: data.rarity ? String(data.rarity) : "common",
    quantity: quantityFields.quantity,
    quantity_min: quantityFields.quantity_min,
    quantity_max: quantityFields.quantity_max
  };
}

function normalizeGuaranteedEntry(input) {
  const data = input || {};
  if (!data.item_id || String(data.item_id).trim() === "") {
    throw new Error("guaranteed entry item_id is required");
  }

  const quantityFields = normalizeQuantityFields(data);

  return {
    item_id: String(data.item_id),
    item_name: data.item_name ? String(data.item_name) : "Unknown Item",
    rarity: data.rarity ? String(data.rarity) : "common",
    quantity: quantityFields.quantity,
    quantity_min: quantityFields.quantity_min,
    quantity_max: quantityFields.quantity_max
  };
}

function createLootTableObject(input) {
  const data = input || {};

  const weightedInput = Array.isArray(data.weighted_entries) ? data.weighted_entries : [];
  const guaranteedInput = Array.isArray(data.guaranteed_entries) ? data.guaranteed_entries : [];

  return {
    loot_table_id: data.loot_table_id ? String(data.loot_table_id) : createId("loot-table"),
    name: data.name ? String(data.name) : "Unnamed Loot Table",
    weighted_entries: weightedInput.map((entry) => normalizeWeightedEntry(entry)),
    guaranteed_entries: guaranteedInput.map((entry) => normalizeGuaranteedEntry(entry)),
    metadata: data.metadata && typeof data.metadata === "object" ? clone(data.metadata) : {}
  };
}

module.exports = {
  createLootTableObject,
  normalizeWeightedEntry,
  normalizeGuaranteedEntry
};
