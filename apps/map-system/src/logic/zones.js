"use strict";

const { inferTerrainType, resolveTerrainDefinition } = require("./terrain-catalog");

function buildRectangleZoneTiles(zone) {
  const tiles = [];
  const width = Math.max(0, Number(zone.width) || 0);
  const height = Math.max(0, Number(zone.height) || 0);

  for (let y = zone.y; y < zone.y + height; y += 1) {
    for (let x = zone.x; x < zone.x + width; x += 1) {
      tiles.push({ x, y });
    }
  }

  return tiles;
}

function buildCircleZoneTiles(zone) {
  const tiles = [];
  const radius = Math.max(0, Number(zone.radius) || 0);
  const radiusSquared = radius * radius;

  for (let y = zone.y - radius; y <= zone.y + radius; y += 1) {
    for (let x = zone.x - radius; x <= zone.x + radius; x += 1) {
      const dx = x - zone.x;
      const dy = y - zone.y;
      if ((dx * dx) + (dy * dy) <= radiusSquared) {
        tiles.push({ x, y });
      }
    }
  }

  return tiles;
}

function expandTerrainZones(map) {
  const zones = Array.isArray(map.terrain_zones) ? map.terrain_zones : [];
  const expanded = [];

  zones.forEach((zone) => {
    let tiles = [];
    if (zone.shape === "rectangle") {
      tiles = buildRectangleZoneTiles(zone);
    } else if (zone.shape === "circle") {
      tiles = buildCircleZoneTiles(zone);
    }

    tiles.forEach((tile) => {
      const inferredTerrainType = inferTerrainType(zone);
      const definition = resolveTerrainDefinition({
        terrain_type: zone.terrain_type || inferredTerrainType,
        asset_path: zone.asset_path,
        label: zone.label,
        zone_id: zone.zone_id
      });

      expanded.push({
        x: tile.x,
        y: tile.y,
        terrain_type: zone.terrain_type || inferredTerrainType || "obstacle",
        movement_cost: typeof zone.movement_cost === "number"
          ? zone.movement_cost
          : (definition && typeof definition.movement_cost === "number" ? definition.movement_cost : 1),
        blocks_movement: zone.blocks_movement !== undefined
          ? zone.blocks_movement === true
          : Boolean(definition && definition.blocks_movement),
        blocks_sight: zone.blocks_sight !== undefined
          ? zone.blocks_sight === true
          : Boolean(definition && definition.blocks_sight),
        zone_id: zone.zone_id || ""
      });
    });
  });

  return expanded;
}

module.exports = {
  expandTerrainZones
};
