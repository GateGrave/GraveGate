"use strict";

const { expireConditionsForTrigger, getActiveConditionsForParticipant } = require("../conditions/conditionHelpers");
const { resetReactionForParticipant } = require("../reactions/reactionState");

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

// Stage 1 next-turn flow:
// - validate combat exists and is active
// - advance turn index
// - wrap round at end of initiative list
// - skip defeated participants (current_hp <= 0)
// - log turn advancement
function nextTurn(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;

  if (!combatManager) {
    return failure("combat_next_turn_failed", "combatManager is required");
  }
  if (!combatId || String(combatId).trim() === "") {
    return failure("combat_next_turn_failed", "combat_id is required");
  }

  const found = combatManager.getCombatById(combatId);
  if (!found.ok) {
    return failure("combat_next_turn_failed", "combat not found", {
      combat_id: String(combatId)
    });
  }

  const combat = clone(found.payload.combat);
  if (combat.status !== "active") {
    return failure("combat_next_turn_failed", "combat is not active", {
      combat_id: String(combatId),
      status: combat.status
    });
  }

  const initiativeOrder = Array.isArray(combat.initiative_order) ? combat.initiative_order : [];
  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  if (initiativeOrder.length === 0) {
    return failure("combat_next_turn_failed", "initiative_order is empty", {
      combat_id: String(combatId)
    });
  }

  const orderLength = initiativeOrder.length;
  const previousTurnIndex = Number.isFinite(combat.turn_index) ? combat.turn_index : 0;
  let nextIndex = previousTurnIndex;
  let nextRound = Number.isFinite(combat.round) ? Math.max(1, Math.floor(combat.round)) : 1;

  let selectedParticipant = null;
  let tries = 0;
  while (tries < orderLength) {
    nextIndex += 1;
    if (nextIndex >= orderLength) {
      nextIndex = 0;
      nextRound += 1;
    }

    const candidateId = initiativeOrder[nextIndex];
    const candidate = findParticipantById(participants, candidateId);
    const candidateHp = candidate && Number.isFinite(candidate.current_hp) ? candidate.current_hp : 0;
    if (candidate && candidateHp > 0) {
      selectedParticipant = candidate;
      break;
    }

    tries += 1;
  }

  if (!selectedParticipant) {
    return failure("combat_next_turn_failed", "no valid participant found for next turn", {
      combat_id: String(combatId)
    });
  }

  combat.turn_index = nextIndex;
  combat.round = nextRound;
  // Dodge lasts until the start of this participant's next turn.
  const dodgeCleared = selectedParticipant.is_dodging === true;
  selectedParticipant.is_dodging = false;
  selectedParticipant.action_available = true;
  selectedParticipant.bonus_action_available = true;
  const movementSpeed = Number(selectedParticipant.movement_speed);
  if (Number.isFinite(movementSpeed)) {
    selectedParticipant.movement_remaining = movementSpeed;
  }
  const reactionReset = resetReactionForParticipant(combat, selectedParticipant.participant_id);
  if (reactionReset.ok) {
    combat.participants = reactionReset.next_state.participants;
  }
  const expiredStartOfTurn = expireConditionsForTrigger(combat, {
    participant_id: selectedParticipant.participant_id,
    expiration_trigger: "start_of_turn"
  });
  if (expiredStartOfTurn.ok) {
    combat.conditions = expiredStartOfTurn.next_state.conditions;
  }
  const refreshedSelectedParticipant = findParticipantById(combat.participants, selectedParticipant.participant_id);
  const activeConditions = getActiveConditionsForParticipant(combat, selectedParticipant.participant_id);
  const speedReduction = activeConditions
    .filter((condition) => String(condition && condition.condition_type || "") === "speed_reduced")
    .reduce((total, condition) => {
      const reduction = Number(condition && condition.metadata && condition.metadata.reduction_feet);
      return total + (Number.isFinite(reduction) ? Math.max(0, reduction) : 10);
    }, 0);
  if (speedReduction > 0 && refreshedSelectedParticipant && Number.isFinite(refreshedSelectedParticipant.movement_remaining)) {
    refreshedSelectedParticipant.movement_remaining = Math.max(0, refreshedSelectedParticipant.movement_remaining - speedReduction);
  }
  const expiredSourceTurn = expireConditionsForTrigger(combat, {
    source_actor_id: selectedParticipant.participant_id,
    expiration_trigger: "start_of_source_turn"
  });
  if (expiredSourceTurn.ok) {
    combat.conditions = expiredSourceTurn.next_state.conditions;
  }
  combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
  combat.event_log.push({
    event_type: "turn_advanced",
    timestamp: new Date().toISOString(),
    details: {
      from_turn_index: previousTurnIndex,
      to_turn_index: nextIndex,
      round: nextRound,
      active_participant_id: selectedParticipant.participant_id,
      dodge_cleared: dodgeCleared,
      reaction_reset: true,
      movement_penalty_applied: speedReduction,
      expired_condition_ids: expiredStartOfTurn.ok
        ? expiredStartOfTurn.expired_conditions
          .concat(expiredSourceTurn.ok ? expiredSourceTurn.expired_conditions : [])
          .map((condition) => condition.condition_id)
        : []
    }
  });
  combat.updated_at = new Date().toISOString();

  combatManager.combats.set(String(combatId), combat);

  return success("combat_turn_advanced", {
    combat_id: String(combatId),
    round: combat.round,
    turn_index: combat.turn_index,
    active_participant_id: selectedParticipant.participant_id,
    dodge_cleared: dodgeCleared,
    combat: clone(combat)
  });
}

module.exports = {
  nextTurn
};
