"use strict";

const { CombatRegistry } = require("../registry/combat-registry");
const { createDefaultReactionRegistry, processReactionTriggerEvent } = require("../reactions");
const { processMovementEvent } = require("../resolvers/movement.resolver");
const { validateCombatAction } = require("../validation");
const { rollAttackRoll } = require("../dice");
const { applyDamageToCombatState, DAMAGE_TYPES } = require("../damage");
const { createStatusEffect, addEffect, processEndOfTurnEffects } = require("../status-effects");
const { applyDownedState, resolveDeathSave } = require("../death-downed");
const { resolveCombatTurn } = require("../turn");
const { createMockCombatants } = require("./mock-combatants");
const {
  buildMockMoveEvent,
  buildMockAttackActionPayload,
  buildMockReactionTriggerEvent,
  buildMockTurnEvent
} = require("./mock-events");

class CombatSimulationRunner {
  constructor(options) {
    this.options = options || {};
    this.registry = new CombatRegistry();
    this.reactionRegistry = createDefaultReactionRegistry();
    this.logs = [];
    this.step = 0;
  }

  log(kind, data) {
    this.step += 1;
    this.logs.push({
      step: this.step,
      kind,
      timestamp: new Date().toISOString(),
      data
    });
  }

  createCombatInstance() {
    const combat = this.registry.createCombat({
      combat_id: this.options.combat_id || `combat-sim-${Date.now()}`,
      participants: createMockCombatants()
    });
    this.log("combat_created", {
      combat_id: combat.combat_id,
      participants: combat.participants.map((p) => p.participant_id)
    });
    return combat;
  }

  async scenarioInitiativeAndTurnProgression(combat) {
    this.log("scenario_start", { scenario: "initiative_and_turn_progression" });

    const before = this.registry.getCombatById(combat.combat_id);
    const after = await this.registry.advanceTurn(combat.combat_id);

    this.log("initiative_order", {
      initiative_order: before.initiative_order,
      round_before: before.round_number,
      turn_index_before: before.current_turn_index
    });
    this.log("turn_advanced", {
      round_after: after.round_number,
      turn_index_after: after.current_turn_index
    });
  }

  async scenarioMovement(combat) {
    this.log("scenario_start", { scenario: "movement" });
    const moveEvent = buildMockMoveEvent(combat.combat_id);
    const result = await processMovementEvent({
      registry: this.registry,
      event: moveEvent
    });

    this.log("movement_result", result.output);
  }

  async scenarioAttackAndDamage(combat) {
    this.log("scenario_start", { scenario: "attack_and_damage" });

    const state = this.registry.getCombatById(combat.combat_id);
    const actionPayload = buildMockAttackActionPayload();
    const actionCheck = validateCombatAction({
      combat_state: state,
      action_payload: actionPayload
    });

    this.log("attack_validation", actionCheck);

    const attackRoll = rollAttackRoll({
      modifier: 6
    });

    const target = state.participants.find((p) => p.participant_id === actionPayload.target_participant_id);
    const hit = attackRoll.final_total >= Number(target?.armor_class || 10);

    this.log("attack_roll", {
      attack_roll: attackRoll,
      target_ac: target?.armor_class || 10,
      hit
    });

    if (hit) {
      const applied = applyDamageToCombatState({
        combat_state: state,
        target_participant_id: actionPayload.target_participant_id,
        damage_type: DAMAGE_TYPES.FIRE,
        damage_formula: "2d6+3"
      });

      await this.registry.updateCombatState(combat.combat_id, () => applied.next_state);
      this.log("damage_result", applied.damage_result);
    }
  }

  async scenarioReactions(combat) {
    this.log("scenario_start", { scenario: "reactions" });

    const reactionEvent = buildMockReactionTriggerEvent(combat.combat_id);
    const result = await processReactionTriggerEvent({
      registry: this.registry,
      reaction_registry: this.reactionRegistry,
      event: reactionEvent,
      decision_provider: async ({ window }) => {
        const first = window.candidates[0];
        if (!first) {
          return { status: "declined" };
        }
        return {
          status: "used",
          reaction_type: first.reaction_type,
          reactor_participant_id: first.reactor_participant_id
        };
      },
      wait_ms: 100
    });

    this.log("reaction_result", result.output);
  }

  async scenarioStatusEffects(combat) {
    this.log("scenario_start", { scenario: "status_effects" });

    const state = this.registry.getCombatById(combat.combat_id);
    const effect = createStatusEffect({
      type: "poisoned",
      source: { participant_id: "enemy-001" },
      target: { participant_id: "hero-001" },
      duration: { remaining_turns: 2, max_turns: 2 },
      tick_timing: "end_of_turn",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: { attack_penalty: -2 }
    });

    const added = addEffect(state, effect);
    await this.registry.updateCombatState(combat.combat_id, () => added.next_state);
    this.log("status_effect_added", added.emitted_events);

    const ticked = processEndOfTurnEffects(added.next_state, "hero-001");
    await this.registry.updateCombatState(combat.combat_id, () => ticked.next_state);
    this.log("status_effect_tick", {
      processed: ticked.processed_effects,
      expired: ticked.expired_effects
    });
  }

  async scenarioDeathSaves(combat) {
    this.log("scenario_start", { scenario: "death_saves" });

    const damaged = await this.registry.updateCombatState(combat.combat_id, (state) => {
      const nextParticipants = state.participants.map((p) =>
        p.participant_id === "enemy-001" ? { ...p, current_hp: 0 } : p
      );
      return {
        ...state,
        participants: nextParticipants
      };
    });

    const downed = applyDownedState(damaged, "enemy-001");
    await this.registry.updateCombatState(combat.combat_id, () => downed.next_state);
    this.log("downed_applied", downed.emitted_events);

    const save1 = resolveDeathSave(downed.next_state, "enemy-001", { rng: () => 0.8 });
    const save2 = resolveDeathSave(save1.next_state, "enemy-001", { rng: () => 0.8 });
    const save3 = resolveDeathSave(save2.next_state, "enemy-001", { rng: () => 0.8 });
    await this.registry.updateCombatState(combat.combat_id, () => save3.next_state);

    this.log("death_saves_resolved", {
      save1: save1.emitted_events,
      save2: save2.emitted_events,
      save3: save3.emitted_events,
      final_participant: save3.next_state.participants.find((p) => p.participant_id === "enemy-001")
    });
  }

  async scenarioFullTurnResolver(combat) {
    this.log("scenario_start", { scenario: "full_turn_resolver" });
    const turnEvent = buildMockTurnEvent(combat.combat_id);
    const result = await resolveCombatTurn({
      registry: this.registry,
      event: turnEvent,
      options: {
        reaction_registry: this.reactionRegistry,
        reaction_wait_ms: 50,
        turn_timeout_seconds: 60,
        turn_timeout_policy: "skip_turn",
        reaction_decision_provider: async ({ window }) => {
          const first = window.candidates[0];
          if (!first) {
            return { status: "declined" };
          }
          return {
            status: "used",
            reaction_type: first.reaction_type,
            reactor_participant_id: first.reactor_participant_id
          };
        }
      }
    });

    this.log("turn_resolver_result", {
      phase_results: result.output.phase_results,
      emitted_events: result.output.emitted_events
    });
  }

  async runAllScenarios() {
    const combat = this.createCombatInstance();
    await this.scenarioInitiativeAndTurnProgression(combat);
    await this.scenarioMovement(combat);
    await this.scenarioAttackAndDamage(combat);
    await this.scenarioReactions(combat);
    await this.scenarioStatusEffects(combat);
    await this.scenarioDeathSaves(combat);
    await this.scenarioFullTurnResolver(combat);

    return {
      ok: true,
      combat_id: combat.combat_id,
      logs: this.logs
    };
  }
}

module.exports = {
  CombatSimulationRunner
};
