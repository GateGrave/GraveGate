"use strict";

const { ACTION_TYPES, validateActionAvailability, gridDistanceFeet } = require("../validation/validation-helpers");
const { getParticipantIncapacitationType } = require("../conditions/conditionHelpers");

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

function normalizeActionCostValue(value, fallback) {
  const safe = String(value || "").trim().toLowerCase();
  if (!safe) {
    return fallback || "action";
  }
  if (safe === "bonus_action" || safe === "bonus action" || safe === "1 bonus action") {
    return "bonus_action";
  }
  if (safe === "reaction" || safe === "1 reaction") {
    return "reaction";
  }
  if (safe === "move" || safe === "movement") {
    return "move";
  }
  return "action";
}

function resolveActionCostForActionType(actionType, options) {
  const settings = options || {};
  if (actionType === ACTION_TYPES.MOVE) {
    return "move";
  }
  if (actionType === ACTION_TYPES.USE_ITEM) {
    return normalizeActionCostValue(settings.action_cost, "action");
  }
  return normalizeActionCostValue(settings.action_cost, "action");
}

function validateParticipantActionContext(combat, participant, options) {
  const settings = options && typeof options === "object" ? options : {};
  const participantId = String(
    settings.participant_id ||
    (participant && participant.participant_id) ||
    ""
  );
  const roleKey = String(settings.role_key || "participant_id");
  const combatId = String(combat && combat.combat_id || "");
  const verb = String(settings.verb || "act").trim().toLowerCase() || "act";
  const requireTurn = settings.require_turn !== false;
  const hp = Number.isFinite(Number(participant && participant.current_hp))
    ? Number(participant.current_hp)
    : 0;

  if (hp <= 0) {
    return {
      ok: false,
      message: `defeated participants cannot ${verb}`,
      payload: {
        combat_id: combatId,
        [roleKey]: participantId || null,
        current_hp: hp
      }
    };
  }

  const incapacitationType = getParticipantIncapacitationType(combat, participantId);
  if (incapacitationType) {
    return {
      ok: false,
      message: `${incapacitationType} participants cannot ${verb}`,
      payload: {
        combat_id: combatId,
        [roleKey]: participantId || null,
        incapacitating_condition: incapacitationType
      }
    };
  }

  if (requireTurn) {
    const initiativeOrder = Array.isArray(combat && combat.initiative_order) ? combat.initiative_order : [];
    const expectedActorId = initiativeOrder[combat && combat.turn_index];
    if (!expectedActorId || String(expectedActorId) !== participantId) {
      return {
        ok: false,
        message: settings.turn_error_message || "it is not the participant's turn",
        payload: {
          combat_id: combatId,
          [roleKey]: participantId || null,
          expected_actor_id: expectedActorId || null,
          turn_index: combat && combat.turn_index
        }
      };
    }
  }

  return { ok: true };
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
  const actionCost = resolveActionCostForActionType(actionType, settings);
  let availability = null;
  if (actionCost === "bonus_action") {
    availability = actorForValidation.bonus_action_available === true
      ? { ok: true }
      : { ok: false, error: "bonus action is not available" };
  } else if (actionCost === "reaction") {
    availability = participant && participant.reaction_available === true
      ? { ok: true }
      : { ok: false, error: "reaction is not available" };
  } else if (actionType === ACTION_TYPES.USE_ITEM) {
    availability = actorForValidation.action_available === true
      ? { ok: true }
      : { ok: false, error: "action is not available" };
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
  const actionCost = resolveActionCostForActionType(actionType, settings);

  if (actionCost === "move") {
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

  if (actionCost === "bonus_action") {
    next.bonus_action_available = false;
    return success("combat_bonus_action_consumed", {
      participant: next,
      consumed_resource: "bonus_action"
    });
  }

  if (actionCost === "reaction") {
    next.reaction_available = false;
    return success("combat_reaction_consumed", {
      participant: next,
      consumed_resource: "reaction"
    });
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
  normalizeActionCostValue,
  validateParticipantActionContext,
  validateParticipantActionAvailability,
  consumeParticipantAction
};
