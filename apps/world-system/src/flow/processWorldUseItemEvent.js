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
      inventory_id: inventory.inventory_id || null,
      hp_before: out.payload.effect_result && out.payload.effect_result.hp_before,
      hp_after: out.payload.effect_result && out.payload.effect_result.hp_after,
      healed_for: out.payload.effect_result && out.payload.effect_result.healed_for,
      temporary_hp_before: out.payload.effect_result && out.payload.effect_result.temporary_hp_before,
      temporary_hp_after: out.payload.effect_result && out.payload.effect_result.temporary_hp_after,
      temporary_hitpoints_granted: out.payload.effect_result && out.payload.effect_result.temporary_hitpoints_granted,
      charges_before: out.payload.effect_result && out.payload.effect_result.charges_before,
      charges_after: out.payload.effect_result && out.payload.effect_result.charges_after
    }
  });
}

module.exports = {
  processWorldUseItemEvent
};
