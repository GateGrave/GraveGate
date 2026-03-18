"use strict";

const {
  ACTION_TYPES,
  consumeParticipantAction,
  validateParticipantActionAvailability
} = require("./actionEconomy");
const {
  applyConditionToCombatState,
  getParticipantIncapacitationType,
  getActiveConditionsForParticipant,
  removeConditionFromCombatState
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
  return participants.find((entry) => String(entry.participant_id || "") === String(participantId || "")) || null;
}

function removeExistingHelpedAttackConditions(combat, sourceId, targetId) {
  let nextCombat = clone(combat);
  const active = getActiveConditionsForParticipant(nextCombat, targetId);
  const matching = active.filter((condition) => {
    return String(condition && condition.condition_type || "") === "helped_attack" &&
      String(condition && condition.source_actor_id || "") === String(sourceId || "");
  });
  for (let index = 0; index < matching.length; index += 1) {
    const removed = removeConditionFromCombatState(nextCombat, matching[index].condition_id);
    if (!removed.ok) {
      return removed;
    }
    nextCombat = clone(removed.next_state);
  }
  return {
    ok: true,
    next_state: nextCombat
  };
}

function performHelpAction(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;
  const helperId = data.helper_id;
  const targetId = data.target_id;

  if (!combatManager) {
    return failure("help_action_failed", "combatManager is required");
  }
  if (!combatId) {
    return failure("help_action_failed", "combat_id is required");
  }
  if (!helperId) {
    return failure("help_action_failed", "helper_id is required");
  }
  if (!targetId) {
    return failure("help_action_failed", "target_id is required");
  }

  const found = combatManager.getCombatById(combatId);
  if (!found.ok) {
    return failure("help_action_failed", "combat not found", {
      combat_id: String(combatId)
    });
  }

  let combat = clone(found.payload.combat);
  if (combat.status !== "active") {
    return failure("help_action_failed", "combat is not active", {
      combat_id: String(combatId),
      status: combat.status
    });
  }

  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  const helper = findParticipantById(participants, helperId);
  const target = findParticipantById(participants, targetId);
  if (!helper) {
    return failure("help_action_failed", "helper not found in combat", {
      combat_id: String(combatId),
      helper_id: String(helperId)
    });
  }
  if (!target) {
    return failure("help_action_failed", "target not found in combat", {
      combat_id: String(combatId),
      target_id: String(targetId)
    });
  }
  if (String(helper.participant_id || "") === String(target.participant_id || "")) {
    return failure("help_action_failed", "help action requires an ally target", {
      combat_id: String(combatId),
      helper_id: String(helperId),
      target_id: String(targetId)
    });
  }
  if (String(helper.team || "") !== String(target.team || "")) {
    return failure("help_action_failed", "help action requires an ally target", {
      combat_id: String(combatId),
      helper_id: String(helperId),
      target_id: String(targetId)
    });
  }
  if (Number(helper.current_hp || 0) <= 0) {
    return failure("help_action_failed", "defeated participants cannot act", {
      combat_id: String(combatId),
      helper_id: String(helperId),
      current_hp: Number(helper.current_hp || 0)
    });
  }
  const incapacitationType = getParticipantIncapacitationType(combat, helperId);
  if (incapacitationType) {
    return failure("help_action_failed", `${incapacitationType} participants cannot act`, {
      combat_id: String(combatId),
      helper_id: String(helperId),
      incapacitating_condition: incapacitationType
    });
  }
  if (Number(target.current_hp || 0) <= 0) {
    return failure("help_action_failed", "target is already defeated", {
      combat_id: String(combatId),
      target_id: String(targetId),
      current_hp: Number(target.current_hp || 0)
    });
  }

  const initiativeOrder = Array.isArray(combat.initiative_order) ? combat.initiative_order : [];
  const expectedActorId = initiativeOrder[combat.turn_index];
  if (!expectedActorId || String(expectedActorId) !== String(helperId)) {
    return failure("help_action_failed", "it is not the helper's turn", {
      combat_id: String(combatId),
      helper_id: String(helperId),
      expected_actor_id: expectedActorId || null,
      turn_index: combat.turn_index
    });
  }

  const availability = validateParticipantActionAvailability(helper, ACTION_TYPES.HELP);
  if (!availability.ok) {
    return failure("help_action_failed", availability.error || "action is not available", availability.payload);
  }

  const consumed = consumeParticipantAction(helper, ACTION_TYPES.HELP);
  if (!consumed.ok) {
    return failure("help_action_failed", consumed.error || "failed to consume action", consumed.payload);
  }

  const helperIndex = participants.findIndex((entry) => String(entry.participant_id || "") === String(helperId));
  participants[helperIndex] = consumed.payload.participant;
  combat.participants = participants;

  const removedExisting = removeExistingHelpedAttackConditions(combat, helperId, targetId);
  if (!removedExisting.ok) {
    return failure("help_action_failed", removedExisting.error || "failed to refresh help condition");
  }
  combat = clone(removedExisting.next_state);

  const applied = applyConditionToCombatState(combat, {
    condition_type: "helped_attack",
    source_actor_id: String(helperId),
    target_actor_id: String(targetId),
    applied_at_round: Number.isFinite(Number(combat.round)) ? Number(combat.round) : 1,
    expiration_trigger: "start_of_source_turn",
    duration: {
      remaining_triggers: 1
    },
    metadata: {
      source: "help_action",
      apply_to_attack_roll: true
    }
  });
  if (!applied.ok) {
    return failure("help_action_failed", applied.error || "failed to apply help condition");
  }
  combat = clone(applied.next_state);
  combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
  combat.event_log.push({
    event_type: "help_action",
    timestamp: new Date().toISOString(),
    helper_id: String(helperId),
    target_id: String(targetId),
    details: {
      condition_id: String(applied.condition && applied.condition.condition_id || ""),
      condition_type: "helped_attack"
    }
  });
  combat.updated_at = new Date().toISOString();

  combatManager.combats.set(String(combatId), combat);

  return success("help_action_resolved", {
    combat_id: String(combatId),
    helper_id: String(helperId),
    target_id: String(targetId),
    action_available_after: consumed.payload.participant.action_available,
    applied_condition: clone(applied.condition),
    combat: clone(combat)
  });
}

module.exports = {
  performHelpAction
};
