"use strict";

const { getTileAt, isWithinBounds, TILE_SIZE_FEET } = require("../battlefield");
const { getTileMovementCostFeet } = require("../movement/movement-cost");
const { validationSuccess, validationFailure } = require("./validation-result");

const ACTION_TYPES = {
  ATTACK: "attack",
  ESCAPE_GRAPPLE: "escape_grapple",
  HELP: "help",
  READY: "ready",
  DODGE: "dodge",
  DASH: "dash",
  DISENGAGE: "disengage",
  CAST_SPELL: "cast_spell",
  MOVE: "move",
  USE_ITEM: "use_item",
  GRAPPLE: "grapple",
  SHOVE: "shove"
};

function findParticipant(combatState, participantId) {
  return combatState.participants.find(
    (participant) => participant.participant_id === participantId
  ) || null;
}

function gridDistanceFeet(fromPosition, toPosition) {
  const dx = Math.abs(fromPosition.x - toPosition.x);
  const dy = Math.abs(fromPosition.y - toPosition.y);
  return Math.max(dx, dy) * TILE_SIZE_FEET;
}

function validateTargetExists(input) {
  const targetId = input.target_participant_id;

  if (!targetId) {
    return validationFailure("target_missing", "Target id is required");
  }

  const target = findParticipant(input.combat_state, targetId);
  if (!target) {
    return validationFailure("target_not_found", "Target does not exist in this combat", {
      target_participant_id: targetId
    });
  }

  return validationSuccess("target_exists", "Target exists", {
    target_participant_id: targetId
  });
}

function validateTargetInRange(input) {
  const actor = input.actor;
  const target = input.target;
  const maxRangeFeet = Number(input.max_range_feet || 5);

  if (!actor || !target || !actor.position || !target.position) {
    return validationFailure("range_missing_positions", "Actor and target positions are required");
  }

  const distance = gridDistanceFeet(actor.position, target.position);
  if (distance > maxRangeFeet) {
    return validationFailure("target_out_of_range", "Target is out of range", {
      distance_feet: distance,
      max_range_feet: maxRangeFeet
    });
  }

  return validationSuccess("target_in_range", "Target is in range", {
    distance_feet: distance,
    max_range_feet: maxRangeFeet
  });
}

function validateTargetValidForAction(input) {
  const actionType = input.action_type;
  const actor = input.actor;
  const target = input.target || null;

  if (actionType === ACTION_TYPES.MOVE) {
    return validationSuccess("target_not_required_for_move", "Move does not require a target");
  }

  if (!target) {
    return validationFailure("target_required", "This action requires a valid target");
  }

  if (target.participant_id === actor.participant_id) {
    // use_item may allow self-targeting in later phases, but not enforced here.
    if (actionType !== ACTION_TYPES.USE_ITEM) {
      return validationFailure("invalid_self_target", "Action cannot target self", {
        action_type: actionType
      });
    }
  }

  return validationSuccess("target_valid_for_action", "Target is valid for this action", {
    action_type: actionType
  });
}

function validateTileReachable(input) {
  const combatState = input.combat_state;
  const actor = input.actor;
  const destination = input.destination || null;
  const path = Array.isArray(input.path) ? input.path : [];

  if (!destination) {
    return validationFailure("destination_missing", "Move destination is required");
  }

  if (!actor.position) {
    return validationFailure("actor_position_missing", "Actor position is required");
  }

  if (!isWithinBounds(combatState.battlefield_grid, destination.x, destination.y)) {
    return validationFailure("destination_out_of_bounds", "Destination is outside battlefield grid");
  }

  let currentX = actor.position.x;
  let currentY = actor.position.y;
  let totalCost = 0;

  const fullPath = path.length > 0 ? path : [destination];

  for (const step of fullPath) {
    if (!isWithinBounds(combatState.battlefield_grid, step.x, step.y)) {
      return validationFailure("path_out_of_bounds", "Path includes out-of-bounds step", { step });
    }

    const dx = Math.abs(step.x - currentX);
    const dy = Math.abs(step.y - currentY);
    const adjacent = dx <= 1 && dy <= 1 && (dx + dy) > 0;
    if (!adjacent) {
      return validationFailure("path_not_adjacent", "Path contains non-adjacent movement", { step });
    }

    const tile = getTileAt(combatState.battlefield_grid, step.x, step.y);
    if (!tile) {
      return validationFailure("path_tile_missing", "Path contains missing tile", { step });
    }

    if (tile.occupant && tile.occupant !== actor.participant_id) {
      return validationFailure("path_tile_occupied", "Path contains occupied tile", {
        step,
        occupant: tile.occupant
      });
    }

    totalCost += getTileMovementCostFeet(tile);
    currentX = step.x;
    currentY = step.y;
  }

  if (currentX !== destination.x || currentY !== destination.y) {
    return validationFailure("destination_not_path_end", "Destination must match final path step");
  }

  if (Number(actor.movement_remaining || 0) < totalCost) {
    return validationFailure("insufficient_movement", "Not enough movement remaining", {
      required_movement_feet: totalCost,
      movement_remaining_feet: Number(actor.movement_remaining || 0)
    });
  }

  return validationSuccess("tile_reachable", "Destination is reachable", {
    required_movement_feet: totalCost,
    movement_remaining_feet: Number(actor.movement_remaining || 0)
  });
}

function validateActionAvailability(input) {
  const actionType = input.action_type;
  const actor = input.actor;

  if (actionType === ACTION_TYPES.MOVE) {
    if (Number(actor.movement_remaining || 0) <= 0) {
      return validationFailure("movement_unavailable", "No movement remaining");
    }

    return validationSuccess("movement_available", "Movement is available");
  }

  if (actionType === ACTION_TYPES.USE_ITEM) {
    // Allow use item if either action or bonus action is available.
    if (actor.action_available || actor.bonus_action_available) {
      return validationSuccess("item_use_available", "Item use is available");
    }

    return validationFailure("item_use_unavailable", "No action or bonus action available");
  }

  const requiresAction = [
    ACTION_TYPES.ATTACK,
    ACTION_TYPES.HELP,
    ACTION_TYPES.READY,
    ACTION_TYPES.DODGE,
    ACTION_TYPES.DASH,
    ACTION_TYPES.DISENGAGE,
    ACTION_TYPES.CAST_SPELL,
    ACTION_TYPES.GRAPPLE,
    ACTION_TYPES.ESCAPE_GRAPPLE,
    ACTION_TYPES.SHOVE
  ];

  if (requiresAction.includes(actionType)) {
    if (!actor.action_available) {
      return validationFailure("action_unavailable", "Action is not available", {
        action_type: actionType
      });
    }

    return validationSuccess("action_available", "Action is available", {
      action_type: actionType
    });
  }

  return validationSuccess("availability_not_restricted", "No availability restriction for action");
}

// Simple line-of-effect check:
// Fails if any checked tile on line has terrain 'wall' or status_effect 'blocks_line_of_effect'.
function validateLineOfEffect(input) {
  const combatState = input.combat_state;
  const from = input.from_position;
  const to = input.to_position;

  if (!from || !to) {
    return validationFailure("line_of_effect_missing_positions", "Line-of-effect positions are required");
  }

  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  if (steps === 0) {
    return validationSuccess("line_of_effect_clear", "Line of effect is clear");
  }

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = Math.round(from.x + (to.x - from.x) * t);
    const y = Math.round(from.y + (to.y - from.y) * t);
    const tile = getTileAt(combatState.battlefield_grid, x, y);

    if (!tile) {
      return validationFailure("line_of_effect_out_of_bounds", "Line crosses out-of-bounds area");
    }

    const blockedByTerrain = tile.terrain === "wall";
    const blockedByStatusEffect = Array.isArray(tile.status_effects) &&
      tile.status_effects.includes("blocks_line_of_effect");

    if (blockedByTerrain || blockedByStatusEffect) {
      return validationFailure("line_of_effect_blocked", "Line of effect is blocked", {
        blocked_at: { x, y },
        terrain: tile.terrain
      });
    }
  }

  return validationSuccess("line_of_effect_clear", "Line of effect is clear");
}

module.exports = {
  ACTION_TYPES,
  findParticipant,
  gridDistanceFeet,
  validateTargetExists,
  validateTargetInRange,
  validateTargetValidForAction,
  validateTileReachable,
  validateActionAvailability,
  validateLineOfEffect
};
