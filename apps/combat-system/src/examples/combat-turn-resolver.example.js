"use strict";

const { CombatRegistry } = require("../registry/combat-registry");
const { createDefaultReactionRegistry, REACTION_TRIGGER_TYPES } = require("../reactions");
const { resolveCombatTurn } = require("../turn");
const { DAMAGE_TYPES } = require("../damage");

async function runCombatTurnResolverExample() {
  const registry = new CombatRegistry();
  const reactionRegistry = createDefaultReactionRegistry();

  const combat = registry.createCombat({
    combat_id: "combat-turn-resolver-demo",
    participants: [
      {
        participant_id: "hero-001",
        team_id: "heroes",
        position: { x: 2, y: 2 },
        movement_speed: 30,
        movement_remaining: 30,
        action_available: false,
        bonus_action_available: false,
        reaction_available: true,
        current_hp: 20,
        constitution_save_modifier: 2,
        concentration: {
          is_concentrating: false,
          source_spell_id: null,
          linked_effect_ids: [],
          expires_at_round: 0
        }
      },
      {
        participant_id: "enemy-001",
        team_id: "monsters",
        position: { x: 3, y: 2 },
        movement_speed: 30,
        movement_remaining: 30,
        action_available: true,
        bonus_action_available: false,
        reaction_available: true,
        current_hp: 18,
        vulnerabilities: [DAMAGE_TYPES.FIRE],
        resistances: [],
        immunities: []
      }
    ]
  });

  const turnEvent = {
    event_id: "evt-turn-001",
    event_type: "resolve_combat_turn",
    combat_id: combat.combat_id,
    timestamp: new Date().toISOString(),
    payload: {
      action_payload: {
        action_type: "attack",
        actor_participant_id: "hero-001",
        target_participant_id: "enemy-001",
        max_range_feet: 5
      },
      reaction_trigger_event: {
        event_id: "evt-trigger-opp-001",
        event_type: "combat_trigger_enemy_leaves_melee_range",
        payload: {
          moving_participant_id: "enemy-001",
          from_position: { x: 3, y: 2 },
          to_position: { x: 5, y: 2 }
        },
        trigger_type: REACTION_TRIGGER_TYPES.ENEMY_LEAVES_MELEE_RANGE
      },
      damage_request: {
        target_participant_id: "enemy-001",
        damage_type: DAMAGE_TYPES.FIRE,
        damage_formula: "2d6+3"
      },
      status_effects_to_apply: [
        {
          type: "poisoned",
          source: { participant_id: "hero-001", event_id: "evt-turn-001" },
          target: { participant_id: "enemy-001" },
          duration: { remaining_turns: 2, max_turns: 2 },
          tick_timing: "end_of_turn",
          stacking_rules: { mode: "refresh", max_stacks: 1 },
          modifiers: { attack_penalty: -2 }
        }
      ]
    }
  };

  const turnResult = await resolveCombatTurn({
    registry,
    event: turnEvent,
    options: {
      reaction_registry: reactionRegistry,
      reaction_wait_ms: 10,
      reaction_decision_provider: async ({ window }) => {
        const candidate = window.candidates[0];
        if (!candidate) {
          return { status: "declined" };
        }
        return {
          status: "used",
          reaction_type: candidate.reaction_type,
          reactor_participant_id: candidate.reactor_participant_id
        };
      }
    }
  });

  return {
    status: turnResult.status,
    phase_count: turnResult.output.phase_results.length,
    phases: turnResult.output.phase_results.map((phase) => phase.phase),
    emitted_event_types: turnResult.output.emitted_events.map((e) => e.event_type)
  };
}

if (require.main === module) {
  runCombatTurnResolverExample()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error("Combat turn resolver example failed:", error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  runCombatTurnResolverExample
};
