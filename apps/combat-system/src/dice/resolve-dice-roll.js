"use strict";

const { parseDiceFormula } = require("./parse-dice-formula");
const { rollDie, rollDiceFormula } = require("./roll-dice-formula");

const ROLL_TYPES = {
  ATTACK_ROLL: "attack_roll",
  SAVING_THROW: "saving_throw",
  ABILITY_CHECK: "ability_check",
  SKILL_CHECK: "skill_check",
  DAMAGE_ROLL: "damage_roll",
  HEALING_ROLL: "healing_roll",
  DEATH_SAVE: "death_save"
};

function getAdvantageState(advantage, disadvantage) {
  if (advantage && !disadvantage) {
    return "advantage";
  }
  if (!advantage && disadvantage) {
    return "disadvantage";
  }
  return "none";
}

function isSingleD20Formula(formula) {
  const parsed = parseDiceFormula(formula);
  const diceTerms = parsed.terms.filter((term) => term.type === "dice");
  return (
    diceTerms.length === 1 &&
    diceTerms[0].count === 1 &&
    diceTerms[0].sides === 20
  );
}

function buildDeathSaveMeta(finalTotal, d20Face) {
  return {
    success: finalTotal >= 10,
    critical_success: d20Face === 20,
    critical_failure: d20Face === 1
  };
}

/**
 * Universal dice resolver.
 * @param {object} input
 * @param {string} input.roll_type
 * @param {string} [input.formula]
 * @param {number} [input.modifier]
 * @param {boolean} [input.advantage]
 * @param {boolean} [input.disadvantage]
 * @param {Function} [input.rng]
 * @returns {object}
 */
function resolveDiceRoll(input) {
  const rollType = input.roll_type;
  if (!Object.values(ROLL_TYPES).includes(rollType)) {
    throw new Error(`Unsupported roll type: ${rollType}`);
  }

  const modifier = Number(input.modifier || 0);
  const advantageState = getAdvantageState(Boolean(input.advantage), Boolean(input.disadvantage));

  const defaultFormula =
    rollType === ROLL_TYPES.DAMAGE_ROLL || rollType === ROLL_TYPES.HEALING_ROLL
      ? "1d4"
      : "1d20";

  const formula = input.formula || defaultFormula;
  const canUseAdvantage = isSingleD20Formula(formula);

  let formulaResult;
  let d20FaceForMeta = null;

  if (canUseAdvantage && advantageState !== "none") {
    const first = rollDie(20, input.rng);
    const second = rollDie(20, input.rng);
    const kept = advantageState === "advantage" ? Math.max(first, second) : Math.min(first, second);
    const dropped = advantageState === "advantage" ? Math.min(first, second) : Math.max(first, second);

    // Roll any constants from formula (for example 1d20+3).
    const parsed = parseDiceFormula(formula);
    const constantTotal = parsed.terms
      .filter((term) => term.type === "constant")
      .reduce((sum, term) => sum + term.sign * term.value, 0);

    formulaResult = {
      formula,
      parsed_terms: parsed.terms,
      raw_dice: [
        {
          term: "+1d20",
          count: 1,
          sides: 20,
          sign: 1,
          rolls: [first, second],
          kept_rolls: [kept],
          dropped_rolls: [dropped]
        }
      ],
      dice_total: kept,
      formula_constant_total: constantTotal,
      subtotal: kept + constantTotal
    };
    d20FaceForMeta = kept;
  } else {
    formulaResult = rollDiceFormula(formula, input.rng);
    const d20Entry = formulaResult.raw_dice.find((entry) => entry.sides === 20);
    d20FaceForMeta = d20Entry ? d20Entry.kept_rolls[0] : null;
  }

  const finalTotal = formulaResult.subtotal + modifier;

  const result = {
    roll_type: rollType,
    formula: formulaResult.formula,
    raw_dice: formulaResult.raw_dice,
    modifiers: {
      formula_constant: formulaResult.formula_constant_total,
      flat_modifier: modifier,
      total_modifier: formulaResult.formula_constant_total + modifier
    },
    final_total: finalTotal,
    advantage_state: canUseAdvantage ? advantageState : "none"
  };

  if (rollType === ROLL_TYPES.DEATH_SAVE) {
    result.death_save = buildDeathSaveMeta(finalTotal, d20FaceForMeta);
  }

  return result;
}

module.exports = {
  ROLL_TYPES,
  resolveDiceRoll
};
