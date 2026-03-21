"use strict";

const { resolveDamagePipeline } = require("./resolve-damage-pipeline");
const { removeConditionFromCombatState } = require("../conditions/conditionHelpers");

function dedupeLowercase(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean)
  ));
}

function buildConditionDamageProfile(combatState, targetId) {
  const conditions = Array.isArray(combatState && combatState.conditions) ? combatState.conditions : [];
  const profile = {
    resistances: [],
    immunities: [],
    vulnerabilities: [],
    damage_reduction: 0,
    damage_reduction_types: []
  };

  for (let index = 0; index < conditions.length; index += 1) {
    const condition = conditions[index];
    if (String(condition && condition.target_actor_id || "") !== String(targetId || "")) {
      continue;
    }
    const metadata = condition && condition.metadata && typeof condition.metadata === "object"
      ? condition.metadata
      : {};
    profile.resistances = dedupeLowercase(profile.resistances.concat(metadata.resistances));
    profile.immunities = dedupeLowercase(profile.immunities.concat(metadata.immunities));
    profile.vulnerabilities = dedupeLowercase(profile.vulnerabilities.concat(metadata.vulnerabilities));
    const reduction = Number(metadata.damage_reduction);
    if (Number.isFinite(reduction) && reduction > 0) {
      profile.damage_reduction += Math.floor(reduction);
    }
    profile.damage_reduction_types = dedupeLowercase(
      profile.damage_reduction_types.concat(metadata.damage_reduction_types)
    );
  }

  return profile;
}

function maybeResolveDeathWard(nextState, targetId, hpBeforeDamage) {
  const conditions = Array.isArray(nextState && nextState.conditions) ? nextState.conditions : [];
  const targetIndex = Array.isArray(nextState && nextState.participants)
    ? nextState.participants.findIndex((participant) => participant.participant_id === targetId)
    : -1;
  if (targetIndex === -1) {
    return {
      next_state: nextState,
      death_ward_result: null
    };
  }
  const target = nextState.participants[targetIndex];
  const hpAfterDamage = Number(target && target.current_hp);
  if (!Number.isFinite(hpBeforeDamage) || hpBeforeDamage <= 0 || !Number.isFinite(hpAfterDamage) || hpAfterDamage > 0) {
    return {
      next_state: nextState,
      death_ward_result: null
    };
  }
  const deathWardCondition = conditions.find((condition) => {
    if (String(condition && condition.target_actor_id || "") !== String(targetId || "")) {
      return false;
    }
    if (String(condition && condition.condition_type || "") !== "death_ward") {
      return false;
    }
    const metadata = condition && condition.metadata && typeof condition.metadata === "object" ? condition.metadata : {};
    return metadata.prevent_defeat_once === true;
  });
  if (!deathWardCondition) {
    return {
      next_state: nextState,
      death_ward_result: null
    };
  }

  const updatedConditions = conditions.filter((condition) => {
    return String(condition && condition.condition_id || "") !== String(deathWardCondition.condition_id || "");
  });
  const updatedParticipants = [...nextState.participants];
  updatedParticipants[targetIndex] = {
    ...target,
    current_hp: 1
  };
  return {
    next_state: {
      ...nextState,
      participants: updatedParticipants,
      conditions: updatedConditions,
      updated_at: new Date().toISOString()
    },
    death_ward_result: {
      triggered: true,
      prevented_condition_id: String(deathWardCondition.condition_id || ""),
      hp_after: 1
    }
  };
}

function maybeRemoveWakeOnDamageConditions(nextState, targetId, damageResult) {
  const finalDamage = Number(damageResult && damageResult.final_damage);
  if (!Number.isFinite(finalDamage) || finalDamage <= 0) {
    return {
      next_state: nextState,
      removed_condition_ids: []
    };
  }
  const conditions = Array.isArray(nextState && nextState.conditions) ? nextState.conditions : [];
  const wakeConditions = conditions.filter((condition) => {
    if (String(condition && condition.target_actor_id || "") !== String(targetId || "")) {
      return false;
    }
    const metadata = condition && condition.metadata && typeof condition.metadata === "object"
      ? condition.metadata
      : {};
    return metadata.wakes_on_damage === true;
  });
  let workingState = nextState;
  const removedConditionIds = [];
  for (let index = 0; index < wakeConditions.length; index += 1) {
    const removed = removeConditionFromCombatState(workingState, wakeConditions[index].condition_id);
    if (!removed.ok) {
      continue;
    }
    workingState = removed.next_state;
    removedConditionIds.push(String(wakeConditions[index].condition_id || ""));
  }
  return {
    next_state: workingState,
    removed_condition_ids: removedConditionIds
  };
}

/**
 * Apply a damage pipeline to one participant in combat state.
 * This does not process status effects.
 * @param {object} input
 * @param {object} input.combat_state
 * @param {string} input.target_participant_id
 * @param {string} input.damage_type
 * @param {string} input.damage_formula
 * @param {number} [input.flat_damage]
 * @param {number} [input.flat_modifier]
 * @param {Function} [input.rng]
 * @returns {object}
 */
function applyDamageToCombatState(input) {
  const state = input.combat_state;
  const targetId = input.target_participant_id;

  const targetIndex = state.participants.findIndex(
    (participant) => participant.participant_id === targetId
  );

  if (targetIndex === -1) {
    throw new Error(`Target participant not found: ${targetId}`);
  }

  const target = state.participants[targetIndex];
  const conditionProfile = buildConditionDamageProfile(state, targetId);
  const enrichedTarget = {
    ...target,
    resistances: dedupeLowercase([].concat(target && target.resistances || [], conditionProfile.resistances)),
    immunities: dedupeLowercase([].concat(target && target.immunities || [], conditionProfile.immunities)),
    vulnerabilities: dedupeLowercase([].concat(target && target.vulnerabilities || [], conditionProfile.vulnerabilities)),
    damage_reduction: Number(target && target.damage_reduction || 0) + conditionProfile.damage_reduction,
    damage_reduction_types: dedupeLowercase([].concat(target && target.damage_reduction_types || [], conditionProfile.damage_reduction_types))
  };
  const damageResult = resolveDamagePipeline({
    target: enrichedTarget,
    damage_type: input.damage_type,
    damage_formula: input.damage_formula,
    flat_modifier: Number.isFinite(Number(input.flat_damage))
      ? Number(input.flat_damage)
      : input.flat_modifier,
    rng: input.rng
  });

  const nextParticipants = [...state.participants];
  const hpBeforeDamage = Number(target && target.current_hp);
  nextParticipants[targetIndex] = {
    ...target,
    current_hp: damageResult.hp_after,
    temporary_hitpoints: damageResult.temporary_hp_after
  };

  const nextState = {
    ...state,
    participants: nextParticipants,
    updated_at: new Date().toISOString()
  };

  const deathWardResolved = maybeResolveDeathWard(nextState, targetId, hpBeforeDamage);
  const wakeResolved = maybeRemoveWakeOnDamageConditions(
    deathWardResolved.next_state,
    targetId,
    deathWardResolved.death_ward_result
      ? {
        ...damageResult,
        final_damage: Number(damageResult && damageResult.final_damage)
      }
      : damageResult
  );
  return {
    next_state: wakeResolved.next_state,
    damage_result: deathWardResolved.death_ward_result
      ? {
        ...damageResult,
        hp_after: 1,
        death_ward_result: deathWardResolved.death_ward_result,
        removed_condition_ids: wakeResolved.removed_condition_ids
      }
      : {
        ...damageResult,
        removed_condition_ids: wakeResolved.removed_condition_ids
      }
  };
}

module.exports = {
  applyDamageToCombatState
};
