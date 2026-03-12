"use strict";

const VALID_TRADE_STATES = new Set([
  "pending",
  "completed",
  "declined",
  "cancelled"
]);

function ensureString(value, field) {
  if (!value || String(value).trim() === "") {
    throw new Error(field + " is required");
  }
  return String(value);
}

function normalizeOffer(value, field) {
  const data = value || {};
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(field + " must be an object");
  }

  const itemId = data.item_id ? String(data.item_id) : "";
  const quantity = Number.isFinite(data.quantity) ? Math.floor(data.quantity) : NaN;
  const currency = Number.isFinite(data.currency) ? Math.floor(data.currency) : 0;

  if (!itemId && !Number.isFinite(currency)) {
    throw new Error(field + " must include item_id/quantity or currency");
  }
  if (itemId && (!Number.isFinite(quantity) || quantity <= 0)) {
    throw new Error(field + ".quantity must be a positive number");
  }
  if (Number.isFinite(currency) && currency < 0) {
    throw new Error(field + ".currency cannot be negative");
  }

  return {
    item_id: itemId || null,
    quantity: itemId ? quantity : null,
    currency: Number.isFinite(currency) ? currency : 0
  };
}

function createPlayerTradeRecord(input) {
  const data = input || {};
  const initiatorPlayerId = ensureString(data.initiator_player_id, "initiator_player_id");
  const counterpartyPlayerId = ensureString(data.counterparty_player_id, "counterparty_player_id");
  if (initiatorPlayerId === counterpartyPlayerId) {
    throw new Error("initiator_player_id and counterparty_player_id must differ");
  }

  const state = data.trade_state ? String(data.trade_state) : "pending";
  if (!VALID_TRADE_STATES.has(state)) {
    throw new Error("trade_state is invalid");
  }

  const now = new Date().toISOString();
  return {
    trade_id: ensureString(data.trade_id, "trade_id"),
    initiator_player_id: initiatorPlayerId,
    counterparty_player_id: counterpartyPlayerId,
    offered: normalizeOffer(data.offered, "offered"),
    requested: normalizeOffer(data.requested || {}, "requested"),
    trade_state: state,
    status_reason: data.status_reason ? String(data.status_reason) : null,
    execution_result:
      data.execution_result && typeof data.execution_result === "object" && !Array.isArray(data.execution_result)
        ? data.execution_result
        : null,
    created_at: data.created_at || now,
    updated_at: data.updated_at || now,
    completed_at: data.completed_at || null
  };
}

module.exports = {
  VALID_TRADE_STATES,
  createPlayerTradeRecord
};

