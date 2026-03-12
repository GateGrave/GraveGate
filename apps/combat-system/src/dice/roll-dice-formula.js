"use strict";

const { parseDiceFormula } = require("./parse-dice-formula");

function rollDie(sides, rng) {
  const randomFn = typeof rng === "function" ? rng : Math.random;
  return Math.floor(randomFn() * sides) + 1;
}

/**
 * Roll a full dice formula.
 * @param {string} formula
 * @param {Function} [rng]
 * @returns {object}
 */
function rollDiceFormula(formula, rng) {
  const parsed = parseDiceFormula(formula);
  const rawDice = [];
  let diceTotal = 0;
  let constantTotal = 0;

  for (const term of parsed.terms) {
    if (term.type === "constant") {
      constantTotal += term.sign * term.value;
      continue;
    }

    const rolls = [];
    for (let i = 0; i < term.count; i += 1) {
      rolls.push(rollDie(term.sides, rng));
    }

    const termTotal = rolls.reduce((sum, value) => sum + value, 0) * term.sign;
    diceTotal += termTotal;

    rawDice.push({
      term: `${term.sign < 0 ? "-" : "+"}${term.count}d${term.sides}`,
      count: term.count,
      sides: term.sides,
      sign: term.sign,
      rolls,
      kept_rolls: [...rolls],
      dropped_rolls: []
    });
  }

  return {
    formula: parsed.source,
    parsed_terms: parsed.terms,
    raw_dice: rawDice,
    dice_total: diceTotal,
    formula_constant_total: constantTotal,
    subtotal: diceTotal + constantTotal
  };
}

module.exports = {
  rollDie,
  rollDiceFormula
};
