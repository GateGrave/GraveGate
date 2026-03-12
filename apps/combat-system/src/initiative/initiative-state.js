"use strict";

const { rollInitiativeForAllParticipants } = require("./roll-initiative");
const { sortParticipantsIntoInitiativeOrder } = require("./sort-initiative-order");

/**
 * Roll and set initiative state on a combat instance.
 * Also initializes current_turn_index and round_number.
 * @param {object} combatState
 * @param {object} [options]
 * @param {Function} [options.rng]
 * @returns {object}
 */
function initializeInitiativeState(combatState, options) {
  const rolls = rollInitiativeForAllParticipants(combatState.participants, options);
  const initiativeOrder = sortParticipantsIntoInitiativeOrder(rolls);

  return {
    ...combatState,
    initiative_order: initiativeOrder,
    current_turn_index: 0,
    round_number: 1,
    updated_at: new Date().toISOString()
  };
}

/**
 * Advance to next turn.
 * When the end of initiative list is reached:
 * - wrap current_turn_index to 0
 * - increment round_number
 * @param {object} combatState
 * @returns {object}
 */
function advanceToNextTurn(combatState) {
  const initiativeLength = combatState.initiative_order.length;

  if (initiativeLength === 0) {
    return {
      ...combatState,
      current_turn_index: 0,
      updated_at: new Date().toISOString()
    };
  }

  let nextTurnIndex = combatState.current_turn_index + 1;
  let nextRoundNumber = combatState.round_number;

  if (nextTurnIndex >= initiativeLength) {
    nextTurnIndex = 0;
    nextRoundNumber += 1;
  }

  return {
    ...combatState,
    current_turn_index: nextTurnIndex,
    round_number: nextRoundNumber,
    updated_at: new Date().toISOString()
  };
}

module.exports = {
  initializeInitiativeState,
  advanceToNextTurn
};
