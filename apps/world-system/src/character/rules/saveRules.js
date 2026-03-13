"use strict";

const SAVE_ABILITIES = Object.freeze([
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma"
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAbilityId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return SAVE_ABILITIES.includes(normalized) ? normalized : null;
}

function toSafeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toSafeArray(value) {
  return Array.isArray(value) ? value.slice() : [];
}

function computeAbilityModifier(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.floor((numeric - 10) / 2);
}

function getAbilityScore(character, abilityId) {
  const key = normalizeAbilityId(abilityId);
  if (!key) {
    return 10;
  }
  const stats = toSafeObject(character && character.stats);
  const numeric = Number(stats[key]);
  return Number.isFinite(numeric) ? numeric : 10;
}

function collectSavingThrowProficiencies(character) {
  const collected = new Set();
  const push = (value) => {
    const key = normalizeAbilityId(value);
    if (key) {
      collected.add(key);
    }
  };

  const applied = toSafeObject(character && character.applied_proficiencies);
  toSafeArray(applied.saving_throws).forEach(push);

  const classSelection = toSafeObject(character && character.class_selection);
  toSafeArray(classSelection.saving_throws).forEach(push);

  const savingThrows = toSafeObject(character && character.saving_throws);
  Object.keys(savingThrows).forEach((key) => {
    const normalizedKey = normalizeAbilityId(key);
    const value = savingThrows[key];
    if (!normalizedKey) {
      return;
    }
    if (value === true) {
      collected.add(normalizedKey);
      return;
    }
    if (value && typeof value === "object" && value.proficient === true) {
      collected.add(normalizedKey);
    }
  });

  return Array.from(collected.values());
}

function deriveSavingThrowState(character) {
  const safeCharacter = character && typeof character === "object" ? character : {};
  const proficiencyBonus = Number.isFinite(Number(safeCharacter.proficiency_bonus))
    ? Number(safeCharacter.proficiency_bonus)
    : 2;
  const itemEffects = toSafeObject(safeCharacter.item_effects);
  const savingThrowBonus = Number.isFinite(Number(itemEffects.saving_throw_bonus))
    ? Number(itemEffects.saving_throw_bonus)
    : 0;
  const proficientSaves = new Set(collectSavingThrowProficiencies(safeCharacter));
  const savingThrows = {};
  const explicitFields = {};

  for (let index = 0; index < SAVE_ABILITIES.length; index += 1) {
    const abilityId = SAVE_ABILITIES[index];
    const baseModifier = computeAbilityModifier(getAbilityScore(safeCharacter, abilityId));
    const modifier = baseModifier + (proficientSaves.has(abilityId) ? proficiencyBonus : 0) + savingThrowBonus;
    savingThrows[abilityId] = modifier;
    explicitFields[abilityId + "_save_modifier"] = modifier;
  }

  return {
    saving_throws: savingThrows,
    save_proficiencies: Array.from(proficientSaves.values()),
    explicit_modifier_fields: explicitFields
  };
}

function applyDerivedSavingThrowState(character) {
  const safeCharacter = character && typeof character === "object" ? clone(character) : {};
  const derived = deriveSavingThrowState(safeCharacter);
  const nextAppliedProficiencies = toSafeObject(safeCharacter.applied_proficiencies);
  nextAppliedProficiencies.saving_throws = derived.save_proficiencies.slice();
  return Object.assign({}, safeCharacter, derived.explicit_modifier_fields, {
    saving_throws: derived.saving_throws,
    applied_proficiencies: nextAppliedProficiencies
  });
}

module.exports = {
  SAVE_ABILITIES,
  normalizeAbilityId,
  computeAbilityModifier,
  collectSavingThrowProficiencies,
  deriveSavingThrowState,
  applyDerivedSavingThrowState
};
