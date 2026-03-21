"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { nextTurn } = require("../flow/nextTurn");
const { performAttackAction } = require("../actions/attackAction");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createBaseCombat() {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: "combat-next-001",
    status: "active",
    round: 1,
    turn_index: 0,
    initiative_order: ["p1", "p2", "p3"],
    participants: [
      {
        participant_id: "p1",
        name: "A",
        team: "ally",
        armor_class: 10,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 4,
        reaction_available: false
      },
      {
        participant_id: "p2",
        name: "B",
        team: "enemy",
        armor_class: 10,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 4
      },
      {
        participant_id: "p3",
        name: "C",
        team: "enemy",
        armor_class: 10,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 4
      }
    ],
    conditions: [],
    event_log: []
  });

  return manager;
}

function runNextTurnTests() {
  const results = [];

  runTest("normal_turn_advancement", () => {
    const manager = createBaseCombat();
    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "combat_turn_advanced");
    assert.equal(out.payload.round, 1);
    assert.equal(out.payload.turn_index, 1);
    assert.equal(out.payload.active_participant_id, "p2");
  }, results);

  runTest("round_increment_at_end_of_order", () => {
    const manager = createBaseCombat();
    const found = manager.getCombatById("combat-next-001");
    const combat = found.payload.combat;
    combat.turn_index = 2;
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.round, 2);
    assert.equal(out.payload.turn_index, 0);
    assert.equal(out.payload.active_participant_id, "p1");
  }, results);

  runTest("skipping_defeated_participants", () => {
    const manager = createBaseCombat();
    const found = manager.getCombatById("combat-next-001");
    const combat = found.payload.combat;
    // It's p1 turn now (index 0). Defeat p2 so next should skip to p3.
    combat.participants[1].current_hp = 0;
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.turn_index, 2);
    assert.equal(out.payload.active_participant_id, "p3");
    assert.equal(out.payload.combat.event_log.length, 1);
    assert.equal(out.payload.combat.event_log[0].event_type, "turn_advanced");
  }, results);

  runTest("reaction_resets_for_new_active_participant", () => {
    const manager = createBaseCombat();
    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });

    assert.equal(out.ok, true);
    const participant = out.payload.combat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(participant.reaction_available, true);
  }, results);

  runTest("spellcasting_turn_state_resets_for_new_active_participant", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].spellcasting_turn_state = {
      bonus_action_spell_cast: true,
      action_spell_cast: true,
      action_spell_was_cantrip: false
    };
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });

    assert.equal(out.ok, true);
    const participant = out.payload.combat.participants.find((entry) => entry.participant_id === "p2");
    assert.deepEqual(participant.spellcasting_turn_state, {
      bonus_action_spell_cast: false,
      action_spell_cast: false,
      action_spell_was_cantrip: false
    });
  }, results);

  runTest("start_of_turn_condition_expires_for_active_participant", () => {
    const manager = createBaseCombat();
    const found = manager.getCombatById("combat-next-001");
    const combat = found.payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-next-001",
        condition_type: "stunned",
        target_actor_id: "p2",
        expiration_trigger: "start_of_turn",
        duration: {
          remaining_triggers: 1
        }
      }
    ];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.combat.conditions.length, 0);
  }, results);

  runTest("command_grovel_activates_on_target_turn_and_blocks_actions", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].movement_speed = 30;
    combat.conditions = [{
      condition_id: "condition-command-pending-001",
      condition_type: "command_pending",
      source_actor_id: "p1",
      target_actor_id: "p2",
      expiration_trigger: "manual",
      metadata: {
        status_hint: "command_forced_action",
        command_word: "grovel"
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });

    assert.equal(out.ok, true);
    const updatedCombat = out.payload.combat;
    const p2 = updatedCombat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(p2.movement_remaining, 0);
    assert.equal(updatedCombat.conditions.some((entry) => entry.target_actor_id === "p2" && entry.condition_type === "command_pending"), false);
    assert.equal(updatedCombat.conditions.some((entry) => entry.target_actor_id === "p2" && entry.condition_type === "command_grovel"), true);
    assert.equal(updatedCombat.conditions.some((entry) => entry.target_actor_id === "p2" && entry.condition_type === "prone"), true);
  }, results);

  runTest("command_halt_activates_on_target_turn_and_zeroes_movement", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].movement_speed = 30;
    combat.conditions = [{
      condition_id: "condition-command-pending-002",
      condition_type: "command_pending",
      source_actor_id: "p1",
      target_actor_id: "p2",
      expiration_trigger: "manual",
      metadata: {
        status_hint: "command_forced_action",
        command_word: "halt"
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });

    assert.equal(out.ok, true);
    const updatedCombat = out.payload.combat;
    const p2 = updatedCombat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(p2.movement_remaining, 0);
    assert.equal(updatedCombat.conditions.some((entry) => entry.target_actor_id === "p2" && entry.condition_type === "command_halt"), true);
  }, results);

  runTest("confusion_roll_two_blocks_actions_and_movement_for_turn", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].movement_speed = 30;
    combat.conditions = [{
      condition_id: "condition-confusion-001",
      condition_type: "confusion",
      source_actor_id: "p1",
      target_actor_id: "p2",
      expiration_trigger: "manual",
      metadata: {
        status_hint: "confusion",
        blocks_reaction: true,
        end_of_turn_save_ability: "wisdom",
        end_of_turn_save_dc: 13
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      confusion_roll_fn: () => ({ final_total: 2 })
    });

    assert.equal(out.ok, true);
    const updatedCombat = out.payload.combat;
    const p2 = updatedCombat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(p2.movement_remaining, 0);
    assert.equal(updatedCombat.conditions.some((entry) => entry.target_actor_id === "p2" && entry.condition_type === "confusion_no_action"), true);
    assert.equal(out.payload.combat.event_log[out.payload.combat.event_log.length - 1].details.confusion_turn_result.outcome, "no_action");
  }, results);

  runTest("confusion_roll_one_wanders_randomly_and_spends_movement", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 4, y: 4 };
    combat.participants[1].movement_speed = 10;
    combat.conditions = [{
      condition_id: "condition-confusion-002",
      condition_type: "confusion",
      source_actor_id: "p1",
      target_actor_id: "p2",
      expiration_trigger: "manual",
      metadata: {
        status_hint: "confusion",
        blocks_reaction: true,
        end_of_turn_save_ability: "wisdom",
        end_of_turn_save_dc: 13
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      confusion_roll_fn: () => ({ final_total: 1 })
    });

    assert.equal(out.ok, true);
    const updatedCombat = out.payload.combat;
    const p2 = updatedCombat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(p2.movement_remaining, 0);
    assert.equal(p2.position.x !== 4 || p2.position.y !== 4, true);
    assert.equal(updatedCombat.conditions.some((entry) => entry.target_actor_id === "p2" && entry.condition_type === "confusion_wandered"), true);
  }, results);

  runTest("confusion_wander_still_takes_start_of_turn_zone_effects_before_moving", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 2, y: 2 };
    combat.participants[1].movement_speed = 10;
    combat.conditions = [{
      condition_id: "condition-confusion-zone-001",
      condition_type: "confusion",
      source_actor_id: "p1",
      target_actor_id: "p2",
      expiration_trigger: "manual",
      metadata: {
        status_hint: "confusion",
        blocks_reaction: true,
        end_of_turn_save_ability: "wisdom",
        end_of_turn_save_dc: 13
      }
    }];
    combat.active_effects = [{
      effect_id: "effect-moonbeam-confusion-start-001",
      type: "spell_active_moonbeam",
      source: {
        participant_id: "p1"
      },
      target: {
        participant_id: "p1"
      },
      duration: {
        remaining_turns: 10,
        max_turns: 10
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "moonbeam",
        area_tiles: [{ x: 2, y: 2 }],
        zone_behavior: {
          on_turn_start_damage: {
            save_ability: "constitution",
            save_dc: 14,
            damage_formula: "2d10",
            damage_type: "radiant",
            save_result: "half_damage_on_success"
          }
        }
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const beforeHp = combat.participants[1].current_hp;
    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      confusion_roll_fn: () => ({ final_total: 1 }),
      saving_throw_fn: () => ({ final_total: 4 }),
      damage_rng: () => 0
    });

    assert.equal(out.ok, true);
    const updatedCombat = out.payload.combat;
    const p2 = updatedCombat.participants.find((entry) => entry.participant_id === "p2");
    const turnEvent = updatedCombat.event_log.find((entry) => entry.event_type === "turn_advanced");
    assert.equal(p2.current_hp < beforeHp, true);
    assert.equal(p2.position.x !== 2 || p2.position.y !== 2, true);
    assert.equal(turnEvent.details.active_effect_results.length, 1);
    assert.equal(turnEvent.details.confusion_turn_result.outcome, "wander_randomly");
  }, results);

  runTest("confusion_roll_seven_makes_random_adjacent_melee_attack", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 1, y: 0 };
    combat.participants[0].position = { x: 0, y: 0 };
    combat.conditions = [{
      condition_id: "condition-confusion-003",
      condition_type: "confusion",
      source_actor_id: "p1",
      target_actor_id: "p2",
      expiration_trigger: "manual",
      metadata: {
        status_hint: "confusion",
        blocks_reaction: true,
        end_of_turn_save_ability: "wisdom",
        end_of_turn_save_dc: 13
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      confusion_roll_fn: () => ({ final_total: 7 }),
      attack_roll_fn: () => 18
    });

    assert.equal(out.ok, true);
    const updatedCombat = out.payload.combat;
    const p1 = updatedCombat.participants.find((entry) => entry.participant_id === "p1");
    const p2 = updatedCombat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(p2.action_available, false);
    assert.equal(p1.current_hp < 10, true);
    assert.equal(out.payload.combat.event_log.some((entry) => entry.event_type === "attack_action" && entry.attacker_id === "p2"), true);
  }, results);

  runTest("confusion_random_melee_can_target_any_adjacent_participant_via_rng_hook", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 1, y: 1 };
    combat.participants[0].position = { x: 0, y: 1 };
    combat.participants[2].position = { x: 2, y: 1 };
    combat.participants.push({
      participant_id: "p4",
      name: "D",
      team: "enemy",
      armor_class: 10,
      current_hp: 10,
      max_hp: 10,
      attack_bonus: 2,
      damage: 4,
      position: { x: 1, y: 2 }
    });
    combat.initiative_order.push("p4");
    combat.conditions = [{
      condition_id: "condition-confusion-003b",
      condition_type: "confusion",
      source_actor_id: "p1",
      target_actor_id: "p2",
      expiration_trigger: "manual",
      metadata: {
        status_hint: "confusion",
        blocks_reaction: true,
        end_of_turn_save_ability: "wisdom",
        end_of_turn_save_dc: 13
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      confusion_roll_fn: () => ({ final_total: 7 }),
      confusion_target_rng: () => 2,
      attack_roll_fn: () => 18,
      damage_roll_fn: () => 4
    });

    assert.equal(out.ok, true);
    const updatedCombat = out.payload.combat;
    const p4 = updatedCombat.participants.find((entry) => entry.participant_id === "p4");
    const turnEvent = updatedCombat.event_log.find((entry) => entry.event_type === "turn_advanced");
    assert.equal(turnEvent.details.confusion_turn_result.target_id, "p4");
    assert.equal(p4.current_hp, 6);
  }, results);

  runTest("confusion_roll_seven_uses_deterministic_damage_hook_for_adjacent_melee_attack", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 1, y: 0 };
    combat.participants[0].position = { x: 0, y: 0 };
    combat.conditions = [{
      condition_id: "condition-confusion-004",
      condition_type: "confusion",
      source_actor_id: "p1",
      target_actor_id: "p2",
      expiration_trigger: "manual",
      metadata: {
        status_hint: "confusion",
        blocks_reaction: true,
        end_of_turn_save_ability: "wisdom",
        end_of_turn_save_dc: 13
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      confusion_roll_fn: () => ({ final_total: 7 }),
      confusion_target_rng: () => 0,
      attack_roll_fn: () => 18,
      damage_roll_fn: () => 3
    });

    assert.equal(out.ok, true);
    const updatedCombat = out.payload.combat;
    const p1 = updatedCombat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(p1.current_hp, 7);
  }, results);

  runTest("speed_reduced_applies_on_target_turn_until_source_turn", () => {
    const manager = createBaseCombat();
    const found = manager.getCombatById("combat-next-001");
    const combat = found.payload.combat;
    combat.participants[1].movement_speed = 30;
    combat.conditions = [
      {
        condition_id: "condition-next-source-001",
        condition_type: "speed_reduced",
        source_actor_id: "p1",
        target_actor_id: "p2",
        expiration_trigger: "start_of_source_turn",
        duration: {
          remaining_triggers: 1
        },
        metadata: {
          reduction_feet: 10
        }
      }
    ];
    manager.combats.set("combat-next-001", combat);

    const firstAdvance = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });

    assert.equal(firstAdvance.ok, true);
    const p2 = firstAdvance.payload.combat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(p2.movement_remaining, 20);
    assert.equal(firstAdvance.payload.combat.conditions.length, 1);

    const combatAfterFirstAdvance = manager.getCombatById("combat-next-001").payload.combat;
    combatAfterFirstAdvance.participants[2].current_hp = 0;
    manager.combats.set("combat-next-001", combatAfterFirstAdvance);

    const secondAdvance = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });

    assert.equal(secondAdvance.ok, true);
    assert.equal(secondAdvance.payload.active_participant_id, "p1");
    assert.equal(secondAdvance.payload.combat.conditions.length, 0);
  }, results);

  runTest("true_strike_pending_activates_into_target_scoped_advantage_on_source_turn_start", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.conditions = [{
      condition_id: "condition-true-strike-pending-001",
      condition_type: "true_strike_pending",
      source_actor_id: "p1",
      target_actor_id: "p1",
      expiration_trigger: "manual",
      metadata: {
        prepared_target_actor_id: "p2",
        source_spell_id: "true_strike"
      }
    }];
    combat.turn_index = 2;
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });

    assert.equal(out.ok, true);
    const activated = out.payload.combat.conditions.find((entry) => {
      return String(entry && entry.condition_type || "") === "true_strike_advantage" &&
        String(entry && entry.target_actor_id || "") === "p1";
    });
    assert.equal(Boolean(activated), true);
    assert.deepEqual(activated.metadata.applies_against_actor_ids, ["p2"]);
    assert.equal(out.payload.combat.conditions.some((entry) => String(entry && entry.condition_type || "") === "true_strike_pending"), false);
  }, results);

  runTest("true_strike_advantage_expires_when_source_turn_ends_without_attack", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.conditions = [{
      condition_id: "condition-true-strike-pending-002",
      condition_type: "true_strike_pending",
      source_actor_id: "p1",
      target_actor_id: "p1",
      expiration_trigger: "manual",
      metadata: {
        prepared_target_actor_id: "p2",
        source_spell_id: "true_strike"
      }
    }];
    combat.turn_index = 2;
    manager.combats.set("combat-next-001", combat);

    const firstAdvance = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });
    assert.equal(firstAdvance.ok, true);
    assert.equal(firstAdvance.payload.combat.conditions.some((entry) => String(entry && entry.condition_type || "") === "true_strike_advantage"), true);

    const secondAdvance = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });
    assert.equal(secondAdvance.ok, true);
    assert.equal(secondAdvance.payload.active_participant_id, "p2");
    assert.equal(secondAdvance.payload.combat.conditions.some((entry) => String(entry && entry.condition_type || "") === "true_strike_advantage"), false);
  }, results);

  runTest("heroism_condition_grants_temporary_hitpoints_at_start_of_turn", () => {
    const manager = createBaseCombat();
    const found = manager.getCombatById("combat-next-001");
    const combat = found.payload.combat;
    combat.participants[1].temporary_hitpoints = 0;
    combat.conditions = [
      {
        condition_id: "condition-heroism-001",
        condition_type: "heroism",
        source_actor_id: "p1",
        target_actor_id: "p2",
        expiration_trigger: "manual",
        metadata: {
          start_of_turn_temporary_hitpoints: 3
        }
      }
    ];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });

    assert.equal(out.ok, true);
    const participant = out.payload.combat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(participant.temporary_hitpoints, 3);
    assert.equal(out.payload.combat.event_log[0].details.temporary_hitpoints_granted, 3);
    assert.equal(out.payload.combat.event_log[0].details.applied_boon_conditions.includes("heroism"), true);
  }, results);

  runTest("longstrider_condition_increases_movement_on_turn_start", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.conditions = [{
      condition_id: "condition-longstrider-001",
      condition_type: "longstrider",
      target_actor_id: "p2",
      expiration_trigger: "manual",
      metadata: {
        speed_bonus_feet: 10
      }
    }];
    combat.participants[1].movement_speed = 30;
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });

    assert.equal(out.ok, true);
    const active = out.payload.combat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(active.movement_remaining, 40);
    assert.equal(out.payload.combat.event_log[0].details.movement_bonus_applied, 10);
  }, results);

  runTest("haste_condition_grants_extra_hasted_action_and_speed_on_turn_start", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.conditions = [{
      condition_id: "condition-haste-001",
      condition_type: "haste",
      source_actor_id: "p1",
      target_actor_id: "p2",
      expiration_trigger: "manual",
      metadata: {
        speed_bonus_feet: 30,
        grants_hasted_action: true
      }
    }];
    combat.participants[1].movement_speed = 30;
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });

    assert.equal(out.ok, true);
    const active = out.payload.combat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(active.movement_remaining, 60);
    assert.equal(active.hasted_action_available, true);
    assert.equal(out.payload.combat.event_log[0].details.movement_bonus_applied, 30);
  }, results);

  runTest("end_of_turn_condition_save_can_remove_condition", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.conditions = [{
      condition_id: "condition-blinded-end-save-001",
      condition_type: "blinded",
      target_actor_id: "p1",
      expiration_trigger: "manual",
      metadata: {
        end_of_turn_save_ability: "constitution",
        end_of_turn_save_dc: 13
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 18 };
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.combat.conditions.length, 0);
    assert.equal(out.payload.combat.event_log[0].details.end_of_turn_save_results.length, 1);
    assert.equal(out.payload.combat.event_log[0].details.end_of_turn_save_results[0].success, true);
  }, results);

  runTest("hold_person_style_end_of_turn_save_can_remove_paralyzed", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.conditions = [{
      condition_id: "condition-paralyzed-end-save-001",
      condition_type: "paralyzed",
      target_actor_id: "p1",
      expiration_trigger: "manual",
      metadata: {
        end_of_turn_save_ability: "wisdom",
        end_of_turn_save_dc: 13
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 18 };
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.combat.conditions.length, 0);
  }, results);

  runTest("flesh_to_stone_failed_end_of_turn_saves_can_petrify_target", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.conditions = [{
      condition_id: "condition-flesh-to-stone-001",
      condition_type: "restrained",
      source_actor_id: "p2",
      target_actor_id: "p1",
      expiration_trigger: "manual",
      metadata: {
        status_hint: "flesh_to_stone",
        end_of_turn_save_ability: "constitution",
        end_of_turn_save_dc: 15,
        flesh_to_stone_failures: 2,
        flesh_to_stone_successes: 0,
        petrify_on_failures: 3,
        release_on_successes: 3
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 4 };
      }
    });

    assert.equal(out.ok, true);
    const petrified = out.payload.combat.conditions.find((entry) => {
      return entry.condition_type === "petrified" && entry.target_actor_id === "p1";
    });
    assert.equal(Boolean(petrified), true);
    assert.equal(petrified.metadata.blocks_move, true);
    assert.equal(out.payload.combat.conditions.some((entry) => entry.condition_type === "restrained" && entry.target_actor_id === "p1"), false);
  }, results);

  runTest("start_of_turn_active_effect_duration_ticks_and_expires", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.active_effects = [{
      effect_id: "effect-start-turn-expire-001",
      type: "test_start_effect",
      target: {
        participant_id: "p2"
      },
      duration: {
        remaining_turns: 1,
        max_turns: 1
      },
      tick_timing: "start_of_turn",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {}
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.combat.active_effects.length, 0);
    assert.equal(out.payload.combat.event_log[0].details.start_of_turn_effects.length, 1);
    assert.equal(out.payload.combat.event_log[0].details.expired_effect_ids.includes("effect-start-turn-expire-001"), true);
  }, results);

  runTest("end_of_turn_active_effect_duration_ticks_before_turn_advances", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.active_effects = [{
      effect_id: "effect-end-turn-expire-001",
      type: "test_end_effect",
      target: {
        participant_id: "p1"
      },
      duration: {
        remaining_turns: 1,
        max_turns: 1
      },
      tick_timing: "end_of_turn",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {}
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.combat.active_effects.length, 0);
    assert.equal(out.payload.combat.event_log[0].details.end_of_turn_effects.length, 1);
    assert.equal(out.payload.combat.event_log[0].details.expired_effect_ids.includes("effect-end-turn-expire-001"), true);
  }, results);

  runTest("spirit_guardians_active_effect_damages_hostile_target_at_start_of_turn", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 2, y: 2 };
    combat.participants[1].current_hp = 20;
    combat.participants[1].max_hp = 20;
    combat.participants[0].team = "ally";
    combat.participants[1].team = "enemy";
    combat.active_effects = [{
      effect_id: "effect-spirit-guardians-001",
      type: "spell_active_spirit_guardians",
      source: {
        participant_id: "p1"
      },
      target: {
        participant_id: "p1"
      },
      duration: {
        remaining_turns: 10,
        max_turns: 10
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "spirit_guardians",
        area_tiles: [{ x: 2, y: 2 }],
        zone_behavior: {
          hostile_only: true,
          on_turn_start_damage: {
            save_ability: "wisdom",
            save_dc: 14,
            damage_formula: "3d8",
            damage_type: "radiant",
            save_result: "half_damage_on_success"
          }
        }
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 4 };
      },
      damage_rng() {
        return 0;
      }
    });

    assert.equal(out.ok, true);
    const participant = out.payload.combat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(participant.current_hp < 20, true);
    assert.equal(out.payload.combat.event_log[0].details.active_effect_results.length, 1);
    assert.equal(out.payload.combat.event_log[0].details.active_effect_results[0].spell_id, "spirit_guardians");
    assert.equal(out.payload.combat.event_log[0].details.active_effect_results[0].damage_applied.final_damage > 0, true);
  }, results);

  runTest("spirit_guardians_active_effect_skips_friendly_target_and_can_break_concentration", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 2, y: 2 };
    combat.participants[1].current_hp = 20;
    combat.participants[1].max_hp = 20;
    combat.participants[1].team = "enemy";
    combat.participants[1].concentration = {
      is_concentrating: true,
      source_spell_id: "blur",
      target_actor_id: "p1",
      linked_condition_ids: ["condition-blur-001"],
      linked_effect_ids: [],
      linked_restorations: [],
      started_at_round: 1,
      broken_reason: null
    };
    combat.conditions = [{
      condition_id: "condition-blur-001",
      condition_type: "blur",
      source_actor_id: "p2",
      target_actor_id: "p2",
      expiration_trigger: "manual",
      metadata: {
        attackers_have_disadvantage: true
      }
    }];
    combat.active_effects = [{
      effect_id: "effect-spirit-guardians-002",
      type: "spell_active_spirit_guardians",
      source: {
        participant_id: "p1"
      },
      target: {
        participant_id: "p1"
      },
      duration: {
        remaining_turns: 10,
        max_turns: 10
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "spirit_guardians",
        area_tiles: [{ x: 2, y: 2 }],
        zone_behavior: {
          hostile_only: true,
          on_turn_start_damage: {
            save_ability: "wisdom",
            save_dc: 14,
            damage_formula: "3d8",
            damage_type: "radiant",
            save_result: "half_damage_on_success"
          }
        }
      }
    }, {
      effect_id: "effect-spirit-guardians-friendly-001",
      type: "spell_active_spirit_guardians",
      source: {
        participant_id: "p2"
      },
      target: {
        participant_id: "p2"
      },
      duration: {
        remaining_turns: 10,
        max_turns: 10
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "spirit_guardians",
        area_tiles: [{ x: 2, y: 2 }],
        zone_behavior: {
          hostile_only: true,
          on_turn_start_damage: {
            save_ability: "wisdom",
            save_dc: 14,
            damage_formula: "3d8",
            damage_type: "radiant",
            save_result: "half_damage_on_success"
          }
        }
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 4 };
      },
      damage_rng() {
        return 0;
      },
      concentration_save_rng() {
        return 0;
      }
    });

    assert.equal(out.ok, true);
    const effectResults = out.payload.combat.event_log[0].details.active_effect_results;
    assert.equal(effectResults.length, 1);
    assert.equal(effectResults[0].source_actor_id, "p1");
    const participant = out.payload.combat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(participant.concentration.is_concentrating, false);
    assert.equal(out.payload.combat.conditions.some((entry) => entry.condition_id === "condition-blur-001"), false);
    assert.equal(effectResults[0].concentration_result.concentration_broken, true);
  }, results);

  runTest("grease_active_effect_can_prone_target_at_start_of_turn_on_failed_save", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 2, y: 2 };
    combat.active_effects = [{
      effect_id: "effect-grease-start-001",
      type: "spell_active_grease",
      source: {
        participant_id: "p1"
      },
      target: {
        participant_id: "p1"
      },
      duration: {
        remaining_turns: 10,
        max_turns: 10
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "grease",
        area_tiles: [{ x: 2, y: 2 }],
        zone_behavior: {
          terrain_kind: "difficult",
          on_turn_start_condition: {
            save_ability: "dexterity",
            save_dc: 14,
            condition_type: "prone",
            expiration_trigger: "manual",
            metadata: {
              source_spell_id: "grease"
            }
          }
        }
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 4 };
      }
    });

    assert.equal(out.ok, true);
    const effectResults = out.payload.combat.event_log[0].details.active_effect_results;
    assert.equal(effectResults.length, 1);
    assert.equal(effectResults[0].applied_condition.condition_type, "prone");
    assert.equal(out.payload.combat.conditions.some((entry) => {
      return String(entry && entry.condition_type || "") === "prone" &&
        String(entry && entry.target_actor_id || "") === "p2";
    }), true);
  }, results);

  runTest("web_active_effect_can_restrain_target_at_start_of_turn_on_failed_save", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 2, y: 2 };
    combat.active_effects = [{
      effect_id: "effect-web-start-001",
      type: "spell_active_web",
      source: {
        participant_id: "p1"
      },
      target: {
        participant_id: "p1"
      },
      duration: {
        remaining_turns: 10,
        max_turns: 10
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "web",
        area_tiles: [{ x: 2, y: 2 }],
        zone_behavior: {
          terrain_kind: "difficult",
          on_turn_start_condition: {
            save_ability: "dexterity",
            save_dc: 14,
            condition_type: "restrained",
            expiration_trigger: "manual",
            metadata: {
              source_spell_id: "web"
            }
          }
        }
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 4 };
      }
    });

    assert.equal(out.ok, true);
    const effectResults = out.payload.combat.event_log[0].details.active_effect_results;
    assert.equal(effectResults.length, 1);
    assert.equal(effectResults[0].applied_condition.condition_type, "restrained");
    assert.equal(out.payload.combat.conditions.some((entry) => {
      return String(entry && entry.condition_type || "") === "restrained" &&
        String(entry && entry.target_actor_id || "") === "p2";
    }), true);
  }, results);

  runTest("moonbeam_active_effect_damages_target_at_start_of_turn_on_failed_save", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 2, y: 2 };
    combat.active_effects = [{
      effect_id: "effect-moonbeam-start-001",
      type: "spell_active_moonbeam",
      source: {
        participant_id: "p1"
      },
      target: {
        participant_id: "p1"
      },
      duration: {
        remaining_turns: 10,
        max_turns: 10
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "moonbeam",
        area_tiles: [{ x: 2, y: 2 }],
        zone_behavior: {
          on_turn_start_damage: {
            save_ability: "constitution",
            save_dc: 14,
            damage_formula: "2d10",
            damage_type: "radiant",
            save_result: "half_damage_on_success"
          }
        }
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const beforeHp = combat.participants[1].current_hp;
    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 4 };
      },
      damage_rng() {
        return 0;
      }
    });

    assert.equal(out.ok, true);
    const effectResults = out.payload.combat.event_log[0].details.active_effect_results;
    assert.equal(effectResults.length, 1);
    assert.equal(effectResults[0].damage_applied.damage_type, "radiant");
    const participant = out.payload.combat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(participant.current_hp < beforeHp, true);
  }, results);

  runTest("stinking_cloud_active_effect_can_poison_target_at_start_of_turn_on_failed_save", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 2, y: 2 };
    combat.active_effects = [{
      effect_id: "effect-stinking-cloud-start-001",
      type: "spell_active_stinking_cloud",
      source: {
        participant_id: "p1"
      },
      target: {
        participant_id: "p1"
      },
      duration: {
        remaining_turns: 10,
        max_turns: 10
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "stinking_cloud",
        area_tiles: [{ x: 2, y: 2 }],
        zone_behavior: {
          on_turn_start_condition: {
            save_ability: "constitution",
            save_dc: 14,
            condition_type: "poisoned",
            expiration_trigger: "end_of_turn",
            metadata: {
              source_spell_id: "stinking_cloud",
              blocks_action: true
            }
          }
        }
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 4 };
      }
    });

    assert.equal(out.ok, true);
    const effectResults = out.payload.combat.event_log[0].details.active_effect_results;
    assert.equal(effectResults.length, 1);
    assert.equal(effectResults[0].applied_condition.condition_type, "poisoned");
    assert.equal(effectResults[0].applied_condition.expiration_trigger, "end_of_turn");
    assert.equal(effectResults[0].applied_condition.metadata.blocks_action, true);
    assert.equal(out.payload.combat.conditions.some((entry) => {
      return String(entry && entry.condition_type || "") === "poisoned" &&
        String(entry && entry.target_actor_id || "") === "p2";
    }), true);
    const blockedAttack = performAttackAction({
      combatManager: manager,
      combat_id: "combat-next-001",
      attacker_id: "p2",
      target_id: "p1",
      attack_roll_fn: () => 15,
      damage_roll_fn: () => 4
    });
    assert.equal(blockedAttack.ok, false);
    assert.equal(blockedAttack.error, "action is blocked by an active condition");
  }, results);

  runTest("cloudkill_active_effect_damages_target_at_start_of_turn_on_failed_save", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 2, y: 2 };
    combat.participants[1].current_hp = 24;
    combat.participants[1].max_hp = 24;
    combat.active_effects = [{
      effect_id: "effect-cloudkill-start-001",
      type: "spell_active_cloudkill",
      source: {
        participant_id: "p1"
      },
      target: {
        participant_id: "p1"
      },
      duration: {
        remaining_turns: 10,
        max_turns: 10
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "cloudkill",
        area_tiles: [{ x: 2, y: 2 }],
        zone_behavior: {
          on_turn_start_damage: {
            save_ability: "constitution",
            save_dc: 15,
            damage_formula: "5d8",
            damage_type: "poison",
            save_result: "half_damage_on_success"
          }
        }
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 4 };
      },
      damage_rng() {
        return 0;
      }
    });

    assert.equal(out.ok, true);
    const effectResults = out.payload.combat.event_log[0].details.active_effect_results;
    assert.equal(effectResults.length, 1);
    assert.equal(effectResults[0].damage_applied.damage_type, "poison");
    const participant = out.payload.combat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(participant.current_hp < 24, true);
  }, results);

  runTest("insect_plague_active_effect_damages_target_at_start_of_turn_on_failed_save", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 2, y: 2 };
    combat.participants[1].current_hp = 24;
    combat.participants[1].max_hp = 24;
    combat.active_effects = [{
      effect_id: "effect-insect-plague-start-001",
      type: "spell_active_insect_plague",
      source: {
        participant_id: "p1"
      },
      target: {
        participant_id: "p1"
      },
      duration: {
        remaining_turns: 10,
        max_turns: 10
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "insect_plague",
        area_tiles: [{ x: 2, y: 2 }],
        zone_behavior: {
          terrain_kind: "difficult",
          on_turn_start_damage: {
            save_ability: "constitution",
            save_dc: 15,
            damage_formula: "4d10",
            damage_type: "piercing",
            save_result: "half_damage_on_success"
          }
        }
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 4 };
      },
      damage_rng() {
        return 0;
      }
    });

    assert.equal(out.ok, true);
    const effectResults = out.payload.combat.event_log[0].details.active_effect_results;
    assert.equal(effectResults.length, 1);
    assert.equal(effectResults[0].damage_applied.damage_type, "piercing");
    const participant = out.payload.combat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(participant.current_hp < 24, true);
  }, results);

  runTest("incendiary_cloud_active_effect_damages_target_at_start_of_turn_on_failed_save", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 2, y: 2 };
    combat.participants[1].current_hp = 24;
    combat.participants[1].max_hp = 24;
    combat.active_effects = [{
      effect_id: "effect-incendiary-cloud-start-001",
      type: "spell_active_incendiary_cloud",
      source: {
        participant_id: "p1"
      },
      target: {
        participant_id: "p1"
      },
      duration: {
        remaining_turns: 10,
        max_turns: 10
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "incendiary_cloud",
        area_tiles: [{ x: 2, y: 2 }],
        zone_behavior: {
          on_turn_start_damage: {
            save_ability: "dexterity",
            save_dc: 15,
            damage_formula: "10d8",
            damage_type: "fire",
            save_result: "half_damage_on_success"
          }
        }
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 4 };
      },
      damage_rng() {
        return 0;
      }
    });

    assert.equal(out.ok, true);
    const effectResults = out.payload.combat.event_log[0].details.active_effect_results;
    assert.equal(effectResults.length, 1);
    assert.equal(effectResults[0].damage_applied.damage_type, "fire");
    const participant = out.payload.combat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(participant.current_hp < 24, true);
  }, results);

  runTest("sleet_storm_active_effect_can_prone_target_at_start_of_turn_on_failed_save", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 2, y: 2 };
    combat.active_effects = [{
      effect_id: "effect-sleet-storm-start-001",
      type: "spell_active_sleet_storm",
      source: {
        participant_id: "p1"
      },
      target: {
        participant_id: "p1"
      },
      duration: {
        remaining_turns: 10,
        max_turns: 10
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "sleet_storm",
        utility_ref: "spell_fog_cloud_heavily_obscured",
        area_tiles: [{ x: 2, y: 2 }],
        zone_behavior: {
          terrain_kind: "difficult",
          on_turn_start_condition: {
            save_ability: "dexterity",
            save_dc: 14,
            condition_type: "prone",
            expiration_trigger: "manual",
            metadata: {
              source_spell_id: "sleet_storm"
            }
          },
          on_turn_start_concentration_save: {
            save_ability: "dexterity",
            save_dc: 14
          }
        }
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 4 };
      }
    });

    assert.equal(out.ok, true);
    const effectResults = out.payload.combat.event_log[0].details.active_effect_results;
    assert.equal(effectResults.length, 1);
    assert.equal(effectResults[0].applied_condition.condition_type, "prone");
  }, results);

  runTest("sleet_storm_failed_turn_start_save_can_break_target_concentration", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 2, y: 2 };
    combat.participants[1].concentration = {
      is_concentrating: true,
      source_spell_id: "blur",
      target_actor_id: "p2",
      linked_condition_ids: ["condition-blur-001"],
      linked_effect_ids: [],
      linked_restorations: [],
      started_at_round: 1,
      broken_reason: null
    };
    combat.conditions = [{
      condition_id: "condition-blur-001",
      condition_type: "blur",
      source_actor_id: "p2",
      target_actor_id: "p2",
      expiration_trigger: "manual",
      metadata: {
        source_spell_id: "blur"
      }
    }];
    combat.active_effects = [{
      effect_id: "effect-sleet-storm-break-001",
      type: "spell_active_sleet_storm",
      source: {
        participant_id: "p1"
      },
      target: {
        participant_id: "p1"
      },
      duration: {
        remaining_turns: 10,
        max_turns: 10
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "sleet_storm",
        utility_ref: "spell_fog_cloud_heavily_obscured",
        area_tiles: [{ x: 2, y: 2 }],
        zone_behavior: {
          terrain_kind: "difficult",
          on_turn_start_condition: {
            save_ability: "dexterity",
            save_dc: 14,
            condition_type: "prone",
            expiration_trigger: "manual",
            metadata: {
              source_spell_id: "sleet_storm"
            }
          },
          on_turn_start_concentration_save: {
            save_ability: "dexterity",
            save_dc: 14
          }
        }
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 4 };
      }
    });

    assert.equal(out.ok, true);
    const participant = out.payload.combat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(Boolean(participant.concentration && participant.concentration.is_concentrating), false);
    assert.equal(out.payload.combat.conditions.some((entry) => String(entry && entry.condition_id || "") === "condition-blur-001"), false);
    const effectResults = out.payload.combat.event_log[0].details.active_effect_results;
    assert.equal(effectResults.length, 1);
    assert.equal(effectResults[0].concentration_zone_result.concentration_broken, true);
  }, results);

  runTest("gust_of_wind_active_effect_pushes_target_at_start_of_turn_on_failed_save", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[0].position = { x: 0, y: 0 };
    combat.participants[1].position = { x: 2, y: 0 };
    combat.active_effects = [{
      effect_id: "effect-gust-start-001",
      type: "spell_active_gust_of_wind",
      source: {
        participant_id: "p1"
      },
      target: {
        participant_id: "p1"
      },
      duration: {
        remaining_turns: 10,
        max_turns: 10
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "gust_of_wind",
        area_tiles: [{ x: 2, y: 0 }],
        zone_behavior: {
          terrain_kind: "difficult",
          on_turn_start_forced_movement: {
            save_ability: "strength",
            save_dc: 15,
            push_tiles: 3
          }
        }
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 4 };
      }
    });

    assert.equal(out.ok, true);
    const effectResults = out.payload.combat.event_log[0].details.active_effect_results;
    assert.equal(effectResults.length, 1);
    assert.equal(effectResults[0].forced_movement_result.moved, true);
    assert.equal(effectResults[0].forced_movement_result.tiles_moved, 3);
    assert.deepEqual(effectResults[0].forced_movement_result.to_position, { x: 5, y: 0 });
  }, results);

  runTest("guardian_of_faith_turn_start_damage_can_spend_remaining_pool_and_expire", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[0].position = { x: 0, y: 0 };
    combat.participants[1].position = { x: 2, y: 2 };
    combat.participants[1].current_hp = 40;
    combat.participants[1].max_hp = 40;
    combat.active_effects = [{
      effect_id: "effect-guardian-start-001",
      type: "spell_active_guardian_of_faith",
      source: {
        participant_id: "p1"
      },
      target: {
        participant_id: "p1"
      },
      duration: {
        remaining_turns: 100,
        max_turns: 100
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "guardian_of_faith",
        area_tiles: [{ x: 2, y: 2 }],
        zone_behavior: {
          hostile_only: true,
          trigger_once_per_turn: true,
          damage_pool_remaining: 20,
          expires_when_damage_pool_spent: true,
          on_turn_start_damage: {
            save_ability: "dexterity",
            save_dc: 15,
            flat_damage: 20,
            damage_type: "radiant",
            save_result: "half_damage_on_success"
          }
        }
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 4 };
      }
    });

    assert.equal(out.ok, true);
    const effectResults = out.payload.combat.event_log[0].details.active_effect_results;
    assert.equal(effectResults.length, 1);
    assert.equal(effectResults[0].damage_applied.final_damage, 20);
    assert.equal(out.payload.combat.active_effects.length, 0);
    const target = out.payload.combat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(target.current_hp, 20);
  }, results);

  runTest("wall_of_fire_active_effect_damages_target_at_start_of_turn_on_failed_save", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 2, y: 2 };
    combat.participants[1].current_hp = 30;
    combat.participants[1].max_hp = 30;
    combat.active_effects = [{
      effect_id: "effect-wall-fire-start-001",
      type: "spell_active_wall_of_fire",
      source: {
        participant_id: "p1"
      },
      target: {
        participant_id: "p1"
      },
      duration: {
        remaining_turns: 10,
        max_turns: 10
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "wall_of_fire",
        area_tiles: [{ x: 2, y: 2 }],
        zone_behavior: {
          on_turn_start_damage: {
            save_ability: "dexterity",
            save_dc: 15,
            damage_formula: "5d8",
            damage_type: "fire",
            save_result: "half_damage_on_success"
          }
        }
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 4 };
      },
      damage_rng() {
        return 0;
      }
    });

    assert.equal(out.ok, true);
    const effectResults = out.payload.combat.event_log[0].details.active_effect_results;
    assert.equal(effectResults.length, 1);
    assert.equal(effectResults[0].damage_applied.damage_type, "fire");
    const target = out.payload.combat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(target.current_hp < 30, true);
  }, results);

  runTest("wall_of_fire_hazard_side_only_damages_turn_start_targets_in_hazard_tiles", () => {
    const manager = createBaseCombat();
    const combat = manager.getCombatById("combat-next-001").payload.combat;
    combat.participants[1].position = { x: 2, y: 3 };
    combat.participants[1].current_hp = 30;
    combat.participants[1].max_hp = 30;
    combat.active_effects = [{
      effect_id: "effect-wall-fire-hazard-start-001",
      type: "spell_active_wall_of_fire",
      source: {
        participant_id: "p1"
      },
      target: {
        participant_id: "p1"
      },
      duration: {
        remaining_turns: 10,
        max_turns: 10
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "wall_of_fire",
        area_tiles: [{ x: 2, y: 2 }],
        zone_behavior: {
          on_turn_start_damage: {
            save_ability: "dexterity",
            save_dc: 15,
            damage_formula: "5d8",
            damage_type: "fire",
            save_result: "half_damage_on_success",
            area_tiles: [{ x: 2, y: 3 }]
          }
        }
      }
    }];
    manager.combats.set("combat-next-001", combat);

    const out = nextTurn({
      combatManager: manager,
      combat_id: "combat-next-001",
      saving_throw_fn() {
        return { final_total: 4 };
      },
      damage_rng() {
        return 0;
      }
    });

    assert.equal(out.ok, true);
    const effectResults = out.payload.combat.event_log[0].details.active_effect_results;
    assert.equal(effectResults.length, 1);
    assert.equal(effectResults[0].damage_applied.damage_type, "fire");
    const target = out.payload.combat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(target.current_hp < 30, true);
  }, results);

  const passed = results.filter((x) => x.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    totals: {
      total: results.length,
      passed,
      failed
    },
    results
  };
}

if (require.main === module) {
  const summary = runNextTurnTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runNextTurnTests
};
