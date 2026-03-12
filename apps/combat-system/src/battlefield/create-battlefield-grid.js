"use strict";

const MAX_GRID_SIZE = 9;
const TILE_SIZE_FEET = 5;

/**
 * Create one battlefield tile.
 * @param {number} x
 * @param {number} y
 * @param {string} terrain
 * @returns {object}
 */
function createBattlefieldTile(x, y, terrain) {
  return {
    x,
    y,
    terrain: terrain || "normal",
    occupant: null,
    hazards: [],
    status_effects: []
  };
}

/**
 * Create a battlefield grid with a maximum size of 9x9.
 * Each square represents 5 feet.
 * @param {object} [options]
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @param {string} [options.default_terrain]
 * @returns {object}
 */
function createBattlefieldGrid(options) {
  const input = options || {};
  const width = Number(input.width || MAX_GRID_SIZE);
  const height = Number(input.height || MAX_GRID_SIZE);

  if (width < 1 || height < 1) {
    throw new Error("Battlefield grid width and height must be at least 1");
  }

  if (width > MAX_GRID_SIZE || height > MAX_GRID_SIZE) {
    throw new Error(`Battlefield grid max size is ${MAX_GRID_SIZE}x${MAX_GRID_SIZE}`);
  }

  const tiles = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      tiles.push(createBattlefieldTile(x, y, input.default_terrain));
    }
  }

  return {
    width,
    height,
    tile_size_feet: TILE_SIZE_FEET,
    max_grid_size: MAX_GRID_SIZE,
    tiles
  };
}

module.exports = {
  MAX_GRID_SIZE,
  TILE_SIZE_FEET,
  createBattlefieldTile,
  createBattlefieldGrid
};
