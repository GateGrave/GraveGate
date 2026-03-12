"use strict";

const { createEvent, EVENT_TYPES } = require("../../../../packages/shared-types");

function createGatewayResponseEvent(sourceEvent, responseType, data, ok, errorMessage) {
  return createEvent(EVENT_TYPES.GATEWAY_RESPONSE_READY, {
    response_type: responseType,
    ok: ok !== false,
    data: data || {},
    error: errorMessage || null,
    request_event_type: sourceEvent.event_type
  }, {
    source: "controller",
    target_system: "gateway",
    player_id: sourceEvent.player_id,
    session_id: sourceEvent.session_id,
    combat_id: sourceEvent.combat_id
  });
}

function createRuntimeDispatchEvent(sourceEvent, dispatchEventType, targetSystem) {
  return createEvent(dispatchEventType, {
    request_event: sourceEvent
  }, {
    source: "controller",
    target_system: targetSystem || null,
    player_id: sourceEvent.player_id,
    session_id: sourceEvent.session_id,
    combat_id: sourceEvent.combat_id
  });
}

module.exports = {
  createGatewayResponseEvent,
  createRuntimeDispatchEvent
};
