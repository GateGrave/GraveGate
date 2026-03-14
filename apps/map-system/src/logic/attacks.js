"use strict";

const { ATTACK_MODES, DISTANCE_METRICS, TOKEN_TYPES, MOVEMENT_RULES } = require("../constants");
const { getDistance } = require("../coordinates/grid");
const { hasLineOfSight } = require("./range");
const { getCoverBetween } = require("./cover");
const { resolveWeaponProfile } = require("./weapon-profiles");

function buildAttackProfile(options) {
  const resolvedWeapon = resolveWeaponProfile({
    weapon_profile_id: options.weapon_profile_id,
    weapon_profile: options.weapon_profile,
    name: options.weapon_name,
    category: options.weapon_category,
    mode: options.mode,
    range_feet: options.range_feet,
    long_range_feet: options.long_range_feet,
    reach_feet: options.reach_feet,
    requires_line_of_sight: options.requires_line_of_sight
  });
  const resolvedMode = options.mode || resolvedWeapon.mode || ATTACK_MODES.MELEE;
  const explicitRangeFeet = typeof options.range_feet === "number"
    ? options.range_feet
    : null;
  const explicitReachFeet = typeof options.reach_feet === "number"
    ? options.reach_feet
    : null;
  const normalRangeFeet = explicitRangeFeet !== null
    ? explicitRangeFeet
    : (resolvedMode === ATTACK_MODES.MELEE
      ? (explicitReachFeet !== null ? explicitReachFeet : resolvedWeapon.range_feet)
      : resolvedWeapon.range_feet);
  const longRangeFeet = typeof options.long_range_feet === "number"
    ? options.long_range_feet
    : resolvedWeapon.long_range_feet;

  return {
    weapon_profile_id: options.weapon_profile_id || resolvedWeapon.weapon_profile_id || "",
    weapon_name: options.weapon_name || resolvedWeapon.name || "",
    weapon_category: options.weapon_category || resolvedWeapon.category || "",
    mode: resolvedMode,
    reach_feet: explicitReachFeet !== null ? explicitReachFeet : resolvedWeapon.reach_feet,
    range_feet: typeof normalRangeFeet === "number" ? normalRangeFeet : MOVEMENT_RULES.TILE_FEET,
    long_range_feet: longRangeFeet,
    max_range_feet: Math.max(
      typeof normalRangeFeet === "number" ? normalRangeFeet : MOVEMENT_RULES.TILE_FEET,
      longRangeFeet || 0
    ),
    requires_line_of_sight: options.requires_line_of_sight !== false && resolvedWeapon.requires_line_of_sight !== false,
    metric: options.metric || DISTANCE_METRICS.CHEBYSHEV,
    target_token_types: Array.isArray(options.target_token_types) && options.target_token_types.length > 0
      ? options.target_token_types
      : [TOKEN_TYPES.ENEMY]
  };
}

function getTokenDistanceFeet(origin, target, metric) {
  return getDistance(origin, target, metric) * MOVEMENT_RULES.TILE_FEET;
}

function getAttackInvalidReasonCodes(options) {
  const map = options.map;
  const attacker = options.attacker;
  const target = options.target;
  const attackProfile = buildAttackProfile(options.attack_profile || {});
  const reasons = [];

  if (!attackProfile.target_token_types.includes(target.token_type)) {
    reasons.push("wrong_target_type");
  }

  const distanceFeet = getTokenDistanceFeet(
    attacker.position,
    target.position,
    attackProfile.metric
  );
  if (distanceFeet > attackProfile.max_range_feet) {
    reasons.push("out_of_range");
  }

  if (attackProfile.requires_line_of_sight && !hasLineOfSight(map, attacker.position, target.position)) {
    reasons.push("line_of_sight_blocked");
  }

  return reasons;
}

function formatAttackInvalidReason(reasonCodes) {
  if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) {
    return "";
  }

  if (reasonCodes.includes("line_of_sight_blocked")) {
    return "line of sight blocked";
  }
  if (reasonCodes.includes("out_of_range")) {
    return "out of range";
  }
  if (reasonCodes.includes("wrong_target_type")) {
    return "not a valid attack target";
  }
  return "illegal target";
}

function buildAttackTargetEntry(map, attacker, target, attackProfile, reasonCodes) {
  const distanceFeet = getTokenDistanceFeet(attacker.position, target.position, attackProfile.metric);
  return {
    cover: getCoverBetween(map, attacker.position, target.position),
    token_id: target.token_id,
    name: target.name || target.display_name || target.token_id,
    x: target.position.x,
    y: target.position.y,
    distance_feet: distanceFeet,
    range_band: (() => {
      if (attackProfile.long_range_feet > attackProfile.range_feet && distanceFeet > attackProfile.range_feet) {
        return "long";
      }
      return "normal";
    })(),
    reason_codes: Array.isArray(reasonCodes) ? reasonCodes.slice() : [],
    reason_summary: formatAttackInvalidReason(reasonCodes)
  };
}

function isTargetValidForAttack(options) {
  return getAttackInvalidReasonCodes(options).length === 0;
}

function inspectAttackTargets(options) {
  const map = options.map;
  const attacker = options.attacker;
  const attackProfile = buildAttackProfile(options.attack_profile || {});
  const evaluated = (map.tokens || [])
    .filter((token) => token.token_id !== attacker.token_id)
    .map((token) => {
      const reasonCodes = getAttackInvalidReasonCodes({
        map,
        attacker,
        target: token,
        attack_profile: attackProfile
      });
      return {
        valid: reasonCodes.length === 0,
        entry: buildAttackTargetEntry(map, attacker, token, attackProfile, reasonCodes)
      };
    })
    .sort((left, right) => (
      Number(left.entry.distance_feet) - Number(right.entry.distance_feet) ||
      left.entry.y - right.entry.y ||
      left.entry.x - right.entry.x ||
      String(left.entry.token_id).localeCompare(String(right.entry.token_id))
    ));

  return {
    attack_profile: attackProfile,
    valid_targets: evaluated.filter((entry) => entry.valid).map((entry) => entry.entry),
    invalid_targets: evaluated.filter((entry) => !entry.valid).map((entry) => entry.entry)
  };
}

function getValidAttackTargets(options) {
  return inspectAttackTargets(options).valid_targets;
}

module.exports = {
  buildAttackProfile,
  isTargetValidForAttack,
  getValidAttackTargets,
  inspectAttackTargets
};
