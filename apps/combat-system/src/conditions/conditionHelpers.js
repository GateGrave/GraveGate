"use strict";

const { gridDistanceFeet } = require("../validation/validation-helpers");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildConditionId() {
  return "condition-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function normalizeCombatConditions(combatState) {
  if (!combatState || typeof combatState !== "object") {
    return [];
  }
  return Array.isArray(combatState.conditions) ? combatState.conditions : [];
}

function normalizeConditionType(value) {
  return String(value || "").trim().toLowerCase();
}

function getConditionMetadata(condition) {
  return condition && condition.metadata && typeof condition.metadata === "object"
    ? condition.metadata
    : {};
}

function findDuplicateCondition(existing, condition) {
  const targetType = normalizeConditionType(condition && condition.condition_type);
  const targetSource = String(condition && condition.source_actor_id || "");
  const targetActor = String(condition && condition.target_actor_id || "");
  return existing.find((entry) => {
    return normalizeConditionType(entry && entry.condition_type) === targetType &&
      String(entry && entry.source_actor_id || "") === targetSource &&
      String(entry && entry.target_actor_id || "") === targetActor;
  }) || null;
}

function findConditionImmunityBlocker(existing, condition) {
  const targetType = normalizeConditionType(condition && condition.condition_type);
  const targetActor = String(condition && condition.target_actor_id || "");
  if (!targetType || !targetActor) {
    return null;
  }
  return existing.find((entry) => {
    if (String(entry && entry.target_actor_id || "") !== targetActor) {
      return false;
    }
    const metadata = getConditionMetadata(entry);
    const immunityTags = Array.isArray(metadata.immunity_tags) ? metadata.immunity_tags : [];
    return immunityTags
      .map((tag) => normalizeConditionType(tag))
      .includes(targetType);
  }) || null;
}

function createCombatCondition(input) {
  const data = input || {};
  return {
    condition_id: data.condition_id || buildConditionId(),
    condition_type: String(data.condition_type || data.condition_id || "").trim(),
    source_actor_id: data.source_actor_id ? String(data.source_actor_id) : null,
    target_actor_id: data.target_actor_id ? String(data.target_actor_id) : null,
    applied_at_round: Number.isFinite(Number(data.applied_at_round)) ? Math.max(1, Math.floor(Number(data.applied_at_round))) : null,
    applied_at_timestamp: data.applied_at_timestamp || new Date().toISOString(),
    duration: data.duration && typeof data.duration === "object" ? clone(data.duration) : {},
    expiration_trigger: String(data.expiration_trigger || "manual"),
    metadata: data.metadata && typeof data.metadata === "object" ? clone(data.metadata) : {}
  };
}

function getActiveConditionsForParticipant(combatState, participantId) {
  const targetId = String(participantId || "").trim();
  return normalizeCombatConditions(combatState)
    .filter((condition) => String(condition && condition.target_actor_id || "") === targetId)
    .map((condition) => clone(condition));
}

function participantHasCondition(combatState, participantId, conditionType) {
  const targetId = String(participantId || "").trim();
  const targetType = String(conditionType || "").trim();
  if (!targetId || !targetType) {
    return false;
  }
  return normalizeCombatConditions(combatState).some((condition) => {
    return String(condition && condition.target_actor_id || "") === targetId &&
      String(condition && condition.condition_type || "") === targetType;
  });
}

function applyConditionToCombatState(combatState, input) {
  const condition = createCombatCondition(input);
  const existing = normalizeCombatConditions(combatState);
  const immunityBlocker = findConditionImmunityBlocker(existing, condition);
  if (immunityBlocker) {
    return {
      ok: true,
      condition: null,
      prevented: true,
      prevented_by_condition: clone(immunityBlocker),
      next_state: Object.assign({}, combatState, {
        conditions: existing,
        updated_at: combatState && combatState.updated_at ? combatState.updated_at : new Date().toISOString()
      })
    };
  }
  const duplicate = findDuplicateCondition(existing, condition);
  if (duplicate) {
    return {
      ok: true,
      condition: clone(duplicate),
      duplicate: true,
      next_state: Object.assign({}, combatState, {
        conditions: existing,
        updated_at: combatState && combatState.updated_at ? combatState.updated_at : new Date().toISOString()
      })
    };
  }
  const nextConditions = existing.concat([condition]);
  return {
    ok: true,
    condition: clone(condition),
    next_state: Object.assign({}, combatState, {
      conditions: nextConditions,
      updated_at: new Date().toISOString()
    })
  };
}

function removeConditionFromCombatState(combatState, conditionId) {
  const targetId = String(conditionId || "").trim();
  const existing = normalizeCombatConditions(combatState);
  const removed = existing.find((condition) => String(condition && condition.condition_id || "") === targetId) || null;
  const nextConditions = existing.filter((condition) => String(condition && condition.condition_id || "") !== targetId);
  return {
    ok: true,
    removed_condition: removed ? clone(removed) : null,
    next_state: Object.assign({}, combatState, {
      conditions: nextConditions,
      updated_at: new Date().toISOString()
    })
  };
}

function shouldExpireOnTrigger(condition, trigger) {
  return String(condition && condition.expiration_trigger || "") === String(trigger || "");
}

function matchesTriggerTarget(condition, input) {
  const participantId = String(input && input.participant_id || "").trim();
  const sourceActorId = String(input && input.source_actor_id || "").trim();
  const trigger = String(input && input.expiration_trigger || "").trim();
  if (!trigger || !shouldExpireOnTrigger(condition, trigger)) {
    return false;
  }

  if (participantId) {
    return String(condition && condition.target_actor_id || "") === participantId;
  }
  if (sourceActorId) {
    return String(condition && condition.source_actor_id || "") === sourceActorId;
  }

  return false;
}

function expireConditionsForTrigger(combatState, input) {
  const data = input || {};
  const existing = normalizeCombatConditions(combatState);
  const expired = [];
  const updated = [];

  for (let index = 0; index < existing.length; index += 1) {
    const condition = existing[index];
    if (!matchesTriggerTarget(condition, data)) {
      updated.push(condition);
      continue;
    }

    const duration = condition.duration && typeof condition.duration === "object" ? condition.duration : {};
    const remainingTriggers = Number(duration.remaining_triggers);
    if (!Number.isFinite(remainingTriggers)) {
      expired.push(condition);
      continue;
    }

    const nextRemaining = Math.max(remainingTriggers - 1, 0);
    if (nextRemaining <= 0) {
      expired.push(condition);
      continue;
    }

    updated.push(Object.assign({}, condition, {
      duration: Object.assign({}, duration, {
        remaining_triggers: nextRemaining
      })
    }));
  }

  return {
    ok: true,
    expired_conditions: expired.map((condition) => clone(condition)),
    next_state: Object.assign({}, combatState, {
      conditions: updated,
      updated_at: new Date().toISOString()
    })
  };
}

function findParticipantById(combatState, participantId) {
  const participants = Array.isArray(combatState && combatState.participants) ? combatState.participants : [];
  return participants.find((entry) => String(entry && entry.participant_id || "") === String(participantId || "")) || null;
}

function participantIsIncapacitated(combatState, participantId) {
  return Boolean(getParticipantIncapacitationType(combatState, participantId));
}

function getParticipantIncapacitationType(combatState, participantId) {
  if (participantHasCondition(combatState, participantId, "stunned")) {
    return "stunned";
  }
  if (participantHasCondition(combatState, participantId, "paralyzed")) {
    return "paralyzed";
  }
  return null;
}

function normalizeCombatControlConditions(combatState) {
  const existing = normalizeCombatConditions(combatState);
  const removed = [];
  const kept = [];

  for (let index = 0; index < existing.length; index += 1) {
    const condition = existing[index];
    if (String(condition && condition.condition_type || "") !== "grappled") {
      kept.push(condition);
      continue;
    }

    const sourceId = String(condition && condition.source_actor_id || "");
    const targetId = String(condition && condition.target_actor_id || "");
    const source = findParticipantById(combatState, sourceId);
    const target = findParticipantById(combatState, targetId);
    const sourceHp = Number.isFinite(Number(source && source.current_hp)) ? Number(source.current_hp) : 0;
    const targetHp = Number.isFinite(Number(target && target.current_hp)) ? Number(target.current_hp) : 0;
    const sourceDistance = source && source.position && target && target.position
      ? gridDistanceFeet(source.position, target.position)
      : null;
    const invalid =
      !source ||
      !target ||
      sourceHp <= 0 ||
      targetHp <= 0 ||
      participantIsIncapacitated(combatState, sourceId) ||
      !Number.isFinite(sourceDistance) ||
      sourceDistance > 5;

    if (invalid) {
      removed.push(clone(condition));
      continue;
    }

    kept.push(condition);
  }

  return {
    ok: true,
    removed_conditions: removed,
    next_state: Object.assign({}, combatState, {
      conditions: kept,
      updated_at: removed.length > 0 ? new Date().toISOString() : combatState.updated_at
    })
  };
}

module.exports = {
  createCombatCondition,
  applyConditionToCombatState,
  removeConditionFromCombatState,
  expireConditionsForTrigger,
  getActiveConditionsForParticipant,
  getParticipantIncapacitationType,
  participantHasCondition,
  normalizeCombatControlConditions
};
