"use strict";

/**
 * Optional concentration expiry helper.
 * If concentration has expires_at_round and combat round has reached it,
 * concentration is removed.
 * @param {object} input
 * @param {object} input.combat_state
 * @returns {{next_state: object, expired_participants: object[], emitted_events: object[]}}
 */
function checkConcentrationExpiry(input) {
  const state = input.combat_state;
  const expired = [];
  const emittedEvents = [];

  const nextParticipants = state.participants.map((participant) => {
    const concentration = participant.concentration;
    if (!concentration || concentration.is_concentrating !== true) {
      return participant;
    }

    const expiresAtRound = Number(concentration.expires_at_round || 0);
    if (expiresAtRound > 0 && state.round_number >= expiresAtRound) {
      expired.push({
        participant_id: participant.participant_id,
        source_spell_id: concentration.source_spell_id || null
      });

      emittedEvents.push({
        event_type: "concentration_expired",
        timestamp: new Date().toISOString(),
        payload: {
          participant_id: participant.participant_id,
          source_spell_id: concentration.source_spell_id || null
        }
      });

      return {
        ...participant,
        concentration: {
          is_concentrating: false,
          source_spell_id: null,
          linked_effect_ids: []
        }
      };
    }

    return participant;
  });

  return {
    next_state: {
      ...state,
      participants: nextParticipants,
      updated_at: new Date().toISOString()
    },
    expired_participants: expired,
    emitted_events: emittedEvents
  };
}

module.exports = {
  checkConcentrationExpiry
};
