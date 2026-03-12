"use strict";

/**
 * Build a normalized damage profile from participant/character data.
 * Character data supports:
 * - vulnerabilities
 * - resistances
 * - immunities
 * @param {object} target
 * @returns {object}
 */
function getCharacterDamageProfile(target) {
  const vulnerabilities = Array.isArray(target.vulnerabilities)
    ? [...target.vulnerabilities]
    : [];
  const resistances = Array.isArray(target.resistances)
    ? [...target.resistances]
    : [];
  const immunities = Array.isArray(target.immunities)
    ? [...target.immunities]
    : [];

  return {
    vulnerabilities,
    resistances,
    immunities
  };
}

module.exports = {
  getCharacterDamageProfile
};
