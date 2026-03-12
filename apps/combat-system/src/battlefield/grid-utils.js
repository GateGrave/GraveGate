"use strict";

/**
 * Convert x/y into tile index for a flat tile array.
 * @param {object} grid
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
function getTileIndex(grid, x, y) {
  return y * grid.width + x;
}

/**
 * Check if x/y is inside the grid.
 * @param {object} grid
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function isWithinBounds(grid, x, y) {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

/**
 * Read tile at x/y.
 * @param {object} grid
 * @param {number} x
 * @param {number} y
 * @returns {object|null}
 */
function getTileAt(grid, x, y) {
  if (!isWithinBounds(grid, x, y)) {
    return null;
  }

  return grid.tiles[getTileIndex(grid, x, y)] || null;
}

/**
 * Replace tile at x/y and return a new grid object.
 * @param {object} grid
 * @param {number} x
 * @param {number} y
 * @param {object} nextTile
 * @returns {object}
 */
function setTileAt(grid, x, y, nextTile) {
  if (!isWithinBounds(grid, x, y)) {
    return grid;
  }

  const nextTiles = [...grid.tiles];
  nextTiles[getTileIndex(grid, x, y)] = nextTile;

  return {
    ...grid,
    tiles: nextTiles
  };
}

module.exports = {
  getTileIndex,
  isWithinBounds,
  getTileAt,
  setTileAt
};
