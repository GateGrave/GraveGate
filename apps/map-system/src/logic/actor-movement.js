"use strict";

const { MOVEMENT_RULES } = require("../constants");

function firstFiniteNumber(values, fallback) {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return Number(value);
    }
  }

  return fallback;
}

function resolveActorMovementSpeedFeet(options) {
  const actor = options.actor || {};
  const context = options.context || {};
  const movementState = actor.movement || {};
  const speedState = actor.speed || {};
  const statsState = actor.stats || {};
  const statsMovementState = statsState.movement || {};
  const statsSpeedState = statsState.speed || {};

  const explicitRemainingFeet = firstFiniteNumber([
    options.remaining_movement_feet,
    context.remaining_movement_feet,
    movementState.remaining_feet,
    actor.remaining_movement_feet,
    speedState.remaining_feet,
    statsMovementState.remaining_feet,
    statsSpeedState.remaining_feet
  ], null);

  if (explicitRemainingFeet !== null) {
    return Math.max(0, explicitRemainingFeet);
  }

  const baseSpeedFeet = firstFiniteNumber([
    options.movement_speed_feet,
    context.movement_speed_feet,
    actor.movement_speed_feet,
    movementState.speed_feet,
    actor.speed_feet,
    speedState.walk_feet,
    speedState.base_walk_feet,
    statsMovementState.walk_feet,
    statsMovementState.speed_feet,
    statsSpeedState.walk_feet
  ], MOVEMENT_RULES.DEFAULT_SPEED_FEET);

  const speedModifierFeet = firstFiniteNumber([
    options.movement_modifier_feet,
    context.movement_modifier_feet,
    movementState.modifier_feet,
    actor.movement_modifier_feet,
    speedState.modifier_feet,
    statsMovementState.modifier_feet
  ], 0);

  return Math.max(0, baseSpeedFeet + speedModifierFeet);
}

module.exports = {
  firstFiniteNumber,
  resolveActorMovementSpeedFeet
};
