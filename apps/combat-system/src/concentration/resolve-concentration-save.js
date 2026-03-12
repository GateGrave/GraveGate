"use strict";

const { rollSavingThrow } = require("../dice");

/**
 * Resolve Constitution save for concentration.
 * @param {object} input
 * @param {number} input.dc
 * @param {number} input.constitution_save_modifier
 * @param {Function} [input.rng]
 * @returns {object}
 */
function resolveConcentrationSave(input) {
  const dc = Number(input.dc);
  const modifier = Number(input.constitution_save_modifier || 0);

  const rollResult = rollSavingThrow({
    modifier,
    rng: input.rng
  });

  const success = rollResult.final_total >= dc;

  return {
    save_type: "constitution_saving_throw",
    dc,
    roll: rollResult,
    success
  };
}

module.exports = {
  resolveConcentrationSave
};
