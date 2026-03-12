"use strict";

const { EVENT_TYPES } = require("../../../../packages/shared-types");
const { createGatewayResponseEvent } = require("./shared");

function handleControllerEvent(event, context) {
  void context;

  if (event.event_type === EVENT_TYPES.GATEWAY_HELP_REQUESTED) {
    return [
      createGatewayResponseEvent(event, "help", {
        commands: ["/help", "/profile", "/inventory", "/start", "/ping"],
        description: "Read command help response from controller runtime flow."
      }, true, null)
    ];
  }

  if (event.event_type === EVENT_TYPES.GATEWAY_PING_REQUESTED) {
    return [
      createGatewayResponseEvent(event, "ping", {
        message: "Pong!"
      }, true, null)
    ];
  }

  return [
    createGatewayResponseEvent(event, "controller", {}, false, "unsupported controller event")
  ];
}

module.exports = {
  handleControllerEvent
};

