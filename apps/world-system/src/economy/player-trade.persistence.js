"use strict";

const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { validateAdapterContract } = require("../../../database/src/adapters/databaseAdapter.interface");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {},
    error: null
  };
}

function failure(eventType, message, payload) {
  return {
    ok: false,
    event_type: eventType,
    payload: payload || {},
    error: message
  };
}

class PlayerTradePersistenceBridge {
  constructor(options) {
    const cfg = options || {};
    this.adapter = cfg.adapter || createInMemoryAdapter();
    this.collection = cfg.collection ? String(cfg.collection) : "player_trades";

    const contract = validateAdapterContract(this.adapter);
    if (!contract.ok) {
      throw new Error(contract.error);
    }
  }

  saveTrade(trade) {
    if (!trade || typeof trade !== "object" || Array.isArray(trade)) {
      return failure("player_trade_persistence_save_failed", "trade must be an object");
    }
    const tradeId = String(trade.trade_id || "").trim();
    if (!tradeId) {
      return failure("player_trade_persistence_save_failed", "trade.trade_id is required");
    }

    const out = this.adapter.save(this.collection, tradeId, trade);
    if (!out.ok) {
      return failure("player_trade_persistence_save_failed", out.error || "adapter save failed", {
        adapter_result: out
      });
    }

    return success("player_trade_persistence_saved", {
      trade: clone(out.payload.record)
    });
  }

  loadTradeById(tradeId) {
    const id = String(tradeId || "").trim();
    if (!id) {
      return failure("player_trade_persistence_load_failed", "trade_id is required");
    }

    const out = this.adapter.getById(this.collection, id);
    if (!out.ok) {
      return failure("player_trade_persistence_load_failed", out.error || "adapter getById failed", {
        adapter_result: out
      });
    }
    if (!out.payload.record) {
      return failure("player_trade_persistence_load_failed", "trade not found", {
        trade_id: id
      });
    }

    return success("player_trade_persistence_loaded", {
      trade: clone(out.payload.record)
    });
  }

  listTrades() {
    const out = this.adapter.list(this.collection);
    if (!out.ok) {
      return failure("player_trade_persistence_list_failed", out.error || "adapter list failed", {
        adapter_result: out
      });
    }

    const trades = Array.isArray(out.payload.records)
      ? out.payload.records.map((row) => clone(row.record))
      : [];
    return success("player_trade_persistence_listed", {
      trades
    });
  }
}

module.exports = {
  PlayerTradePersistenceBridge
};

