"use strict";

const { processWorldUseItemRequest } = require("./processWorldUseItemRequest");

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

// Domain-side wrapper for player_use_item event processing.
// Controller should call this wrapper instead of mutating world state directly.
function processWorldUseItemEvent(input) {
  const data = input || {};
  const event = data.event || {};
  const context = data.context || {};

  const out = processWorldUseItemRequest({
    context,
    player_id: event.player_id,
    item_id: event.payload && event.payload.item_id
  });

  if (!out.ok) {
    return failure("player_use_item_event_failed", out.error || "item use request failed", out.payload);
  }

  const inventory = out.payload.inventory || {};
  return success("player_use_item_event_processed", {
    response_type: "use",
    response_data: {
      use_status: out.payload.use_status || "consumed",
      item_id: out.payload.item_id || (event.payload && event.payload.item_id) || null,
      inventory_id: inventory.inventory_id || null
    }
  });
}

module.exports = {
  processWorldUseItemEvent
};

