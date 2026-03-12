"use strict";

const { ROLL_TYPES, resolveDiceRoll } = require("./resolve-dice-roll");

function rollAttackRoll(input) {
  const data = input || {};
  return resolveDiceRoll({
    roll_type: ROLL_TYPES.ATTACK_ROLL,
    formula: "1d20",
    modifier: data.modifier || 0,
    advantage: data.advantage,
    disadvantage: data.disadvantage,
    rng: data.rng
  });
}

function rollSavingThrow(input) {
  const data = input || {};
  return resolveDiceRoll({
    roll_type: ROLL_TYPES.SAVING_THROW,
    formula: "1d20",
    modifier: data.modifier || 0,
    advantage: data.advantage,
    disadvantage: data.disadvantage,
    rng: data.rng
  });
}

function rollAbilityCheck(input) {
  const data = input || {};
  return resolveDiceRoll({
    roll_type: ROLL_TYPES.ABILITY_CHECK,
    formula: "1d20",
    modifier: data.modifier || 0,
    advantage: data.advantage,
    disadvantage: data.disadvantage,
    rng: data.rng
  });
}

function rollSkillCheck(input) {
  const data = input || {};
  return resolveDiceRoll({
    roll_type: ROLL_TYPES.SKILL_CHECK,
    formula: "1d20",
    modifier: data.modifier || 0,
    advantage: data.advantage,
    disadvantage: data.disadvantage,
    rng: data.rng
  });
}

function rollDamageRoll(input) {
  const data = input || {};
  return resolveDiceRoll({
    roll_type: ROLL_TYPES.DAMAGE_ROLL,
    formula: data.formula || "1d6",
    modifier: data.modifier || 0,
    rng: data.rng
  });
}

function rollHealingRoll(input) {
  const data = input || {};
  return resolveDiceRoll({
    roll_type: ROLL_TYPES.HEALING_ROLL,
    formula: data.formula || "1d8",
    modifier: data.modifier || 0,
    rng: data.rng
  });
}

function rollDeathSave(input) {
  const data = input || {};
  return resolveDiceRoll({
    roll_type: ROLL_TYPES.DEATH_SAVE,
    formula: "1d20",
    modifier: data.modifier || 0,
    advantage: data.advantage,
    disadvantage: data.disadvantage,
    rng: data.rng
  });
}

module.exports = {
  rollAttackRoll,
  rollSavingThrow,
  rollAbilityCheck,
  rollSkillCheck,
  rollDamageRoll,
  rollHealingRoll,
  rollDeathSave
};
