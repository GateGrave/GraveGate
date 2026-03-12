"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {},
    error: null
  };
}

function failure(eventType, message, payload) {
  return {
    ok: false,
    event_type: eventType,
    payload: payload || {},
    error: message
  };
}

function defaultRollFunction() {
  return Math.floor(Math.random() * 20) + 1;
}

function getParticipantId(participant) {
  return participant.participant_id || participant.id || null;
}

function getInitiativeModifier(participant) {
  if (Number.isFinite(participant.initiative_modifier)) {
    return participant.initiative_modifier;
  }
  return 0;
}

// Stage 1 initiative resolver:
// - roll each participant
// - sort highest first
// - ties keep original participant order (stable rule)
// - write initiative_order back to combat state
function resolveInitiativeOrder(input) {
  const data = input || {};
  const combatState = data.combat_state;
  const rollFunction = typeof data.roll_function === "function" ? data.roll_function : defaultRollFunction;

  if (!combatState || typeof combatState !== "object") {
    return failure("initiative_resolve_failed", "combat_state is required");
  }

  const participants = Array.isArray(combatState.participants) ? combatState.participants : [];
  if (participants.length === 0) {
    return failure("initiative_resolve_failed", "combat has no participants", {
      combat_id: combatState.combat_id || null
    });
  }

  const initiativeEntries = [];
  for (let index = 0; index < participants.length; index += 1) {
    const participant = participants[index];
    const participantId = getParticipantId(participant);

    if (!participantId) {
      return failure("initiative_resolve_failed", "participant missing participant_id", {
        participant_index: index
      });
    }

    const rollValue = Number(rollFunction(participant, index));
    if (!Number.isFinite(rollValue)) {
      return failure("initiative_resolve_failed", "roll_function returned non-numeric value", {
        participant_id: String(participantId)
      });
    }

    const modifier = getInitiativeModifier(participant);
    const total = rollValue + modifier;

    initiativeEntries.push({
      participant_id: String(participantId),
      roll: rollValue,
      modifier,
      total,
      original_index: index
    });
  }

  initiativeEntries.sort((a, b) => {
    if (b.total !== a.total) {
      return b.total - a.total;
    }
    return a.original_index - b.original_index;
  });

  const initiativeOrder = initiativeEntries.map((entry) => entry.participant_id);
  const nextCombatState = clone(combatState);
  nextCombatState.initiative_order = initiativeOrder;
  nextCombatState.turn_index = 0;
  nextCombatState.updated_at = new Date().toISOString();

  return success("initiative_order_initialized", {
    combat: nextCombatState,
    initiative_entries: initiativeEntries
  });
}

module.exports = {
  resolveInitiativeOrder
};

