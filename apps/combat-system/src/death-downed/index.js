"use strict";

const { LIFE_STATES, createDefaultDeathSaves } = require("./death-downed-model");
const {
  applyDownedState,
  resolveDeathSave,
  stabilizeCharacter,
  markCharacterDead
} = require("./death-downed-helpers");

module.exports = {
  LIFE_STATES,
  createDefaultDeathSaves,
  applyDownedState,
  resolveDeathSave,
  stabilizeCharacter,
  markCharacterDead
};
