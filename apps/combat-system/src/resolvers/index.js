"use strict";

const {
  resolveTurnStarted,
  processTurnStartedEvent
} = require("./turn-started.resolver");
const { resolveMovement, processMovementEvent } = require("./movement.resolver");

module.exports = {
  resolveTurnStarted,
  processTurnStartedEvent,
  resolveMovement,
  processMovementEvent
};
