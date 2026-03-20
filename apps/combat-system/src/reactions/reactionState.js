"use strict";

const { participantHasCondition } = require("../conditions/conditionHelpers");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function initializeParticipantReactions(participants) {
  const list = Array.isArray(participants) ? participants : [];
  return list.map((participant) => Object.assign({}, participant, {
    reaction_available: participant && typeof participant.reaction_available === "boolean"
      ? participant.reaction_available
      : true
  }));
}

function findParticipantById(participants, participantId) {
  const list = Array.isArray(participants) ? participants : [];
  return list.find((participant) => String(participant && participant.participant_id || "") === String(participantId || "")) || null;
}

function canParticipantReact(combatState, participantId) {
  if (!combatState || String(combatState.status || "") !== "active") {
    return false;
  }
  const participant = findParticipantById(combatState.participants, participantId);
  if (!participant) {
    return false;
  }
  const hp = Number(participant.current_hp);
  if (!Number.isFinite(hp) || hp <= 0) {
    return false;
  }
  if (participantHasCondition(combatState, participantId, "stunned")) {
    return false;
  }
  if (participantHasCondition(combatState, participantId, "paralyzed")) {
    return false;
  }
  if (
    participantHasCondition(combatState, participantId, "opportunity_attack_immunity") ||
    participantHasCondition(combatState, participantId, "no_reaction")
  ) {
    return false;
  }
  const activeConditions = Array.isArray(combatState && combatState.conditions)
    ? combatState.conditions.filter((condition) => String(condition && condition.target_actor_id || "") === String(participantId || ""))
    : [];
  const blockedByMetadata = activeConditions.some((condition) => {
    const metadata = condition && condition.metadata && typeof condition.metadata === "object" ? condition.metadata : {};
    return metadata.apply_no_reaction === true;
  });
  if (blockedByMetadata) {
    return false;
  }
  return participant.reaction_available === true;
}

function consumeReaction(combatState, participantId) {
  const list = Array.isArray(combatState && combatState.participants) ? combatState.participants : [];
  const nextParticipants = list.map((participant) => {
    if (String(participant && participant.participant_id || "") !== String(participantId || "")) {
      return participant;
    }
    return Object.assign({}, participant, {
      reaction_available: false
    });
  });

  const nextState = Object.assign({}, combatState, {
    participants: nextParticipants,
    updated_at: new Date().toISOString()
  });
  nextState.event_log = Array.isArray(nextState.event_log) ? nextState.event_log : [];
  nextState.event_log.push({
    event_type: "reaction_consumed",
    timestamp: new Date().toISOString(),
    participant_id: String(participantId || "")
  });

  return {
    ok: true,
    next_state: nextState
  };
}

function resetReactionForParticipant(combatState, participantId) {
  const list = Array.isArray(combatState && combatState.participants) ? combatState.participants : [];
  const nextParticipants = list.map((participant) => {
    if (String(participant && participant.participant_id || "") !== String(participantId || "")) {
      return participant;
    }
    return Object.assign({}, participant, {
      reaction_available: true
    });
  });

  return {
    ok: true,
    next_state: Object.assign({}, combatState, {
      participants: nextParticipants,
      updated_at: new Date().toISOString()
    })
  };
}

module.exports = {
  initializeParticipantReactions,
  canParticipantReact,
  consumeReaction,
  resetReactionForParticipant
};
