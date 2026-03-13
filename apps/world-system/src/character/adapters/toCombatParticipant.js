"use strict";

function toNumberOrDefault(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function resolveSaveModifier(character, abilityId) {
  const explicit = character && typeof character === "object"
    ? character[abilityId + "_save_modifier"]
    : undefined;
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return explicit;
  }
  const savingThrows = character && character.saving_throws && typeof character.saving_throws === "object"
    ? character.saving_throws
    : {};
  const fallback = savingThrows[abilityId];
  return typeof fallback === "number" && Number.isFinite(fallback) ? fallback : null;
}

function toObjectOrDefault(value, fallback) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return fallback;
}

function toArrayOrDefault(value, fallback) {
  return Array.isArray(value) ? value.slice() : fallback;
}

function toStringOrNull(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function buildPosition(inputPosition, characterPosition) {
  if (inputPosition && typeof inputPosition.x === "number" && typeof inputPosition.y === "number") {
    return { x: inputPosition.x, y: inputPosition.y };
  }

  if (
    characterPosition &&
    typeof characterPosition.x === "number" &&
    typeof characterPosition.y === "number"
  ) {
    return { x: characterPosition.x, y: characterPosition.y };
  }

  return { x: 0, y: 0 };
}

function toCombatParticipant(input) {
  if (!input || typeof input !== "object") {
    return {
      ok: false,
      event_type: "combat_participant_conversion_failed",
      payload: { participant: null },
      error: "input object is required"
    };
  }

  const character = input.character;
  if (!character || typeof character !== "object") {
    return {
      ok: false,
      event_type: "combat_participant_conversion_failed",
      payload: { participant: null },
      error: "character object is required"
    };
  }

  if (!character.character_id) {
    return {
      ok: false,
      event_type: "combat_participant_conversion_failed",
      payload: { participant: null },
      error: "character.character_id is required"
    };
  }

  const hpSummary = character.hp_summary && typeof character.hp_summary === "object"
    ? character.hp_summary
    : {};

  const itemEffects = toObjectOrDefault(character.item_effects, {});
  const armorClassBonus = toNumberOrDefault(itemEffects.armor_class_bonus, 0);
  const attackBonus = toNumberOrDefault(itemEffects.attack_bonus, 0);
  const speedBonus = toNumberOrDefault(itemEffects.speed_bonus, 0);
  const spellSaveDcBonus = toNumberOrDefault(itemEffects.spell_save_dc_bonus, 0);
  const spellAttackBonus = toNumberOrDefault(itemEffects.spell_attack_bonus, 0);
  const damageReduction = toNumberOrDefault(itemEffects.damage_reduction, 0);
  const effectResistances = toArrayOrDefault(itemEffects.resistances, []);
  const effectImmunities = toArrayOrDefault(itemEffects.immunities, []);
  const effectVulnerabilities = toArrayOrDefault(itemEffects.vulnerabilities, []);
  const damageReductionTypes = toArrayOrDefault(itemEffects.damage_reduction_types, []);
  const equippedProfiles = toObjectOrDefault(character.equipped_item_profiles, {});
  const weaponProfile = toObjectOrDefault(equippedProfiles.main_hand, null);
  const weaponMetadata = toObjectOrDefault(weaponProfile && weaponProfile.weapon, {});

  const participant = {
    participant_id: character.character_id,
    name: character.name || "Unknown Character",
    team: input.team || character.team || "team_a",
    armor_class: toNumberOrDefault(character.effective_armor_class, toNumberOrDefault(character.armor_class, 10) + armorClassBonus),
    current_hp: toNumberOrDefault(character.current_hitpoints, toNumberOrDefault(hpSummary.current, 10)),
    max_hp: toNumberOrDefault(character.effective_hitpoint_max, toNumberOrDefault(character.hitpoint_max, toNumberOrDefault(hpSummary.max, 10))),
    temporary_hitpoints: toNumberOrDefault(character.temporary_hitpoints, toNumberOrDefault(hpSummary.temporary, 0)),
    attack_bonus: toNumberOrDefault(input.attack_bonus, toNumberOrDefault(character.attack_bonus, 0)) + attackBonus,
    initiative_modifier: toNumberOrDefault(
      character.initiative_modifier,
      toNumberOrDefault(character.initiative, 0)
    ),
    damage: toNumberOrDefault(input.damage, toNumberOrDefault(character.damage, 1)),
    position: buildPosition(input.position, character.position),
    movement_speed: toNumberOrDefault(character.effective_speed, toNumberOrDefault(character.speed, 30) + speedBonus),
    stats: toObjectOrDefault(character.stats, {}),
    feats: toArrayOrDefault(character.feats, []),
    feat_flags: toObjectOrDefault(character.metadata && character.metadata.feat_flags, {}),
    spellbook: toObjectOrDefault(character.spellbook, null),
    spellcasting_ability: character.spellcasting_ability || null,
    spellsave_dc: (() => {
      const base = toNumberOrDefault(character.spellsave_dc, null);
      return base === null ? null : base + spellSaveDcBonus;
    })(),
    spell_attack_bonus: (() => {
      const base = toNumberOrDefault(character.spell_attack_bonus, null);
      return base === null ? null : base + spellAttackBonus;
    })(),
    proficiency_bonus: toNumberOrDefault(character.proficiency_bonus, null),
    strength_save_modifier: resolveSaveModifier(character, "strength"),
    dexterity_save_modifier: resolveSaveModifier(character, "dexterity"),
    constitution_save_modifier: resolveSaveModifier(character, "constitution"),
    intelligence_save_modifier: resolveSaveModifier(character, "intelligence"),
    wisdom_save_modifier: resolveSaveModifier(character, "wisdom"),
    charisma_save_modifier: resolveSaveModifier(character, "charisma"),
    vulnerabilities: Array.from(new Set(toArrayOrDefault(character.vulnerabilities, []).concat(effectVulnerabilities))),
    resistances: Array.from(new Set(toArrayOrDefault(character.resistances, []).concat(effectResistances))),
    immunities: Array.from(new Set(toArrayOrDefault(character.immunities, []).concat(effectImmunities))),
    damage_reduction: damageReduction,
    damage_reduction_types: damageReductionTypes,
    magical_on_hit_effects: toArrayOrDefault(itemEffects.on_hit_damage_effects, []),
    magical_reactive_effects: toArrayOrDefault(itemEffects.reactive_damage_effects, []),
    damage_formula: toStringOrNull(weaponMetadata.damage_dice) || toStringOrNull(character.damage_formula),
    damage_type: toStringOrNull(weaponMetadata.damage_type) || toStringOrNull(character.damage_type),
    equipped_loadout: equippedProfiles,
    readiness: {
      race_id: character.race_id || character.race || null,
      class_id: character.class_id || character.class || null,
      armor_profile: toObjectOrDefault(
        character.equipped_item_profiles && character.equipped_item_profiles.body,
        null
      ),
      shield_profile: toObjectOrDefault(
        character.equipped_item_profiles && character.equipped_item_profiles.off_hand,
        null
      ),
      weapon_profile: weaponProfile
    }
  };

  return {
    ok: true,
    event_type: "combat_participant_converted",
    payload: { participant },
    error: null
  };
}

module.exports = {
  toCombatParticipant
};
