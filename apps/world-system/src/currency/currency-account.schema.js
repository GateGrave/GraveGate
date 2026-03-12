"use strict";

// Currency account shape for persistent world economy data.
// `balances` allows easy expansion beyond gold in future phases.
const CURRENCY_ACCOUNT_SCHEMA = {
  player_id: "string",
  gold_balance: "number",
  balances: "object",
  updated_at: "string (ISO date)",
  transaction_log: "array"
};

function createCurrencyAccountRecord(input) {
  const data = input || {};
  if (!data.player_id || String(data.player_id).trim() === "") {
    throw new Error("createCurrencyAccount requires player_id");
  }

  const now = new Date().toISOString();
  const providedGold = Number.isFinite(data.gold_balance) ? Math.floor(data.gold_balance) : 0;
  const balances = {
    gold: providedGold,
    ...(data.balances && typeof data.balances === "object" ? data.balances : {})
  };

  return {
    player_id: String(data.player_id),
    gold_balance: Number.isFinite(balances.gold) ? Math.floor(balances.gold) : 0,
    balances,
    updated_at: data.updated_at || now,
    transaction_log: Array.isArray(data.transaction_log) ? data.transaction_log : []
  };
}

module.exports = {
  CURRENCY_ACCOUNT_SCHEMA,
  createCurrencyAccountRecord
};

