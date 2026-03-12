"use strict";

/**
 * Parse formulas like:
 * - 1d20
 * - 2d6+3
 * - 2d6+1d4-2
 * @param {string} formula
 * @returns {object}
 */
function parseDiceFormula(formula) {
  const source = String(formula || "").replace(/\s+/g, "");
  if (!source) {
    throw new Error("Dice formula is required");
  }

  const normalized = source[0] === "+" || source[0] === "-" ? source : `+${source}`;
  const tokenRegex = /([+-])([^+-]+)/g;
  const terms = [];
  let match;

  while ((match = tokenRegex.exec(normalized)) !== null) {
    const sign = match[1] === "-" ? -1 : 1;
    const body = match[2];
    const diceMatch = /^(\d+)d(\d+)$/i.exec(body);

    if (diceMatch) {
      const count = Number(diceMatch[1]);
      const sides = Number(diceMatch[2]);

      if (count < 1 || sides < 2) {
        throw new Error(`Invalid dice term: ${body}`);
      }

      terms.push({
        type: "dice",
        sign,
        count,
        sides
      });
      continue;
    }

    if (/^\d+$/.test(body)) {
      terms.push({
        type: "constant",
        sign,
        value: Number(body)
      });
      continue;
    }

    throw new Error(`Unsupported formula term: ${body}`);
  }

  if (terms.length === 0) {
    throw new Error(`Invalid dice formula: ${formula}`);
  }

  return {
    source,
    terms
  };
}

module.exports = {
  parseDiceFormula
};
