"use strict";

const { OVERLAY_KINDS, DISTANCE_METRICS, MOVEMENT_RULES } = require("../constants");
const { getReachableTiles } = require("./movement");
const { getTilesInRange } = require("./range");
const { getValidAttackTargets } = require("./attacks");
const { buildHazardTileList } = require("./terrain");
const { buildSpellAreaTiles } = require("../spells/spell-area");
const { resolveActorMovementSpeedFeet } = require("./actor-movement");

function normalizeOverlayColor(color, fallback) {
  return typeof color === "string" && color.trim() ? color : fallback;
}

function resolveDiagonalRule(options) {
  if (options && options.diagonal_rule) {
    return options.diagonal_rule;
  }

  const mapRules = options && options.map && options.map.rules ? options.map.rules : {};
  const movementRules = options && options.map && options.map.movement ? options.map.movement : {};
  return mapRules.diagonal_rule || movementRules.diagonal_rule || MOVEMENT_RULES.DIAGONAL_5E;
}

function buildMovementOverlay(options) {
  const diagonalRule = resolveDiagonalRule(options);
  const maxCost = typeof options.max_cost === "number"
    ? options.max_cost
    : MOVEMENT_RULES.DEFAULT_SPEED_FEET;
  const reachable = getReachableTiles({
    map: options.map,
    origin: options.origin,
    max_cost: maxCost,
    allow_diagonal: options.allow_diagonal,
    diagonal_rule: diagonalRule,
    ignore_token_id: options.ignore_token_id
  });

  return {
    overlay_id: options.overlay_id || "movement-overlay",
    kind: OVERLAY_KINDS.MOVE,
    color: normalizeOverlayColor(options.color, "#34c759"),
    opacity: typeof options.opacity === "number" ? options.opacity : 0.5,
    tiles: reachable.map((tile) => ({
      x: tile.x,
      y: tile.y,
      movement_cost_feet: tile.movement_cost_feet,
      remaining_movement_feet: Math.max(0, maxCost - tile.movement_cost_feet)
    })),
    metadata: {
      max_cost_feet: maxCost,
      tile_feet: MOVEMENT_RULES.TILE_FEET,
      diagonal_rule: diagonalRule,
      reachable_tiles: reachable.map((tile) => ({
        x: tile.x,
        y: tile.y,
        movement_cost_feet: tile.movement_cost_feet,
        remaining_movement_feet: Math.max(0, maxCost - tile.movement_cost_feet)
      }))
    }
  };
}

function buildActorMovementOverlay(options) {
  const actor = options.actor || {};
  return buildMovementOverlay({
    ...options,
    origin: options.origin || actor.position,
    max_cost: typeof options.max_cost === "number"
      ? options.max_cost
      : resolveActorMovementSpeedFeet({
        actor,
        context: options.context || {},
        movement_speed_feet: options.movement_speed_feet,
        movement_modifier_feet: options.movement_modifier_feet,
        remaining_movement_feet: options.remaining_movement_feet
      }),
    ignore_token_id: options.ignore_token_id || actor.token_id
  });
}

function buildRangeOverlay(options) {
  const rangedTiles = getTilesInRange({
    map: options.map,
    origin: options.origin,
    range: options.range,
    metric: options.metric || DISTANCE_METRICS.MANHATTAN,
    include_origin: options.include_origin,
    require_line_of_sight: options.require_line_of_sight
  });

  return {
    overlay_id: options.overlay_id || "range-overlay",
    kind: options.kind || OVERLAY_KINDS.RANGE,
    color: normalizeOverlayColor(options.color, "#ffd60a"),
    opacity: typeof options.opacity === "number" ? options.opacity : 0.45,
    tiles: rangedTiles.map((tile) => ({ x: tile.x, y: tile.y })),
    metadata: {
      range: options.range,
      metric: options.metric || DISTANCE_METRICS.MANHATTAN
    }
  };
}

function buildPhysicalRangeOverlay(options) {
  const validTargets = getValidAttackTargets({
    map: options.map,
    attacker: options.attacker,
    attack_profile: options.attack_profile
  });

  return {
    overlay_id: options.overlay_id || "physical-range-overlay",
    kind: OVERLAY_KINDS.PHYSICAL_RANGE,
    color: normalizeOverlayColor(options.color, "#ff3b30"),
    opacity: typeof options.opacity === "number" ? options.opacity : 0.5,
    tiles: validTargets.map((tile) => ({ x: tile.x, y: tile.y })),
    metadata: {
      valid_target_count: validTargets.length,
      attack_profile: options.attack_profile || null
    }
  };
}

function buildSpellRangeOverlay(options) {
  return buildRangeOverlay({
    ...options,
    overlay_id: options.overlay_id || "spell-range-overlay",
    kind: OVERLAY_KINDS.SPELL_RANGE,
    color: options.color || "#4dabf7",
    require_line_of_sight: options.require_line_of_sight !== false
  });
}

function buildSpellAreaOverlay(options) {
  const tiles = Array.isArray(options.tiles)
    ? options.tiles
    : buildSpellAreaTiles({
      map: options.map,
      origin: options.origin,
      profile: options.profile || {},
      target_position: options.target_position,
      target_token: options.target_token,
      valid_targets: options.valid_targets
    });

  return {
    overlay_id: options.overlay_id || "spell-area-overlay",
    kind: OVERLAY_KINDS.SPELL_AREA,
    color: normalizeOverlayColor(options.color, "#a855f7"),
    opacity: typeof options.opacity === "number" ? options.opacity : 0.55,
    tiles: tiles.map((tile) => ({ x: tile.x, y: tile.y })),
    metadata: {
      shape: options.profile && options.profile.shape || "",
      area_size_feet: options.profile && options.profile.area_size_feet || 0,
      line_width_feet: options.profile && options.profile.line_width_feet || 0
    }
  };
}

function buildSelectionOverlay(options) {
  const tiles = Array.isArray(options.tiles)
    ? options.tiles
    : (options.tile ? [options.tile] : []);

  return {
    overlay_id: options.overlay_id || "selection-overlay",
    kind: OVERLAY_KINDS.SELECTION,
    color: normalizeOverlayColor(options.color, "#ffd60a"),
    opacity: typeof options.opacity === "number" ? options.opacity : 0.18,
    tiles: tiles.map((tile) => ({
      x: tile.x,
      y: tile.y,
      label: tile.label || "",
      marker_style: tile.marker_style || ""
    })),
    metadata: {
      marker_style: options.marker_style || "target"
    }
  };
}

function buildHazardOverlay(options) {
  const hazardTiles = Array.isArray(options.tiles)
    ? options.tiles
    : buildHazardTileList(options.map);

  return {
    overlay_id: options.overlay_id || "hazard-overlay",
    kind: OVERLAY_KINDS.HAZARD,
    color: normalizeOverlayColor(options.color, "#ff9f0a"),
    opacity: typeof options.opacity === "number" ? options.opacity : 0.42,
    tiles: hazardTiles.map((tile) => ({
      x: tile.x,
      y: tile.y,
      label: tile.hazard_kind ? String(tile.hazard_kind).slice(0, 3).toUpperCase() : "HZD"
    })),
    metadata: {
      hazard_count: hazardTiles.length
    }
  };
}

module.exports = {
  buildMovementOverlay,
  buildActorMovementOverlay,
  buildRangeOverlay,
  buildPhysicalRangeOverlay,
  buildSpellRangeOverlay,
  buildSpellAreaOverlay,
  buildSelectionOverlay,
  buildHazardOverlay
};
