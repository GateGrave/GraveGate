"use strict";

const { ACTION_TYPES, validateActionAvailability, gridDistanceFeet } = require("../validation/validation-helpers");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

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

function normalizeMoveCostFeet(fromPosition, toPosition) {
  if (!fromPosition || !toPosition) {
    return 0;
  }
  return Math.max(0, Number(gridDistanceFeet(fromPosition, toPosition) || 0));
}

function resolveMovementPool(participant) {
  if (Number.isFinite(participant && participant.movement_remaining)) {
    return Number(participant.movement_remaining);
  }
  if (Number.isFinite(participant && participant.movement_speed)) {
    return Number(participant.movement_speed);
  }
  return 30;
}

function validateParticipantActionAvailability(participant, actionType, options) {
  const settings = options || {};
  const actorForValidation = Object.assign({}, participant, {
    action_available:
      participant && typeof participant.action_available === "boolean"
        ? participant.action_available
        : true,
    bonus_action_available:
      participant && typeof participant.bonus_action_available === "boolean"
        ? participant.bonus_action_available
        : true,
    movement_remaining: resolveMovementPool(participant)
  });
  let availability = null;
  if (actionType === ACTION_TYPES.USE_ITEM && settings.allow_bonus_action !== true) {
    availability = actorForValidation.action_available
      ? { ok: true }
      : { ok: false, message: "action is not available" };
  } else {
    availability = validateActionAvailability({
      actor: actorForValidation,
      action_type: actionType
    });
  }
  if (!availability.ok) {
    return failure("combat_action_economy_failed", availability.error || "action is not available", availability.payload);
  }
  return success("combat_action_available");
}

function consumeParticipantAction(participant, actionType, options) {
  const settings = options || {};
  const next = clone(participant);

  if (actionType === ACTION_TYPES.MOVE) {
    const moveCostFeet = Number.isFinite(settings.move_cost_feet) ? Math.max(0, Number(settings.move_cost_feet)) : 0;
    const before = resolveMovementPool(next);
    if (before < moveCostFeet) {
      return failure("combat_action_economy_failed", "not enough movement remaining", {
        required_movement_feet: moveCostFeet,
        movement_remaining_feet: before
      });
    }
    next.movement_remaining = before - moveCostFeet;
    return success("combat_movement_consumed", {
      participant: next,
      movement_cost_feet: moveCostFeet,
      movement_remaining_before: before,
      movement_remaining_after: next.movement_remaining
    });
  }

  if (actionType === ACTION_TYPES.USE_ITEM && settings.prefer_bonus_action === true) {
    if (next.bonus_action_available === true) {
      next.bonus_action_available = false;
      return success("combat_bonus_action_consumed", {
        participant: next,
        consumed_resource: "bonus_action"
      });
    }
  }

  if (
    actionType === ACTION_TYPES.USE_ITEM ||
    actionType === ACTION_TYPES.ATTACK ||
    actionType === ACTION_TYPES.HELP ||
    actionType === ACTION_TYPES.READY ||
    actionType === ACTION_TYPES.DODGE ||
    actionType === ACTION_TYPES.DASH ||
    actionType === ACTION_TYPES.DISENGAGE ||
    actionType === ACTION_TYPES.CAST_SPELL ||
    actionType === ACTION_TYPES.GRAPPLE ||
    actionType === ACTION_TYPES.ESCAPE_GRAPPLE ||
    actionType === ACTION_TYPES.SHOVE
  ) {
    next.action_available = false;
    return success("combat_action_consumed", {
      participant: next,
      consumed_resource: "action"
    });
  }

  return success("combat_action_consumption_skipped", {
    participant: next
  });
}

module.exports = {
  ACTION_TYPES,
  normalizeMoveCostFeet,
  validateParticipantActionAvailability,
  consumeParticipantAction
};
