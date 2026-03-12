"use strict";

const { EVENT_TYPES } = require("../../../../packages/shared-types");
const { createRuntimeDispatchEvent } = require("./shared");

function handleSessionEvent(event, context) {
  void context;

  if (event.event_type === EVENT_TYPES.PLAYER_MOVE) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_SESSION_COMMAND_REQUESTED, "session_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_ENTER_DUNGEON) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_SESSION_COMMAND_REQUESTED, "session_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_LEAVE_SESSION) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_SESSION_COMMAND_REQUESTED, "session_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_INTERACT_OBJECT) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_SESSION_COMMAND_REQUESTED, "session_system")];
  }

  return [];
}

module.exports = {
  handleSessionEvent
};
