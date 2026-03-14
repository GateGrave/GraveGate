"use strict";

const { MOVEMENT_RULES, SPELL_TARGETING_SHAPES, TARGET_AFFINITIES, TOKEN_TYPES } = require("../constants");
const { getDistance } = require("../coordinates/grid");
const { hasLineOfSight } = require("../logic/range");
const { getCoverBetween } = require("../logic/cover");

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
  if (safe === "self") {
    return {
      shape: SPELL_TARGETING_SHAPES.SELF,
      size_feet: 0,
      width_feet: 0,
      min_targets: 1,
      max_targets: 1,
      requires_exact_target_count: true,
      allows_duplicate_targets: false,
      requires_adjacent_selection: false,
      target_affinity_hint: TARGET_AFFINITIES.SELF
    };
  }
  if (safe === "single_target") {
    return {
      shape: SPELL_TARGETING_SHAPES.SINGLE,
      size_feet: 0,
      width_feet: 0,
      min_targets: 1,
      max_targets: 1,
      requires_exact_target_count: true,
      allows_duplicate_targets: false,
      requires_adjacent_selection: false,
      target_affinity_hint: null
    };
  }
  if (safe === "single_or_split_target") {
    return {
      shape: SPELL_TARGETING_SHAPES.SPLIT,
      size_feet: 0,
      width_feet: 0,
      min_targets: 1,
      max_targets: null,
      requires_exact_target_count: true,
      allows_duplicate_targets: true,
      requires_adjacent_selection: false,
      target_affinity_hint: null
    };
  }
  if (safe === "single_or_adjacent_pair") {
    return {
      shape: SPELL_TARGETING_SHAPES.SPLIT,
      size_feet: 0,
      width_feet: 0,
      min_targets: 1,
      max_targets: 2,
      requires_exact_target_count: false,
      allows_duplicate_targets: false,
      requires_adjacent_selection: true,
      target_affinity_hint: TARGET_AFFINITIES.ENEMY
    };
  }
  if (safe === "up_to_three_allies") {
    return {
      shape: SPELL_TARGETING_SHAPES.SPLIT,
      size_feet: 0,
      width_feet: 0,
      min_targets: 1,
      max_targets: 3,
      requires_exact_target_count: false,
      allows_duplicate_targets: false,
      requires_adjacent_selection: false,
      target_affinity_hint: TARGET_AFFINITIES.ALLY
    };
  }
  if (safe === "up_to_three_enemies") {
    return {
      shape: SPELL_TARGETING_SHAPES.SPLIT,
      size_feet: 0,
      width_feet: 0,
      min_targets: 1,
      max_targets: 3,
      requires_exact_target_count: false,
      allows_duplicate_targets: false,
      requires_adjacent_selection: false,
      target_affinity_hint: TARGET_AFFINITIES.ENEMY
    };
  }
  if (safe === "object") {
    return {
      shape: SPELL_TARGETING_SHAPES.SINGLE,
      size_feet: 0,
      width_feet: 0,
      min_targets: 1,
      max_targets: 1,
      requires_exact_target_count: true,
      allows_duplicate_targets: false,
      requires_adjacent_selection: false,
      target_affinity_hint: TARGET_AFFINITIES.OBJECT
    };
  }
  if (safe === "utility") {
    return {
      shape: SPELL_TARGETING_SHAPES.UTILITY,
      size_feet: 0,
      width_feet: 0,
      min_targets: 0,
      max_targets: null,
      requires_exact_target_count: false,
      allows_duplicate_targets: false,
      requires_adjacent_selection: false,
      target_affinity_hint: TARGET_AFFINITIES.ANY
    };
  }

  const coneMatch = safe.match(/^cone_(\d+)(ft)?$/);
  if (coneMatch) {
    return {
      shape: SPELL_TARGETING_SHAPES.CONE,
      size_feet: Number(coneMatch[1]),
      width_feet: 0,
      min_targets: 0,
      max_targets: null,
      requires_exact_target_count: false,
      allows_duplicate_targets: false,
      requires_adjacent_selection: false,
      target_affinity_hint: null
    };
  }

  const cubeMatch = safe.match(/^cube_(\d+)(ft)?$/);
  if (cubeMatch) {
    return {
      shape: SPELL_TARGETING_SHAPES.CUBE,
      size_feet: Number(cubeMatch[1]),
      width_feet: 0,
      min_targets: 0,
      max_targets: null,
      requires_exact_target_count: false,
      allows_duplicate_targets: false,
      requires_adjacent_selection: false,
      target_affinity_hint: null
    };
  }

  const sphereMatch = safe.match(/^sphere_(\d+)(ft)?$/);
  if (sphereMatch) {
    return {
      shape: SPELL_TARGETING_SHAPES.SPHERE,
      size_feet: Number(sphereMatch[1]),
      width_feet: 0,
      min_targets: 0,
      max_targets: null,
      requires_exact_target_count: false,
      allows_duplicate_targets: false,
      requires_adjacent_selection: false,
      target_affinity_hint: null
    };
  }

  const auraMatch = safe.match(/^aura_(\d+)(ft)?$/);
  if (auraMatch) {
    return {
      shape: SPELL_TARGETING_SHAPES.AURA,
      size_feet: Number(auraMatch[1]),
      width_feet: 0,
      min_targets: 0,
      max_targets: null,
      requires_exact_target_count: false,
      allows_duplicate_targets: false,
      requires_adjacent_selection: false,
      target_affinity_hint: null
    };
  }

  const lineMatch = safe.match(/^line_(\d+)(ft)?_(\d+)(ft)?$/) || safe.match(/^line_(\d+)(ft)?$/);
  if (lineMatch) {
    return {
      shape: SPELL_TARGETING_SHAPES.LINE,
      size_feet: Number(lineMatch[1]),
      width_feet: Number(lineMatch[3] || MOVEMENT_RULES.TILE_FEET),
      min_targets: 0,
      max_targets: null,
      requires_exact_target_count: false,
      allows_duplicate_targets: false,
      requires_adjacent_selection: false,
      target_affinity_hint: null
    };
  }

  return {
    shape: SPELL_TARGETING_SHAPES.SINGLE,
    size_feet: 0,
    width_feet: 0,
    min_targets: 1,
    max_targets: 1,
    requires_exact_target_count: true,
    allows_duplicate_targets: false,
    requires_adjacent_selection: false,
    target_affinity_hint: null
  };
}

function deriveTargetAffinity(spell, parsedTargetType) {
  const effect = spell && spell.effect ? spell.effect : {};
  const effectTargeting = String(effect.targeting || "").toLowerCase();
  const spellName = String(spell && spell.name || "").toLowerCase();
  const attackType = String(spell && spell.attack_or_save && spell.attack_or_save.type || "").toLowerCase();
  const supportsAlly = Boolean(
    effect.healing_ref ||
    effect.defense_ref ||
    effect.buff_ref ||
    effect.vitality_ref
  );

  if (parsedTargetType && parsedTargetType.target_affinity_hint) {
    return parsedTargetType.target_affinity_hint;
  }

  if (spell && spell.healing) {
    return TARGET_AFFINITIES.ALLY;
  }

  if (spellName.includes("healing")) {
    return TARGET_AFFINITIES.ALLY;
  }

  if (effectTargeting.includes("object")) {
    return TARGET_AFFINITIES.OBJECT;
  }

  if (effectTargeting.includes("ally")) {
    return TARGET_AFFINITIES.ALLY;
  }

  if (effectTargeting.includes("enemy")) {
    return TARGET_AFFINITIES.ENEMY;
  }

  if (effectTargeting.includes("self")) {
    return TARGET_AFFINITIES.SELF;
  }

  if (supportsAlly && attackType === "none" && !spell.damage) {
    return TARGET_AFFINITIES.ALLY;
  }

  if (effect.debuff_ref && attackType === "none" && !spell.damage) {
    return TARGET_AFFINITIES.ENEMY;
  }

  if (effectTargeting.includes("utility")) {
    return TARGET_AFFINITIES.ANY;
  }

  return TARGET_AFFINITIES.ENEMY;
}

function deriveMaxTargets(spell, parsedTargetType) {
  const effect = spell && spell.effect ? spell.effect : {};
  if (Number.isFinite(effect.projectiles)) {
    return Number(effect.projectiles);
  }

  if (Number.isFinite(parsedTargetType && parsedTargetType.max_targets)) {
    return Number(parsedTargetType.max_targets);
  }

  return null;
}

function buildSpellTargetingProfile(spell) {
  const targetType = spell && spell.targeting && spell.targeting.type
    ? spell.targeting.type
    : (spell && spell.target_type) || "single_target";
  const parsedShape = parseShapeFromTargetType(targetType);
  const rangeFeet = parseFeet(spell && spell.range, MOVEMENT_RULES.TILE_FEET);
  const selfCenteredArea = parsedShape.shape === SPELL_TARGETING_SHAPES.AURA ||
    (
      rangeFeet <= 0 &&
      [SPELL_TARGETING_SHAPES.CUBE, SPELL_TARGETING_SHAPES.SPHERE].includes(parsedShape.shape)
    );

  return {
    spell_id: String(spell && (spell.spell_id || spell.id) || ""),
    name: String(spell && spell.name || ""),
    targeting_type: String(targetType || ""),
    range_feet: rangeFeet,
    shape: parsedShape.shape,
    area_size_feet: parsedShape.size_feet,
    line_width_feet: parsedShape.width_feet,
    target_affinity: deriveTargetAffinity(spell, parsedShape),
    min_targets: Number.isFinite(parsedShape.min_targets) ? Number(parsedShape.min_targets) : 0,
    max_targets: deriveMaxTargets(spell, parsedShape),
    requires_exact_target_count: parsedShape.requires_exact_target_count === true,
    allows_duplicate_targets: parsedShape.allows_duplicate_targets === true,
    requires_adjacent_selection: parsedShape.requires_adjacent_selection === true,
    self_centered_area: selfCenteredArea,
    requires_line_of_sight: ![SPELL_TARGETING_SHAPES.SELF, SPELL_TARGETING_SHAPES.AURA].includes(parsedShape.shape)
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
  if (affinity === TARGET_AFFINITIES.OBJECT) return target.token_type === TOKEN_TYPES.OBJECT;
  if (affinity === TARGET_AFFINITIES.CREATURE) {
    return [TOKEN_TYPES.PLAYER, TOKEN_TYPES.ENEMY, TOKEN_TYPES.NPC].includes(target.token_type);
  }
  return true;
}

function getTokenDistanceFeet(actor, target) {
  return getDistance(actor.position, target.position, "chebyshev") * MOVEMENT_RULES.TILE_FEET;
}

function formatTargetAffinityReason(profile) {
  if (!profile) {
    return "invalid target";
  }

  if (profile.target_affinity === TARGET_AFFINITIES.SELF) {
    return "self only";
  }
  if (profile.target_affinity === TARGET_AFFINITIES.ALLY) {
    return "ally only";
  }
  if (profile.target_affinity === TARGET_AFFINITIES.ENEMY) {
    return "enemy only";
  }
  if (profile.target_affinity === TARGET_AFFINITIES.CREATURE) {
    return "creature only";
  }
  if (profile.target_affinity === TARGET_AFFINITIES.OBJECT) {
    return "object only";
  }
  return "invalid target";
}

function formatSpellInvalidReason(reasonCodes, profile) {
  if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) {
    return "";
  }

  if (reasonCodes.includes("line_of_sight_blocked")) {
    return "line of sight blocked";
  }
  if (reasonCodes.includes("out_of_range")) {
    return "out of range";
  }
  if (reasonCodes.includes("wrong_affinity")) {
    return formatTargetAffinityReason(profile);
  }
  return "illegal target";
}

function buildSpellTargetEntry(map, actor, profile, token, reasonCodes) {
  return {
    token_id: token.token_id,
    name: token.name || token.display_name || token.token_id,
    x: token.position.x,
    y: token.position.y,
    distance_feet: getTokenDistanceFeet(actor, token),
    cover: getCoverBetween(map, actor.position, token.position),
    line_of_sight: profile.requires_line_of_sight ? hasLineOfSight(map, actor.position, token.position) : true,
    reason_codes: Array.isArray(reasonCodes) ? reasonCodes.slice() : [],
    reason_summary: formatSpellInvalidReason(reasonCodes, profile)
  };
}

function inspectSpellTargets(options) {
  const map = options.map;
  const actor = options.actor;
  const profile = options.profile;
  if (!map || !actor || !profile || profile.shape === SPELL_TARGETING_SHAPES.UTILITY) {
    return {
      valid_targets: [],
      invalid_targets: []
    };
  }
  const evaluated = (map.tokens || [])
    .filter((token) => token.position && token.token_id)
    .filter((token) => !(
      String(token.token_id) === String(actor && actor.token_id || "") &&
      profile.target_affinity === TARGET_AFFINITIES.ENEMY
    ))
    .map((token) => {
      const reasons = [];

      if (!matchesTargetAffinity(actor, token, profile.target_affinity)) {
        reasons.push("wrong_affinity");
      }

      if (profile.shape === SPELL_TARGETING_SHAPES.SELF) {
        if (String(token.token_id) !== String(actor.token_id)) {
          reasons.push("wrong_affinity");
        }
      } else if (getTokenDistanceFeet(actor, token) > profile.range_feet) {
        reasons.push("out_of_range");
      }

      if (
        profile.requires_line_of_sight &&
        profile.shape !== SPELL_TARGETING_SHAPES.SELF &&
        !hasLineOfSight(map, actor.position, token.position)
      ) {
        reasons.push("line_of_sight_blocked");
      }

      return {
        valid: reasons.length === 0,
        entry: buildSpellTargetEntry(map, actor, profile, token, reasons)
      };
    })
    .sort((left, right) => (
      Number(left.entry.distance_feet) - Number(right.entry.distance_feet) ||
      left.entry.y - right.entry.y ||
      left.entry.x - right.entry.x ||
      String(left.entry.token_id).localeCompare(String(right.entry.token_id))
    ));

  return {
    valid_targets: evaluated.filter((entry) => entry.valid).map((entry) => entry.entry),
    invalid_targets: evaluated.filter((entry) => !entry.valid).map((entry) => entry.entry)
  };
}

function getValidSpellTargets(options) {
  return inspectSpellTargets(options).valid_targets;
}

function validateSpellSelection(options) {
  const profile = options.profile;
  const selectedTargets = Array.isArray(options.selected_targets) ? options.selected_targets : [];
  const minTargets = Number.isFinite(profile && profile.min_targets) ? Number(profile.min_targets) : 0;
  const targetEntries = Array.isArray(options.selected_target_entries) ? options.selected_target_entries : [];

  if (profile.shape === SPELL_TARGETING_SHAPES.UTILITY) {
    return { ok: true };
  }

  if (profile.self_centered_area === true || profile.shape === SPELL_TARGETING_SHAPES.AURA) {
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

  if (profile.allows_duplicate_targets !== true && (new Set(selectedTargets)).size !== selectedTargets.length) {
    return {
      ok: false,
      error: "duplicate target selections are not allowed for this spell"
    };
  }

  if (
    [SPELL_TARGETING_SHAPES.SINGLE, SPELL_TARGETING_SHAPES.SPLIT].includes(profile.shape) &&
    selectedTargets.length < minTargets
  ) {
    return {
      ok: false,
      error: minTargets > 1
        ? `at least ${minTargets} targets must be selected`
        : "at least one target must be selected"
    };
  }

  if (
    profile.requires_exact_target_count === true &&
    Number.isFinite(profile.max_targets) &&
    selectedTargets.length !== profile.max_targets
  ) {
    return {
      ok: false,
      error: `split-target spells require exactly ${profile.max_targets} target selections`
    };
  }

  if (
    profile.requires_adjacent_selection === true &&
    targetEntries.length > 1 &&
    targetEntries.some((entry, index) => (
      index > 0 &&
      getDistance(targetEntries[0], entry, "chebyshev") > 1
    ))
  ) {
    return {
      ok: false,
      error: "selected targets must be adjacent to each other"
    };
  }

  return { ok: true };
}

function getSpellAreaOverlaySpec(profile) {
  return {
    shape: profile.shape,
    size_feet: profile.area_size_feet,
    width_feet: profile.line_width_feet || 0,
    range_feet: profile.range_feet
  };
}

module.exports = {
  parseFeet,
  parseShapeFromTargetType,
  buildSpellTargetingProfile,
  getValidSpellTargets,
  inspectSpellTargets,
  validateSpellSelection,
  getSpellAreaOverlaySpec,
  matchesTargetAffinity
};
