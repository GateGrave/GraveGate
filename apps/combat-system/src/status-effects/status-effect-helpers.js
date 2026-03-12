"use strict";

const { TICK_TIMING, STACKING_MODES } = require("./status-effect-model");

function cloneEffects(state) {
  return Array.isArray(state.active_effects) ? [...state.active_effects] : [];
}

function withUpdatedState(state, activeEffects) {
  return {
    ...state,
    active_effects: activeEffects,
    updated_at: new Date().toISOString()
  };
}

function findMatchingEffect(activeEffects, effect) {
  return activeEffects.find(
    (existing) =>
      existing.type === effect.type &&
      existing.target?.participant_id === effect.target?.participant_id
  ) || null;
}

function addEffect(combatState, effect) {
  const activeEffects = cloneEffects(combatState);
  const matching = findMatchingEffect(activeEffects, effect);

  if (!matching) {
    activeEffects.push(effect);
    return {
      ok: true,
      action: "add_effect",
      result: "added",
      effect,
      next_state: withUpdatedState(combatState, activeEffects),
      emitted_events: [
        {
          event_type: "status_effect_added",
          timestamp: new Date().toISOString(),
          payload: {
            effect_id: effect.effect_id,
            type: effect.type,
            target: effect.target
          }
        }
      ]
    };
  }

  const mode = matching.stacking_rules?.mode || STACKING_MODES.REFRESH;
  const maxStacks = Number(matching.stacking_rules?.max_stacks ?? 1);

  if (mode === STACKING_MODES.IGNORE) {
    return {
      ok: true,
      action: "add_effect",
      result: "ignored_existing",
      effect: matching,
      next_state: combatState,
      emitted_events: []
    };
  }

  const index = activeEffects.findIndex((item) => item.effect_id === matching.effect_id);
  let next = { ...matching, updated_at: new Date().toISOString() };

  if (mode === STACKING_MODES.STACK) {
    next.stacks = Math.min(maxStacks, Number(matching.stacks || 1) + 1);
    next.duration = {
      ...matching.duration,
      remaining_turns: Math.max(
        Number(matching.duration?.remaining_turns || 0),
        Number(effect.duration?.remaining_turns || 0)
      )
    };
  } else {
    // refresh
    next.duration = {
      ...matching.duration,
      remaining_turns: Number(effect.duration?.remaining_turns ?? matching.duration?.remaining_turns ?? 1),
      max_turns: Number(effect.duration?.max_turns ?? matching.duration?.max_turns ?? 1)
    };
    next.modifiers = effect.modifiers || matching.modifiers || {};
  }

  activeEffects[index] = next;

  return {
    ok: true,
    action: "add_effect",
    result: mode === STACKING_MODES.STACK ? "stacked" : "refreshed",
    effect: next,
    next_state: withUpdatedState(combatState, activeEffects),
    emitted_events: [
      {
        event_type: "status_effect_updated",
        timestamp: new Date().toISOString(),
        payload: {
          effect_id: next.effect_id,
          type: next.type,
          target: next.target,
          result: mode === STACKING_MODES.STACK ? "stacked" : "refreshed"
        }
      }
    ]
  };
}

function removeEffect(combatState, effectId) {
  const activeEffects = cloneEffects(combatState);
  const removed = activeEffects.find((effect) => effect.effect_id === effectId) || null;
  const filtered = activeEffects.filter((effect) => effect.effect_id !== effectId);

  return {
    ok: true,
    action: "remove_effect",
    removed_effect: removed,
    next_state: withUpdatedState(combatState, filtered),
    emitted_events: removed
      ? [
          {
            event_type: "status_effect_removed",
            timestamp: new Date().toISOString(),
            payload: {
              effect_id: removed.effect_id,
              type: removed.type,
              target: removed.target
            }
          }
        ]
      : []
  };
}

function updateEffectDuration(combatState, effectId, deltaTurns) {
  const activeEffects = cloneEffects(combatState);
  const index = activeEffects.findIndex((effect) => effect.effect_id === effectId);
  if (index === -1) {
    return {
      ok: false,
      action: "update_effect_duration",
      reason: "effect_not_found",
      next_state: combatState,
      emitted_events: []
    };
  }

  const current = activeEffects[index];
  const nextRemaining = Math.max(0, Number(current.duration?.remaining_turns || 0) + Number(deltaTurns || 0));
  activeEffects[index] = {
    ...current,
    duration: {
      ...current.duration,
      remaining_turns: nextRemaining
    },
    updated_at: new Date().toISOString()
  };

  return {
    ok: true,
    action: "update_effect_duration",
    effect: activeEffects[index],
    next_state: withUpdatedState(combatState, activeEffects),
    emitted_events: [
      {
        event_type: "status_effect_duration_updated",
        timestamp: new Date().toISOString(),
        payload: {
          effect_id: current.effect_id,
          remaining_turns: nextRemaining
        }
      }
    ]
  };
}

function timingMatches(effect, timing) {
  if (effect.tick_timing === TICK_TIMING.BOTH) {
    return true;
  }
  return effect.tick_timing === timing;
}

function processTurnEffectsByTiming(combatState, participantId, timing) {
  const activeEffects = cloneEffects(combatState);
  const processed = [];
  const expired = [];

  const next = activeEffects
    .map((effect) => {
      const isTarget = effect.target?.participant_id === participantId;
      if (!isTarget || !timingMatches(effect, timing)) {
        return effect;
      }

      const remaining = Math.max(0, Number(effect.duration?.remaining_turns || 0) - 1);
      const updated = {
        ...effect,
        duration: {
          ...effect.duration,
          remaining_turns: remaining
        },
        updated_at: new Date().toISOString()
      };

      processed.push({
        effect_id: updated.effect_id,
        type: updated.type,
        target: updated.target,
        timing,
        remaining_turns: remaining
      });

      if (remaining <= 0) {
        expired.push(updated);
      }

      return updated;
    })
    .filter((effect) => Number(effect.duration?.remaining_turns || 0) > 0);

  return {
    ok: true,
    action: "process_turn_effects",
    timing,
    participant_id: participantId,
    processed_effects: processed,
    expired_effects: expired,
    next_state: withUpdatedState(combatState, next),
    emitted_events: [
      ...processed.map((item) => ({
        event_type: "status_effect_ticked",
        timestamp: new Date().toISOString(),
        payload: item
      })),
      ...expired.map((item) => ({
        event_type: "status_effect_expired",
        timestamp: new Date().toISOString(),
        payload: {
          effect_id: item.effect_id,
          type: item.type,
          target: item.target
        }
      }))
    ]
  };
}

function processStartOfTurnEffects(combatState, participantId) {
  return processTurnEffectsByTiming(combatState, participantId, TICK_TIMING.START_OF_TURN);
}

function processEndOfTurnEffects(combatState, participantId) {
  return processTurnEffectsByTiming(combatState, participantId, TICK_TIMING.END_OF_TURN);
}

function processStatusDurationTick(combatState, participantId) {
  const activeEffects = cloneEffects(combatState);
  const processed = [];
  const expired = [];

  const next = activeEffects
    .map((effect) => {
      const isTarget = effect.target?.participant_id === participantId;
      if (!isTarget || effect.tick_timing !== TICK_TIMING.NONE) {
        return effect;
      }

      const remaining = Math.max(0, Number(effect.duration?.remaining_turns || 0) - 1);
      const updated = {
        ...effect,
        duration: {
          ...effect.duration,
          remaining_turns: remaining
        },
        updated_at: new Date().toISOString()
      };

      processed.push({
        effect_id: updated.effect_id,
        type: updated.type,
        participant_id: participantId,
        remaining_turns: remaining
      });

      if (remaining <= 0) {
        expired.push(updated);
      }

      return updated;
    })
    .filter((effect) => Number(effect.duration?.remaining_turns || 0) > 0);

  return {
    ok: true,
    action: "status_duration_tick",
    participant_id: participantId,
    processed_effects: processed,
    expired_effects: expired,
    next_state: withUpdatedState(combatState, next),
    emitted_events: [
      ...processed.map((item) => ({
        event_type: "status_duration_ticked",
        timestamp: new Date().toISOString(),
        payload: item
      })),
      ...expired.map((item) => ({
        event_type: "status_effect_expired",
        timestamp: new Date().toISOString(),
        payload: {
          effect_id: item.effect_id,
          type: item.type,
          target: item.target
        }
      }))
    ]
  };
}

module.exports = {
  addEffect,
  removeEffect,
  updateEffectDuration,
  processTurnEffectsByTiming,
  processStartOfTurnEffects,
  processEndOfTurnEffects,
  processStatusDurationTick
};
