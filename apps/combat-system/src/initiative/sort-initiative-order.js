"use strict";

/**
 * Sort initiative results into combat turn order.
 * Highest initiative_total goes first.
 * Tie-breakers:
 * 1) higher initiative_modifier
 * 2) higher d20_roll
 * 3) participant_id alphabetical (deterministic fallback)
 * @param {object[]} initiativeRolls
 * @returns {object[]}
 */
function sortParticipantsIntoInitiativeOrder(initiativeRolls) {
  const rolls = Array.isArray(initiativeRolls) ? [...initiativeRolls] : [];

  rolls.sort((a, b) => {
    if (b.initiative_total !== a.initiative_total) {
      return b.initiative_total - a.initiative_total;
    }

    if (b.initiative_modifier !== a.initiative_modifier) {
      return b.initiative_modifier - a.initiative_modifier;
    }

    if (b.d20_roll !== a.d20_roll) {
      return b.d20_roll - a.d20_roll;
    }

    return String(a.participant_id).localeCompare(String(b.participant_id));
  });

  return rolls;
}

module.exports = {
  sortParticipantsIntoInitiativeOrder
};
