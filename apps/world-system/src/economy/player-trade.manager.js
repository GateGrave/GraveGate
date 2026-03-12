"use strict";

const { processPlayerTrade } = require("./player-trade.flow");
const { createPlayerTradeRecord } = require("./player-trade.schema");

class InMemoryPlayerTradeStore {
  constructor() {
    this.trades = new Map();
  }

  save(record) {
    this.trades.set(record.trade_id, record);
    return record;
  }

  load(tradeId) {
    if (!tradeId) return null;
    return this.trades.get(String(tradeId)) || null;
  }

  list() {
    return Array.from(this.trades.values());
  }
}

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

class PlayerTradeManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryPlayerTradeStore();
    this.persistence = cfg.persistence || null;
  }

  saveRecord(record) {
    this.store.save(record);
    if (this.persistence && typeof this.persistence.saveTrade === "function") {
      const persisted = this.persistence.saveTrade(record);
      if (!persisted.ok) {
        return failure("player_trade_save_failed", persisted.error || "trade persistence save failed", {
          persistence_result: persisted
        });
      }
    }
    return success("player_trade_saved", {
      trade: clone(record)
    });
  }

  proposeTrade(input) {
    let trade;
    try {
      trade = createPlayerTradeRecord({
        trade_id: input && input.trade_id ? String(input.trade_id) : "ptrade-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        initiator_player_id: input && input.initiator_player_id,
        counterparty_player_id: input && input.counterparty_player_id,
        offered: input && input.offered,
        requested: input && input.requested,
        trade_state: "pending"
      });
    } catch (error) {
      return failure("player_trade_propose_failed", error.message);
    }

    if (this.store.load(trade.trade_id)) {
      return failure("player_trade_propose_failed", "trade_id already exists");
    }

    const saved = this.saveRecord(trade);
    if (!saved.ok) return saved;
    return success("player_trade_proposed", {
      trade: saved.payload.trade
    });
  }

  getTrade(tradeId) {
    const loaded = this.store.load(tradeId);
    return loaded ? clone(loaded) : null;
  }

  listTradesByPlayer(playerId) {
    const id = String(playerId || "").trim();
    if (!id) return [];
    return this.store.list()
      .filter((trade) => trade.initiator_player_id === id || trade.counterparty_player_id === id)
      .map((trade) => clone(trade));
  }

  updateTradeState(trade, tradeState, patch) {
    const updated = createPlayerTradeRecord({
      ...trade,
      ...(patch || {}),
      trade_state: tradeState,
      updated_at: new Date().toISOString(),
      completed_at: tradeState === "completed" ? new Date().toISOString() : trade.completed_at || null
    });
    return this.saveRecord(updated);
  }

  acceptTrade(input) {
    const data = input || {};
    const tradeId = String(data.trade_id || "").trim();
    const actor = String(data.acting_player_id || "").trim();
    if (!tradeId) return failure("player_trade_accept_failed", "trade_id is required");
    if (!actor) return failure("player_trade_accept_failed", "acting_player_id is required");

    const trade = this.store.load(tradeId);
    if (!trade) return failure("player_trade_accept_failed", "trade not found", { trade_id: tradeId });
    if (trade.trade_state !== "pending") {
      return failure("player_trade_accept_failed", "trade is not pending", {
        trade_id: tradeId,
        trade_state: trade.trade_state
      });
    }
    if (actor !== trade.counterparty_player_id) {
      return failure("player_trade_accept_failed", "only counterparty can accept trade", {
        acting_player_id: actor
      });
    }

    const execution = processPlayerTrade({
      seller_player_id: trade.initiator_player_id,
      buyer_player_id: trade.counterparty_player_id,
      offered_item_id: trade.offered.item_id,
      offered_quantity: trade.offered.quantity,
      offered_currency: trade.offered.currency,
      requested_item_id: trade.requested.item_id || null,
      requested_quantity: trade.requested.quantity || null,
      requested_currency: trade.requested.currency || 0,
      seller_inventory: data.seller_inventory,
      buyer_inventory: data.buyer_inventory,
      inventoryPersistence: data.inventoryPersistence,
      validatePlayerExists: data.validatePlayerExists,
      accountService: data.accountService,
      characterService: data.characterService,
      trade_id: trade.trade_id
    });
    if (!execution.ok) {
      return failure("player_trade_accept_failed", execution.error || "trade execution failed", {
        trade_id: tradeId,
        execution_result: execution
      });
    }

    const updated = this.updateTradeState(trade, "completed", {
      status_reason: "accepted_and_completed",
      execution_result: execution.payload || {}
    });
    if (!updated.ok) return updated;

    return success("player_trade_completed", {
      trade: updated.payload.trade,
      execution_result: execution.payload
    });
  }

  declineTrade(input) {
    const data = input || {};
    const tradeId = String(data.trade_id || "").trim();
    const actor = String(data.acting_player_id || "").trim();
    if (!tradeId) return failure("player_trade_decline_failed", "trade_id is required");
    if (!actor) return failure("player_trade_decline_failed", "acting_player_id is required");

    const trade = this.store.load(tradeId);
    if (!trade) return failure("player_trade_decline_failed", "trade not found", { trade_id: tradeId });
    if (trade.trade_state !== "pending") {
      return failure("player_trade_decline_failed", "trade is not pending", {
        trade_id: tradeId,
        trade_state: trade.trade_state
      });
    }
    if (actor !== trade.counterparty_player_id) {
      return failure("player_trade_decline_failed", "only counterparty can decline trade", {
        acting_player_id: actor
      });
    }

    return this.updateTradeState(trade, "declined", {
      status_reason: "declined_by_counterparty"
    });
  }

  cancelTrade(input) {
    const data = input || {};
    const tradeId = String(data.trade_id || "").trim();
    const actor = String(data.acting_player_id || "").trim();
    if (!tradeId) return failure("player_trade_cancel_failed", "trade_id is required");
    if (!actor) return failure("player_trade_cancel_failed", "acting_player_id is required");

    const trade = this.store.load(tradeId);
    if (!trade) return failure("player_trade_cancel_failed", "trade not found", { trade_id: tradeId });
    if (trade.trade_state !== "pending") {
      return failure("player_trade_cancel_failed", "trade is not pending", {
        trade_id: tradeId,
        trade_state: trade.trade_state
      });
    }
    if (actor !== trade.initiator_player_id && actor !== trade.counterparty_player_id) {
      return failure("player_trade_cancel_failed", "only trade participants can cancel trade", {
        acting_player_id: actor
      });
    }

    return this.updateTradeState(trade, "cancelled", {
      status_reason: "cancelled_by_participant"
    });
  }
}

module.exports = {
  InMemoryPlayerTradeStore,
  PlayerTradeManager
};
