"use strict";

const { coordinateKey, getNeighborCoordinates, isWithinBounds } = require("../coordinates/grid");
const { MOVEMENT_RULES } = require("../constants");
const { buildBlockedTileSet, getTileProperties } = require("./terrain");

function buildOccupiedTileSet(map, options) {
  const occupied = new Set();
  const ignoreTokenId = options && options.ignore_token_id ? options.ignore_token_id : "";

  (map.tokens || []).forEach((token) => {
    if (token.token_id === ignoreTokenId) {
      return;
    }
    occupied.add(coordinateKey(token.position));
  });

  return occupied;
}

function isDiagonalMove(fromPoint, toPoint) {
  return fromPoint.x !== toPoint.x && fromPoint.y !== toPoint.y;
}

function getDiagonalStepFeet(diagonalStepsTaken, diagonalRule) {
  if (diagonalRule === MOVEMENT_RULES.DIAGONAL_ALTERNATING) {
    return diagonalStepsTaken % 2 === 0 ? 10 : 5;
  }

  return MOVEMENT_RULES.TILE_FEET;
}

function getStepFeetCost(currentState, neighbor, diagonalRule) {
  if (!isDiagonalMove(currentState.point, neighbor)) {
    return MOVEMENT_RULES.TILE_FEET;
  }

  return getDiagonalStepFeet(currentState.diagonal_steps + 1, diagonalRule);
}

function buildTraversalStateKey(point, diagonalSteps, diagonalRule) {
  if (diagonalRule === MOVEMENT_RULES.DIAGONAL_ALTERNATING) {
    return `${coordinateKey(point)}|${diagonalSteps % 2}`;
  }

  return coordinateKey(point);
}

function isTilePassable(map, point, blocked) {
  const key = coordinateKey(point);
  if (blocked.has(key)) {
    return false;
  }

  const properties = getTileProperties(map, point);
  return properties.ok && properties.blocks_movement !== true;
}

function canTraverseDiagonal(map, fromPoint, toPoint, blocked) {
  if (!isDiagonalMove(fromPoint, toPoint)) {
    return true;
  }

  const sideA = { x: toPoint.x, y: fromPoint.y };
  const sideB = { x: fromPoint.x, y: toPoint.y };
  return isTilePassable(map, sideA, blocked) && isTilePassable(map, sideB, blocked);
}

function getReachableTiles(options) {
  const map = options.map;
  const origin = options.origin;
  const maxCost = options.max_cost;
  const allowDiagonal = options.allow_diagonal === true;
  const ignoreTokenId = options.ignore_token_id || "";
  const diagonalRule = options.diagonal_rule || MOVEMENT_RULES.DIAGONAL_5E;

  const blocked = buildBlockedTileSet(map);
  const occupied = buildOccupiedTileSet(map, { ignore_token_id: ignoreTokenId });
  const queue = [{ point: origin, cost: 0, diagonal_steps: 0 }];
  const best = new Map([[buildTraversalStateKey(origin, 0, diagonalRule), { point: origin, cost: 0, diagonal_steps: 0 }]]);

  while (queue.length > 0) {
    queue.sort((left, right) => left.cost - right.cost);
    const current = queue.shift();

    getNeighborCoordinates(current.point, { allow_diagonal: allowDiagonal }).forEach((neighbor) => {
      if (!isWithinBounds(map.grid, neighbor)) {
        return;
      }

      if (!canTraverseDiagonal(map, current.point, neighbor, blocked)) {
        return;
      }

      const key = coordinateKey(neighbor);
      if (blocked.has(key)) {
        return;
      }
      if (occupied.has(key)) {
        return;
      }

      const properties = getTileProperties(map, neighbor);
      if (!properties.ok || properties.blocks_movement) {
        return;
      }

      const stepFeet = getStepFeetCost(current, neighbor, diagonalRule);
      const terrainMultiplier = typeof properties.movement_cost === "number" ? properties.movement_cost : 1;
      const nextCost = current.cost + (stepFeet * terrainMultiplier);
      if (nextCost > maxCost) {
        return;
      }

      const nextDiagonalSteps = current.diagonal_steps + (isDiagonalMove(current.point, neighbor) ? 1 : 0);
      const stateKey = buildTraversalStateKey(neighbor, nextDiagonalSteps, diagonalRule);
      const previousBest = best.get(stateKey);
      if (previousBest !== undefined && previousBest.cost <= nextCost) {
        return;
      }

      best.set(stateKey, { point: neighbor, cost: nextCost, diagonal_steps: nextDiagonalSteps });
      queue.push({ point: neighbor, cost: nextCost, diagonal_steps: nextDiagonalSteps });
    });
  }

  const aggregated = new Map();
  Array.from(best.values()).forEach((state) => {
    const key = coordinateKey(state.point);
    if (key === coordinateKey(origin)) {
      return;
    }

    const existing = aggregated.get(key);
    if (!existing || state.cost < existing.cost) {
      aggregated.set(key, state);
    }
  });

  return Array.from(aggregated.entries())
    .map(([key, state]) => {
      const parts = key.split(",");
      return {
        x: Number(parts[0]),
        y: Number(parts[1]),
        movement_cost_feet: state.cost,
        diagonal_steps: state.diagonal_steps
      };
    })
    .sort((left, right) => left.movement_cost_feet - right.movement_cost_feet || left.y - right.y || left.x - right.x);
}

module.exports = {
  buildOccupiedTileSet,
  getReachableTiles,
  isDiagonalMove,
  getStepFeetCost
};
