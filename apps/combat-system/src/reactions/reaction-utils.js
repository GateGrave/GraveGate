"use strict";

function isAdjacent(a, b) {
  if (!a || !b) {
    return false;
  }

  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return dx <= 1 && dy <= 1 && (dx + dy) > 0;
}

function nowIso() {
  return new Date().toISOString();
}

function findParticipantById(combatState, participantId) {
  return combatState.participants.find(
    (participant) => participant.participant_id === participantId
  ) || null;
}

module.exports = {
  isAdjacent,
  nowIso,
  findParticipantById
};
