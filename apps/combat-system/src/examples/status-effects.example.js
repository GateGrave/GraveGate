"use strict";

const { CombatRegistry } = require("../registry/combat-registry");
const {
  STATUS_EFFECT_TYPES,
  TICK_TIMING,
  STACKING_MODES,
  createStatusEffect,
  addEffect,
  processStartOfTurnEffects,
  processEndOfTurnEffects,
  removeEffect
} = require("../status-effects");

function runStatusEffectsExample() {
  const registry = new CombatRegistry();
  const combat = registry.createCombat({
    combat_id: "combat-status-demo",
    participants: [
      {
        participant_id: "player-001",
        movement_speed: 30,
        movement_remaining: 30
      }
    ]
  });

  const poisoned = createStatusEffect({
    type: STATUS_EFFECT_TYPES.POISONED,
    source: { participant_id: "enemy-001", event_id: "evt-101" },
    target: { participant_id: "player-001" },
    duration: { remaining_turns: 2, max_turns: 2 },
    tick_timing: TICK_TIMING.END_OF_TURN,
    stacking_rules: { mode: STACKING_MODES.REFRESH, max_stacks: 1 },
    modifiers: { attack_penalty: -2 }
  });

  const restrained = createStatusEffect({
    type: STATUS_EFFECT_TYPES.RESTRAINED,
    source: { participant_id: "enemy-002", event_id: "evt-102" },
    target: { participant_id: "player-001" },
    duration: { remaining_turns: 1, max_turns: 1 },
    tick_timing: TICK_TIMING.START_OF_TURN,
    stacking_rules: { mode: STACKING_MODES.IGNORE, max_stacks: 1 },
    modifiers: { movement_speed_override: 0 }
  });

  const afterPoison = addEffect(combat, poisoned);
  const afterRestrained = addEffect(afterPoison.next_state, restrained);
  const startTick = processStartOfTurnEffects(afterRestrained.next_state, "player-001");
  const endTick = processEndOfTurnEffects(startTick.next_state, "player-001");

  const remainingEffectId = endTick.next_state.active_effects[0]?.effect_id || null;
  const afterRemove = remainingEffectId
    ? removeEffect(endTick.next_state, remainingEffectId)
    : {
        next_state: endTick.next_state,
        emitted_events: []
      };

  return {
    added_effects: afterRestrained.next_state.active_effects.map((e) => ({
      effect_id: e.effect_id,
      type: e.type,
      remaining_turns: e.duration.remaining_turns
    })),
    start_of_turn_processed: startTick.processed_effects,
    start_of_turn_expired: startTick.expired_effects.map((e) => e.type),
    end_of_turn_processed: endTick.processed_effects,
    end_of_turn_expired: endTick.expired_effects.map((e) => e.type),
    final_effect_count: afterRemove.next_state.active_effects.length
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runStatusEffectsExample(), null, 2));
}

module.exports = {
  runStatusEffectsExample
};
