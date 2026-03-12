"use strict";

const { processCombatEventSafe } = require("../processing/process-combat-event-safe");
const { getTileAt, isWithinBounds, setTileAt } = require("../battlefield");
const { getTileMovementCostFeet } = require("../movement/movement-cost");

/**
 * Resolve movement tile-by-tile.
 * Stops as soon as a step is invalid.
 * Does not handle opportunity attacks in this phase.
 * @param {object} input
 * @param {object} input.event
 * @param {object} input.combatState
 * @returns {{stateUpdater: Function, output: object}}
 */
function resolveMovement(input) {
  const event = input.event;
  const combatState = input.combatState;
  const payload = event.payload || {};
  const participantId = payload.participant_id;
  const path = Array.isArray(payload.path) ? payload.path : [];

  const participantIndex = combatState.participants.findIndex(
    (participant) => participant.participant_id === participantId
  );

  if (participantIndex === -1) {
    throw new Error(`move failed: participant not found (${participantId})`);
  }

  const participant = combatState.participants[participantIndex];
  if (!participant.position || typeof participant.position.x !== "number" || typeof participant.position.y !== "number") {
    throw new Error("move failed: participant position is required");
  }

  let tempGrid = combatState.battlefield_grid;
  let tempParticipant = { ...participant };
  const stepsProcessed = [];
  const triggeredHazards = [];
  let totalCostFeet = 0;
  let stopReason = null;

  let currentX = tempParticipant.position.x;
  let currentY = tempParticipant.position.y;

  for (const step of path) {
    const nextX = Number(step.x);
    const nextY = Number(step.y);

    if (!isWithinBounds(tempGrid, nextX, nextY)) {
      stopReason = "out_of_bounds";
      break;
    }

    const deltaX = Math.abs(nextX - currentX);
    const deltaY = Math.abs(nextY - currentY);
    const isAdjacent = deltaX <= 1 && deltaY <= 1 && (deltaX + deltaY) > 0;
    if (!isAdjacent) {
      stopReason = "invalid_step_distance";
      break;
    }

    const destinationTile = getTileAt(tempGrid, nextX, nextY);
    if (!destinationTile) {
      stopReason = "missing_tile";
      break;
    }

    if (destinationTile.occupant && destinationTile.occupant !== participantId) {
      stopReason = "tile_occupied";
      break;
    }

    const moveCostFeet = getTileMovementCostFeet(destinationTile);
    if (tempParticipant.movement_remaining < moveCostFeet) {
      stopReason = "insufficient_movement_remaining";
      break;
    }

    const originTile = getTileAt(tempGrid, currentX, currentY);
    if (originTile) {
      tempGrid = setTileAt(tempGrid, currentX, currentY, {
        ...originTile,
        occupant: null
      });
    }

    tempGrid = setTileAt(tempGrid, nextX, nextY, {
      ...destinationTile,
      occupant: participantId
    });

    currentX = nextX;
    currentY = nextY;

    tempParticipant = {
      ...tempParticipant,
      position: { x: nextX, y: nextY },
      movement_remaining: tempParticipant.movement_remaining - moveCostFeet
    };

    totalCostFeet += moveCostFeet;

    const hazards = Array.isArray(destinationTile.hazards) ? destinationTile.hazards : [];
    const enteredHazards = hazards.map((hazard) => ({
      hazard,
      triggered_on: { x: nextX, y: nextY }
    }));
    triggeredHazards.push(...enteredHazards);

    stepsProcessed.push({
      x: nextX,
      y: nextY,
      terrain: destinationTile.terrain,
      movement_cost_feet: moveCostFeet,
      hazards_triggered: enteredHazards
    });
  }

  const movementStatus = stopReason ? "stopped_invalid" : "completed";

  return {
    stateUpdater: (state) => {
      const nextParticipants = [...state.participants];
      nextParticipants[participantIndex] = tempParticipant;

      return {
        ...state,
        participants: nextParticipants,
        battlefield_grid: tempGrid
      };
    },
    output: {
      event_type: "movement_resolved",
      movement_status: movementStatus,
      stop_reason: stopReason,
      participant_id: participantId,
      movement_remaining_before: participant.movement_remaining,
      movement_remaining_after: tempParticipant.movement_remaining,
      total_movement_cost_feet: totalCostFeet,
      started_position: participant.position,
      ended_position: tempParticipant.position,
      requested_path: path,
      processed_steps: stepsProcessed,
      hazard_triggers: triggeredHazards
    }
  };
}

/**
 * Safe processor for movement events.
 * Uses lock-safe combat event pipeline.
 * @param {object} input
 * @param {object} input.registry
 * @param {object} input.event
 * @returns {Promise<object>}
 */
async function processMovementEvent(input) {
  return processCombatEventSafe({
    registry: input.registry,
    event: input.event,
    processEventFn: async ({ event, combatState }) => {
      return resolveMovement({ event, combatState });
    }
  });
}

module.exports = {
  resolveMovement,
  processMovementEvent
};
