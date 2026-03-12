"use strict";

const STATUS_EFFECT_TYPES = {
  PRONE: "prone",
  GRAPPLED: "grappled",
  STUNNED: "stunned",
  RESTRAINED: "restrained",
  POISONED: "poisoned",
  INVISIBLE: "invisible"
};

const TICK_TIMING = {
  NONE: "none",
  START_OF_TURN: "start_of_turn",
  END_OF_TURN: "end_of_turn",
  BOTH: "both"
};

const STACKING_MODES = {
  REFRESH: "refresh",
  STACK: "stack",
  IGNORE: "ignore"
};

function createStatusEffect(input) {
  const now = new Date().toISOString();

  return {
    effect_id: input.effect_id || `effect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: input.type,
    source: input.source || {
      participant_id: null,
      event_id: null
    },
    target: input.target || {
      participant_id: null
    },
    duration: {
      remaining_turns: Number(input.duration?.remaining_turns ?? 1),
      max_turns: Number(input.duration?.max_turns ?? 1)
    },
    tick_timing: input.tick_timing || TICK_TIMING.NONE,
    stacking_rules: {
      mode: input.stacking_rules?.mode || STACKING_MODES.REFRESH,
      max_stacks: Number(input.stacking_rules?.max_stacks ?? 1)
    },
    modifiers: input.modifiers || {},
    stacks: Number(input.stacks ?? 1),
    created_at: now,
    updated_at: now
  };
}

module.exports = {
  STATUS_EFFECT_TYPES,
  TICK_TIMING,
  STACKING_MODES,
  createStatusEffect
};
