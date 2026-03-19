"use strict";

const {
  ACTION_TYPES,
  consumeParticipantAction,
  validateParticipantActionAvailability,
  validateParticipantActionContext
} = require("./actionEconomy");
const {
  applyConditionToCombatState,
  getActiveConditionsForParticipant,
  removeConditionFromCombatState
} = require("../conditions/conditionHelpers");
const { gridDistanceFeet } = require("../validation/validation-helpers");
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
  return participants.find((entry) => String(entry && entry.participant_id || "") === String(participantId || "")) || null;
}

function removeExistingGrappleFromSource(combat, sourceId, targetId) {
  const active = getActiveConditionsForParticipant(combat, targetId);
  let nextCombat = clone(combat);
  for (let index = 0; index < active.length; index += 1) {
    const condition = active[index];
    if (String(condition && condition.condition_type || "") !== "grappled") {
      continue;
    }
    if (String(condition && condition.source_actor_id || "") !== String(sourceId || "")) {
      continue;
    }
    const removed = removeConditionFromCombatState(nextCombat, condition.condition_id);
    if (!removed.ok) {
      return removed;
    }
    nextCombat = removed.next_state;
  }
  return {
    ok: true,
    next_state: nextCombat
  };
}

function performGrappleAction(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;
  const attackerId = data.attacker_id;
  const targetId = data.target_id;
  const contestRollFn = typeof data.contest_roll_fn === "function" ? data.contest_roll_fn : null;

  if (!combatManager) {
    return failure("grapple_action_failed", "combatManager is required");
  }
  if (!combatId) {
    return failure("grapple_action_failed", "combat_id is required");
  }
  if (!attackerId) {
    return failure("grapple_action_failed", "attacker_id is required");
  }
  if (!targetId) {
    return failure("grapple_action_failed", "target_id is required");
  }

  const found = combatManager.getCombatById(combatId);
  if (!found.ok) {
    return failure("grapple_action_failed", "combat not found", {
      combat_id: String(combatId)
    });
  }

  let combat = clone(found.payload.combat);
  if (combat.status !== "active") {
    return failure("grapple_action_failed", "combat is not active", {
      combat_id: String(combatId),
      status: combat.status
    });
  }

  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  const attacker = findParticipantById(participants, attackerId);
  const target = findParticipantById(participants, targetId);
  if (!attacker) {
    return failure("grapple_action_failed", "attacker not found in combat", {
      combat_id: String(combatId),
      attacker_id: String(attackerId)
    });
  }
  if (!target) {
    return failure("grapple_action_failed", "target not found in combat", {
      combat_id: String(combatId),
      target_id: String(targetId)
    });
  }
  if (String(attacker.participant_id || "") === String(target.participant_id || "")) {
    return failure("grapple_action_failed", "cannot grapple self");
  }
  if (String(attacker.team || "") === String(target.team || "")) {
    return failure("grapple_action_failed", "cannot grapple an ally", {
      attacker_id: String(attackerId),
      target_id: String(targetId)
    });
  }

  const targetHp = Number.isFinite(Number(target.current_hp)) ? Number(target.current_hp) : 0;
  const contextValidation = validateParticipantActionContext(combat, attacker, {
    participant_id: attackerId,
    role_key: "attacker_id",
    turn_error_message: "it is not the attacker's turn"
  });
  if (!contextValidation.ok) {
    return failure("grapple_action_failed", contextValidation.message, contextValidation.payload);
  }
  if (targetHp <= 0) {
    return failure("grapple_action_failed", "target is already defeated", {
      target_id: String(targetId),
      current_hp: targetHp
    });
  }

  const rangeFeet = attacker.position && target.position
    ? gridDistanceFeet(attacker.position, target.position)
    : null;
  if (!Number.isFinite(rangeFeet) || rangeFeet > 5) {
    return failure("grapple_action_failed", "target is out of grapple range", {
      attacker_id: String(attackerId),
      target_id: String(targetId),
      distance_feet: Number.isFinite(rangeFeet) ? rangeFeet : null
    });
  }

  const availability = validateParticipantActionAvailability(attacker, ACTION_TYPES.GRAPPLE);
  if (!availability.ok) {
    return failure("grapple_action_failed", availability.error || "action is not available", availability.payload);
  }

  const consumed = consumeParticipantAction(attacker, ACTION_TYPES.GRAPPLE);
  if (!consumed.ok) {
    return failure("grapple_action_failed", consumed.error || "failed to consume action", consumed.payload);
  }

  const attackerIndex = participants.findIndex((entry) => String(entry && entry.participant_id || "") === String(attackerId));
  participants[attackerIndex] = consumed.payload.participant;
  combat.participants = participants;

  const defenderAbility = getAbilityModifier(target, "dexterity") >= getAbilityModifier(target, "strength")
    ? "dexterity"
    : "strength";
  const contest = resolveContestedCheck({
    attacker,
    defender: target,
    attacker_ability: "strength",
    defender_ability: defenderAbility,
    roll_fn: contestRollFn,
    combat
  });
  if (!contest.attacker_wins) {
    combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
    combat.event_log.push({
      event_type: "grapple_action",
      timestamp: new Date().toISOString(),
      attacker_id: String(attackerId),
      target_id: String(targetId),
      details: {
        success: false,
        contested_check: contest
      }
    });
    combat.updated_at = new Date().toISOString();
    combatManager.combats.set(String(combatId), combat);
    return success("grapple_action_resolved", {
      combat_id: String(combatId),
      attacker_id: String(attackerId),
      target_id: String(targetId),
      applied_condition: null,
      contested_check: contest,
      action_available_after: consumed.payload.participant.action_available,
      combat: clone(combat)
    });
  }

  const removedExisting = removeExistingGrappleFromSource(combat, attackerId, targetId);
  if (!removedExisting.ok) {
    return failure("grapple_action_failed", removedExisting.error || "failed to refresh grapple condition");
  }
  combat = removedExisting.next_state;

  const applied = applyConditionToCombatState(combat, {
    condition_type: "grappled",
    source_actor_id: String(attackerId),
    target_actor_id: String(targetId),
    expiration_trigger: "manual",
    metadata: {
      source: "grapple_action",
      escape_action: "future_escape_grapple"
    }
  });
  if (!applied.ok) {
    return failure("grapple_action_failed", applied.error || "failed to apply grappled condition");
  }
  combat = clone(applied.next_state);
  combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
  combat.event_log.push({
    event_type: "grapple_action",
    timestamp: new Date().toISOString(),
    attacker_id: String(attackerId),
    target_id: String(targetId),
    details: {
      success: true,
      condition_type: "grappled",
      condition_id: String(applied.condition && applied.condition.condition_id || ""),
      contested_check: contest
    }
  });
  combat.updated_at = new Date().toISOString();

  combatManager.combats.set(String(combatId), combat);

  return success("grapple_action_resolved", {
    combat_id: String(combatId),
    attacker_id: String(attackerId),
    target_id: String(targetId),
    applied_condition: clone(applied.condition),
    contested_check: contest,
    action_available_after: consumed.payload.participant.action_available,
    combat: clone(combat)
  });
}

module.exports = {
  performGrappleAction
};
