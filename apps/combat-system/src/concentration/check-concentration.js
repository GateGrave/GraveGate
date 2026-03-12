"use strict";

/**
 * Check whether a participant is currently concentrating.
 * @param {object} participant
 * @returns {boolean}
 */
function isConcentrating(participant) {
  return Boolean(
    participant &&
      participant.concentration &&
      participant.concentration.is_concentrating === true
  );
}

/**
 * Concentration DC rule:
 * max(10, damage / 2)
 * @param {number} damageTaken
 * @returns {number}
 */
function getConcentrationDC(damageTaken) {
  const damage = Math.max(0, Number(damageTaken || 0));
  return Math.max(10, Math.floor(damage / 2));
}

module.exports = {
  isConcentrating,
  getConcentrationDC
};
