"use strict";

const { createCurrencyAccountRecord } = require("./currency-account.schema");

class InMemoryCurrencyAccountStore {
  constructor() {
    this.accounts = new Map();
  }

  save(account) {
    this.accounts.set(account.player_id, account);
    return account;
  }

  load(playerId) {
    if (!playerId) return null;
    return this.accounts.get(String(playerId)) || null;
  }

  list() {
    return Array.from(this.accounts.values());
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCurrencyCode(currency) {
  if (!currency) return "gold";
  return String(currency).toLowerCase();
}

function buildEventResult(event_type, payload, ok) {
  return {
    ok: Boolean(ok),
    event_type,
    payload
  };
}

class CurrencyAccountManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryCurrencyAccountStore();
    this.allowNegativeBalance = Boolean(cfg.allow_negative_balance);
  }

  createCurrencyAccount(input) {
    const record = createCurrencyAccountRecord(input);
    this.store.save(record);
    return clone(record);
  }

  getCurrencyAccount(player_id) {
    const loaded = this.store.load(player_id);
    return loaded ? clone(loaded) : null;
  }

  hasSufficientFunds(input) {
    const data = input || {};
    const playerId = data.player_id;
    const amount = Number.isFinite(data.amount) ? Math.floor(data.amount) : NaN;
    const currency = normalizeCurrencyCode(data.currency);

    if (!playerId || String(playerId).trim() === "") {
      return false;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return false;
    }

    const account = this.store.load(playerId);
    if (!account) return false;

    const balance = Number.isFinite(account.balances?.[currency])
      ? Math.floor(account.balances[currency])
      : 0;
    return balance >= amount;
  }

  addCurrency(input) {
    const data = input || {};
    const playerId = data.player_id;
    const amount = Number.isFinite(data.amount) ? Math.floor(data.amount) : NaN;
    const currency = normalizeCurrencyCode(data.currency);

    if (!playerId || String(playerId).trim() === "") {
      return buildEventResult(
        "currency_update_failed",
        { reason: "player_id_required" },
        false
      );
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return buildEventResult(
        "currency_update_failed",
        { reason: "non_negative_amount_required" },
        false
      );
    }

    let account = this.store.load(playerId);
    if (!account) {
      account = createCurrencyAccountRecord({ player_id: playerId });
    }

    const currentBalance = Number.isFinite(account.balances?.[currency])
      ? Math.floor(account.balances[currency])
      : 0;
    const nextBalance = currentBalance + amount;
    const now = new Date().toISOString();

    const next = {
      ...account,
      balances: {
        ...account.balances,
        [currency]: nextBalance
      },
      gold_balance: currency === "gold" ? nextBalance : account.gold_balance,
      updated_at: now,
      transaction_log: [
        ...(Array.isArray(account.transaction_log) ? account.transaction_log : []),
        {
          transaction_id: `txn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          operation: "add",
          currency,
          amount,
          balance_after: nextBalance,
          reason: data.reason || "currency_added",
          source_event_id: data.source_event_id || null,
          timestamp: now
        }
      ]
    };

    this.store.save(next);
    return buildEventResult(
      "currency_added",
      {
        player_id: String(playerId),
        currency,
        amount,
        balance_after: nextBalance,
        updated_at: now
      },
      true
    );
  }

  subtractCurrency(input) {
    const data = input || {};
    const playerId = data.player_id;
    const amount = Number.isFinite(data.amount) ? Math.floor(data.amount) : NaN;
    const currency = normalizeCurrencyCode(data.currency);
    const allowNegativeOverride = Boolean(data.allow_negative_balance);

    if (!playerId || String(playerId).trim() === "") {
      return buildEventResult(
        "currency_update_failed",
        { reason: "player_id_required" },
        false
      );
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return buildEventResult(
        "currency_update_failed",
        { reason: "non_negative_amount_required" },
        false
      );
    }

    let account = this.store.load(playerId);
    if (!account) {
      account = createCurrencyAccountRecord({ player_id: playerId });
    }

    const currentBalance = Number.isFinite(account.balances?.[currency])
      ? Math.floor(account.balances[currency])
      : 0;
    const nextBalance = currentBalance - amount;
    const negativeAllowed = this.allowNegativeBalance || allowNegativeOverride;

    if (!negativeAllowed && nextBalance < 0) {
      return buildEventResult(
        "currency_subtract_rejected",
        {
          reason: "insufficient_funds",
          player_id: String(playerId),
          currency,
          amount_requested: amount,
          balance_current: currentBalance
        },
        false
      );
    }

    const now = new Date().toISOString();
    const next = {
      ...account,
      balances: {
        ...account.balances,
        [currency]: nextBalance
      },
      gold_balance: currency === "gold" ? nextBalance : account.gold_balance,
      updated_at: now,
      transaction_log: [
        ...(Array.isArray(account.transaction_log) ? account.transaction_log : []),
        {
          transaction_id: `txn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          operation: "subtract",
          currency,
          amount,
          balance_after: nextBalance,
          reason: data.reason || "currency_subtracted",
          source_event_id: data.source_event_id || null,
          timestamp: now
        }
      ]
    };

    this.store.save(next);
    return buildEventResult(
      "currency_subtracted",
      {
        player_id: String(playerId),
        currency,
        amount,
        balance_after: nextBalance,
        updated_at: now
      },
      true
    );
  }
}

module.exports = {
  InMemoryCurrencyAccountStore,
  CurrencyAccountManager
};

