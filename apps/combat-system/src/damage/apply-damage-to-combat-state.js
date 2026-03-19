"use strict";

const { resolveDamagePipeline } = require("./resolve-damage-pipeline");

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

  return {
    next_state: nextState,
    damage_result: damageResult
  };
}

module.exports = {
  applyDamageToCombatState
};
