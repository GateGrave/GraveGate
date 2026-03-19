"use strict";

const { getActiveConditionsForParticipant } = require("../conditions/conditionHelpers");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(payload) {
  return {
    ok: true,
    payload: payload || {},
    error: null
  };
}

function failure(message, payload) {
  return {
    ok: false,
    payload: payload || {},
    error: message
  };
}

function getBlockedTargetByCondition(combatState, participantId, targetId, conditionType) {
  const target = String(targetId || "").trim();
  const wantedType = String(conditionType || "").trim();
  if (!target || !wantedType) {
    return null;
  }
  const conditions = getActiveConditionsForParticipant(combatState, participantId);
  for (let index = 0; index < conditions.length; index += 1) {
    const condition = conditions[index];
    if (String(condition && condition.condition_type || "") !== wantedType) {
      continue;
    }
    const sourceActorId = String(condition && condition.source_actor_id || "").trim();
    if (sourceActorId && sourceActorId === target) {
      return clone(condition);
    }
    const metadata = condition && condition.metadata && typeof condition.metadata === "object"
      ? condition.metadata
      : {};
    const blockedTargets = Array.isArray(metadata.cannot_target_actor_ids)
      ? metadata.cannot_target_actor_ids.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];
    if (blockedTargets.includes(target)) {
      return clone(condition);
    }
  }
  return null;
}

function validateHarmfulTargetingRestriction(combatState, participantId, targetId, options) {
  const settings = options && typeof options === "object" ? options : {};
  const conditionType = String(settings.condition_type || "charmed").trim();
  const blockedBy = getBlockedTargetByCondition(combatState, participantId, targetId, conditionType);
  if (!blockedBy) {
    return success({
      blocked: false,
      gating_condition: null
    });
  }
  return failure(
    settings.error_message || "participant cannot target that hostile creature",
    {
      blocked: true,
      gating_condition: blockedBy
    }
  );
}

module.exports = {
  getBlockedTargetByCondition,
  validateHarmfulTargetingRestriction
};
