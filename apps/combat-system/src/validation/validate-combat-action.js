"use strict";

const {
  ACTION_TYPES,
  findParticipant,
  validateTargetExists,
  validateTargetInRange,
  validateTargetValidForAction,
  validateTileReachable,
  validateActionAvailability,
  validateLineOfEffect
} = require("./validation-helpers");
const { validationFailure } = require("./validation-result");

function shouldCheckTarget(actionType) {
  return [
    ACTION_TYPES.ATTACK,
    ACTION_TYPES.CAST_SPELL,
    ACTION_TYPES.USE_ITEM,
    ACTION_TYPES.GRAPPLE,
    ACTION_TYPES.SHOVE
  ].includes(actionType);
}

function shouldCheckLineOfEffect(actionType) {
  return [
    ACTION_TYPES.ATTACK,
    ACTION_TYPES.CAST_SPELL,
    ACTION_TYPES.GRAPPLE,
    ACTION_TYPES.SHOVE
  ].includes(actionType);
}

/**
 * Validate one combat action with reusable checks.
 * Returns structured pass/fail details.
 * @param {object} input
 * @param {object} input.combat_state
 * @param {object} input.action_payload
 * @returns {object}
 */
function validateCombatAction(input) {
  const combatState = input.combat_state;
  const action = input.action_payload || {};
  const actionType = action.action_type;
  const actorId = action.actor_participant_id;

  if (!Object.values(ACTION_TYPES).includes(actionType)) {
    return validationFailure("unknown_action_type", "Unsupported action type", {
      action_type: actionType
    });
  }

  const actor = findParticipant(combatState, actorId);
  if (!actor) {
    return validationFailure("actor_not_found", "Actor does not exist in this combat", {
      actor_participant_id: actorId
    });
  }

  const checks = [];

  checks.push(validateActionAvailability({
    action_type: actionType,
    actor
  }));

  let target = null;
  if (shouldCheckTarget(actionType)) {
    const existsCheck = validateTargetExists({
      combat_state: combatState,
      target_participant_id: action.target_participant_id
    });
    checks.push(existsCheck);

    if (existsCheck.ok) {
      target = findParticipant(combatState, action.target_participant_id);
      checks.push(validateTargetValidForAction({
        action_type: actionType,
        actor,
        target
      }));
    }
  }

  if (target && shouldCheckLineOfEffect(actionType)) {
    checks.push(validateLineOfEffect({
      combat_state: combatState,
      from_position: actor.position,
      to_position: target.position
    }));
  }

  if (target && actionType !== ACTION_TYPES.USE_ITEM) {
    checks.push(validateTargetInRange({
      actor,
      target,
      max_range_feet: action.max_range_feet || 5
    }));
  }

  if (actionType === ACTION_TYPES.MOVE) {
    checks.push(validateTileReachable({
      combat_state: combatState,
      actor,
      destination: action.destination,
      path: action.path
    }));
  }

  const failedChecks = checks.filter((check) => !check.ok);

  return {
    ok: failedChecks.length === 0,
    action_type: actionType,
    actor_participant_id: actorId,
    checks,
    failed_checks: failedChecks
  };
}

module.exports = {
  validateCombatAction
};
