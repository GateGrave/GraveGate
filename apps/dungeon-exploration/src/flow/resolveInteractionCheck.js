"use strict";

function toSafeNumber(value, fallback) {
  if (!Number.isFinite(Number(value))) {
    return fallback;
  }
  return Number(value);
}

function clampD20(value) {
  const asInt = Math.floor(Number(value));
  if (!Number.isFinite(asInt)) return null;
  if (asInt < 1) return 1;
  if (asInt > 20) return 20;
  return asInt;
}

const SKILL_TO_ABILITY = {
  athletics: "strength",
  acrobatics: "dexterity",
  sleight_of_hand: "dexterity",
  stealth: "dexterity",
  arcana: "intelligence",
  history: "intelligence",
  investigation: "intelligence",
  nature: "intelligence",
  religion: "intelligence",
  animal_handling: "wisdom",
  insight: "wisdom",
  medicine: "wisdom",
  perception: "wisdom",
  survival: "wisdom",
  deception: "charisma",
  intimidation: "charisma",
  performance: "charisma",
  persuasion: "charisma"
};

const TOOL_TO_ABILITY = {
  thieves_tools: "dexterity",
  herbalism_kit: "wisdom"
};

function computeAbilityModifier(score) {
  if (!Number.isFinite(Number(score))) {
    return 0;
  }
  return Math.floor((Number(score) - 10) / 2);
}

function getAbilityScore(characterProfile, abilityId) {
  const key = String(abilityId || "").trim().toLowerCase();
  const stats = characterProfile && characterProfile.stats && typeof characterProfile.stats === "object"
    ? characterProfile.stats
    : {};
  return Number.isFinite(Number(stats[key])) ? Number(stats[key]) : 10;
}

function resolveSkillModifier(characterProfile, skillId) {
  const normalizedSkillId = String(skillId || "").trim().toLowerCase();
  const skills = characterProfile && characterProfile.skills && typeof characterProfile.skills === "object"
    ? characterProfile.skills
    : {};
  const explicit = skills[normalizedSkillId];
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return explicit;
  }
  if (explicit && typeof explicit === "object" && typeof explicit.modifier === "number" && Number.isFinite(explicit.modifier)) {
    return explicit.modifier;
  }
  const proficiencyBonus = toSafeNumber(characterProfile && characterProfile.proficiency_bonus, 2);
  const isProficient = explicit === true
    || (explicit && typeof explicit === "object" && (explicit.proficient === true || explicit.trained === true))
    || (typeof explicit === "number" && explicit > 0);
  const abilityId = SKILL_TO_ABILITY[normalizedSkillId] || "intelligence";
  const abilityModifier = computeAbilityModifier(getAbilityScore(characterProfile, abilityId));
  return abilityModifier + (isProficient ? proficiencyBonus : 0);
}

function resolveToolModifier(characterProfile, toolId) {
  const normalizedToolId = String(toolId || "").trim().toLowerCase();
  const tools = Array.isArray(characterProfile && characterProfile.tools) ? characterProfile.tools : [];
  const proficiencyBonus = toSafeNumber(characterProfile && characterProfile.proficiency_bonus, 2);
  const abilityId = TOOL_TO_ABILITY[normalizedToolId] || "dexterity";
  const abilityModifier = computeAbilityModifier(getAbilityScore(characterProfile, abilityId));
  const isProficient = tools.includes(normalizedToolId);
  return abilityModifier + (isProficient ? proficiencyBonus : 0);
}

function resolveInteractionCheck(input) {
  const data = input || {};
  const checkType = String(data.check_type || "").trim().toLowerCase();
  const targetId = String(data.target_id || "").trim().toLowerCase();
  const difficultyClass = toSafeNumber(data.difficulty_class, NaN);
  const characterProfile = data.character_profile && typeof data.character_profile === "object"
    ? data.character_profile
    : {};
  if (!targetId) {
    return { ok: false, error: "target_id is required" };
  }
  if (!Number.isFinite(difficultyClass)) {
    return { ok: false, error: "difficulty_class must be a number" };
  }
  let modifier = 0;
  let abilityId = null;
  if (checkType === "skill") {
    modifier = resolveSkillModifier(characterProfile, targetId);
    abilityId = SKILL_TO_ABILITY[targetId] || "intelligence";
  } else if (checkType === "tool") {
    modifier = resolveToolModifier(characterProfile, targetId);
    abilityId = TOOL_TO_ABILITY[targetId] || "dexterity";
  } else if (checkType === "ability") {
    abilityId = targetId;
    modifier = computeAbilityModifier(getAbilityScore(characterProfile, targetId));
  } else {
    return { ok: false, error: "unsupported check_type" };
  }

  let d20Roll = null;
  if (data.forced_roll !== undefined) {
    d20Roll = clampD20(data.forced_roll);
  } else if (typeof data.roll_fn === "function") {
    d20Roll = clampD20(data.roll_fn());
  } else {
    d20Roll = clampD20(Math.floor(Math.random() * 20) + 1);
  }
  if (!Number.isFinite(d20Roll)) {
    return { ok: false, error: "failed to resolve a valid d20 roll" };
  }

  const total = d20Roll + modifier;
  return {
    ok: true,
    payload: {
      check_type: checkType,
      target_id: targetId,
      ability_id: abilityId,
      dc: difficultyClass,
      roll: {
        d20_roll: d20Roll,
        modifier,
        total
      },
      passed: total >= difficultyClass
    }
  };
}

module.exports = {
  resolveInteractionCheck,
  resolveSkillModifier,
  resolveToolModifier
};
