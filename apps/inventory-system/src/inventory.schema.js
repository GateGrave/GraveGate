"use strict";

const INVENTORY_SCHEMA = {
  inventory_id: "string",
  owner_type: "string",
  owner_id: "string|null",
  currency: "object",
  stackable_items: "array",
  equipment_items: "array",
  quest_items: "array",
  metadata: "object",
  created_at: "string",
  updated_at: "string"
};

function createId(prefix) {
  return String(prefix) + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toSafeObject(value, fallback) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return fallback;
}

function toSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCurrency(inputCurrency) {
  const base = {
    gold: 0,
    silver: 0,
    copper: 0
  };

  const currency = toSafeObject(inputCurrency, {});
  const result = Object.assign({}, base, currency);

  if (!Number.isFinite(result.gold)) result.gold = 0;
  if (!Number.isFinite(result.silver)) result.silver = 0;
  if (!Number.isFinite(result.copper)) result.copper = 0;

  // Keep values simple and non-negative for scaffold safety.
  result.gold = Math.max(0, Math.floor(Number(result.gold)));
  result.silver = Math.max(0, Math.floor(Number(result.silver)));
  result.copper = Math.max(0, Math.floor(Number(result.copper)));

  return result;
}

function createInventoryRecord(input) {
  const data = toSafeObject(input, {});
  const now = new Date().toISOString();

  return {
    inventory_id: data.inventory_id ? String(data.inventory_id) : createId("inventory"),
    owner_type: data.owner_type ? String(data.owner_type) : "player",
    owner_id: data.owner_id ? String(data.owner_id) : null,
    currency: normalizeCurrency(data.currency),
    stackable_items: toSafeArray(data.stackable_items),
    equipment_items: toSafeArray(data.equipment_items),
    quest_items: toSafeArray(data.quest_items),
    metadata: toSafeObject(data.metadata, {}),
    created_at: data.created_at ? String(data.created_at) : now,
    updated_at: data.updated_at ? String(data.updated_at) : now
  };
}

function buildInventory(input) {
  if (input !== undefined && (input === null || typeof input !== "object" || Array.isArray(input))) {
    return {
      ok: false,
      event_type: "inventory_schema_build_failed",
      payload: { inventory: null },
      error: "input must be an object when provided"
    };
  }

  const inventory = createInventoryRecord(input);
  return {
    ok: true,
    event_type: "inventory_schema_built",
    payload: {
      inventory: clone(inventory)
    },
    error: null
  };
}

module.exports = {
  INVENTORY_SCHEMA,
  createInventoryRecord,
  buildInventory
};
