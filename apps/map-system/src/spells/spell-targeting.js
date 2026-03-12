"use strict";

const { MOVEMENT_RULES, SPELL_TARGETING_SHAPES, TARGET_AFFINITIES, TOKEN_TYPES } = require("../constants");
const { getDistance } = require("../coordinates/grid");
const { hasLineOfSight } = require("../logic/range");

function parseFeet(value, fallback) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return fallback;
  if (text === "self") return 0;
  if (text === "touch") return MOVEMENT_RULES.TILE_FEET;
  const match = text.match(/(\d+)\s*feet?/);
  if (!match) return fallback;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseShapeFromTargetType(targetType) {
  const safe = String(targetType || "").trim().toLowerCase();
  if (safe === "self") return { shape: SPELL_TARGETING_SHAPES.SELF, size_feet: 0 };
  if (safe === "single_target") return { shape: SPELL_TARGETING_SHAPES.SINGLE, size_feet: 0 };
  if (safe === "single_or_split_target") return { shape: SPELL_TARGETING_SHAPES.SPLIT, size_feet: 0 };
  if (safe === "utility") return { shape: SPELL_TARGETING_SHAPES.UTILITY, size_feet: 0 };

  const coneMatch = safe.match(/^cone_(\d+)ft$/);
  if (coneMatch) {
    return { shape: SPELL_TARGETING_SHAPES.CONE, size_feet: Number(coneMatch[1]) };
  }

  const cubeMatch = safe.match(/^cube_(\d+)ft$/);
  if (cubeMatch) {
    return { shape: SPELL_TARGETING_SHAPES.CUBE, size_feet: Number(cubeMatch[1]) };
  }

  const sphereMatch = safe.match(/^sphere_(\d+)ft$/);
  if (sphereMatch) {
    return { shape: SPELL_TARGETING_SHAPES.SPHERE, size_feet: Number(sphereMatch[1]) };
  }

  const lineMatch = safe.match(/^line_(\d+)ft$/);
  if (lineMatch) {
    return { shape: SPELL_TARGETING_SHAPES.LINE, size_feet: Number(lineMatch[1]) };
  }

  return { shape: SPELL_TARGETING_SHAPES.SINGLE, size_feet: 0 };
}

function deriveTargetAffinity(spell) {
  const effect = spell && spell.effect ? spell.effect : {};
  const effectTargeting = String(effect.targeting || "").toLowerCase();
  const spellName = String(spell && spell.name || "").toLowerCase();

  if (String(spell && spell.range || "").toLowerCase() === "self") {
    return TARGET_AFFINITIES.SELF;
  }

  if (spell && spell.healing) {
    return TARGET_AFFINITIES.ALLY;
  }

  if (spellName.includes("healing")) {
    return TARGET_AFFINITIES.ALLY;
  }

  if (effectTargeting.includes("utility")) {
    return TARGET_AFFINITIES.ANY;
  }

  return TARGET_AFFINITIES.ENEMY;
}

function deriveMaxTargets(spell) {
  const effect = spell && spell.effect ? spell.effect : {};
  if (Number.isFinite(effect.projectiles)) {
    return Number(effect.projectiles);
  }

  const targetType = String(spell && spell.targeting && spell.targeting.type || "");
  if (targetType === "single_or_split_target") {
    return 1;
  }

  if (targetType === "single_target" || targetType === "self") {
    return 1;
  }

  return null;
}

function buildSpellTargetingProfile(spell) {
  const targetType = spell && spell.targeting && spell.targeting.type
    ? spell.targeting.type
    : (spell && spell.target_type) || "single_target";
  const parsedShape = parseShapeFromTargetType(targetType);

  return {
    spell_id: String(spell && (spell.spell_id || spell.id) || ""),
    name: String(spell && spell.name || ""),
    range_feet: parseFeet(spell && spell.range, MOVEMENT_RULES.TILE_FEET),
    shape: parsedShape.shape,
    area_size_feet: parsedShape.size_feet,
    target_affinity: deriveTargetAffinity(spell),
    max_targets: deriveMaxTargets(spell),
    requires_line_of_sight: parsedShape.shape !== SPELL_TARGETING_SHAPES.SELF
  };
}

function isFriendlyToken(actor, target) {
  const actorTeam = String(actor && actor.team || "");
  const targetTeam = String(target && target.team || "");
  return actorTeam && targetTeam && actorTeam === targetTeam;
}

function isEnemyToken(actor, target) {
  const actorTeam = String(actor && actor.team || "");
  const targetTeam = String(target && target.team || "");
  return actorTeam && targetTeam && actorTeam !== targetTeam;
}

function matchesTargetAffinity(actor, target, affinity) {
  if (affinity === TARGET_AFFINITIES.ANY) return true;
  if (affinity === TARGET_AFFINITIES.SELF) return String(actor.token_id) === String(target.token_id);
  if (affinity === TARGET_AFFINITIES.ALLY) return isFriendlyToken(actor, target) || String(actor.token_id) === String(target.token_id);
  if (affinity === TARGET_AFFINITIES.ENEMY) return isEnemyToken(actor, target);
  if (affinity === TARGET_AFFINITIES.CREATURE) {
    return [TOKEN_TYPES.PLAYER, TOKEN_TYPES.ENEMY, TOKEN_TYPES.NPC].includes(target.token_type);
  }
  return true;
}

function getTokenDistanceFeet(actor, target) {
  return getDistance(actor.position, target.position, "chebyshev") * MOVEMENT_RULES.TILE_FEET;
}

function getValidSpellTargets(options) {
  const map = options.map;
  const actor = options.actor;
  const profile = options.profile;

  return (map.tokens || [])
    .filter((token) => token.position && token.token_id)
    .filter((token) => matchesTargetAffinity(actor, token, profile.target_affinity))
    .filter((token) => {
      if (profile.shape === SPELL_TARGETING_SHAPES.SELF) {
        return String(token.token_id) === String(actor.token_id);
      }
      return getTokenDistanceFeet(actor, token) <= profile.range_feet;
    })
    .filter((token) => {
      if (!profile.requires_line_of_sight || profile.shape === SPELL_TARGETING_SHAPES.SELF) {
        return true;
      }
      return hasLineOfSight(map, actor.position, token.position);
    })
    .map((token) => ({
      token_id: token.token_id,
      x: token.position.x,
      y: token.position.y,
      distance_feet: getTokenDistanceFeet(actor, token)
    }));
}

function validateSpellSelection(options) {
  const profile = options.profile;
  const selectedTargets = Array.isArray(options.selected_targets) ? options.selected_targets : [];

  if (profile.shape === SPELL_TARGETING_SHAPES.UTILITY) {
    return { ok: true };
  }

  if (profile.shape === SPELL_TARGETING_SHAPES.SELF) {
    return selectedTargets.length === 1
      ? { ok: true }
      : { ok: false, error: "self spells must target exactly one self token" };
  }

  if (profile.max_targets && selectedTargets.length > profile.max_targets) {
    return {
      ok: false,
      error: `too many targets selected; max is ${profile.max_targets}`
    };
  }

  if (
    profile.shape === SPELL_TARGETING_SHAPES.SPLIT &&
    Number.isFinite(profile.max_targets) &&
    selectedTargets.length !== profile.max_targets
  ) {
    return {
      ok: false,
      error: `split-target spells require exactly ${profile.max_targets} target selections`
    };
  }

  if (
    [SPELL_TARGETING_SHAPES.SINGLE, SPELL_TARGETING_SHAPES.SPLIT].includes(profile.shape) &&
    selectedTargets.length < 1
  ) {
    return {
      ok: false,
      error: "at least one target must be selected"
    };
  }

  return { ok: true };
}

function getSpellAreaOverlaySpec(profile) {
  return {
    shape: profile.shape,
    size_feet: profile.area_size_feet,
    range_feet: profile.range_feet
  };
}

module.exports = {
  parseFeet,
  parseShapeFromTargetType,
  buildSpellTargetingProfile,
  getValidSpellTargets,
  validateSpellSelection,
  getSpellAreaOverlaySpec,
  matchesTargetAffinity
};
