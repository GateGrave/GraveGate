"use strict";

const { DISTANCE_METRICS } = require("../constants");
const { coordinateKey, getDistance, isWithinBounds } = require("../coordinates/grid");
const { buildSightBlockingSet } = require("./terrain");

function hasLineOfSight(map, origin, target) {
  const blocking = buildSightBlockingSet(map);
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));

  if (steps <= 1) {
    return true;
  }

  for (let step = 1; step < steps; step += 1) {
    const x = Math.round(origin.x + ((dx * step) / steps));
    const y = Math.round(origin.y + ((dy * step) / steps));
    if (blocking.has(coordinateKey({ x, y }))) {
      return false;
    }
  }

  return true;
}

function getTilesInRange(options) {
  const map = options.map;
  const origin = options.origin;
  const range = options.range;
  const metric = options.metric || DISTANCE_METRICS.MANHATTAN;
  const includeOrigin = options.include_origin === true;
  const requireLineOfSight = options.require_line_of_sight === true;
  const results = [];

  for (let y = 0; y < map.grid.height; y += 1) {
    for (let x = 0; x < map.grid.width; x += 1) {
      const point = { x, y };
      if (!includeOrigin && x === origin.x && y === origin.y) {
        continue;
      }

      if (!isWithinBounds(map.grid, point)) {
        continue;
      }

      const distance = getDistance(origin, point, metric);
      if (distance > range) {
        continue;
      }

      if (requireLineOfSight && !hasLineOfSight(map, origin, point)) {
        continue;
      }

      results.push({
        x,
        y,
        distance
      });
    }
  }

  return results.sort((left, right) => left.distance - right.distance || left.y - right.y || left.x - right.x);
}

module.exports = {
  hasLineOfSight,
  getTilesInRange
};
