"use strict";

const { MAP_TYPES, OVERLAY_KINDS, TOKEN_TYPES } = require("../constants");

function isInteger(value) {
  return Number.isInteger(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isCoordinate(value) {
  return (
    value &&
    typeof value === "object" &&
    isInteger(value.x) &&
    isInteger(value.y)
  );
}

function validateCoordinates(list, fieldName, errors) {
  if (!Array.isArray(list)) {
    errors.push(`${fieldName} must be an array`);
    return;
  }

  list.forEach((entry, index) => {
    if (!isCoordinate(entry)) {
      errors.push(`${fieldName}[${index}] must be a coordinate`);
    }
  });
}

function validateTokens(tokens, errors) {
  if (!Array.isArray(tokens)) {
    errors.push("tokens must be an array");
    return;
  }

  const seenTokenIds = new Set();
  const seenPositions = new Map();

  tokens.forEach((token, index) => {
    if (!token || typeof token !== "object") {
      errors.push(`tokens[${index}] must be an object`);
      return;
    }

    if (!isNonEmptyString(token.token_id)) errors.push(`tokens[${index}].token_id is required`);
    if (isNonEmptyString(token.token_id)) {
      const safeTokenId = String(token.token_id);
      if (seenTokenIds.has(safeTokenId)) {
        errors.push(`tokens[${index}].token_id must be unique`);
      }
      seenTokenIds.add(safeTokenId);
    }
    if (!Object.values(TOKEN_TYPES).includes(token.token_type)) {
      errors.push(`tokens[${index}].token_type must be a known token type`);
    }
    if (!isNonEmptyString(token.label)) errors.push(`tokens[${index}].label is required`);
    if (!isCoordinate(token.position)) {
      errors.push(`tokens[${index}].position must be a coordinate`);
    } else {
      const key = `${token.position.x},${token.position.y}`;
      if (seenPositions.has(key)) {
        errors.push(`tokens[${index}].position overlaps another token at ${key}`);
      }
      seenPositions.set(key, token.token_id || `tokens[${index}]`);
    }
  });
}

function validateOverlays(overlays, errors) {
  if (!Array.isArray(overlays)) {
    errors.push("overlays must be an array");
    return;
  }

  overlays.forEach((overlay, index) => {
    if (!overlay || typeof overlay !== "object") {
      errors.push(`overlays[${index}] must be an object`);
      return;
    }

    if (!isNonEmptyString(overlay.overlay_id)) {
      errors.push(`overlays[${index}].overlay_id is required`);
    }
    if (!Object.values(OVERLAY_KINDS).includes(overlay.kind)) {
      errors.push(`overlays[${index}].kind must be a known overlay kind`);
    }
    validateCoordinates(overlay.tiles, `overlays[${index}].tiles`, errors);
  });
}

function validateTerrain(terrain, errors) {
  if (!Array.isArray(terrain)) {
    errors.push("terrain must be an array");
    return;
  }

  terrain.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      errors.push(`terrain[${index}] must be an object`);
      return;
    }

    if (!isCoordinate(entry)) errors.push(`terrain[${index}] must include x and y`);
    if (entry.movement_cost !== undefined && typeof entry.movement_cost !== "number") {
      errors.push(`terrain[${index}].movement_cost must be numeric`);
    }
    if (entry.blocks_movement !== undefined && typeof entry.blocks_movement !== "boolean") {
      errors.push(`terrain[${index}].blocks_movement must be boolean`);
    }
    if (entry.blocks_sight !== undefined && typeof entry.blocks_sight !== "boolean") {
      errors.push(`terrain[${index}].blocks_sight must be boolean`);
    }
  });
}

function validateTerrainZones(zones, errors) {
  if (!Array.isArray(zones)) {
    errors.push("terrain_zones must be an array");
    return;
  }

  zones.forEach((zone, index) => {
    if (!zone || typeof zone !== "object") {
      errors.push(`terrain_zones[${index}] must be an object`);
      return;
    }

    if (!isNonEmptyString(zone.shape)) errors.push(`terrain_zones[${index}].shape is required`);
    if (!isInteger(zone.x) || !isInteger(zone.y)) {
      errors.push(`terrain_zones[${index}] must include integer x and y`);
    }
    if (zone.shape === "rectangle") {
      if (!isInteger(zone.width) || zone.width <= 0) errors.push(`terrain_zones[${index}].width must be positive`);
      if (!isInteger(zone.height) || zone.height <= 0) errors.push(`terrain_zones[${index}].height must be positive`);
    }
    if (zone.shape === "circle") {
      if (!isInteger(zone.radius) || zone.radius < 0) errors.push(`terrain_zones[${index}].radius must be zero or greater`);
    }
  });
}

function validateMapStateShape(map) {
  const errors = [];

  if (!map || typeof map !== "object") {
    return {
      ok: false,
      errors: ["map must be an object"]
    };
  }

  if (!isNonEmptyString(map.map_id)) errors.push("map_id is required");
  if (!Object.values(MAP_TYPES).includes(map.map_type)) {
    errors.push("map_type must be a known map type");
  }

  if (!map.grid || typeof map.grid !== "object") {
    errors.push("grid is required");
  } else {
    if (!isInteger(map.grid.width) || map.grid.width <= 0) errors.push("grid.width must be a positive integer");
    if (!isInteger(map.grid.height) || map.grid.height <= 0) errors.push("grid.height must be a positive integer");
    if (!isInteger(map.grid.tile_size) || map.grid.tile_size <= 0) {
      errors.push("grid.tile_size must be a positive integer");
    }
  }

  if (map.asset !== undefined && typeof map.asset !== "object") {
    errors.push("asset must be an object when provided");
  }

  validateCoordinates(map.blocked_tiles || [], "blocked_tiles", errors);
  validateTerrain(map.terrain || [], errors);
  validateTerrainZones(map.terrain_zones || [], errors);
  validateTokens(map.tokens || [], errors);
  validateOverlays(map.overlays || [], errors);

  return {
    ok: errors.length === 0,
    errors
  };
}

function assertValidMapState(map) {
  const result = validateMapStateShape(map);
  if (!result.ok) {
    throw new Error(`invalid map state: ${result.errors.join("; ")}`);
  }
}

module.exports = {
  validateMapStateShape,
  assertValidMapState
};
