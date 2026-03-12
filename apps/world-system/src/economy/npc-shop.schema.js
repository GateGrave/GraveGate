"use strict";

// NPC shop shape. This model only represents shop inventory/availability state.
// Purchase mutation is handled by separate systems in later phases.
const NPC_SHOP_SCHEMA = {
  vendor_id: "string",
  vendor_name: "string",
  stock_items: "array",
  price_map: "object",
  quantity_map: "object",
  infinite_stock_items: "array",
  shop_active: "boolean",
  updated_at: "string (ISO date)"
};

function normalizeItemIdArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((x) => (x === null || x === undefined ? null : String(x)))
    .filter((x) => Boolean(x));
}

function normalizeNumberMap(value) {
  if (!value || typeof value !== "object") return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const num = Number.isFinite(raw) ? Math.floor(raw) : 0;
    out[String(key)] = Math.max(0, num);
  }
  return out;
}

function createNpcShopRecord(input) {
  const data = input || {};
  if (!data.vendor_id || String(data.vendor_id).trim() === "") {
    throw new Error("createNpcShop requires vendor_id");
  }

  const stockItems = normalizeItemIdArray(data.stock_items);
  const infiniteItems = normalizeItemIdArray(data.infinite_stock_items);
  const stockSet = new Set([...stockItems, ...infiniteItems]);

  return {
    vendor_id: String(data.vendor_id),
    vendor_name: String(data.vendor_name || "Unnamed Vendor"),
    stock_items: Array.from(stockSet),
    price_map: normalizeNumberMap(data.price_map),
    quantity_map: normalizeNumberMap(data.quantity_map),
    infinite_stock_items: infiniteItems,
    shop_active: data.shop_active !== false,
    updated_at: data.updated_at || new Date().toISOString()
  };
}

module.exports = {
  NPC_SHOP_SCHEMA,
  createNpcShopRecord
};

