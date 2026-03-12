"use strict";

const { DAMAGE_TYPES } = require("../damage");
const { REACTION_TRIGGER_TYPES } = require("../reactions");

function buildMockMoveEvent(combatId) {
  return {
    event_id: `evt-move-${Date.now()}`,
    event_type: "movement_requested",
    combat_id: combatId,
    timestamp: new Date().toISOString(),
    payload: {
      participant_id: "hero-001",
      path: [
        { x: 3, y: 2 },
        { x: 4, y: 2 }
      ]
    }
  };
}

function buildMockAttackActionPayload() {
  return {
    action_type: "attack",
    actor_participant_id: "hero-001",
    target_participant_id: "enemy-001",
    max_range_feet: 5
  };
}

function buildMockReactionTriggerEvent(combatId) {
  return {
    event_id: `evt-reaction-${Date.now()}`,
    event_type: "combat_trigger_enemy_leaves_melee_range",
    combat_id: combatId,
    timestamp: new Date().toISOString(),
    payload: {
      moving_participant_id: "enemy-001",
      from_position: { x: 4, y: 2 },
      to_position: { x: 6, y: 2 }
    },
    trigger_type: REACTION_TRIGGER_TYPES.ENEMY_LEAVES_MELEE_RANGE
  };
}

function buildMockTurnEvent(combatId) {
  return {
    event_id: `evt-turn-${Date.now()}`,
    event_type: "resolve_combat_turn",
    combat_id: combatId,
    timestamp: new Date().toISOString(),
    payload: {
      action_payload: buildMockAttackActionPayload(),
      damage_request: {
        target_participant_id: "enemy-001",
        damage_type: DAMAGE_TYPES.FIRE,
        damage_formula: "2d6+3"
      },
      status_effects_to_apply: [
        {
          type: "poisoned",
          source: { participant_id: "hero-001" },
          target: { participant_id: "enemy-001" },
          duration: { remaining_turns: 2, max_turns: 2 },
          tick_timing: "end_of_turn",
          stacking_rules: { mode: "refresh", max_stacks: 1 },
          modifiers: { attack_penalty: -2 }
        }
      ]
    }
  };
}

module.exports = {
  buildMockMoveEvent,
  buildMockAttackActionPayload,
  buildMockReactionTriggerEvent,
  buildMockTurnEvent
};
