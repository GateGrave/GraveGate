"use strict";

const {
  ACTION_TYPES,
  consumeParticipantAction,
  validateParticipantActionAvailability,
  validateParticipantActionContext
} = require("./actionEconomy");
const {
  getActiveConditionsForParticipant,
  removeConditionFromCombatState
} = require("../conditions/conditionHelpers");
const { getAbilityModifier, resolveContestedCheck } = require("./contestedChecks");

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
  const list = Array.isArray(participants) ? participants : [];
  return list.find((entry) => String(entry && entry.participant_id || "") === String(participantId || "")) || null;
}

function pickGrappleConditionForTarget(combat, targetId) {
  const active = getActiveConditionsForParticipant(combat, targetId).filter((condition) => {
    return String(condition && condition.condition_type || "") === "grappled";
  });
  return active.length > 0 ? active[0] : null;
}

function performEscapeGrappleAction(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;
  const participantId = data.participant_id;
  const contestRollFn = typeof data.contest_roll_fn === "function" ? data.contest_roll_fn : null;

  if (!combatManager) {
    return failure("escape_grapple_action_failed", "combatManager is required");
  }
  if (!combatId) {
    return failure("escape_grapple_action_failed", "combat_id is required");
  }
  if (!participantId) {
    return failure("escape_grapple_action_failed", "participant_id is required");
  }

  const found = combatManager.getCombatById(combatId);
  if (!found.ok) {
    return failure("escape_grapple_action_failed", "combat not found", {
      combat_id: String(combatId)
    });
  }

  let combat = clone(found.payload.combat);
  if (combat.status !== "active") {
    return failure("escape_grapple_action_failed", "combat is not active", {
      combat_id: String(combatId),
      status: combat.status
    });
  }

  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  const actor = findParticipantById(participants, participantId);
  if (!actor) {
    return failure("escape_grapple_action_failed", "participant not found in combat", {
      combat_id: String(combatId),
      participant_id: String(participantId)
    });
  }
  const contextValidation = validateParticipantActionContext(combat, actor, {
    participant_id: participantId
  });
  if (!contextValidation.ok) {
    return failure("escape_grapple_action_failed", contextValidation.message, contextValidation.payload);
  }

  const grappleCondition = pickGrappleConditionForTarget(combat, participantId);
  if (!grappleCondition) {
    return failure("escape_grapple_action_failed", "participant is not grappled", {
      combat_id: String(combatId),
      participant_id: String(participantId)
    });
  }
  const grappler = findParticipantById(participants, grappleCondition.source_actor_id);
  if (!grappler) {
    return failure("escape_grapple_action_failed", "grapple source not found");
  }

  const availability = validateParticipantActionAvailability(actor, ACTION_TYPES.ESCAPE_GRAPPLE);
  if (!availability.ok) {
    return failure("escape_grapple_action_failed", availability.error || "action is not available", availability.payload);
  }
  const consumed = consumeParticipantAction(actor, ACTION_TYPES.ESCAPE_GRAPPLE);
  if (!consumed.ok) {
    return failure("escape_grapple_action_failed", consumed.error || "failed to consume action", consumed.payload);
  }
  const actorIndex = participants.findIndex((entry) => String(entry && entry.participant_id || "") === String(participantId));
  participants[actorIndex] = consumed.payload.participant;
  combat.participants = participants;

  const escapeAbility = getAbilityModifier(actor, "dexterity") >= getAbilityModifier(actor, "strength")
    ? "dexterity"
    : "strength";
  const contest = resolveContestedCheck({
    attacker: actor,
    defender: grappler,
    attacker_ability: escapeAbility,
    defender_ability: "strength",
    roll_fn: contestRollFn,
    combat
  });

  let removedCondition = null;
  if (contest.attacker_wins) {
    const removed = removeConditionFromCombatState(combat, grappleCondition.condition_id);
    if (!removed.ok) {
      return failure("escape_grapple_action_failed", removed.error || "failed to remove grapple condition");
    }
    removedCondition = removed.removed_condition;
    combat = removed.next_state;
  }
  combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
  combat.event_log.push({
    event_type: "escape_grapple_action",
    timestamp: new Date().toISOString(),
    participant_id: String(participantId),
    source_actor_id: String(grappleCondition.source_actor_id || ""),
    details: {
      success: contest.attacker_wins === true,
      contested_check: contest,
      removed_condition_id: removedCondition && removedCondition.condition_id ? String(removedCondition.condition_id) : null
    }
  });
  combat.updated_at = new Date().toISOString();
  combatManager.combats.set(String(combatId), combat);

  return success("escape_grapple_action_resolved", {
    combat_id: String(combatId),
    participant_id: String(participantId),
    source_actor_id: String(grappleCondition.source_actor_id || ""),
    escaped: contest.attacker_wins === true,
    contested_check: contest,
    removed_condition: removedCondition ? clone(removedCondition) : null,
    action_available_after: consumed.payload.participant.action_available,
    combat: clone(combat)
  });
}

module.exports = {
  performEscapeGrappleAction
};
