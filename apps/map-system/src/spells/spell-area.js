"use strict";

const { MOVEMENT_RULES, SPELL_TARGETING_SHAPES } = require("../constants");
const { isWithinBounds } = require("../coordinates/grid");

function feetToTiles(feet) {
  const safeFeet = Number(feet || 0);
  if (!Number.isFinite(safeFeet) || safeFeet <= 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(safeFeet / MOVEMENT_RULES.TILE_FEET));
}

function clampPointToMap(map, point) {
  if (!map || !map.grid || !point) {
    return null;
  }

  return {
    x: Math.max(0, Math.min(map.grid.width - 1, Number(point.x || 0))),
    y: Math.max(0, Math.min(map.grid.height - 1, Number(point.y || 0)))
  };
}

function normalizeDirection(origin, target) {
  const dx = Number(target.x) - Number(origin.x);
  const dy = Number(target.y) - Number(origin.y);

  if (dx === 0 && dy === 0) {
    return { x: 1, y: 0 };
  }

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx >= (absDy * 2)) {
    return { x: Math.sign(dx), y: 0 };
  }

  if (absDy >= (absDx * 2)) {
    return { x: 0, y: Math.sign(dy) };
  }

  return {
    x: Math.sign(dx) || 1,
    y: Math.sign(dy) || 0
  };
}

function addTile(tiles, seen, map, x, y) {
  const point = { x, y };
  if (!isWithinBounds(map.grid, point)) {
    return;
  }

  const key = `${x},${y}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  tiles.push(point);
}

function buildSelfTiles(origin) {
  return origin ? [{ x: origin.x, y: origin.y }] : [];
}

function buildSphereTiles(map, center, radiusTiles) {
  const tiles = [];
  const seen = new Set();

  for (let y = center.y - radiusTiles; y <= center.y + radiusTiles; y += 1) {
    for (let x = center.x - radiusTiles; x <= center.x + radiusTiles; x += 1) {
      const dx = x - center.x;
      const dy = y - center.y;
      if ((dx * dx) + (dy * dy) <= (radiusTiles * radiusTiles)) {
        addTile(tiles, seen, map, x, y);
      }
    }
  }

  return tiles;
}

function buildCubeTiles(map, center, sizeTiles) {
  const tiles = [];
  const seen = new Set();
  const half = Math.floor((sizeTiles - 1) / 2);
  const startX = center.x - half;
  const startY = center.y - half;

  for (let y = startY; y < startY + sizeTiles; y += 1) {
    for (let x = startX; x < startX + sizeTiles; x += 1) {
      addTile(tiles, seen, map, x, y);
    }
  }

  return tiles;
}

function buildLineTiles(map, origin, target, lengthTiles, widthTiles) {
  const tiles = [];
  const seen = new Set();
  const direction = normalizeDirection(origin, target);
  const safeWidthTiles = Math.max(1, Math.floor(Number(widthTiles || 1)));
  const offsetStart = -Math.floor((safeWidthTiles - 1) / 2);
  const lateralDirection = (() => {
    if (direction.x === 0) {
      return { x: 1, y: 0 };
    }
    if (direction.y === 0) {
      return { x: 0, y: 1 };
    }
    return {
      x: -direction.y,
      y: direction.x
    };
  })();

  for (let step = 1; step <= lengthTiles; step += 1) {
    const baseX = origin.x + (direction.x * step);
    const baseY = origin.y + (direction.y * step);
    for (let offset = offsetStart; offset < offsetStart + safeWidthTiles; offset += 1) {
      addTile(
        tiles,
        seen,
        map,
        baseX + (lateralDirection.x * offset),
        baseY + (lateralDirection.y * offset)
      );
    }
  }

  return tiles;
}

function buildCardinalConeTiles(map, origin, direction, lengthTiles) {
  const tiles = [];
  const seen = new Set();

  for (let forward = 1; forward <= lengthTiles; forward += 1) {
    const lateralMax = forward - 1;
    for (let lateral = -lateralMax; lateral <= lateralMax; lateral += 1) {
      const x = direction.x !== 0 ? origin.x + (direction.x * forward) : origin.x + lateral;
      const y = direction.y !== 0 ? origin.y + (direction.y * forward) : origin.y + lateral;
      addTile(tiles, seen, map, x, y);
    }
  }

  return tiles;
}

function buildDiagonalConeTiles(map, origin, direction, lengthTiles) {
  const tiles = [];
  const seen = new Set();

  for (let forwardX = 1; forwardX <= lengthTiles; forwardX += 1) {
    for (let forwardY = 1; forwardY <= lengthTiles; forwardY += 1) {
      const maxForward = Math.max(forwardX, forwardY);
      if (maxForward > lengthTiles || Math.abs(forwardX - forwardY) > 1) {
        continue;
      }

      addTile(
        tiles,
        seen,
        map,
        origin.x + (direction.x * forwardX),
        origin.y + (direction.y * forwardY)
      );
    }
  }

  return tiles;
}

function buildConeTiles(map, origin, target, lengthTiles) {
  const direction = normalizeDirection(origin, target);
  if (direction.x !== 0 && direction.y !== 0) {
    return buildDiagonalConeTiles(map, origin, direction, lengthTiles);
  }

  return buildCardinalConeTiles(map, origin, direction, lengthTiles);
}

function getDefaultAnchor(map, origin, profile) {
  const rangeTiles = feetToTiles(profile && profile.range_feet);
  return clampPointToMap(map, {
    x: origin.x + rangeTiles,
    y: origin.y
  });
}

function resolveAreaAnchor(options) {
  if (!options.map || !options.origin || !options.profile) {
    return null;
  }

  if (options.target_position) {
    return clampPointToMap(options.map, options.target_position);
  }

  if (options.target_token && options.target_token.position) {
    return clampPointToMap(options.map, options.target_token.position);
  }

  if (Array.isArray(options.valid_targets) && options.valid_targets.length > 0) {
    return clampPointToMap(options.map, options.valid_targets[0]);
  }

  if ([SPELL_TARGETING_SHAPES.SELF, SPELL_TARGETING_SHAPES.AURA].includes(options.profile.shape)) {
    return clampPointToMap(options.map, options.origin);
  }

  return getDefaultAnchor(options.map, options.origin, options.profile);
}

function buildSpellAreaTiles(options) {
  const map = options.map;
  const origin = clampPointToMap(map, options.origin);
  const profile = options.profile || {};

  if (!map || !map.grid || !origin) {
    return [];
  }

  const areaSizeTiles = feetToTiles(profile.area_size_feet);
  const anchor = resolveAreaAnchor({
    map,
    origin,
    profile,
    target_position: options.target_position,
    target_token: options.target_token,
    valid_targets: options.valid_targets
  });

  if (!anchor) {
    return [];
  }

  if (profile.shape === SPELL_TARGETING_SHAPES.SELF) {
    return buildSelfTiles(origin);
  }

  if (profile.shape === SPELL_TARGETING_SHAPES.AURA) {
    return buildSphereTiles(map, origin, areaSizeTiles);
  }

  if (profile.shape === SPELL_TARGETING_SHAPES.SPHERE) {
    return buildSphereTiles(map, anchor, areaSizeTiles);
  }

  if (profile.shape === SPELL_TARGETING_SHAPES.CUBE) {
    return buildCubeTiles(map, anchor, areaSizeTiles);
  }

  if (profile.shape === SPELL_TARGETING_SHAPES.LINE) {
    return buildLineTiles(
      map,
      origin,
      anchor,
      areaSizeTiles,
      Math.max(1, feetToTiles(profile.line_width_feet))
    );
  }

  if (profile.shape === SPELL_TARGETING_SHAPES.CONE) {
    return buildConeTiles(map, origin, anchor, areaSizeTiles);
  }

  return [];
}

module.exports = {
  feetToTiles,
  normalizeDirection,
  resolveAreaAnchor,
  buildSpellAreaTiles
};
