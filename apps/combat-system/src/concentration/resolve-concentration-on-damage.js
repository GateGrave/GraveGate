"use strict";

const { isConcentrating, getConcentrationDC } = require("./check-concentration");
const { resolveConcentrationSave } = require("./resolve-concentration-save");
const { removeConcentrationEffects } = require("./remove-concentration-effects");

/**
 * Resolve concentration flow after damage (separate from damage resolver):
 * 1) check concentration
 * 2) build DC
 * 3) roll Constitution save
 * 4) remove concentration + linked effects on failure
 *
 * @param {object} input
 * @param {object} input.combat_state
 * @param {string} input.participant_id
 * @param {number} input.damage_taken
 * @param {Function} [input.rng]
 * @returns {object}
 */
function resolveConcentrationOnDamage(input) {
  const state = input.combat_state;
  const participantId = input.participant_id;
  const damageTaken = Number(input.damage_taken || 0);

  const participant = state.participants.find(
    (p) => p.participant_id === participantId
  );

  if (!participant) {
    throw new Error(`Participant not found: ${participantId}`);
  }

  if (damageTaken <= 0) {
    return {
      required: false,
      reason: "no_damage_taken",
      participant_id: participantId,
      next_state: state
    };
  }

  if (!isConcentrating(participant)) {
    return {
      required: false,
      reason: "not_concentrating",
      participant_id: participantId,
      next_state: state
    };
  }

  const dc = getConcentrationDC(damageTaken);
  const saveResult = resolveConcentrationSave({
    dc,
    constitution_save_modifier: participant.constitution_save_modifier || 0,
    rng: input.rng
  });

  if (saveResult.success) {
    return {
      required: true,
      participant_id: participantId,
      damage_taken: damageTaken,
      concentration_dc: dc,
      save_result: saveResult,
      concentration_broken: false,
      removed_effect_ids: [],
      next_state: state
    };
  }

  const removed = removeConcentrationEffects({
    combat_state: state,
    participant_id: participantId
  });

  return {
    required: true,
    participant_id: participantId,
    damage_taken: damageTaken,
    concentration_dc: dc,
    save_result: saveResult,
    concentration_broken: true,
    removed_effect_ids: removed.removed_effect_ids,
    next_state: removed.next_state
  };
}

module.exports = {
  resolveConcentrationOnDamage
};
