"use strict";

const { resolveCombatTurn } = require("./resolve-combat-turn");
const {
  MIN_TURN_TIMEOUT_SECONDS,
  MAX_TURN_TIMEOUT_SECONDS,
  TURN_TIMEOUT_POLICIES,
  assertValidTurnTimeoutSeconds,
  buildTimeoutAutoAction,
  waitForPlayerActionWithTimeout
} = require("./turn-timeout");

module.exports = {
  resolveCombatTurn,
  MIN_TURN_TIMEOUT_SECONDS,
  MAX_TURN_TIMEOUT_SECONDS,
  TURN_TIMEOUT_POLICIES,
  assertValidTurnTimeoutSeconds,
  buildTimeoutAutoAction,
  waitForPlayerActionWithTimeout
};
