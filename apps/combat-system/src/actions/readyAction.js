"use strict";

const {
  ACTION_TYPES,
  consumeParticipantAction,
  validateParticipantActionAvailability
} = require("./actionEconomy");
const { getParticipantIncapacitationType } = require("../conditions/conditionHelpers");

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
  return participants.find((entry) => String(entry.participant_id || "") === String(participantId || "")) || null;
}

const SUPPORTED_READY_TRIGGER_TYPES = new Set([
  "enemy_enters_reach"
]);

const SUPPORTED_READIED_ACTION_TYPES = new Set([
  "attack"
]);

function performReadyAction(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;
  const participantId = data.participant_id;
  const triggerType = String(data.trigger_type || "enemy_enters_reach").trim().toLowerCase();
  const actionType = String(data.readied_action_type || "attack").trim().toLowerCase();
  const targetId = data.target_id ? String(data.target_id).trim() : null;

  if (!combatManager) {
    return failure("ready_action_failed", "combatManager is required");
  }
  if (!combatId) {
    return failure("ready_action_failed", "combat_id is required");
  }
  if (!participantId) {
    return failure("ready_action_failed", "participant_id is required");
  }
  if (!triggerType) {
    return failure("ready_action_failed", "trigger_type is required");
  }
  if (!actionType) {
    return failure("ready_action_failed", "readied_action_type is required");
  }
  if (!SUPPORTED_READY_TRIGGER_TYPES.has(triggerType)) {
    return failure("ready_action_failed", "unsupported trigger_type for ready action", {
      trigger_type: triggerType,
      supported_trigger_types: Array.from(SUPPORTED_READY_TRIGGER_TYPES)
    });
  }
  if (!SUPPORTED_READIED_ACTION_TYPES.has(actionType)) {
    return failure("ready_action_failed", "unsupported readied_action_type", {
      readied_action_type: actionType,
      supported_action_types: Array.from(SUPPORTED_READIED_ACTION_TYPES)
    });
  }

  const found = combatManager.getCombatById(combatId);
  if (!found.ok) {
    return failure("ready_action_failed", "combat not found", {
      combat_id: String(combatId)
    });
  }

  const combat = clone(found.payload.combat);
  if (combat.status !== "active") {
    return failure("ready_action_failed", "combat is not active", {
      combat_id: String(combatId),
      status: combat.status
    });
  }

  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  const actor = findParticipantById(participants, participantId);
  if (!actor) {
    return failure("ready_action_failed", "participant not found in combat", {
      combat_id: String(combatId),
      participant_id: String(participantId)
    });
  }
  const actorHp = Number.isFinite(actor.current_hp) ? actor.current_hp : 0;
  if (actorHp <= 0) {
    return failure("ready_action_failed", "defeated participants cannot act", {
      combat_id: String(combatId),
      participant_id: String(participantId),
      current_hp: actorHp
    });
  }
  const incapacitationType = getParticipantIncapacitationType(combat, participantId);
  if (incapacitationType) {
    return failure("ready_action_failed", `${incapacitationType} participants cannot act`, {
      combat_id: String(combatId),
      participant_id: String(participantId),
      incapacitating_condition: incapacitationType
    });
  }

  const initiativeOrder = Array.isArray(combat.initiative_order) ? combat.initiative_order : [];
  const expectedActorId = initiativeOrder[combat.turn_index];
  if (!expectedActorId || String(expectedActorId) !== String(participantId)) {
    return failure("ready_action_failed", "it is not the participant's turn", {
      combat_id: String(combatId),
      participant_id: String(participantId),
      expected_actor_id: expectedActorId || null,
      turn_index: combat.turn_index
    });
  }

  const availability = validateParticipantActionAvailability(actor, ACTION_TYPES.READY);
  if (!availability.ok) {
    return failure("ready_action_failed", availability.error || "action is not available", availability.payload);
  }

  const consumed = consumeParticipantAction(actor, ACTION_TYPES.READY);
  if (!consumed.ok) {
    return failure("ready_action_failed", consumed.error || "failed to consume action", consumed.payload);
  }

  const actorIndex = participants.findIndex((entry) => String(entry.participant_id || "") === String(participantId));
  const updatedActor = consumed.payload.participant;
  updatedActor.ready_action = {
    trigger_type: triggerType,
    action_type: actionType,
    target_id: targetId || null,
    set_round: Number.isFinite(Number(combat.round)) ? Number(combat.round) : 1
  };
  participants[actorIndex] = updatedActor;
  combat.participants = participants;
  combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
  combat.event_log.push({
    event_type: "ready_action",
    timestamp: new Date().toISOString(),
    participant_id: String(participantId),
    details: clone(updatedActor.ready_action)
  });
  combat.updated_at = new Date().toISOString();

  combatManager.combats.set(String(combatId), combat);

  return success("ready_action_resolved", {
    combat_id: String(combatId),
    participant_id: String(participantId),
    ready_action: clone(updatedActor.ready_action),
    action_available_after: updatedActor.action_available,
    combat: clone(combat)
  });
}

module.exports = {
  performReadyAction
};
