"use strict";

const MAP_TYPES = Object.freeze({
  COMBAT: "combat",
  DUNGEON: "dungeon"
});

const OVERLAY_KINDS = Object.freeze({
  MOVE: "move",
  RANGE: "range",
  PHYSICAL_RANGE: "physical_range",
  SPELL_RANGE: "spell_range",
  SPELL_AREA: "spell_area",
  AREA: "area",
  HAZARD: "hazard",
  SELECTION: "selection"
});

const TOKEN_TYPES = Object.freeze({
  PLAYER: "player",
  ENEMY: "enemy",
  NPC: "npc",
  OBJECT: "object"
});

const DISTANCE_METRICS = Object.freeze({
  MANHATTAN: "manhattan",
  CHEBYSHEV: "chebyshev",
  EUCLIDEAN: "euclidean"
});

const MOVEMENT_RULES = Object.freeze({
  TILE_FEET: 5,
  DEFAULT_SPEED_FEET: 30,
  DIAGONAL_5E: "5e",
  DIAGONAL_ALTERNATING: "alternating"
});

const ATTACK_MODES = Object.freeze({
  MELEE: "melee",
  RANGED_WEAPON: "ranged_weapon",
  SPELL_ATTACK: "spell_attack",
  SPELL_AREA: "spell_area"
});

const TARGET_AFFINITIES = Object.freeze({
  ANY: "any",
  SELF: "self",
  ALLY: "ally",
  ENEMY: "enemy",
  CREATURE: "creature",
  OBJECT: "object"
});

const SPELL_TARGETING_SHAPES = Object.freeze({
  NONE: "none",
  SELF: "self",
  SINGLE: "single",
  SPLIT: "split",
  CONE: "cone",
  CUBE: "cube",
  SPHERE: "sphere",
  LINE: "line",
  AURA: "aura",
  UTILITY: "utility"
});

const COVER_LEVELS = Object.freeze({
  NONE: "none",
  HALF: "half",
  THREE_QUARTERS: "three_quarters",
  TOTAL: "total"
});

const EDGE_WALL_SIDES = Object.freeze({
  NORTH: "north",
  SOUTH: "south",
  EAST: "east",
  WEST: "west"
});

module.exports = {
  MAP_TYPES,
  OVERLAY_KINDS,
  TOKEN_TYPES,
  DISTANCE_METRICS,
  MOVEMENT_RULES,
  ATTACK_MODES,
  TARGET_AFFINITIES,
  SPELL_TARGETING_SHAPES,
  COVER_LEVELS,
  EDGE_WALL_SIDES
};
