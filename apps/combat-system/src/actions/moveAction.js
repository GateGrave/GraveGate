"use strict";

const BATTLEFIELD_SIZE = 9;
const {
  ACTION_TYPES,
  consumeParticipantAction,
  normalizeMoveCostFeet,
  validateParticipantActionAvailability
} = require("./actionEconomy");
const {
  participantHasCondition,
  getActiveConditionsForParticipant,
  normalizeCombatControlConditions
} = require("../conditions/conditionHelpers");
const { gridDistanceFeet } = require("../validation/validation-helpers");

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

function isInsideBounds(x, y) {
  return x >= 0 && x < BATTLEFIELD_SIZE && y >= 0 && y < BATTLEFIELD_SIZE;
}

function normalizePosition(position) {
  if (!position || typeof position !== "object") {
    return null;
  }
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return {
    x: Math.floor(x),
    y: Math.floor(y)
  };
}

function findFrightenedMovementBlocker(combat, participantId, currentPosition, targetPosition) {
  const activeConditions = getActiveConditionsForParticipant(combat, participantId);
  const frightenedConditions = activeConditions.filter((condition) => {
    return String(condition && condition.condition_type || "") === "frightened";
  });
  const participants = Array.isArray(combat && combat.participants) ? combat.participants : [];
  for (let index = 0; index < frightenedConditions.length; index += 1) {
    const condition = frightenedConditions[index];
    const sourceId = String(condition && condition.source_actor_id || "").trim();
    if (!sourceId) {
      continue;
    }
    const source = findParticipantById(participants, sourceId);
    if (!source || !source.position) {
      continue;
    }
    const sourceHp = Number.isFinite(Number(source.current_hp)) ? Number(source.current_hp) : 0;
    if (sourceHp <= 0) {
      continue;
    }
    const currentDistance = gridDistanceFeet(currentPosition, source.position);
    const nextDistance = gridDistanceFeet(targetPosition, source.position);
    if (Number.isFinite(currentDistance) && Number.isFinite(nextDistance) && nextDistance < currentDistance) {
      return {
        source,
        current_distance_feet: currentDistance,
        next_distance_feet: nextDistance
      };
    }
  }
  return null;
}

function performMoveAction(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;
  const participantId = data.participant_id;
  const targetPosition = normalizePosition(data.target_position);

  if (!combatManager) {
    return failure("move_action_failed", "combatManager is required");
  }
  if (!combatId) {
    return failure("move_action_failed", "combat_id is required");
  }
  if (!participantId) {
    return failure("move_action_failed", "participant_id is required");
  }
  if (!targetPosition) {
    return failure("move_action_failed", "target_position with numeric x and y is required");
  }

  const found = combatManager.getCombatById(combatId);
  if (!found.ok) {
    return failure("move_action_failed", "combat not found", {
      combat_id: String(combatId)
    });
  }

  const combat = clone(found.payload.combat);
  if (combat.status !== "active") {
    return failure("move_action_failed", "combat is not active", {
      combat_id: String(combatId),
      status: combat.status
    });
  }

  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  const actor = findParticipantById(participants, participantId);
  if (!actor) {
    return failure("move_action_failed", "participant not found in combat", {
      combat_id: String(combatId),
      participant_id: String(participantId)
    });
  }

  const actorHp = Number.isFinite(actor.current_hp) ? actor.current_hp : 0;
  if (actorHp <= 0) {
    return failure("move_action_failed", "defeated participants cannot act", {
      combat_id: String(combatId),
      participant_id: String(participantId),
      current_hp: actorHp
    });
  }
  if (participantHasCondition(combat, participantId, "stunned")) {
    return failure("move_action_failed", "stunned participants cannot act", {
      combat_id: String(combatId),
      participant_id: String(participantId)
    });
  }
  if (participantHasCondition(combat, participantId, "paralyzed")) {
    return failure("move_action_failed", "paralyzed participants cannot move", {
      combat_id: String(combatId),
      participant_id: String(participantId)
    });
  }
  if (participantHasCondition(combat, participantId, "restrained")) {
    return failure("move_action_failed", "restrained participants cannot move", {
      combat_id: String(combatId),
      participant_id: String(participantId)
    });
  }
  if (participantHasCondition(combat, participantId, "grappled")) {
    return failure("move_action_failed", "grappled participants cannot move", {
      combat_id: String(combatId),
      participant_id: String(participantId)
    });
  }
  const currentPosition = normalizePosition(actor.position) || { x: 0, y: 0 };
  const frightenedBlocker = findFrightenedMovementBlocker(combat, participantId, currentPosition, targetPosition);
  if (frightenedBlocker) {
    return failure("move_action_failed", "frightened participants cannot move closer to the source of fear", {
      combat_id: String(combatId),
      participant_id: String(participantId),
      fear_source_actor_id: String(frightenedBlocker.source.participant_id || ""),
      current_distance_feet: frightenedBlocker.current_distance_feet,
      next_distance_feet: frightenedBlocker.next_distance_feet
    });
  }

  const initiativeOrder = Array.isArray(combat.initiative_order) ? combat.initiative_order : [];
  const expectedActorId = initiativeOrder[combat.turn_index];
  if (!expectedActorId || String(expectedActorId) !== String(participantId)) {
    return failure("move_action_failed", "it is not the participant's turn", {
      combat_id: String(combatId),
      participant_id: String(participantId),
      expected_actor_id: expectedActorId || null,
      turn_index: combat.turn_index
    });
  }
  const availability = validateParticipantActionAvailability(actor, ACTION_TYPES.MOVE);
  if (!availability.ok) {
    return failure("move_action_failed", availability.error, availability.payload);
  }

  if (!isInsideBounds(targetPosition.x, targetPosition.y)) {
    return failure("move_action_failed", "target position is out of battlefield bounds", {
      combat_id: String(combatId),
      target_position: targetPosition,
      battlefield_size: BATTLEFIELD_SIZE
    });
  }

  const occupied = participants.some((participant) => {
    if (String(participant.participant_id) === String(participantId)) {
      return false;
    }
    const position = normalizePosition(participant.position);
    if (!position) return false;
    return position.x === targetPosition.x && position.y === targetPosition.y;
  });

  if (occupied) {
    return failure("move_action_failed", "target tile is occupied", {
      combat_id: String(combatId),
      target_position: targetPosition
    });
  }

  const previousPosition = currentPosition;
  const moveCostFeet = normalizeMoveCostFeet(previousPosition, targetPosition);
  const consumedMovement = consumeParticipantAction(actor, ACTION_TYPES.MOVE, {
    move_cost_feet: moveCostFeet
  });
  if (!consumedMovement.ok) {
    return failure("move_action_failed", consumedMovement.error, consumedMovement.payload);
  }
  let actorRef = actor;
  const actorIndex = participants.findIndex((entry) => String(entry.participant_id || "") === String(participantId));
  if (actorIndex !== -1) {
    participants[actorIndex] = consumedMovement.payload.participant;
    actorRef = participants[actorIndex];
  }
  actorRef.position = {
    x: targetPosition.x,
    y: targetPosition.y
  };

  combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
  const normalizedConditions = normalizeCombatControlConditions(combat);
  if (normalizedConditions.ok) {
    combat.conditions = normalizedConditions.next_state.conditions;
  }
  combat.event_log.push({
    event_type: "move_action",
    timestamp: new Date().toISOString(),
    participant_id: String(participantId),
    from_position: previousPosition,
    to_position: clone(actorRef.position),
    movement_cost_feet: moveCostFeet,
    movement_remaining_after: actorRef.movement_remaining
  });
  combat.updated_at = new Date().toISOString();

  combatManager.combats.set(String(combatId), combat);

  return success("move_action_resolved", {
    combat_id: String(combatId),
    participant_id: String(participantId),
    from_position: previousPosition,
    to_position: clone(actorRef.position),
    combat: clone(combat)
  });
}

module.exports = {
  BATTLEFIELD_SIZE,
  performMoveAction,
  normalizePosition
};
