"use strict";

const { rollDeathSave } = require("../dice");
const { LIFE_STATES, createDefaultDeathSaves } = require("./death-downed-model");

function findParticipantIndex(combatState, participantId) {
  return combatState.participants.findIndex(
    (participant) => participant.participant_id === participantId
  );
}

function withUpdatedParticipant(combatState, participantIndex, updatedParticipant) {
  const nextParticipants = [...combatState.participants];
  nextParticipants[participantIndex] = updatedParticipant;

  return {
    ...combatState,
    participants: nextParticipants,
    updated_at: new Date().toISOString()
  };
}

/**
 * Apply downed state when HP reaches 0.
 * Triggers character_down and sets unconscious state.
 */
function applyDownedState(combatState, participantId) {
  const index = findParticipantIndex(combatState, participantId);
  if (index === -1) {
    throw new Error(`Participant not found: ${participantId}`);
  }

  const participant = combatState.participants[index];
  const hp = Number(participant.current_hp || 0);

  if (hp > 0) {
    return {
      ok: true,
      action: "apply_downed_state",
      changed: false,
      reason: "hp_above_zero",
      next_state: combatState,
      emitted_events: []
    };
  }

  const updated = {
    ...participant,
    current_hp: 0,
    life_state: LIFE_STATES.DOWNED,
    unconscious: true,
    death_saves: participant.death_saves || createDefaultDeathSaves()
  };

  return {
    ok: true,
    action: "apply_downed_state",
    changed: true,
    next_state: withUpdatedParticipant(combatState, index, updated),
    emitted_events: [
      {
        event_type: "character_down",
        timestamp: new Date().toISOString(),
        payload: {
          participant_id: participantId
        }
      }
    ]
  };
}

function stabilizeCharacter(combatState, participantId) {
  const index = findParticipantIndex(combatState, participantId);
  if (index === -1) {
    throw new Error(`Participant not found: ${participantId}`);
  }

  const participant = combatState.participants[index];
  const updated = {
    ...participant,
    life_state: LIFE_STATES.STABILIZED,
    unconscious: true,
    death_saves: createDefaultDeathSaves()
  };

  return {
    ok: true,
    action: "stabilize_character",
    next_state: withUpdatedParticipant(combatState, index, updated),
    emitted_events: [
      {
        event_type: "character_stabilized",
        timestamp: new Date().toISOString(),
        payload: {
          participant_id: participantId
        }
      }
    ]
  };
}

function markCharacterDead(combatState, participantId) {
  const index = findParticipantIndex(combatState, participantId);
  if (index === -1) {
    throw new Error(`Participant not found: ${participantId}`);
  }

  const participant = combatState.participants[index];
  const updated = {
    ...participant,
    life_state: LIFE_STATES.DEAD,
    unconscious: true
  };

  return {
    ok: true,
    action: "mark_character_dead",
    next_state: withUpdatedParticipant(combatState, index, updated),
    emitted_events: [
      {
        event_type: "character_dead",
        timestamp: new Date().toISOString(),
        payload: {
          participant_id: participantId
        }
      }
    ]
  };
}

/**
 * Resolve one death save roll:
 * - 3 successes => stabilized
 * - 3 failures => dead
 * - nat 20 => regain 1 HP
 * - nat 1 => two failures
 */
function resolveDeathSave(combatState, participantId, options) {
  const index = findParticipantIndex(combatState, participantId);
  if (index === -1) {
    throw new Error(`Participant not found: ${participantId}`);
  }

  const participant = combatState.participants[index];
  const deathSaves = participant.death_saves || createDefaultDeathSaves();

  if (participant.life_state === LIFE_STATES.DEAD) {
    return {
      ok: false,
      action: "resolve_death_save",
      reason: "participant_dead",
      next_state: combatState,
      emitted_events: []
    };
  }

  const roll = rollDeathSave({
    rng: options?.rng
  });

  const d20Roll = roll.raw_dice[0]?.kept_rolls?.[0] || 0;
  let successes = Number(deathSaves.successes || 0);
  let failures = Number(deathSaves.failures || 0);
  let updatedParticipant = { ...participant };
  const emittedEvents = [];

  if (d20Roll === 20) {
    updatedParticipant = {
      ...updatedParticipant,
      current_hp: 1,
      life_state: LIFE_STATES.ALIVE,
      unconscious: false,
      death_saves: createDefaultDeathSaves()
    };
    emittedEvents.push({
      event_type: "death_save_natural_20",
      timestamp: new Date().toISOString(),
      payload: {
        participant_id: participantId,
        regained_hp: 1
      }
    });
  } else if (d20Roll === 1) {
    failures += 2;
  } else if (roll.death_save?.success) {
    successes += 1;
  } else {
    failures += 1;
  }

  if (updatedParticipant.current_hp !== 1) {
    updatedParticipant = {
      ...updatedParticipant,
      death_saves: {
        successes,
        failures
      }
    };
  }

  let nextState = withUpdatedParticipant(combatState, index, updatedParticipant);

  if (updatedParticipant.current_hp !== 1 && successes >= 3) {
    const stabilized = stabilizeCharacter(nextState, participantId);
    nextState = stabilized.next_state;
    emittedEvents.push(...stabilized.emitted_events);
  } else if (updatedParticipant.current_hp !== 1 && failures >= 3) {
    const dead = markCharacterDead(nextState, participantId);
    nextState = dead.next_state;
    emittedEvents.push(...dead.emitted_events);
  }

  emittedEvents.unshift({
    event_type: "death_save_resolved",
    timestamp: new Date().toISOString(),
    payload: {
      participant_id: participantId,
      roll_total: roll.final_total,
      d20_roll: d20Roll,
      successes: nextState.participants[index].death_saves?.successes ?? 0,
      failures: nextState.participants[index].death_saves?.failures ?? 0
    }
  });

  return {
    ok: true,
    action: "resolve_death_save",
    roll_result: roll,
    next_state: nextState,
    emitted_events: emittedEvents
  };
}

module.exports = {
  applyDownedState,
  resolveDeathSave,
  stabilizeCharacter,
  markCharacterDead
};
