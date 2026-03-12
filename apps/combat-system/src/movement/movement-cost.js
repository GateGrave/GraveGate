"use strict";

const { TILE_SIZE_FEET } = require("../battlefield");

/**
 * Movement cost in feet for entering a tile.
 * - normal terrain: 5 feet
 * - difficult terrain: 10 feet
 * @param {object} tile
 * @returns {number}
 */
function getTileMovementCostFeet(tile) {
  const terrain = tile && tile.terrain ? tile.terrain : "normal";

  if (terrain === "difficult") {
    return TILE_SIZE_FEET * 2;
  }

  return TILE_SIZE_FEET;
}

module.exports = {
  getTileMovementCostFeet
};
