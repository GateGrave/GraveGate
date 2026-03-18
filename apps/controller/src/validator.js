"use strict";

const { isValidEvent, validateEventContract, EVENT_TYPES } = require("../../../packages/shared-types");

const SUPPORTED_READ_COMMAND_EVENTS = new Set([
  EVENT_TYPES.GATEWAY_PING_REQUESTED,
  EVENT_TYPES.GATEWAY_HELP_REQUESTED,
  EVENT_TYPES.PLAYER_PROFILE_REQUESTED,
  EVENT_TYPES.PLAYER_COMBAT_REQUESTED,
  EVENT_TYPES.PLAYER_INVENTORY_REQUESTED,
  EVENT_TYPES.PLAYER_SHOP_REQUESTED,
  EVENT_TYPES.PLAYER_CRAFT_REQUESTED,
  EVENT_TYPES.PLAYER_TRADE_REQUESTED,
  EVENT_TYPES.PLAYER_ADMIN_REQUESTED,
  EVENT_TYPES.PLAYER_START_REQUESTED,
  EVENT_TYPES.PLAYER_EQUIP_REQUESTED,
  EVENT_TYPES.PLAYER_UNEQUIP_REQUESTED,
  EVENT_TYPES.PLAYER_IDENTIFY_ITEM_REQUESTED,
  EVENT_TYPES.PLAYER_ATTUNE_ITEM_REQUESTED,
  EVENT_TYPES.PLAYER_UNATTUNE_ITEM_REQUESTED,
  EVENT_TYPES.PLAYER_FEAT_REQUESTED,
  EVENT_TYPES.PLAYER_ENTER_DUNGEON,
  EVENT_TYPES.PLAYER_LEAVE_SESSION,
  EVENT_TYPES.PLAYER_INTERACT_OBJECT,
  EVENT_TYPES.PLAYER_MOVE,
  EVENT_TYPES.PLAYER_ATTACK,
  EVENT_TYPES.PLAYER_HELP_ACTION,
  EVENT_TYPES.PLAYER_READY_ACTION,
  EVENT_TYPES.PLAYER_DODGE,
  EVENT_TYPES.PLAYER_DASH,
  EVENT_TYPES.PLAYER_GRAPPLE,
  EVENT_TYPES.PLAYER_ESCAPE_GRAPPLE,
  EVENT_TYPES.PLAYER_SHOVE,
  EVENT_TYPES.PLAYER_DISENGAGE,
  EVENT_TYPES.PLAYER_CAST_SPELL,
  EVENT_TYPES.PLAYER_USE_ITEM
]);

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

function validateIncomingGatewayEvent(event) {
  const contract = validateEventContract(event);
  if (!contract.ok) {
    return failure("controller_event_validation_failed", contract.error, {
      error_code: contract.error_code || "event_contract_invalid",
      supported_versions: contract.supported_versions || undefined
    });
  }

  if (!isValidEvent(event)) {
    return failure("controller_event_validation_failed", "event does not match shared schema");
  }

  if (event.source !== "gateway.discord") {
    return failure("controller_event_validation_failed", "event source must be gateway.discord", {
      source: event.source || null
    });
  }

  if (!SUPPORTED_READ_COMMAND_EVENTS.has(event.event_type)) {
    return failure("controller_event_validation_failed", "event type is not supported by command intake", {
      event_type: event.event_type
    });
  }

  if (event.target_system !== null && event.target_system !== undefined) {
    const target = String(event.target_system);
    const allowedTargets = new Set([
      "controller",
      "world",
      "world_system",
      "session",
      "session_system",
      "combat",
      "combat_system"
    ]);

    if (!allowedTargets.has(target)) {
      return failure("controller_event_validation_failed", "event target_system is not supported by command intake", {
        target_system: target
      });
    }
  }

  return success("controller_event_validated", {
    event_type: event.event_type,
    player_id: event.player_id || null
  });
}

module.exports = {
  SUPPORTED_READ_COMMAND_EVENTS,
  validateIncomingGatewayEvent
};
