"use strict";

const GUILD_STORAGE_SCHEMA = {
  guild_id: "string",
  storage_items: "array",
  updated_at: "string (ISO date)"
};

function normalizeStorageItems(items) {
  if (!Array.isArray(items)) {
    throw new Error("storage_items must be an array");
  }

  const map = new Map();
  items.forEach((row, index) => {
    if (!row || typeof row !== "object") {
      throw new Error("storage_items row must be object at index " + index);
    }
    if (!row.item_id || String(row.item_id).trim() === "") {
      throw new Error("storage_items row requires item_id at index " + index);
    }
    const quantity = Math.floor(Number(row.quantity));
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error("storage_items row quantity must be >= 0 at index " + index);
    }
    if (quantity === 0) return;

    const key = String(row.item_id);
    map.set(key, (map.get(key) || 0) + quantity);
  });

  return Array.from(map.entries()).map(([item_id, quantity]) => ({
    item_id,
    quantity
  }));
}

function createGuildStorageRecord(input) {
  const data = input || {};
  if (!data.guild_id || String(data.guild_id).trim() === "") {
    throw new Error("createGuildStorage requires guild_id");
  }

  return {
    guild_id: String(data.guild_id),
    storage_items: normalizeStorageItems(data.storage_items || []),
    updated_at: data.updated_at || new Date().toISOString()
  };
}

module.exports = {
  GUILD_STORAGE_SCHEMA,
  createGuildStorageRecord
};

