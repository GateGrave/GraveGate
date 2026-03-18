"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { nextTurn } = require("../flow/nextTurn");

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
