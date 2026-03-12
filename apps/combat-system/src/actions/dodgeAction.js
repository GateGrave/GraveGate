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

function findParticipantById(participants, participantId) {
  return participants.find((p) => String(p.participant_id) === String(participantId)) || null;
}

function performDodgeAction(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;
  const participantId = data.participant_id;

  if (!combatManager) {
    return failure("dodge_action_failed", "combatManager is required");
  }
  if (!combatId) {
    return failure("dodge_action_failed", "combat_id is required");
  }
  if (!participantId) {
    return failure("dodge_action_failed", "participant_id is required");
  }

  const found = combatManager.getCombatById(combatId);
  if (!found.ok) {
    return failure("dodge_action_failed", "combat not found", {
      combat_id: String(combatId)
    });
  }

  const combat = clone(found.payload.combat);
  if (combat.status !== "active") {
    return failure("dodge_action_failed", "combat is not active", {
      combat_id: String(combatId),
      status: combat.status
    });
  }

  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  const actor = findParticipantById(participants, participantId);
  if (!actor) {
    return failure("dodge_action_failed", "participant not found in combat", {
      combat_id: String(combatId),
      participant_id: String(participantId)
    });
  }

  const actorHp = Number.isFinite(actor.current_hp) ? actor.current_hp : 0;
  if (actorHp <= 0) {
    return failure("dodge_action_failed", "defeated participants cannot act", {
      combat_id: String(combatId),
      participant_id: String(participantId),
      current_hp: actorHp
    });
  }

  const initiativeOrder = Array.isArray(combat.initiative_order) ? combat.initiative_order : [];
  const expectedActorId = initiativeOrder[combat.turn_index];
  if (!expectedActorId || String(expectedActorId) !== String(participantId)) {
    return failure("dodge_action_failed", "it is not the participant's turn", {
      combat_id: String(combatId),
      participant_id: String(participantId),
      expected_actor_id: expectedActorId || null,
      turn_index: combat.turn_index
    });
  }

  actor.is_dodging = true;
  combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
  combat.event_log.push({
    event_type: "dodge_action",
    timestamp: new Date().toISOString(),
    participant_id: String(participantId),
    details: {
      is_dodging: true
    }
  });
  combat.updated_at = new Date().toISOString();

  combatManager.combats.set(String(combatId), combat);

  return success("dodge_action_resolved", {
    combat_id: String(combatId),
    participant_id: String(participantId),
    is_dodging: true,
    combat: clone(combat)
  });
}

module.exports = {
  performDodgeAction
};
