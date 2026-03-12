"use strict";

const { ATTACK_MODES, DISTANCE_METRICS, TOKEN_TYPES, MOVEMENT_RULES } = require("../constants");
const { getDistance } = require("../coordinates/grid");
const { hasLineOfSight } = require("./range");
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

function isTargetValidForAttack(options) {
  const map = options.map;
  const attacker = options.attacker;
  const target = options.target;
  const attackProfile = buildAttackProfile(options.attack_profile || {});

  if (!attackProfile.target_token_types.includes(target.token_type)) {
    return false;
  }

  const distanceFeet = getTokenDistanceFeet(
    attacker.position,
    target.position,
    attackProfile.metric
  );

  if (distanceFeet > attackProfile.max_range_feet) {
    return false;
  }

  if (attackProfile.requires_line_of_sight && !hasLineOfSight(map, attacker.position, target.position)) {
    return false;
  }

  return true;
}

function getValidAttackTargets(options) {
  const map = options.map;
  const attacker = options.attacker;
  const attackProfile = buildAttackProfile(options.attack_profile || {});

  return (map.tokens || [])
    .filter((token) => token.token_id !== attacker.token_id)
    .filter((token) => isTargetValidForAttack({
      map,
      attacker,
      target: token,
      attack_profile: attackProfile
    }))
    .map((token) => ({
      token_id: token.token_id,
      x: token.position.x,
      y: token.position.y,
      distance_feet: getTokenDistanceFeet(attacker.position, token.position, attackProfile.metric),
      range_band: (() => {
        const distanceFeet = getTokenDistanceFeet(attacker.position, token.position, attackProfile.metric);
        if (attackProfile.long_range_feet > attackProfile.range_feet && distanceFeet > attackProfile.range_feet) {
          return "long";
        }
        return "normal";
      })()
    }));
}

module.exports = {
  buildAttackProfile,
  isTargetValidForAttack,
  getValidAttackTargets
};
