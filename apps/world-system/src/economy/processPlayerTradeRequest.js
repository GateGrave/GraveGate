"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(event_type, payload) {
  return {
    ok: true,
    event_type,
    payload: payload || {},
    error: null
  };
}

function failure(event_type, error, payload) {
  return {
    ok: false,
    event_type,
    payload: payload || {},
    error
  };
}

function loadCharacters(context) {
  const persistence = context && context.characterPersistence;
  if (!persistence || typeof persistence.listCharacters !== "function") {
    return [];
  }
  const listed = persistence.listCharacters();
  if (!listed || listed.ok !== true) {
    return [];
  }
  return Array.isArray(listed.payload && listed.payload.characters) ? listed.payload.characters : [];
}

function loadPlayerCharacter(context, playerId) {
  const characters = loadCharacters(context);
  return characters.find((entry) => String(entry && entry.player_id || "") === String(playerId || "")) || null;
}

function loadInventoryForPlayer(context, playerId) {
  const inventoryPersistence = context && context.inventoryPersistence;
  if (!inventoryPersistence || typeof inventoryPersistence.loadInventoryById !== "function") {
    return null;
  }
  const character = loadPlayerCharacter(context, playerId);
  if (!character || !character.inventory_id) {
    return null;
  }
  const loaded = inventoryPersistence.loadInventoryById(character.inventory_id);
  if (!loaded || loaded.ok !== true || !loaded.payload || !loaded.payload.inventory) {
    return null;
  }
  return loaded.payload.inventory;
}

function findItemNameInInventory(inventory, itemId) {
  const target = String(itemId || "").trim();
  if (!target) {
    return null;
  }
  const buckets = ["stackable_items", "equipment_items", "quest_items"];
  for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex += 1) {
    const entries = Array.isArray(inventory && inventory[buckets[bucketIndex]]) ? inventory[buckets[bucketIndex]] : [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (String(entry && entry.item_id || "") === target) {
        return entry.item_name || entry.public_label || entry.item_id || null;
      }
    }
  }
  return null;
}

function findItemNameInContent(context, itemId) {
  if (!itemId || !context || typeof context.loadContentBundle !== "function") {
    return null;
  }
  const loaded = context.loadContentBundle();
  if (!loaded || loaded.ok !== true) {
    return null;
  }
  const content = loaded.payload && loaded.payload.content ? loaded.payload.content : {};
  const items = Array.isArray(content.items) ? content.items : [];
  const target = String(itemId || "");
  const found = items.find((entry) => String(entry && entry.item_id || "") === target);
  return found ? found.name || found.item_name || found.item_id || null : null;
}

function resolveItemDisplayName(context, ownerPlayerId, itemId) {
  if (!itemId) {
    return null;
  }
  const inventory = loadInventoryForPlayer(context, ownerPlayerId);
  const fromInventory = findItemNameInInventory(inventory, itemId);
  if (fromInventory) {
    return fromInventory;
  }
  return findItemNameInContent(context, itemId);
}

function syncTradeManagerFromPersistence(context) {
  const manager = context && context.playerTradeManager;
  const persistence = context && context.playerTradePersistence;
  if (!manager || !persistence || typeof persistence.listTrades !== "function") {
    return;
  }
  const listed = persistence.listTrades();
  if (!listed || listed.ok !== true) {
    return;
  }
  const trades = Array.isArray(listed.payload && listed.payload.trades) ? listed.payload.trades : [];
  for (let i = 0; i < trades.length; i += 1) {
    const trade = trades[i];
    if (!trade || !trade.trade_id) continue;
    if (!manager.getTrade(trade.trade_id) && manager.store && typeof manager.store.save === "function") {
      manager.store.save(clone(trade));
    }
  }
}

function summarizeOffer(offer, context, ownerPlayerId) {
  const safe = offer && typeof offer === "object" ? offer : {};
  return {
    item_id: safe.item_id || null,
    item_name: safe.item_id ? resolveItemDisplayName(context, ownerPlayerId, safe.item_id) : null,
    quantity: Number.isFinite(Number(safe.quantity)) ? Number(safe.quantity) : null,
    currency: Number.isFinite(Number(safe.currency)) ? Number(safe.currency) : 0
  };
}

function summarizeTradeForPlayer(trade, playerId, context) {
  const safe = trade && typeof trade === "object" ? trade : {};
  const actor = String(playerId || "");
  const initiatorId = String(safe.initiator_player_id || "");
  const counterpartyId = String(safe.counterparty_player_id || "");
  const role = actor === initiatorId ? "initiator" : actor === counterpartyId ? "counterparty" : "observer";
  const actionable =
    String(safe.trade_state || "") === "pending" &&
    (role === "counterparty" || role === "initiator");

  return {
    trade_id: safe.trade_id || null,
    trade_state: safe.trade_state || "pending",
    initiator_player_id: safe.initiator_player_id || null,
    counterparty_player_id: safe.counterparty_player_id || null,
    offered: summarizeOffer(safe.offered, context, safe.initiator_player_id),
    requested: summarizeOffer(safe.requested, context, safe.counterparty_player_id),
    role,
    actionable,
    created_at: safe.created_at || null,
    updated_at: safe.updated_at || null,
    completed_at: safe.completed_at || null
  };
}

function getActionableTradesForPlayer(trades, playerId, context) {
  return (Array.isArray(trades) ? trades : [])
    .map((trade) => {
      if (trade && typeof trade === "object" && Object.prototype.hasOwnProperty.call(trade, "role")) {
        return trade;
      }
      return summarizeTradeForPlayer(trade, playerId, context);
    })
    .filter((trade) => trade && trade.trade_state === "pending")
    .filter((trade) => trade.actionable)
    .slice(0, 2);
}

function listTradesForPlayer(input) {
  const data = input || {};
  const context = data.context || {};
  const playerId = String(data.player_id || "").trim();
  if (!playerId) {
    return failure("player_trade_request_failed", "player_id is required");
  }
  const manager = context.playerTradeManager;
  if (!manager || typeof manager.listTradesByPlayer !== "function") {
    return failure("player_trade_request_failed", "playerTradeManager is not available");
  }

  syncTradeManagerFromPersistence(context);
  const trades = manager.listTradesByPlayer(playerId)
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));

  return success("player_trade_loaded", {
    trades: trades.map((trade) => summarizeTradeForPlayer(trade, playerId, context)),
    actionable_trades: getActionableTradesForPlayer(
      trades.map((trade) => summarizeTradeForPlayer(trade, playerId, context)),
      playerId,
      context
    )
  });
}

function processTradeProposal(input) {
  const data = input || {};
  const context = data.context || {};
  const manager = context.playerTradeManager;
  const playerId = String(data.player_id || "").trim();
  const counterpartyId = String(data.counterparty_player_id || "").trim();

  if (!playerId) return failure("player_trade_propose_failed", "player_id is required");
  if (!counterpartyId) return failure("player_trade_propose_failed", "counterparty_player_id is required");
  if (!manager || typeof manager.proposeTrade !== "function") {
    return failure("player_trade_propose_failed", "playerTradeManager is not available");
  }

  syncTradeManagerFromPersistence(context);
  const out = manager.proposeTrade({
    trade_id: data.trade_id || null,
    initiator_player_id: playerId,
    counterparty_player_id: counterpartyId,
    offered: {
      item_id: data.offered_item_id || null,
      quantity: data.offered_quantity || null,
      currency: data.offered_currency || 0
    },
    requested: {
      item_id: data.requested_item_id || null,
      quantity: data.requested_quantity || null,
      currency: data.requested_currency || 0
    }
  });
  if (!out.ok) {
    return failure("player_trade_propose_failed", out.error || "trade proposal failed", out.payload);
  }

  const listed = listTradesForPlayer({ context, player_id: playerId });
  return success("player_trade_proposed", {
    trade: summarizeTradeForPlayer(out.payload.trade, playerId, context),
    trades: listed.ok ? listed.payload.trades : [],
    actionable_trades: listed.ok ? listed.payload.actionable_trades : []
  });
}

function processTradeAction(input) {
  const data = input || {};
  const context = data.context || {};
  const manager = context.playerTradeManager;
  const inventoryPersistence = context.inventoryPersistence;
  const playerId = String(data.player_id || "").trim();
  const tradeId = String(data.trade_id || "").trim();
  const action = String(data.action || "").trim().toLowerCase();

  if (!playerId) return failure("player_trade_action_failed", "player_id is required");
  if (!tradeId) return failure("player_trade_action_failed", "trade_id is required");
  if (!manager) return failure("player_trade_action_failed", "playerTradeManager is not available");

  syncTradeManagerFromPersistence(context);
  const trade = manager.getTrade(tradeId);
  if (!trade) {
    return failure("player_trade_action_failed", "trade not found", { trade_id: tradeId });
  }

  let out;
  if (action === "accept") {
    const sellerInventory = loadInventoryForPlayer(context, trade.initiator_player_id);
    const buyerInventory = loadInventoryForPlayer(context, trade.counterparty_player_id);
    if (!sellerInventory || !buyerInventory || !inventoryPersistence) {
      return failure("player_trade_action_failed", "trade inventories are not available", { trade_id: tradeId });
    }
    out = manager.acceptTrade({
      trade_id: tradeId,
      acting_player_id: playerId,
      seller_inventory: sellerInventory,
      buyer_inventory: buyerInventory,
      inventoryPersistence,
      characterService: context.characterPersistence
    });
  } else if (action === "decline") {
    out = manager.declineTrade({
      trade_id: tradeId,
      acting_player_id: playerId
    });
  } else if (action === "cancel") {
    out = manager.cancelTrade({
      trade_id: tradeId,
      acting_player_id: playerId
    });
  } else {
    return failure("player_trade_action_failed", "trade action is invalid", { action });
  }

  if (!out.ok) {
    return failure("player_trade_action_failed", out.error || ("trade " + action + " failed"), out.payload);
  }

  const listed = listTradesForPlayer({ context, player_id: playerId });
  return success("player_trade_action_processed", {
    trade: summarizeTradeForPlayer(out.payload.trade, playerId, context),
    execution_result: out.payload.execution_result || null,
    trades: listed.ok ? listed.payload.trades : [],
    actionable_trades: listed.ok ? listed.payload.actionable_trades : []
  });
}

module.exports = {
  listTradesForPlayer,
  processTradeProposal,
  processTradeAction
};
