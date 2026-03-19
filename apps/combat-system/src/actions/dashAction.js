"use strict";

const {
  ACTION_TYPES,
  consumeParticipantAction,
  validateParticipantActionAvailability,
  validateParticipantActionContext
} = require("./actionEconomy");

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
  return participants.find((entry) => String(entry && entry.participant_id || "") === String(participantId || "")) || null;
}

function resolveMovementSpeed(participant) {
  const speed = Number(participant && participant.movement_speed);
  return Number.isFinite(speed) && speed > 0 ? Math.floor(speed) : 30;
}

function resolveMovementRemaining(participant) {
  const remaining = Number(participant && participant.movement_remaining);
  if (Number.isFinite(remaining) && remaining >= 0) {
    return Math.floor(remaining);
  }
  return resolveMovementSpeed(participant);
}

function performDashAction(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;
  const participantId = data.participant_id;

  if (!combatManager) {
    return failure("dash_action_failed", "combatManager is required");
  }
  if (!combatId) {
    return failure("dash_action_failed", "combat_id is required");
  }
  if (!participantId) {
    return failure("dash_action_failed", "participant_id is required");
  }

  const found = combatManager.getCombatById(combatId);
  if (!found.ok) {
    return failure("dash_action_failed", "combat not found", {
      combat_id: String(combatId)
    });
  }

  const combat = clone(found.payload.combat);
  if (combat.status !== "active") {
    return failure("dash_action_failed", "combat is not active", {
      combat_id: String(combatId),
      status: combat.status
    });
  }

  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  const actor = findParticipantById(participants, participantId);
  if (!actor) {
    return failure("dash_action_failed", "participant not found in combat", {
      combat_id: String(combatId),
      participant_id: String(participantId)
    });
  }

  const contextValidation = validateParticipantActionContext(combat, actor, {
    participant_id: participantId
  });
  if (!contextValidation.ok) {
    return failure("dash_action_failed", contextValidation.message, contextValidation.payload);
  }

  const availability = validateParticipantActionAvailability(actor, ACTION_TYPES.DASH);
  if (!availability.ok) {
    return failure("dash_action_failed", availability.error || "action is not available", availability.payload);
  }

  const consumed = consumeParticipantAction(actor, ACTION_TYPES.DASH);
  if (!consumed.ok) {
    return failure("dash_action_failed", consumed.error || "failed to consume action", consumed.payload);
  }

  const actorIndex = participants.findIndex((entry) => String(entry && entry.participant_id || "") === String(participantId));
  const updatedActor = consumed.payload.participant;
  const movementBefore = resolveMovementRemaining(updatedActor);
  const speed = resolveMovementSpeed(updatedActor);
  const movementAfter = movementBefore + speed;
  updatedActor.movement_remaining = movementAfter;
  participants[actorIndex] = updatedActor;
  combat.participants = participants;
  combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
  combat.event_log.push({
    event_type: "dash_action",
    timestamp: new Date().toISOString(),
    participant_id: String(participantId),
    details: {
      movement_before: movementBefore,
      movement_added: speed,
      movement_after: movementAfter
    }
  });
  combat.updated_at = new Date().toISOString();

  combatManager.combats.set(String(combatId), combat);

  return success("dash_action_resolved", {
    combat_id: String(combatId),
    participant_id: String(participantId),
    action_available_after: updatedActor.action_available,
    movement_before: movementBefore,
    movement_added: speed,
    movement_after: movementAfter,
    combat: clone(combat)
  });
}

module.exports = {
  performDashAction
};
