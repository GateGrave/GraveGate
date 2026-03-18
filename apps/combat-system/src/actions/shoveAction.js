"use strict";

const {
  ACTION_TYPES,
  consumeParticipantAction,
  validateParticipantActionAvailability
} = require("./actionEconomy");
const {
  applyConditionToCombatState,
  getActiveConditionsForParticipant,
  participantHasCondition,
  normalizeCombatControlConditions
} = require("../conditions/conditionHelpers");
const { gridDistanceFeet } = require("../validation/validation-helpers");
const { getAbilityModifier, resolveContestedCheck } = require("./contestedChecks");

const BATTLEFIELD_SIZE = 9;

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
  return (Array.isArray(participants) ? participants : []).find((entry) => {
    return String(entry && entry.participant_id || "") === String(participantId || "");
  }) || null;
}

function isInsideBounds(position) {
  if (!position || typeof position !== "object") {
    return false;
  }
  const x = Number(position.x);
  const y = Number(position.y);
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x < BATTLEFIELD_SIZE && y >= 0 && y < BATTLEFIELD_SIZE;
}

function normalizeShoveMode(mode) {
  const safe = String(mode || "push").trim().toLowerCase();
  return safe === "prone" ? "prone" : "push";
}

function computePushDestination(attackerPosition, targetPosition) {
  if (!attackerPosition || !targetPosition) {
    return null;
  }
  const dx = Number(targetPosition.x) - Number(attackerPosition.x);
  const dy = Number(targetPosition.y) - Number(attackerPosition.y);
  const stepX = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
  const stepY = dy === 0 ? 0 : (dy > 0 ? 1 : -1);
  return {
    x: Number(targetPosition.x) + stepX,
    y: Number(targetPosition.y) + stepY
  };
}

function targetCanBePushedTo(combat, targetId, destination) {
  if (!isInsideBounds(destination)) {
    return false;
  }
  const participants = Array.isArray(combat && combat.participants) ? combat.participants : [];
  return !participants.some((entry) => {
    if (String(entry && entry.participant_id || "") === String(targetId || "")) {
      return false;
    }
    return entry && entry.position &&
      Number(entry.position.x) === Number(destination.x) &&
      Number(entry.position.y) === Number(destination.y);
  });
}

function performShoveAction(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;
  const attackerId = data.attacker_id;
  const targetId = data.target_id;
  const shoveMode = normalizeShoveMode(data.shove_mode);
  const contestRollFn = typeof data.contest_roll_fn === "function" ? data.contest_roll_fn : null;

  if (!combatManager) {
    return failure("shove_action_failed", "combatManager is required");
  }
  if (!combatId) {
    return failure("shove_action_failed", "combat_id is required");
  }
  if (!attackerId) {
    return failure("shove_action_failed", "attacker_id is required");
  }
  if (!targetId) {
    return failure("shove_action_failed", "target_id is required");
  }

  const found = combatManager.getCombatById(combatId);
  if (!found.ok) {
    return failure("shove_action_failed", "combat not found", {
      combat_id: String(combatId)
    });
  }

  let combat = clone(found.payload.combat);
  if (combat.status !== "active") {
    return failure("shove_action_failed", "combat is not active", {
      combat_id: String(combatId),
      status: combat.status
    });
  }

  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  const attacker = findParticipantById(participants, attackerId);
  const target = findParticipantById(participants, targetId);
  if (!attacker || !target) {
    return failure("shove_action_failed", "attacker or target not found in combat");
  }
  if (String(attacker.team || "") === String(target.team || "")) {
    return failure("shove_action_failed", "cannot shove an ally");
  }
  const attackerHp = Number.isFinite(Number(attacker.current_hp)) ? Number(attacker.current_hp) : 0;
  const targetHp = Number.isFinite(Number(target.current_hp)) ? Number(target.current_hp) : 0;
  if (attackerHp <= 0) {
    return failure("shove_action_failed", "defeated participants cannot act");
  }
  if (targetHp <= 0) {
    return failure("shove_action_failed", "target is already defeated");
  }
  if (participantHasCondition(combat, attackerId, "stunned")) {
    return failure("shove_action_failed", "stunned participants cannot act");
  }
  if (participantHasCondition(combat, attackerId, "paralyzed")) {
    return failure("shove_action_failed", "paralyzed participants cannot act");
  }

  const initiativeOrder = Array.isArray(combat.initiative_order) ? combat.initiative_order : [];
  const expectedActorId = initiativeOrder[combat.turn_index];
  if (!expectedActorId || String(expectedActorId) !== String(attackerId)) {
    return failure("shove_action_failed", "it is not the attacker's turn");
  }

  const rangeFeet = attacker.position && target.position ? gridDistanceFeet(attacker.position, target.position) : null;
  if (!Number.isFinite(rangeFeet) || rangeFeet > 5) {
    return failure("shove_action_failed", "target is out of shove range");
  }

  const availability = validateParticipantActionAvailability(attacker, ACTION_TYPES.SHOVE);
  if (!availability.ok) {
    return failure("shove_action_failed", availability.error || "action is not available", availability.payload);
  }
  const consumed = consumeParticipantAction(attacker, ACTION_TYPES.SHOVE);
  if (!consumed.ok) {
    return failure("shove_action_failed", consumed.error || "failed to consume action", consumed.payload);
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

  let movedTo = null;
  let appliedCondition = null;
  let successful = false;

  if (contest.attacker_wins) {
    if (shoveMode === "push") {
      const destination = computePushDestination(attacker.position, target.position);
      if (targetCanBePushedTo(combat, targetId, destination)) {
        const targetIndex = participants.findIndex((entry) => String(entry && entry.participant_id || "") === String(targetId));
        if (targetIndex >= 0) {
          participants[targetIndex] = Object.assign({}, participants[targetIndex], {
            position: clone(destination)
          });
          combat.participants = participants;
          movedTo = clone(destination);
          successful = true;
        }
      }
    } else {
      const existingProne = getActiveConditionsForParticipant(combat, targetId).find((condition) => {
        return String(condition && condition.condition_type || "") === "prone";
      });
      if (!existingProne) {
        const applied = applyConditionToCombatState(combat, {
          condition_type: "prone",
          source_actor_id: String(attackerId),
          target_actor_id: String(targetId),
          expiration_trigger: "manual",
          metadata: {
            source: "shove_action"
          }
        });
        if (applied.ok) {
          combat = applied.next_state;
          appliedCondition = applied.condition;
        }
      }
      successful = true;
    }
  }

  const normalizedConditions = normalizeCombatControlConditions(combat);
  if (normalizedConditions.ok) {
    combat.conditions = normalizedConditions.next_state.conditions;
  }
  combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
  combat.event_log.push({
    event_type: "shove_action",
    timestamp: new Date().toISOString(),
    attacker_id: String(attackerId),
    target_id: String(targetId),
    details: {
      mode: shoveMode,
      success: successful,
      moved_to: movedTo,
      applied_condition_id: appliedCondition && appliedCondition.condition_id ? String(appliedCondition.condition_id) : null,
      contested_check: contest
    }
  });
  combat.updated_at = new Date().toISOString();
  combatManager.combats.set(String(combatId), combat);

  return success("shove_action_resolved", {
    combat_id: String(combatId),
    attacker_id: String(attackerId),
    target_id: String(targetId),
    mode: shoveMode,
    success: successful,
    moved_to: movedTo,
    applied_condition: appliedCondition ? clone(appliedCondition) : null,
    contested_check: contest,
    action_available_after: consumed.payload.participant.action_available,
    combat: clone(combat)
  });
}

module.exports = {
  performShoveAction
};
