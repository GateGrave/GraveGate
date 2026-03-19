"use strict";

const fs = require("fs");
const path = require("path");
const { Jimp, rgbaToInt } = require("jimp");
const { validateMapStateShape } = require("../schema/map-state.schema");
const { renderMapPng } = require("../render/render-map-png");
const { buildTerrainEntriesFromMaskPath } = require("../core/terrain-mask-loader");

const GENERATOR_VERSION = 1;
const DEFAULT_THEME_ID = "stone_dungeon";
const DEFAULT_TILE_SIZE = 56;
const DEFAULT_GRID_WIDTH = 30;
const DEFAULT_GRID_HEIGHT = 30;
const DEFAULT_ROOM_COUNT = 8;
const DEFAULT_OUTPUT_ROOT = "apps/map-system/output/generated-dungeons";

const ROOM_KIND_LIBRARY = Object.freeze({
  entrance: { label: "Entrance", shapes: ["rectangle", "octagon"], props: ["stairs", "torch"], size: "medium" },
  guard: { label: "Guard Room", shapes: ["rectangle", "octagon"], props: ["table", "crate"], size: "medium" },
  hall: { label: "Hall", shapes: ["rectangle", "diamond"], props: ["table", "torch"], size: "large" },
  barracks: { label: "Barracks", shapes: ["rectangle", "rectangle", "octagon"], props: ["bunk", "bunk", "crate"], size: "medium" },
  storage: { label: "Storage", shapes: ["rectangle", "rectangle", "diamond"], props: ["crate", "crate", "barrel"], size: "medium" },
  shrine: { label: "Shrine", shapes: ["circle", "octagon"], props: ["altar", "pillar"], size: "medium" },
  crypt: { label: "Crypt", shapes: ["octagon", "circle", "rectangle"], props: ["sarcophagus", "sarcophagus", "torch"], size: "medium" },
  library: { label: "Library", shapes: ["rectangle", "rectangle", "octagon"], props: ["bookshelf", "desk"], size: "medium" },
  boss: { label: "Final Chamber", shapes: ["cruciform", "octagon", "diamond"], props: ["dais", "pillar"], size: "large" }
});

const PROP_OBJECT_TYPES = Object.freeze({
  altar: "shrine",
  barrel: "object",
  bookshelf: "lore_object",
  crate: "chest",
  dais: "shrine",
  desk: "object",
  sarcophagus: "object",
  stairs: "exit"
});

const DIRECTION_VECTORS = Object.freeze({
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 }
});

function cleanText(value, fallback) {
  const safe = String(value || "").trim();
  return safe === "" ? (fallback || "") : safe;
}

function slugify(value, fallback) {
  const safe = cleanText(value, fallback || "generated-dungeon")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || (fallback || "generated-dungeon");
}

function titleCase(value) {
  return cleanText(value, "")
    .split(/[_\s-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashSeed(value) {
  const text = cleanText(value, "gategrave-dungeon-seed");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed) {
  let state = hashSeed(seed) || 1;
  return function random() {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(random, min, max) {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return safeMin + Math.floor(random() * ((safeMax - safeMin) + 1));
}

function pickOne(random, list) {
  return list[randomInt(random, 0, Math.max(0, list.length - 1))];
}

function shuffle(random, list) {
  const next = list.slice();
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(random, 0, index);
    const temp = next[index];
    next[index] = next[swapIndex];
    next[swapIndex] = temp;
  }
  return next;
}

function coordinateKey(point) {
  return `${point.x},${point.y}`;
}

function uniquePoints(points) {
  const seen = new Map();
  points.forEach((point) => {
    if (!point || !Number.isInteger(point.x) || !Number.isInteger(point.y)) {
      return;
    }
    seen.set(coordinateKey(point), { x: point.x, y: point.y });
  });
  return Array.from(seen.values());
}

function uniqueEdgeWalls(entries) {
  const seen = new Map();
  (entries || []).forEach((entry) => {
    if (!entry || !Number.isInteger(entry.x) || !Number.isInteger(entry.y) || !cleanText(entry.side, "")) {
      return;
    }
    seen.set(`${entry.x},${entry.y},${entry.side}`, clone(entry));
  });
  return Array.from(seen.values());
}

function normalizeGeneratorOptions(options) {
  const safe = options && typeof options === "object" ? options : {};
  const width = Math.max(18, Math.min(48, Number.parseInt(safe.width, 10) || DEFAULT_GRID_WIDTH));
  const height = Math.max(18, Math.min(48, Number.parseInt(safe.height, 10) || DEFAULT_GRID_HEIGHT));
  const roomCount = Math.max(5, Math.min(14, Number.parseInt(safe.room_count, 10) || DEFAULT_ROOM_COUNT));
  const tileSize = Math.max(32, Math.min(80, Number.parseInt(safe.tile_size, 10) || DEFAULT_TILE_SIZE));
  const themeId = cleanText(safe.theme_id || safe.theme, DEFAULT_THEME_ID).toLowerCase();

  if (themeId !== DEFAULT_THEME_ID) {
    throw new Error(`unsupported dungeon generator theme: ${themeId}`);
  }

  const requestedId = slugify(safe.map_id || safe.id, "");
  const seed = cleanText(safe.seed, requestedId || `seed-${Date.now()}`);
  const mapId = requestedId || `generated-${slugify(seed, "dungeon")}`;

  return {
    map_id: mapId,
    theme_id: themeId,
    seed,
    width,
    height,
    room_count: roomCount,
    tile_size: tileSize,
    output_root: path.resolve(process.cwd(), cleanText(safe.output_root, DEFAULT_OUTPUT_ROOT))
  };
}

function buildRectangleTiles(width, height) {
  const tiles = [];
  const xStart = -Math.floor(width / 2);
  const xEnd = xStart + width - 1;
  const yStart = -Math.floor(height / 2);
  const yEnd = yStart + height - 1;
  for (let y = yStart; y <= yEnd; y += 1) {
    for (let x = xStart; x <= xEnd; x += 1) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}

function buildCircleTiles(radius) {
  const tiles = [];
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (((x * x) + (y * y)) <= ((radius * radius) + 1)) {
        tiles.push({ x, y });
      }
    }
  }
  return tiles;
}

function buildOctagonTiles(radius) {
  const tiles = [];
  const cutoff = Math.max(1, Math.floor(radius * 0.5));
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (Math.abs(x) > radius || Math.abs(y) > radius) {
        continue;
      }
      if ((Math.abs(x) + Math.abs(y)) > ((radius * 2) - cutoff)) {
        continue;
      }
      tiles.push({ x, y });
    }
  }
  return tiles;
}

function buildDiamondTiles(radius) {
  const tiles = [];
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if ((Math.abs(x) + Math.abs(y)) <= radius) {
        tiles.push({ x, y });
      }
    }
  }
  return tiles;
}

function buildCruciformTiles(armLength, armWidth) {
  const tiles = [];
  for (let y = -armLength; y <= armLength; y += 1) {
    for (let x = -armLength; x <= armLength; x += 1) {
      const inVertical = Math.abs(x) <= armWidth && Math.abs(y) <= armLength;
      const inHorizontal = Math.abs(y) <= armWidth && Math.abs(x) <= armLength;
      if (inVertical || inHorizontal) {
        tiles.push({ x, y });
      }
    }
  }
  return tiles;
}

function createRoomShapeSpec(kind, random) {
  const definition = ROOM_KIND_LIBRARY[kind] || ROOM_KIND_LIBRARY.storage;
  const shape = pickOne(random, definition.shapes);
  let originTiles = [];
  let parameters = {};

  if (shape === "rectangle") {
    const isLarge = definition.size === "large";
    const width = randomInt(random, isLarge ? 6 : 5, isLarge ? 10 : 8);
    const height = randomInt(random, isLarge ? 5 : 4, isLarge ? 8 : 6);
    originTiles = buildRectangleTiles(width, height);
    parameters = { width, height };
  } else if (shape === "circle") {
    const radius = randomInt(random, definition.size === "large" ? 4 : 3, definition.size === "large" ? 5 : 4);
    originTiles = buildCircleTiles(radius);
    parameters = { radius };
  } else if (shape === "octagon") {
    const radius = randomInt(random, definition.size === "large" ? 4 : 3, definition.size === "large" ? 5 : 4);
    originTiles = buildOctagonTiles(radius);
    parameters = { radius };
  } else if (shape === "diamond") {
    const radius = randomInt(random, definition.size === "large" ? 4 : 3, definition.size === "large" ? 5 : 4);
    originTiles = buildDiamondTiles(radius);
    parameters = { radius };
  } else {
    const armLength = randomInt(random, 4, definition.size === "large" ? 6 : 5);
    const armWidth = randomInt(random, 1, 2);
    originTiles = buildCruciformTiles(armLength, armWidth);
    parameters = { arm_length: armLength, arm_width: armWidth };
  }

  const extents = originTiles.reduce((accumulator, tile) => ({
    x: Math.max(accumulator.x, Math.abs(tile.x)),
    y: Math.max(accumulator.y, Math.abs(tile.y))
  }), { x: 0, y: 0 });

  return {
    kind,
    label: definition.label,
    shape,
    parameters,
    origin_tiles: originTiles,
    extent_x: extents.x,
    extent_y: extents.y,
    prop_templates: definition.props.slice()
  };
}

function buildRoomTilesAtCenter(shapeSpec, center) {
  return shapeSpec.origin_tiles.map((tile) => ({
    x: center.x + tile.x,
    y: center.y + tile.y
  }));
}

function buildRoomPlan(roomCount, random) {
  const plans = [];
  const mainPathCount = Math.max(4, Math.min(roomCount, Math.ceil(roomCount * 0.5)));
  const mainKinds = ["entrance"];
  const middleKinds = ["guard", "hall", "storage", "barracks", "shrine", "crypt", "library"];

  while (mainKinds.length < mainPathCount - 1) {
    mainKinds.push(pickOne(random, middleKinds));
  }
  mainKinds.push("boss");

  let previousDirection = "north";
  mainKinds.forEach((kind, index) => {
    let preferredDirection = null;
    if (index > 0) {
      const candidates = previousDirection === "north"
        ? ["north", "east", "west"]
        : ["north", previousDirection];
      preferredDirection = pickOne(random, candidates);
      previousDirection = preferredDirection;
    }
    plans.push({
      room_id: `room-${index + 1}`,
      kind,
      is_main_path: true,
      parent_room_id: index === 0 ? null : `room-${index}`,
      preferred_direction: preferredDirection
    });
  });

  const branchKinds = ["storage", "barracks", "crypt", "library", "shrine"];
  for (let index = mainPathCount; index < roomCount; index += 1) {
    const parentIndex = randomInt(random, 1, Math.max(1, mainPathCount - 2));
    plans.push({
      room_id: `room-${index + 1}`,
      kind: pickOne(random, branchKinds),
      is_main_path: false,
      parent_room_id: `room-${parentIndex + 1}`,
      preferred_direction: pickOne(random, ["east", "west"])
    });
  }

  return plans;
}

function buildPaddedOccupancy(tiles) {
  const occupied = new Set();
  tiles.forEach((tile) => {
    occupied.add(`${tile.x},${tile.y}`);
    occupied.add(`${tile.x + 1},${tile.y}`);
    occupied.add(`${tile.x - 1},${tile.y}`);
    occupied.add(`${tile.x},${tile.y + 1}`);
    occupied.add(`${tile.x},${tile.y - 1}`);
  });
  return occupied;
}

function chooseCandidateCenters(parentRoom, shapeSpec, preferredDirection, random) {
  const directions = preferredDirection
    ? [preferredDirection].concat(shuffle(random, Object.keys(DIRECTION_VECTORS).filter((entry) => entry !== preferredDirection)))
    : shuffle(random, Object.keys(DIRECTION_VECTORS));
  const candidates = [];

  directions.forEach((direction) => {
    const vector = DIRECTION_VECTORS[direction];
    for (let corridorLength = 1; corridorLength <= 3; corridorLength += 1) {
      const distanceX = parentRoom.extent_x + shapeSpec.extent_x + corridorLength + 1;
      const distanceY = parentRoom.extent_y + shapeSpec.extent_y + corridorLength + 1;
      candidates.push({
        direction,
        center: {
          x: parentRoom.center.x + (vector.dx * distanceX),
          y: parentRoom.center.y + (vector.dy * distanceY)
        }
      });
    }
  });

  return candidates;
}

function roomFits(tiles, paddedOccupancy, width, height) {
  return tiles.every((tile) => (
    tile.x >= 1 &&
    tile.y >= 1 &&
    tile.x < width - 1 &&
    tile.y < height - 1 &&
    !paddedOccupancy.has(coordinateKey(tile))
  ));
}

function selectBoundaryTile(room, direction, towardValue) {
  const tiles = room.tiles || [];
  if (tiles.length === 0) {
    return room.center;
  }

  let target = tiles[0];
  tiles.forEach((tile) => {
    if (direction === "north") {
      if (tile.y < target.y || (tile.y === target.y && Math.abs(tile.x - towardValue) < Math.abs(target.x - towardValue))) {
        target = tile;
      }
      return;
    }
    if (direction === "south") {
      if (tile.y > target.y || (tile.y === target.y && Math.abs(tile.x - towardValue) < Math.abs(target.x - towardValue))) {
        target = tile;
      }
      return;
    }
    if (direction === "east") {
      if (tile.x > target.x || (tile.x === target.x && Math.abs(tile.y - towardValue) < Math.abs(target.y - towardValue))) {
        target = tile;
      }
      return;
    }
    if (tile.x < target.x || (tile.x === target.x && Math.abs(tile.y - towardValue) < Math.abs(target.y - towardValue))) {
      target = tile;
    }
  });
  return target;
}

function stepFromTile(tile, direction) {
  const vector = DIRECTION_VECTORS[direction] || { dx: 0, dy: 0 };
  return {
    x: tile.x + vector.dx,
    y: tile.y + vector.dy
  };
}

function buildCorridorTiles(fromPoint, toPoint, width) {
  const tiles = [];
  const current = { x: fromPoint.x, y: fromPoint.y };
  const corridorWidth = Math.max(1, width || 1);
  const horizontalFirst = Math.abs(toPoint.x - fromPoint.x) >= Math.abs(toPoint.y - fromPoint.y);

  function pushWithWidth(point, horizontalStep) {
    const offsets = corridorWidth === 1 ? [0] : [-1, 0];
    offsets.forEach((offset) => {
      tiles.push(horizontalStep
        ? { x: point.x, y: point.y + offset }
        : { x: point.x + offset, y: point.y });
    });
  }

  function walkAxis(axis, targetValue) {
    while (current[axis] !== targetValue) {
      current[axis] += current[axis] < targetValue ? 1 : -1;
      pushWithWidth({ x: current.x, y: current.y }, axis === "x");
    }
  }

  pushWithWidth(current, horizontalFirst);
  if (horizontalFirst) {
    walkAxis("x", toPoint.x);
    walkAxis("y", toPoint.y);
  } else {
    walkAxis("y", toPoint.y);
    walkAxis("x", toPoint.x);
  }

  return uniquePoints(tiles);
}

function buildSuggestedObjects(room, random) {
  const roomTileSet = new Set(room.tiles.map((tile) => coordinateKey(tile)));
  const interior = room.tiles.filter((tile) => (
    roomTileSet.has(`${tile.x + 1},${tile.y}`) &&
    roomTileSet.has(`${tile.x - 1},${tile.y}`) &&
    roomTileSet.has(`${tile.x},${tile.y + 1}`) &&
    roomTileSet.has(`${tile.x},${tile.y - 1}`)
  ));
  const candidates = interior.length > 0 ? shuffle(random, interior) : [room.center];

  return room.prop_templates.slice(0, 3).map((prop, index) => {
    const tile = candidates[index % candidates.length];
    return {
      object_id: `${room.room_id}-${prop}-${index + 1}`,
      object_type: PROP_OBJECT_TYPES[prop] || "object",
      prop_type: prop,
      label: titleCase(prop),
      position: { x: tile.x, y: tile.y }
    };
  });
}

function cropBlueprint(blueprint, padding) {
  const bounds = blueprint.floor_tiles.reduce((accumulator, tile) => ({
    minX: Math.min(accumulator.minX, tile.x),
    maxX: Math.max(accumulator.maxX, tile.x),
    minY: Math.min(accumulator.minY, tile.y),
    maxY: Math.max(accumulator.maxY, tile.y)
  }), {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  });

  const offsetX = padding - bounds.minX;
  const offsetY = padding - bounds.minY;
  const width = (bounds.maxX - bounds.minX + 1) + (padding * 2);
  const height = (bounds.maxY - bounds.minY + 1) + (padding * 2);

  function shiftPoint(point) {
    return {
      x: point.x + offsetX,
      y: point.y + offsetY
    };
  }

  return {
    ...blueprint,
    grid: {
      ...blueprint.grid,
      width,
      height
    },
    floor_tiles: blueprint.floor_tiles.map(shiftPoint),
    corridor_tiles: blueprint.corridor_tiles.map(shiftPoint),
    blocked_tiles: blueprint.blocked_tiles.map(shiftPoint),
    edge_walls: blueprint.edge_walls.map((entry) => ({
      ...entry,
      x: entry.x + offsetX,
      y: entry.y + offsetY
    })),
    party_start: shiftPoint(blueprint.party_start),
    suggested_exit: shiftPoint(blueprint.suggested_exit),
    rooms: blueprint.rooms.map((room) => ({
      ...room,
      center: shiftPoint(room.center),
      tiles: room.tiles.map(shiftPoint),
      suggested_objects: room.suggested_objects.map((entry) => ({
        ...entry,
        position: shiftPoint(entry.position)
      }))
    })),
    connections: blueprint.connections.map((connection) => ({
      ...connection,
      tiles: connection.tiles.map(shiftPoint)
    }))
  };
}

function buildBlueprintAttempt(normalized, attemptIndex) {
  const attemptSeed = attemptIndex > 0
    ? `${normalized.seed}::attempt:${attemptIndex}`
    : normalized.seed;
  const random = createSeededRandom(attemptSeed);
  const roomPlans = buildRoomPlan(normalized.room_count, random);
  const placedRooms = [];
  const floorTiles = [];
  const corridorTiles = [];

  roomPlans.forEach((plan, index) => {
    const shapeSpec = createRoomShapeSpec(plan.kind, random);

    if (index === 0) {
      const center = {
        x: Math.max(shapeSpec.extent_x + 2, Math.min(normalized.width - shapeSpec.extent_x - 3, Math.floor(normalized.width / 2))),
        y: Math.max(shapeSpec.extent_y + 2, normalized.height - shapeSpec.extent_y - 3)
      };
      const tiles = buildRoomTilesAtCenter(shapeSpec, center);
      if (!roomFits(tiles, new Set(), normalized.width, normalized.height)) {
        throw new Error("failed to place dungeon entrance room inside bounds");
      }
      placedRooms.push({
        room_id: plan.room_id,
        kind: plan.kind,
        label: shapeSpec.label,
        shape: shapeSpec.shape,
        center,
        extent_x: shapeSpec.extent_x,
        extent_y: shapeSpec.extent_y,
        tiles,
        prop_templates: shapeSpec.prop_templates.slice(),
        is_main_path: true,
        parent_room_id: null
      });
      floorTiles.push(...tiles);
      return;
    }

    const parentRoom = placedRooms.find((room) => room.room_id === plan.parent_room_id);
    if (!parentRoom) {
      return;
    }

    const paddedOccupancy = buildPaddedOccupancy(floorTiles);
    const candidates = chooseCandidateCenters(parentRoom, shapeSpec, plan.preferred_direction, random);
    let selected = null;

    for (const candidate of candidates) {
      const tiles = buildRoomTilesAtCenter(shapeSpec, candidate.center);
      if (!roomFits(tiles, paddedOccupancy, normalized.width, normalized.height)) {
        continue;
      }
      selected = {
        direction: candidate.direction,
        center: candidate.center,
        tiles
      };
      break;
    }

    if (!selected) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const fallbackCenter = {
          x: randomInt(random, 3, normalized.width - 4),
          y: randomInt(random, 3, normalized.height - 4)
        };
        const tiles = buildRoomTilesAtCenter(shapeSpec, fallbackCenter);
        if (!roomFits(tiles, paddedOccupancy, normalized.width, normalized.height)) {
          continue;
        }
        selected = {
          direction: pickOne(random, Object.keys(DIRECTION_VECTORS)),
          center: fallbackCenter,
          tiles
        };
        break;
      }
    }

    if (!selected) {
      throw new Error(`failed to place planned room ${plan.room_id} (${plan.kind})`);
    }

    const fromBoundary = selectBoundaryTile(
      parentRoom,
      selected.direction,
      selected.direction === "north" || selected.direction === "south" ? selected.center.x : selected.center.y
    );
    const opposite = selected.direction === "north"
      ? "south"
      : selected.direction === "south"
        ? "north"
        : selected.direction === "east"
          ? "west"
          : "east";
    const toBoundary = selectBoundaryTile(
      { tiles: selected.tiles, center: selected.center },
      opposite,
      opposite === "north" || opposite === "south" ? parentRoom.center.x : parentRoom.center.y
    );
    const corridorStart = stepFromTile(fromBoundary, selected.direction);
    const corridorEnd = stepFromTile(toBoundary, opposite);
    const connectionTiles = buildCorridorTiles(corridorStart, corridorEnd, plan.is_main_path ? 2 : 1);

    corridorTiles.push(...connectionTiles);
    floorTiles.push(...selected.tiles, ...connectionTiles);
    placedRooms.push({
      room_id: plan.room_id,
      kind: plan.kind,
      label: shapeSpec.label,
      shape: shapeSpec.shape,
      center: selected.center,
      extent_x: shapeSpec.extent_x,
      extent_y: shapeSpec.extent_y,
      tiles: selected.tiles,
      prop_templates: shapeSpec.prop_templates.slice(),
      is_main_path: plan.is_main_path,
      parent_room_id: parentRoom.room_id,
      entry_direction: selected.direction,
      connection: {
        from_room_id: parentRoom.room_id,
        to_room_id: plan.room_id,
        tiles: connectionTiles
      }
    });
  });

  const uniqueFloorTiles = uniquePoints(floorTiles);
  const floorTileSet = new Set(uniqueFloorTiles.map((tile) => coordinateKey(tile)));

  const bounds = uniqueFloorTiles.reduce((accumulator, tile) => ({
    minX: Math.min(accumulator.minX, tile.x),
    maxX: Math.max(accumulator.maxX, tile.x),
    minY: Math.min(accumulator.minY, tile.y),
    maxY: Math.max(accumulator.maxY, tile.y)
  }), {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  });

  const blockedTiles = [];
  for (let y = bounds.minY - 1; y <= bounds.maxY + 1; y += 1) {
    for (let x = bounds.minX - 1; x <= bounds.maxX + 1; x += 1) {
      if (!floorTileSet.has(`${x},${y}`)) {
        blockedTiles.push({ x, y });
      }
    }
  }

  const edgeWalls = [];
  uniqueFloorTiles.forEach((tile) => {
    if (!floorTileSet.has(`${tile.x},${tile.y - 1}`)) edgeWalls.push({ x: tile.x, y: tile.y, side: "north", blocks_movement: true, blocks_sight: true });
    if (!floorTileSet.has(`${tile.x},${tile.y + 1}`)) edgeWalls.push({ x: tile.x, y: tile.y, side: "south", blocks_movement: true, blocks_sight: true });
    if (!floorTileSet.has(`${tile.x - 1},${tile.y}`)) edgeWalls.push({ x: tile.x, y: tile.y, side: "west", blocks_movement: true, blocks_sight: true });
    if (!floorTileSet.has(`${tile.x + 1},${tile.y}`)) edgeWalls.push({ x: tile.x, y: tile.y, side: "east", blocks_movement: true, blocks_sight: true });
  });

  const roomsWithProps = placedRooms.map((room) => ({
    ...room,
    suggested_objects: buildSuggestedObjects(room, random)
  }));

  const blueprint = {
    generator_version: GENERATOR_VERSION,
    generator_type: "stone_dungeon_alpha",
    theme_id: normalized.theme_id,
    seed: normalized.seed,
    map_id: normalized.map_id,
    name: titleCase(normalized.map_id.replace(/-/g, " ")),
    grid: { width: normalized.width, height: normalized.height, tile_size: normalized.tile_size },
    party_start: clone(roomsWithProps[0].center),
    suggested_exit: clone(roomsWithProps[roomsWithProps.length - 1].center),
    rooms: roomsWithProps,
    connections: roomsWithProps.filter((room) => room.connection).map((room) => clone(room.connection)),
    floor_tiles: uniqueFloorTiles,
    corridor_tiles: uniquePoints(corridorTiles),
    blocked_tiles: uniquePoints(blockedTiles),
    edge_walls: uniqueEdgeWalls(edgeWalls)
  };

  return cropBlueprint(blueprint, 1);
}

function buildBlueprint(options) {
  const normalized = normalizeGeneratorOptions(options);
  const maxAttempts = Math.max(8, normalized.room_count * 3);
  let lastError = null;

  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    try {
      return buildBlueprintAttempt(normalized, attemptIndex);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `failed to generate dungeon blueprint after ${maxAttempts} attempts: ${
      lastError && lastError.message ? lastError.message : "unknown generation error"
    }`
  );
}

function createImage(width, height, rgba) {
  return new Jimp({ width, height, color: rgba });
}

function fillRect(image, x, y, width, height, color) {
  const safeX = Math.round(x);
  const safeY = Math.round(y);
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const clampedX = Math.max(0, safeX);
  const clampedY = Math.max(0, safeY);
  const clampedWidth = Math.min(image.bitmap.width - clampedX, safeWidth);
  const clampedHeight = Math.min(image.bitmap.height - clampedY, safeHeight);
  if (clampedWidth <= 0 || clampedHeight <= 0) {
    return;
  }

  for (let py = clampedY; py < clampedY + clampedHeight; py += 1) {
    for (let px = clampedX; px < clampedX + clampedWidth; px += 1) {
      image.setPixelColor(color, px, py);
    }
  }
}

function drawLine(image, startX, startY, endX, endY, color, thickness) {
  const safeThickness = Math.max(1, Math.round(thickness || 1));
  const steps = Math.max(Math.abs(endX - startX), Math.abs(endY - startY), 1);
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(startX + (((endX - startX) * step) / steps));
    const y = Math.round(startY + (((endY - startY) * step) / steps));
    fillRect(image, x - Math.floor(safeThickness / 2), y - Math.floor(safeThickness / 2), safeThickness, safeThickness, color);
  }
}

function buildNoise(seedValue, x, y) {
  const safeSeed = seedValue >>> 0;
  let value = Math.imul((x + 1) * 374761393, (y + 1) * 668265263);
  value = Math.imul(value ^ safeSeed, 2246822519);
  value ^= value >>> 13;
  value = Math.imul(value, 3266489917);
  return (value >>> 0) / 4294967295;
}

function drawParchmentBackground(image, seedValue) {
  const width = image.bitmap.width;
  const height = image.bitmap.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const maxDistance = Math.sqrt((centerX * centerX) + (centerY * centerY));

  image.scan(0, 0, width, height, function scan(x, y, index) {
    const noise = buildNoise(seedValue, Math.floor(x / 4), Math.floor(y / 4));
    const dx = x - centerX;
    const dy = y - centerY;
    const vignette = Math.min(1, Math.sqrt((dx * dx) + (dy * dy)) / maxDistance);
    const base = 221 - Math.round(vignette * 28);
    const variation = Math.round((noise - 0.5) * 18);
    this.bitmap.data[index] = Math.max(145, Math.min(240, base + variation));
    this.bitmap.data[index + 1] = Math.max(126, Math.min(228, base - 11 + variation));
    this.bitmap.data[index + 2] = Math.max(92, Math.min(214, base - 28 + variation));
    this.bitmap.data[index + 3] = 255;
  });
}

function renderFloorTiles(image, blueprint, metrics, seedValue) {
  blueprint.floor_tiles.forEach((tile) => {
    const x = metrics.grid_origin_x + (tile.x * metrics.tile_size);
    const y = metrics.grid_origin_y + (tile.y * metrics.tile_size);
    const noise = buildNoise(seedValue, tile.x, tile.y);
    const shade = 222 + Math.round((noise - 0.5) * 10);
    fillRect(image, x, y, metrics.tile_size, metrics.tile_size, rgbaToInt(shade, shade - 8, shade - 24, 255));
    fillRect(image, x, y + metrics.tile_size - 1, metrics.tile_size, 1, rgbaToInt(170, 153, 122, 190));
    fillRect(image, x + metrics.tile_size - 1, y, 1, metrics.tile_size, rgbaToInt(170, 153, 122, 190));
  });
}

function renderBlockedTiles(image, blueprint, metrics) {
  blueprint.blocked_tiles.forEach((tile) => {
    const x = metrics.grid_origin_x + (tile.x * metrics.tile_size);
    const y = metrics.grid_origin_y + (tile.y * metrics.tile_size);
    fillRect(image, x, y, metrics.tile_size, metrics.tile_size, rgbaToInt(163, 138, 103, 255));
  });
}

function renderWallEdges(image, blueprint, metrics) {
  blueprint.edge_walls.forEach((wall) => {
    const x = metrics.grid_origin_x + (wall.x * metrics.tile_size);
    const y = metrics.grid_origin_y + (wall.y * metrics.tile_size);
    const shadow = rgbaToInt(77, 61, 40, 110);
    const ink = rgbaToInt(12, 10, 9, 255);
    if (wall.side === "north") {
      fillRect(image, x, y - 6, metrics.tile_size, 5, shadow);
      fillRect(image, x, y - 1, metrics.tile_size, 4, ink);
      return;
    }
    if (wall.side === "south") {
      fillRect(image, x, y + metrics.tile_size + 1, metrics.tile_size, 5, shadow);
      fillRect(image, x, y + metrics.tile_size - 3, metrics.tile_size, 4, ink);
      return;
    }
    if (wall.side === "east") {
      fillRect(image, x + metrics.tile_size + 1, y, 5, metrics.tile_size, shadow);
      fillRect(image, x + metrics.tile_size - 3, y, 4, metrics.tile_size, ink);
      return;
    }
    fillRect(image, x - 6, y, 5, metrics.tile_size, shadow);
    fillRect(image, x - 1, y, 4, metrics.tile_size, ink);
  });
}

function drawPropIcon(image, metrics, object, seedValue) {
  const tileSize = metrics.tile_size;
  const x = metrics.grid_origin_x + (object.position.x * tileSize);
  const y = metrics.grid_origin_y + (object.position.y * tileSize);
  const inset = Math.max(8, Math.round(tileSize * 0.2));
  const left = x + inset;
  const right = x + tileSize - inset;
  const top = y + inset;
  const bottom = y + tileSize - inset;
  const centerX = Math.round((left + right) / 2);
  const centerY = Math.round((top + bottom) / 2);
  const ink = rgbaToInt(54, 39, 27, 255);
  const accent = rgbaToInt(121, 92, 59, 255);

  if (object.prop_type === "stairs") {
    drawLine(image, left, bottom, right, top, ink, 2);
    drawLine(image, left + 6, bottom, right, top + 6, ink, 2);
    drawLine(image, left + 12, bottom, right, top + 12, ink, 2);
    return;
  }
  if (object.prop_type === "table") {
    fillRect(image, left + 2, centerY - 6, right - left - 4, 12, accent);
    drawLine(image, left + 4, centerY + 8, left + 4, bottom, ink, 2);
    drawLine(image, right - 4, centerY + 8, right - 4, bottom, ink, 2);
    return;
  }
  if (object.prop_type === "crate" || object.prop_type === "desk") {
    fillRect(image, left, top, right - left, bottom - top, rgbaToInt(185, 152, 103, 255));
    drawLine(image, left, top, right, top, ink, 2);
    drawLine(image, left, bottom, right, bottom, ink, 2);
    drawLine(image, left, top, left, bottom, ink, 2);
    drawLine(image, right, top, right, bottom, ink, 2);
    if (object.prop_type === "crate") {
      drawLine(image, left, top, right, bottom, ink, 2);
      drawLine(image, right, top, left, bottom, ink, 2);
    }
    return;
  }
  if (object.prop_type === "barrel") {
    fillRect(image, left + 4, top, right - left - 8, bottom - top, rgbaToInt(173, 133, 85, 255));
    drawLine(image, centerX, top, centerX, bottom, ink, 2);
    drawLine(image, left + 2, top + 6, right - 2, top + 6, ink, 2);
    drawLine(image, left + 2, bottom - 6, right - 2, bottom - 6, ink, 2);
    return;
  }
  if (object.prop_type === "altar" || object.prop_type === "dais") {
    fillRect(image, left + 6, top + 8, right - left - 12, bottom - top - 16, rgbaToInt(205, 185, 148, 255));
    drawLine(image, left + 6, centerY, right - 6, centerY, ink, 2);
    drawLine(image, centerX, top + 4, centerX, bottom - 4, ink, 2);
    return;
  }
  if (object.prop_type === "pillar") {
    fillRect(image, centerX - 6, centerY - 6, 12, 12, rgbaToInt(188, 172, 145, 255));
    drawLine(image, centerX - 6, centerY - 6, centerX + 6, centerY - 6, ink, 2);
    drawLine(image, centerX - 6, centerY + 6, centerX + 6, centerY + 6, ink, 2);
    return;
  }
  if (object.prop_type === "sarcophagus" || object.prop_type === "bunk") {
    fillRect(image, left + 2, top, right - left - 4, bottom - top, rgbaToInt(196, 178, 143, 255));
    drawLine(image, left + 2, top, right - 2, top, ink, 2);
    drawLine(image, left + 2, bottom, right - 2, bottom, ink, 2);
    if (object.prop_type === "sarcophagus") {
      drawLine(image, centerX, top + 4, centerX, bottom - 4, accent, 2);
    }
    return;
  }
  if (object.prop_type === "bookshelf") {
    fillRect(image, left, top, right - left, bottom - top, rgbaToInt(165, 132, 89, 255));
    drawLine(image, left, top + 6, right, top + 6, ink, 2);
    drawLine(image, left, centerY, right, centerY, ink, 2);
    drawLine(image, left, bottom - 6, right, bottom - 6, ink, 2);
    return;
  }

  if (buildNoise(seedValue, object.position.x, object.position.y) > 0.45) {
    drawLine(image, left, top, right, bottom, ink, 2);
  }
  drawLine(image, left, bottom, right, top, ink, 2);
}

function renderObjects(image, blueprint, metrics, seedValue) {
  blueprint.rooms.forEach((room) => {
    room.suggested_objects.forEach((object) => drawPropIcon(image, metrics, object, seedValue));
  });
}

async function writeDungeonBaseImage(blueprint, outputPath) {
  const margin = Math.max(24, Math.round(blueprint.grid.tile_size * 0.75));
  const renderWidth = (blueprint.grid.width * blueprint.grid.tile_size) + (margin * 2);
  const renderHeight = (blueprint.grid.height * blueprint.grid.tile_size) + (margin * 2);
  const metrics = {
    tile_size: blueprint.grid.tile_size,
    grid_origin_x: margin,
    grid_origin_y: margin,
    render_width_px: renderWidth,
    render_height_px: renderHeight
  };
  const image = createImage(renderWidth, renderHeight, rgbaToInt(219, 195, 154, 255));
  const seedValue = hashSeed(blueprint.seed);

  drawParchmentBackground(image, seedValue);
  renderBlockedTiles(image, blueprint, metrics);
  renderFloorTiles(image, blueprint, metrics, seedValue);
  renderWallEdges(image, blueprint, metrics);
  renderObjects(image, blueprint, metrics, seedValue);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await image.write(outputPath);

  return {
    output_path: outputPath,
    metrics
  };
}

async function writeTerrainMask(blueprint, outputPath, metrics) {
  const image = createImage(metrics.render_width_px, metrics.render_height_px, rgbaToInt(0, 0, 0, 255));
  const openColor = rgbaToInt(255, 255, 255, 255);

  blueprint.floor_tiles.forEach((tile) => {
    const x = metrics.grid_origin_x + (tile.x * metrics.tile_size);
    const y = metrics.grid_origin_y + (tile.y * metrics.tile_size);
    fillRect(image, x, y, metrics.tile_size, metrics.tile_size, openColor);
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await image.write(outputPath);

  return {
    output_path: outputPath
  };
}

function toRepoRelative(absolutePath) {
  return path.relative(process.cwd(), absolutePath).replace(/\\/g, "/");
}

function getConnectionDirection(fromPoint, toPoint) {
  const dx = toPoint.x - fromPoint.x;
  const dy = toPoint.y - fromPoint.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "east" : "west";
  }
  return dy >= 0 ? "south" : "north";
}

function buildSourceRooms(blueprint) {
  return blueprint.rooms.map((room) => {
    const exits = blueprint.connections
      .filter((connection) => connection.from_room_id === room.room_id || connection.to_room_id === room.room_id)
      .map((connection) => {
        const toRoomId = connection.from_room_id === room.room_id ? connection.to_room_id : connection.from_room_id;
        const otherRoom = blueprint.rooms.find((entry) => entry.room_id === toRoomId);
        return {
          direction: otherRoom ? getConnectionDirection(room.center, otherRoom.center) : "unknown",
          to_room_id: toRoomId,
          locked: false
        };
      });

    return {
      room_id: room.room_id,
      room_type: room.kind,
      name: room.label,
      description: `Generated ${room.label.toLowerCase()} in ${titleCase(blueprint.theme_id)} style.`,
      shape: room.shape,
      center: clone(room.center),
      exits,
      objects: room.suggested_objects.map((entry) => ({
        object_id: entry.object_id,
        object_type: entry.object_type,
        label: entry.label,
        prop_type: entry.prop_type,
        position: clone(entry.position)
      })),
      discovered: room.room_id === blueprint.rooms[0].room_id,
      cleared: false
    };
  });
}

function buildCanonicalMap(blueprint, artifactPaths, metrics) {
  const mapState = {
    map_id: blueprint.map_id,
    map_type: "dungeon",
    name: `${blueprint.name} Generated Map`,
    instance_id: `generated-dungeon-${blueprint.map_id}`,
    instance_binding: {
      instance_type: "dungeon",
      instance_id: blueprint.map_id
    },
    grid: {
      width: blueprint.grid.width,
      height: blueprint.grid.height,
      tile_size: blueprint.grid.tile_size
    },
    asset: {
      base_image_path: toRepoRelative(artifactPaths.base_image_path),
      terrain_mask_path: toRepoRelative(artifactPaths.terrain_mask_path),
      terrain_mask_palette_id: "mspaint_basic",
      has_embedded_grid: true,
      render_width_px: metrics.render_width_px,
      render_height_px: metrics.render_height_px,
      grid_origin_x: metrics.grid_origin_x,
      grid_origin_y: metrics.grid_origin_y,
      grid_width_px: blueprint.grid.width * blueprint.grid.tile_size,
      grid_height_px: blueprint.grid.height * blueprint.grid.tile_size
    },
    rules: {
      diagonal_rule: "alternating"
    },
    blocked_tiles: clone(blueprint.blocked_tiles),
    terrain: [],
    terrain_zones: [],
    edge_walls: clone(blueprint.edge_walls),
    tokens: [],
    overlays: []
  };

  const validation = validateMapStateShape(mapState);
  if (!validation.ok) {
    throw new Error(`generated dungeon map is invalid: ${validation.errors.join("; ")}`);
  }

  return mapState;
}

function buildProfileMetadata(blueprint, artifactPaths, maskSummary) {
  return {
    name: `${blueprint.name} Dungeon Profile`,
    terrain: [],
    terrain_zones: [],
    tokens: [],
    overlays: [],
    terrain_mask_metadata: maskSummary || null,
    generator_metadata: {
      generator_version: blueprint.generator_version,
      generator_type: blueprint.generator_type,
      theme_id: blueprint.theme_id,
      seed: blueprint.seed,
      room_count: blueprint.rooms.length,
      source_path: toRepoRelative(artifactPaths.source_path)
    }
  };
}

function buildDungeonSource(blueprint, artifactPaths) {
  return {
    map_id: blueprint.map_id,
    name: blueprint.name,
    generator_version: blueprint.generator_version,
    generator_type: blueprint.generator_type,
    theme_id: blueprint.theme_id,
    seed: blueprint.seed,
    package_paths: {
      base_map_json_path: toRepoRelative(artifactPaths.base_map_json_path),
      profile_json_path: toRepoRelative(artifactPaths.profile_json_path),
      base_image_path: toRepoRelative(artifactPaths.base_image_path),
      terrain_mask_path: toRepoRelative(artifactPaths.terrain_mask_path),
      preview_png_path: toRepoRelative(artifactPaths.preview_png_path)
    },
    generation_summary: {
      grid: clone(blueprint.grid),
      room_count: blueprint.rooms.length,
      connection_count: blueprint.connections.length,
      floor_tile_count: blueprint.floor_tiles.length,
      blocked_tile_count: blueprint.blocked_tiles.length,
      edge_wall_count: blueprint.edge_walls.length
    },
    entry_room_id: blueprint.rooms[0] ? blueprint.rooms[0].room_id : null,
    exit_room_id: blueprint.rooms[blueprint.rooms.length - 1] ? blueprint.rooms[blueprint.rooms.length - 1].room_id : null,
    party_start: clone(blueprint.party_start),
    suggested_exit: clone(blueprint.suggested_exit),
    rooms: buildSourceRooms(blueprint),
    connections: clone(blueprint.connections),
    blueprint: {
      floor_tiles: clone(blueprint.floor_tiles),
      corridor_tiles: clone(blueprint.corridor_tiles),
      blocked_tiles: clone(blueprint.blocked_tiles),
      edge_walls: clone(blueprint.edge_walls)
    }
  };
}

async function generateDungeonMapPackage(options) {
  const normalized = normalizeGeneratorOptions(options);
  const blueprint = buildBlueprint(normalized);
  const outputDirectory = path.resolve(normalized.output_root, normalized.map_id);

  fs.mkdirSync(outputDirectory, { recursive: true });

  const artifactPaths = {
    output_directory: outputDirectory,
    source_path: path.resolve(outputDirectory, `${normalized.map_id}.dungeon-source.json`),
    base_image_path: path.resolve(outputDirectory, `${normalized.map_id}.base-map.png`),
    terrain_mask_path: path.resolve(outputDirectory, `${normalized.map_id}.terrain-mask.png`),
    base_map_json_path: path.resolve(outputDirectory, `${normalized.map_id}.base-map.json`),
    profile_json_path: path.resolve(outputDirectory, `${normalized.map_id}.dungeon-profile.json`),
    preview_png_path: path.resolve(outputDirectory, `${normalized.map_id}.preview.png`)
  };

  const baseImage = await writeDungeonBaseImage(blueprint, artifactPaths.base_image_path);
  await writeTerrainMask(blueprint, artifactPaths.terrain_mask_path, baseImage.metrics);

  const canonicalMap = buildCanonicalMap(blueprint, artifactPaths, baseImage.metrics);
  const maskBuilt = await buildTerrainEntriesFromMaskPath(canonicalMap, {});
  const profile = buildProfileMetadata(blueprint, artifactPaths, maskBuilt.summary);
  const source = buildDungeonSource(blueprint, artifactPaths);

  fs.writeFileSync(artifactPaths.base_map_json_path, JSON.stringify(canonicalMap, null, 2), "utf8");
  fs.writeFileSync(artifactPaths.profile_json_path, JSON.stringify(profile, null, 2), "utf8");
  fs.writeFileSync(artifactPaths.source_path, JSON.stringify(source, null, 2), "utf8");

  await renderMapPng(canonicalMap, {
    output_path: artifactPaths.preview_png_path
  });

  return {
    ok: true,
    event_type: "dungeon_map_generated",
    payload: {
      map_id: blueprint.map_id,
      theme_id: blueprint.theme_id,
      seed: blueprint.seed,
      output_directory: toRepoRelative(outputDirectory),
      base_map_json_path: toRepoRelative(artifactPaths.base_map_json_path),
      profile_json_path: toRepoRelative(artifactPaths.profile_json_path),
      source_path: toRepoRelative(artifactPaths.source_path),
      base_image_path: toRepoRelative(artifactPaths.base_image_path),
      terrain_mask_path: toRepoRelative(artifactPaths.terrain_mask_path),
      preview_png_path: toRepoRelative(artifactPaths.preview_png_path),
      room_count: blueprint.rooms.length,
      connection_count: blueprint.connections.length
    }
  };
}

module.exports = {
  createSeededRandom,
  generateDungeonBlueprint: buildBlueprint,
  generateDungeonMapPackage
};
