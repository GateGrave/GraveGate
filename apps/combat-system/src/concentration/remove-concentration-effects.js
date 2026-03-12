"use strict";

/**
 * Remove concentration and linked effects from combat state.
 * Linked effects are removed by effect ids listed on participant concentration data.
 * @param {object} input
 * @param {object} input.combat_state
 * @param {string} input.participant_id
 * @returns {{next_state: object, removed_effect_ids: string[]}}
 */
function removeConcentrationEffects(input) {
  const state = input.combat_state;
  const participantId = input.participant_id;

  const participantIndex = state.participants.findIndex(
    (participant) => participant.participant_id === participantId
  );

  if (participantIndex === -1) {
    throw new Error(`Participant not found: ${participantId}`);
  }

  const participant = state.participants[participantIndex];
  const linkedEffectIds = Array.isArray(participant.concentration?.linked_effect_ids)
    ? [...participant.concentration.linked_effect_ids]
    : [];

  const nextParticipants = [...state.participants];
  nextParticipants[participantIndex] = {
    ...participant,
    concentration: {
      is_concentrating: false,
      source_spell_id: null,
      linked_effect_ids: []
    }
  };

  const nextActiveEffects = Array.isArray(state.active_effects)
    ? state.active_effects.filter((effect) => !linkedEffectIds.includes(effect.effect_id))
    : [];

  return {
    next_state: {
      ...state,
      participants: nextParticipants,
      active_effects: nextActiveEffects,
      updated_at: new Date().toISOString()
    },
    removed_effect_ids: linkedEffectIds
  };
}

module.exports = {
  removeConcentrationEffects
};
