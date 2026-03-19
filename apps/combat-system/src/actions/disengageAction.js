"use strict";

const {
  ACTION_TYPES,
  consumeParticipantAction,
  validateParticipantActionAvailability,
  validateParticipantActionContext
} = require("./actionEconomy");
const {
  applyConditionToCombatState
} = require("../conditions/conditionHelpers");

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

function removeParticipantOpportunityAttackImmunity(combat, participantId) {
  const conditions = Array.isArray(combat && combat.conditions) ? combat.conditions : [];
  return Object.assign({}, combat, {
    conditions: conditions.filter((condition) => {
      return !(
        String(condition && condition.target_actor_id || "") === String(participantId || "") &&
        String(condition && condition.condition_type || "") === "opportunity_attack_immunity"
      );
    })
  });
}

function performDisengageAction(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;
  const participantId = data.participant_id;

  if (!combatManager) {
    return failure("disengage_action_failed", "combatManager is required");
  }
  if (!combatId) {
    return failure("disengage_action_failed", "combat_id is required");
  }
  if (!participantId) {
    return failure("disengage_action_failed", "participant_id is required");
  }

  const found = combatManager.getCombatById(combatId);
  if (!found.ok) {
    return failure("disengage_action_failed", "combat not found", {
      combat_id: String(combatId)
    });
  }

  let combat = clone(found.payload.combat);
  if (combat.status !== "active") {
    return failure("disengage_action_failed", "combat is not active", {
      combat_id: String(combatId),
      status: combat.status
    });
  }

  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  const actor = findParticipantById(participants, participantId);
  if (!actor) {
    return failure("disengage_action_failed", "participant not found in combat", {
      combat_id: String(combatId),
      participant_id: String(participantId)
    });
  }

  const contextValidation = validateParticipantActionContext(combat, actor, {
    participant_id: participantId
  });
  if (!contextValidation.ok) {
    return failure("disengage_action_failed", contextValidation.message, contextValidation.payload);
  }

  const availability = validateParticipantActionAvailability(actor, ACTION_TYPES.DISENGAGE);
  if (!availability.ok) {
    return failure("disengage_action_failed", availability.error || "action is not available", availability.payload);
  }

  const consumed = consumeParticipantAction(actor, ACTION_TYPES.DISENGAGE);
  if (!consumed.ok) {
    return failure("disengage_action_failed", consumed.error || "failed to consume action", consumed.payload);
  }

  const updatedActor = consumed.payload.participant;
  const actorIndex = participants.findIndex((entry) => String(entry.participant_id) === String(participantId));
  participants[actorIndex] = updatedActor;
  combat.participants = participants;
  combat = removeParticipantOpportunityAttackImmunity(combat, participantId);

  const immunityApplied = applyConditionToCombatState(combat, {
    condition_type: "opportunity_attack_immunity",
    source_actor_id: String(participantId),
    target_actor_id: String(participantId),
    expiration_trigger: "start_of_turn",
    duration: {
      remaining_triggers: 1
    },
    metadata: {
      source: "disengage_action"
    }
  });
  if (!immunityApplied.ok) {
    return failure("disengage_action_failed", immunityApplied.error || "failed to apply disengage immunity");
  }
  combat = clone(immunityApplied.next_state);
  combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
  combat.event_log.push({
    event_type: "disengage_action",
    timestamp: new Date().toISOString(),
    participant_id: String(participantId),
    details: {
      opportunity_attack_immunity: true,
      immunity_condition_id: immunityApplied.condition && immunityApplied.condition.condition_id
        ? String(immunityApplied.condition.condition_id)
        : null
    }
  });
  combat.updated_at = new Date().toISOString();

  combatManager.combats.set(String(combatId), combat);

  return success("disengage_action_resolved", {
    combat_id: String(combatId),
    participant_id: String(participantId),
    action_available_after: updatedActor.action_available,
    immunity_condition: clone(immunityApplied.condition),
    combat: clone(combat)
  });
}

module.exports = {
  performDisengageAction
};
