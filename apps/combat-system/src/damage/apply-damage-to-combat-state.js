"use strict";

const { resolveDamagePipeline } = require("./resolve-damage-pipeline");

/**
 * Apply a damage pipeline to one participant in combat state.
 * This does not process status effects.
 * @param {object} input
 * @param {object} input.combat_state
 * @param {string} input.target_participant_id
 * @param {string} input.damage_type
 * @param {string} input.damage_formula
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
  const damageResult = resolveDamagePipeline({
    target,
    damage_type: input.damage_type,
    damage_formula: input.damage_formula,
    flat_modifier: input.flat_modifier,
    rng: input.rng
  });

  const nextParticipants = [...state.participants];
  nextParticipants[targetIndex] = {
    ...target,
    current_hp: damageResult.hp_after
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
