"use strict";

const { processCombatEventSafe } = require("../processing/process-combat-event-safe");

/**
 * Build a state update for a turn_started event.
 * - Finds active participant from initiative_order[current_turn_index]
 * - Resets turn flags on that participant only
 * @param {object} input
 * @param {object} input.event
 * @param {object} input.combatState
 * @returns {object}
 */
function resolveTurnStarted(input) {
  const combatState = input.combatState;

  const activeInitiativeEntry =
    combatState.initiative_order[combatState.current_turn_index] || null;

  if (!activeInitiativeEntry) {
    throw new Error("turn_started failed: no active initiative entry");
  }

  const activeParticipantId = activeInitiativeEntry.participant_id;
  const participantExists = combatState.participants.some(
    (participant) => participant.participant_id === activeParticipantId
  );

  if (!participantExists) {
    throw new Error(`turn_started failed: participant not found (${activeParticipantId})`);
  }

  return {
    stateUpdater: (state) => {
      const nextParticipants = state.participants.map((participant) => {
        if (participant.participant_id !== activeParticipantId) {
          return participant;
        }

        const movementSpeed = Number(participant.movement_speed || 0);

        return {
          ...participant,
          action_available: true,
          bonus_action_available: true,
          reaction_available: true,
          movement_remaining: movementSpeed
        };
      });

      return {
        ...state,
        participants: nextParticipants
      };
    },
    output: {
      event_type: "turn_started_resolved",
      active_participant_id: activeParticipantId,
      current_turn_index: combatState.current_turn_index,
      round_number: combatState.round_number
    }
  };
}

/**
 * Safe event-driven processor for turn_started.
 * Uses combat lock lifecycle through processCombatEventSafe.
 * @param {object} input
 * @param {object} input.registry
 * @param {object} input.event
 * @returns {Promise<object>}
 */
async function processTurnStartedEvent(input) {
  return processCombatEventSafe({
    registry: input.registry,
    event: input.event,
    processEventFn: async ({ event, combatState }) => {
      return resolveTurnStarted({ event, combatState });
    }
  });
}

module.exports = {
  resolveTurnStarted,
  processTurnStartedEvent
};
