"use strict";

const { validationSuccess, validationFailure } = require("./validation-result");
const {
  ACTION_TYPES,
  findParticipant,
  gridDistanceFeet,
  validateTargetExists,
  validateTargetInRange,
  validateTargetValidForAction,
  validateTileReachable,
  validateActionAvailability,
  validateLineOfEffect
} = require("./validation-helpers");
const { validateCombatAction } = require("./validate-combat-action");

module.exports = {
  ACTION_TYPES,
  validationSuccess,
  validationFailure,
  findParticipant,
  gridDistanceFeet,
  validateTargetExists,
  validateTargetInRange,
  validateTargetValidForAction,
  validateTileReachable,
  validateActionAvailability,
  validateLineOfEffect,
  validateCombatAction
};
