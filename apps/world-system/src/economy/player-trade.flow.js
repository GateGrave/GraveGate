"use strict";

const {
  normalizeInventoryShape,
  addItemToInventory,
  removeItemFromInventory
} = require("../../../inventory-system/src/mutationHelpers");

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

function canRemoveOwnedEntry(playerId) {
  return function canRemove(entry) {
    if (!entry || typeof entry !== "object") return false;
    const owner = entry.owner_player_id ? String(entry.owner_player_id) : "";
    const explicitShared = entry.metadata && entry.metadata.shared_unowned === true;
    if (explicitShared) return true;
    return owner !== "" && owner === String(playerId);
  };
}

function normalizeCurrencyOffer(value, field) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const amount = Number.isFinite(value) ? Math.floor(value) : NaN;
  if (!Number.isFinite(amount) || amount < 0) {
    return failure("player_trade_failed", field + " must be a non-negative number");
  }
  return amount;
}

function ensureTradeSideConsistency(itemId, quantity, currency, side) {
  if (itemId && (!Number.isFinite(quantity) || quantity <= 0)) {
    return failure("player_trade_failed", side + "_quantity must be a positive number");
  }
  if (!itemId && Number.isFinite(quantity)) {
    return failure("player_trade_failed", side + "_item_id and " + side + "_quantity must be provided together");
  }
  if (!itemId && currency <= 0) {
    return failure("player_trade_failed", side + " must include item_id/quantity or currency");
  }
  return null;
}

function normalizeTradeInput(input) {
  const data = input || {};
  const sellerPlayerId = data.seller_player_id ? String(data.seller_player_id) : "";
  const buyerPlayerId = data.buyer_player_id ? String(data.buyer_player_id) : "";
  const offeredItemId = data.offered_item_id ? String(data.offered_item_id) : "";
  const requestedItemId = data.requested_item_id ? String(data.requested_item_id) : "";
  const offeredQuantity = Number.isFinite(data.offered_quantity) ? Math.floor(data.offered_quantity) : NaN;
  const requestedQuantity = Number.isFinite(data.requested_quantity) ? Math.floor(data.requested_quantity) : NaN;
  const offeredCurrency = normalizeCurrencyOffer(data.offered_currency, "offered_currency");
  const requestedCurrency = normalizeCurrencyOffer(data.requested_currency, "requested_currency");

  if (!sellerPlayerId) {
    return failure("player_trade_failed", "seller_player_id is required");
  }
  if (!buyerPlayerId) {
    return failure("player_trade_failed", "buyer_player_id is required");
  }
  if (typeof offeredCurrency === "object" && offeredCurrency.ok === false) {
    return offeredCurrency;
  }
  if (typeof requestedCurrency === "object" && requestedCurrency.ok === false) {
    return requestedCurrency;
  }

  const offeredSideError = ensureTradeSideConsistency(
    offeredItemId,
    offeredQuantity,
    offeredCurrency,
    "offered"
  );
  if (offeredSideError) {
    return offeredSideError;
  }
  const requestedSideError =
    requestedItemId || Number.isFinite(requestedQuantity) || requestedCurrency > 0
      ? ensureTradeSideConsistency(requestedItemId, requestedQuantity, requestedCurrency, "requested")
      : null;
  if (requestedSideError) {
    return requestedSideError;
  }

  return success("player_trade_input_validated", {
    trade_id: data.trade_id ? String(data.trade_id) : "trade-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    seller_player_id: sellerPlayerId,
    buyer_player_id: buyerPlayerId,
    offered_item_id: offeredItemId || null,
    offered_quantity: offeredItemId ? offeredQuantity : null,
    offered_currency: offeredCurrency,
    requested_item_id: requestedItemId || null,
    requested_quantity: requestedItemId ? requestedQuantity : null,
    requested_currency: requestedCurrency
  });
}

function validatePlayerParticipant(input) {
  const data = input || {};
  const role = data.role || "player";
  const playerId = data.player_id ? String(data.player_id) : "";
  if (!playerId) {
    return failure("player_trade_failed", role + "_player_id is required");
  }

  if (typeof data.validatePlayerExists === "function") {
    const out = data.validatePlayerExists(playerId);
    if (!out || out.ok !== true) {
      return failure("player_trade_failed", role + " player not found", {
        role,
        player_id: playerId
      });
    }
  }

  if (data.accountService && typeof data.accountService.getAccountByDiscordUserId === "function") {
    const accountOut = data.accountService.getAccountByDiscordUserId(playerId);
    if (!accountOut.ok) {
      return failure("player_trade_failed", role + " account not found", {
        role,
        player_id: playerId
      });
    }
  }

  if (data.characterService && typeof data.characterService.listCharacters === "function") {
    const listed = data.characterService.listCharacters();
    if (!listed.ok) {
      return failure("player_trade_failed", "character lookup failed during trade validation", {
        role,
        player_id: playerId
      });
    }

    const rows = Array.isArray(listed.payload.characters) ? listed.payload.characters : [];
    const hasCharacter = rows.some(function matchCharacter(character) {
      if (!character || typeof character !== "object") return false;
      return String(character.player_id || "") === playerId || String(character.account_id || "") === playerId;
    });

    if (!hasCharacter) {
      return failure("player_trade_failed", role + " character not found", {
        role,
        player_id: playerId
      });
    }
  }

  return success("player_trade_participant_validated", {
    role,
    player_id: playerId
  });
}

function processPlayerTrade(input) {
  const data = input || {};
  const validated = normalizeTradeInput(data);
  if (!validated.ok) return validated;

  const sellerNormalized = normalizeInventoryShape(data.seller_inventory);
  if (!sellerNormalized.ok) {
    return failure("player_trade_failed", "seller inventory is invalid", {
      inventory_error: sellerNormalized.error
    });
  }
  const buyerNormalized = normalizeInventoryShape(data.buyer_inventory);
  if (!buyerNormalized.ok) {
    return failure("player_trade_failed", "buyer inventory is invalid", {
      inventory_error: buyerNormalized.error
    });
  }

  const trade = validated.payload;
  const sellerValidated = validatePlayerParticipant({
    role: "seller",
    player_id: trade.seller_player_id,
    validatePlayerExists: data.validatePlayerExists,
    accountService: data.accountService,
    characterService: data.characterService
  });
  if (!sellerValidated.ok) return sellerValidated;

  const buyerValidated = validatePlayerParticipant({
    role: "buyer",
    player_id: trade.buyer_player_id,
    validatePlayerExists: data.validatePlayerExists,
    accountService: data.accountService,
    characterService: data.characterService
  });
  if (!buyerValidated.ok) return buyerValidated;

  const sellerBefore = clone(sellerNormalized.payload.inventory);
  const buyerBefore = clone(buyerNormalized.payload.inventory);
  let sellerNext = clone(sellerBefore);
  let buyerNext = clone(buyerBefore);

  sellerNext.currency = sellerNext.currency && typeof sellerNext.currency === "object"
    ? sellerNext.currency
    : { gold: 0, silver: 0, copper: 0 };
  buyerNext.currency = buyerNext.currency && typeof buyerNext.currency === "object"
    ? buyerNext.currency
    : { gold: 0, silver: 0, copper: 0 };

  if (trade.offered_item_id) {
    const removeFromSeller = removeItemFromInventory(
      sellerNext,
      trade.offered_item_id,
      trade.offered_quantity,
      { canRemoveEntry: canRemoveOwnedEntry(trade.seller_player_id) }
    );
    if (!removeFromSeller.ok) {
      return failure("player_trade_failed", removeFromSeller.error, {
        step: "remove_seller_item",
        reason: removeFromSeller.payload
      });
    }
    sellerNext = removeFromSeller.payload.inventory;
  }
  if (trade.offered_currency > 0) {
    const sellerGold = Math.max(0, Math.floor(Number(sellerNext.currency.gold || 0)));
    if (sellerGold < trade.offered_currency) {
      return failure("player_trade_failed", "insufficient_gold_currency", {
        step: "remove_seller_currency",
        player_id: trade.seller_player_id
      });
    }
    sellerNext.currency.gold = sellerGold - trade.offered_currency;
  }

  if (trade.requested_item_id) {
    const removeFromBuyer = removeItemFromInventory(
      buyerNext,
      trade.requested_item_id,
      trade.requested_quantity,
      { canRemoveEntry: canRemoveOwnedEntry(trade.buyer_player_id) }
    );
    if (!removeFromBuyer.ok) {
      return failure("player_trade_failed", removeFromBuyer.error, {
        step: "remove_buyer_item",
        reason: removeFromBuyer.payload
      });
    }
    buyerNext = removeFromBuyer.payload.inventory;
  }
  if (trade.requested_currency > 0) {
    const buyerGold = Math.max(0, Math.floor(Number(buyerNext.currency.gold || 0)));
    if (buyerGold < trade.requested_currency) {
      return failure("player_trade_failed", "insufficient_gold_currency", {
        step: "remove_buyer_currency",
        player_id: trade.buyer_player_id
      });
    }
    buyerNext.currency.gold = buyerGold - trade.requested_currency;
  }

  if (trade.offered_item_id) {
    const giveToBuyer = addItemToInventory(buyerNext, {
      item_id: trade.offered_item_id,
      quantity: trade.offered_quantity,
      owner_player_id: trade.buyer_player_id,
      stackable: true
    });
    if (!giveToBuyer.ok) {
      return failure("player_trade_failed", giveToBuyer.error, {
        step: "add_item_to_buyer"
      });
    }
    buyerNext = giveToBuyer.payload.inventory;
  }
  if (trade.offered_currency > 0) {
    buyerNext.currency.gold = Math.max(0, Math.floor(Number(buyerNext.currency.gold || 0))) + trade.offered_currency;
  }

  if (trade.requested_item_id) {
    const giveToSeller = addItemToInventory(sellerNext, {
      item_id: trade.requested_item_id,
      quantity: trade.requested_quantity,
      owner_player_id: trade.seller_player_id,
      stackable: true
    });
    if (!giveToSeller.ok) {
      return failure("player_trade_failed", giveToSeller.error, {
        step: "add_item_to_seller"
      });
    }
    sellerNext = giveToSeller.payload.inventory;
  }
  if (trade.requested_currency > 0) {
    sellerNext.currency.gold = Math.max(0, Math.floor(Number(sellerNext.currency.gold || 0))) + trade.requested_currency;
  }

  const inventoryPersistence = data.inventoryPersistence;
  if (inventoryPersistence && typeof inventoryPersistence.saveInventory === "function") {
    const sellerSaved = inventoryPersistence.saveInventory(sellerNext);
    if (!sellerSaved.ok) {
      return failure("player_trade_failed", "failed to persist seller inventory", {
        step: "persist_seller_inventory",
        persistence_result: sellerSaved
      });
    }

    const buyerSaved = inventoryPersistence.saveInventory(buyerNext);
    if (!buyerSaved.ok) {
      inventoryPersistence.saveInventory(sellerBefore);
      return failure("player_trade_failed", "failed to persist buyer inventory", {
        step: "persist_buyer_inventory",
        persistence_result: buyerSaved
      });
    }
  }

  return success("player_trade_completed", {
    trade_id: trade.trade_id,
    seller_player_id: trade.seller_player_id,
    buyer_player_id: trade.buyer_player_id,
    offered_item_id: trade.offered_item_id,
    offered_quantity: trade.offered_quantity,
    offered_currency: trade.offered_currency,
    requested_item_id: trade.requested_item_id,
    requested_quantity: trade.requested_quantity,
    requested_currency: trade.requested_currency,
    seller_inventory: clone(sellerNext),
    buyer_inventory: clone(buyerNext)
  });
}

module.exports = {
  processPlayerTrade
};
