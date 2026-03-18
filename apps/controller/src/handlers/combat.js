"use strict";

const { EVENT_TYPES } = require("../../../../packages/shared-types");
const { createGatewayResponseEvent, createRuntimeDispatchEvent } = require("./shared");

function handleCombatEvent(event, context) {
  if (event.event_type !== EVENT_TYPES.PLAYER_COMBAT_REQUESTED && !event.combat_id) {
    return [createGatewayResponseEvent(
      event,
      "combat_action",
      {},
      false,
      "combat_id is required for combat action events"
    )];
  }

  if (!context.combatManager) {
    return [createGatewayResponseEvent(
      event,
      "combat_action",
      {},
      false,
      "combatManager is not available in controller context"
    )];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_ATTACK) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED, "combat_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_HELP_ACTION) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED, "combat_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_READY_ACTION) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED, "combat_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_DODGE) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED, "combat_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_DASH) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED, "combat_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_GRAPPLE) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED, "combat_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_ESCAPE_GRAPPLE) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED, "combat_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_SHOVE) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED, "combat_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_DISENGAGE) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED, "combat_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_COMBAT_REQUESTED) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED, "combat_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_CAST_SPELL) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED, "combat_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_MOVE) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED, "combat_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_USE_ITEM) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED, "combat_system")];
  }

  return [];
}

module.exports = {
  handleCombatEvent
};
