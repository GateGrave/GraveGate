"use strict";

function toNumberOrDefault(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

  const participant = {
    participant_id: character.character_id,
    name: character.name || "Unknown Character",
    team: input.team || character.team || "team_a",
    armor_class: toNumberOrDefault(character.armor_class, 10),
    current_hp: toNumberOrDefault(character.current_hitpoints, toNumberOrDefault(hpSummary.current, 10)),
    max_hp: toNumberOrDefault(character.hitpoint_max, toNumberOrDefault(hpSummary.max, 10)),
    attack_bonus: toNumberOrDefault(input.attack_bonus, toNumberOrDefault(character.attack_bonus, 0)),
    damage: toNumberOrDefault(input.damage, toNumberOrDefault(character.damage, 1)),
    position: buildPosition(input.position, character.position),
    stats: toObjectOrDefault(character.stats, {}),
    spellbook: toObjectOrDefault(character.spellbook, null),
    spellcasting_ability: character.spellcasting_ability || null,
    spellsave_dc: toNumberOrDefault(character.spellsave_dc, null),
    spell_attack_bonus: toNumberOrDefault(character.spell_attack_bonus, null),
    proficiency_bonus: toNumberOrDefault(character.proficiency_bonus, null),
    strength_save_modifier: toNumberOrDefault(character.strength_save_modifier, null),
    dexterity_save_modifier: toNumberOrDefault(character.dexterity_save_modifier, null),
    constitution_save_modifier: toNumberOrDefault(character.constitution_save_modifier, null),
    intelligence_save_modifier: toNumberOrDefault(character.intelligence_save_modifier, null),
    wisdom_save_modifier: toNumberOrDefault(character.wisdom_save_modifier, null),
    charisma_save_modifier: toNumberOrDefault(character.charisma_save_modifier, null),
    vulnerabilities: toArrayOrDefault(character.vulnerabilities, []),
    resistances: toArrayOrDefault(character.resistances, []),
    immunities: toArrayOrDefault(character.immunities, []),
    equipped_loadout: toObjectOrDefault(character.equipped_item_profiles, {}),
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
      weapon_profile: toObjectOrDefault(
        character.equipped_item_profiles && character.equipped_item_profiles.main_hand,
        null
      )
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
