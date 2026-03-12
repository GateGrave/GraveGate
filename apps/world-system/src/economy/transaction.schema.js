"use strict";

// Economy transaction shape.
// This record is an audit trail only and does not mutate inventory/currency by itself.
const ECONOMY_TRANSACTION_SCHEMA = {
  transaction_id: "string",
  transaction_type: "string",
  source_player_id: "string|null",
  target_player_id: "string|null",
  npc_vendor_id: "string|null",
  item_id: "string|null",
  quantity: "number",
  gold_amount: "number",
  result: "string",
  created_at: "string (ISO date)"
};

function sanitizeOptionalString(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function createTransactionRecord(input) {
  const data = input || {};

  if (!data.transaction_id || String(data.transaction_id).trim() === "") {
    throw new Error("createTransaction requires transaction_id");
  }
  if (!data.transaction_type || String(data.transaction_type).trim() === "") {
    throw new Error("createTransaction requires transaction_type");
  }

  const quantity = Number.isFinite(data.quantity) ? Math.floor(data.quantity) : 0;
  const goldAmount = Number.isFinite(data.gold_amount) ? Math.floor(data.gold_amount) : 0;
  if (quantity < 0) {
    throw new Error("createTransaction requires non-negative quantity");
  }
  if (goldAmount < 0) {
    throw new Error("createTransaction requires non-negative gold_amount");
  }

  return {
    transaction_id: String(data.transaction_id),
    transaction_type: String(data.transaction_type),
    source_player_id: sanitizeOptionalString(data.source_player_id),
    target_player_id: sanitizeOptionalString(data.target_player_id),
    npc_vendor_id: sanitizeOptionalString(data.npc_vendor_id),
    item_id: sanitizeOptionalString(data.item_id),
    quantity,
    gold_amount: goldAmount,
    result: String(data.result || "pending"),
    created_at: data.created_at || new Date().toISOString()
  };
}

module.exports = {
  ECONOMY_TRANSACTION_SCHEMA,
  createTransactionRecord
};

