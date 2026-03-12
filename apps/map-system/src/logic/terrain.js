"use strict";

const { coordinateKey, isWithinBounds } = require("../coordinates/grid");
const { expandTerrainZones } = require("./zones");
const { normalizeTerrainType, resolveTerrainDefinition } = require("./terrain-catalog");

function resolveTerrainFlags(entry) {
  const definition = resolveTerrainDefinition(entry);
  const terrainType = definition
    ? definition.terrain_type
    : normalizeTerrainType(entry && entry.terrain_type);
  const defaultBlocksMovement = definition ? definition.blocks_movement : false;
  const defaultBlocksSight = definition ? definition.blocks_sight : false;
  const defaultMovementCost = definition && typeof definition.movement_cost === "number"
    ? definition.movement_cost
    : 1;

  return {
    terrain_type: terrainType || "open",
    movement_cost: entry && typeof entry.movement_cost === "number" ? entry.movement_cost : defaultMovementCost,
    blocks_movement: entry && entry.blocks_movement !== undefined
      ? entry.blocks_movement === true
      : defaultBlocksMovement,
    blocks_sight: entry && entry.blocks_sight !== undefined
      ? entry.blocks_sight === true
      : defaultBlocksSight
  };
}

function buildTerrainIndex(map) {
  const index = new Map();

  const terrainEntries = [].concat(map.terrain || [], expandTerrainZones(map));
  terrainEntries.forEach((entry) => {
    index.set(coordinateKey(entry), entry);
  });

  return index;
}

function buildBlockedTileSet(map) {
  const blocked = new Set();

  (map.blocked_tiles || []).forEach((point) => {
    blocked.add(coordinateKey(point));
  });

  [].concat(map.terrain || [], expandTerrainZones(map)).forEach((entry) => {
    if (resolveTerrainFlags(entry).blocks_movement) {
      blocked.add(coordinateKey(entry));
    }
  });

  return blocked;
}

function buildSightBlockingSet(map) {
  const blocked = new Set();

  [].concat(map.terrain || [], expandTerrainZones(map)).forEach((entry) => {
    if (resolveTerrainFlags(entry).blocks_sight) {
      blocked.add(coordinateKey(entry));
    }
  });

  return blocked;
}

function getTileProperties(map, point) {
  if (!isWithinBounds(map.grid, point)) {
    return {
      ok: false,
      blocks_movement: true,
      blocks_sight: true,
      movement_cost: Number.POSITIVE_INFINITY
    };
  }

  const terrainIndex = buildTerrainIndex(map);
  const terrain = terrainIndex.get(coordinateKey(point));
  const flags = resolveTerrainFlags(terrain);

  return {
    ok: true,
    terrain_type: flags.terrain_type,
    movement_cost: flags.movement_cost,
    blocks_movement: flags.blocks_movement,
    blocks_sight: flags.blocks_sight
  };
}

module.exports = {
  buildTerrainIndex,
  buildBlockedTileSet,
  buildSightBlockingSet,
  getTileProperties,
  resolveTerrainFlags
};
