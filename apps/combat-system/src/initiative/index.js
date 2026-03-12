"use strict";

const {
  rollD20,
  rollInitiativeForParticipant,
  rollInitiativeForAllParticipants
} = require("./roll-initiative");
const { sortParticipantsIntoInitiativeOrder } = require("./sort-initiative-order");
const { initializeInitiativeState, advanceToNextTurn } = require("./initiative-state");

module.exports = {
  rollD20,
  rollInitiativeForParticipant,
  rollInitiativeForAllParticipants,
  sortParticipantsIntoInitiativeOrder,
  initializeInitiativeState,
  advanceToNextTurn
};
