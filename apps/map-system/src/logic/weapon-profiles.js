"use strict";

const weaponProfileData = require("../../data/attacks/weapon-profiles.json");
const { ATTACK_MODES, MOVEMENT_RULES } = require("../constants");

function listWeaponProfiles() {
  return Array.isArray(weaponProfileData.weapons)
    ? weaponProfileData.weapons.map((entry) => ({ ...entry }))
    : [];
}

function findWeaponProfile(weaponProfileId) {
  return listWeaponProfiles().find((entry) => (
    String(entry.weapon_profile_id) === String(weaponProfileId || "")
  )) || null;
}

function getDefaultRangeFeet(mode) {
  return mode === ATTACK_MODES.MELEE
    ? MOVEMENT_RULES.TILE_FEET
    : 0;
}

function resolveWeaponProfile(options) {
  const explicitOverrides = Object.entries(options || {}).reduce((accumulator, [key, value]) => {
    if (value !== undefined) {
      accumulator[key] = value;
    }
    return accumulator;
  }, {});
  const providedProfile = options.weapon_profile || null;
  const storedProfile = options.weapon_profile_id
    ? findWeaponProfile(options.weapon_profile_id)
    : null;
  const profile = {
    ...(storedProfile || {}),
    ...(providedProfile || {}),
    ...explicitOverrides
  };

  const mode = profile.mode || ATTACK_MODES.MELEE;
  const reachFeet = typeof profile.reach_feet === "number"
    ? profile.reach_feet
    : (mode === ATTACK_MODES.MELEE ? MOVEMENT_RULES.TILE_FEET : 0);
  const normalRangeFeet = typeof profile.range_feet === "number"
    ? profile.range_feet
    : (mode === ATTACK_MODES.MELEE ? reachFeet : getDefaultRangeFeet(mode));
  const longRangeFeet = typeof profile.long_range_feet === "number"
    ? profile.long_range_feet
    : 0;

  return {
    weapon_profile_id: profile.weapon_profile_id || "",
    name: profile.name || "",
    category: profile.category || "",
    mode,
    reach_feet: reachFeet,
    range_feet: normalRangeFeet,
    long_range_feet: longRangeFeet,
    max_range_feet: Math.max(normalRangeFeet, longRangeFeet),
    requires_line_of_sight: profile.requires_line_of_sight !== false,
    is_reach_weapon: mode === ATTACK_MODES.MELEE && reachFeet > MOVEMENT_RULES.TILE_FEET
  };
}

module.exports = {
  listWeaponProfiles,
  findWeaponProfile,
  resolveWeaponProfile
};
