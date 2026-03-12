"use strict";

const { DISTANCE_METRICS } = require("../constants");

function coordinateKey(point) {
  return `${point.x},${point.y}`;
}

function isWithinBounds(grid, point) {
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < grid.width &&
    point.y < grid.height
  );
}

function getNeighborCoordinates(point, options) {
  const allowDiagonal = options && options.allow_diagonal === true;
  const cardinal = [
    { x: point.x + 1, y: point.y },
    { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y + 1 },
    { x: point.x, y: point.y - 1 }
  ];

  if (!allowDiagonal) {
    return cardinal;
  }

  return cardinal.concat([
    { x: point.x + 1, y: point.y + 1 },
    { x: point.x - 1, y: point.y - 1 },
    { x: point.x + 1, y: point.y - 1 },
    { x: point.x - 1, y: point.y + 1 }
  ]);
}

function getDistance(origin, target, metric) {
  const dx = Math.abs(target.x - origin.x);
  const dy = Math.abs(target.y - origin.y);
  const mode = metric || DISTANCE_METRICS.MANHATTAN;

  if (mode === DISTANCE_METRICS.CHEBYSHEV) {
    return Math.max(dx, dy);
  }

  if (mode === DISTANCE_METRICS.EUCLIDEAN) {
    return Math.sqrt((dx * dx) + (dy * dy));
  }

  return dx + dy;
}

module.exports = {
  coordinateKey,
  isWithinBounds,
  getNeighborCoordinates,
  getDistance
};
