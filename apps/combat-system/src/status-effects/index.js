"use strict";

const {
  STATUS_EFFECT_TYPES,
  TICK_TIMING,
  STACKING_MODES,
  createStatusEffect
} = require("./status-effect-model");
const {
  addEffect,
  removeEffect,
  updateEffectDuration,
  processTurnEffectsByTiming,
  processStartOfTurnEffects,
  processEndOfTurnEffects,
  processStatusDurationTick
} = require("./status-effect-helpers");

module.exports = {
  STATUS_EFFECT_TYPES,
  TICK_TIMING,
  STACKING_MODES,
  createStatusEffect,
  addEffect,
  removeEffect,
  updateEffectDuration,
  processTurnEffectsByTiming,
  processStartOfTurnEffects,
  processEndOfTurnEffects,
  processStatusDurationTick
};
