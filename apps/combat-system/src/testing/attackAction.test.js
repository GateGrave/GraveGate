"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { performAttackAction } = require("../actions/attackAction");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createActiveCombatForAttackTests() {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: "combat-attack-001",
    status: "active",
    round: 1,
    turn_index: 0,
    initiative_order: ["attacker-001", "target-001"],
    participants: [
      {
        participant_id: "attacker-001",
        name: "Hero",
        team: "A",
        armor_class: 14,
        current_hp: 20,
        max_hp: 20,
        attack_bonus: 5,
        damage: 6
      },
      {
        participant_id: "target-001",
        name: "Goblin",
        team: "B",
        armor_class: 12,
        current_hp: 16,
        max_hp: 16,
        attack_bonus: 2,
        damage: 4
      }
    ],
    conditions: [],
    battlefield: {},
    event_log: []
  });
  return manager;
}

function runAttackActionTests() {
  const results = [];

  runTest("successful_hit", () => {
    const manager = createActiveCombatForAttackTests();
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 15,
      damage_roll_fn: () => 5
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "attack_action_resolved");
    assert.equal(out.payload.hit, true);
    assert.equal(out.payload.damage_dealt, 5);
    assert.equal(out.payload.target_hp_after, 11);
    assert.equal(out.payload.combat.event_log.length, 1);
    const attacker = out.payload.combat.participants.find((entry) => entry.participant_id === "attacker-001");
    assert.equal(attacker.action_available, false);
  }, results);

  runTest("attacking_consumes_action_for_turn", () => {
    const manager = createActiveCombatForAttackTests();
    const first = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 15,
      damage_roll_fn: () => 5
    });
    assert.equal(first.ok, true);

    const second = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 15,
      damage_roll_fn: () => 5
    });
    assert.equal(second.ok, false);
    assert.equal(second.error, "action is not available");
  }, results);

  runTest("miss", () => {
    const manager = createActiveCombatForAttackTests();
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 2,
      damage_roll_fn: () => 999
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.hit, false);
    assert.equal(out.payload.damage_dealt, 0);
    assert.equal(out.payload.target_hp_after, 16);
  }, results);

  runTest("wrong_turn", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    combat.turn_index = 1; // target's turn
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 15,
      damage_roll_fn: () => 5
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "attack_action_failed");
    assert.equal(out.error, "it is not the attacker's turn");
  }, results);

  runTest("invalid_target", () => {
    const manager = createActiveCombatForAttackTests();
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-missing-001",
      attack_roll_fn: () => 15,
      damage_roll_fn: () => 5
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "attack_action_failed");
    assert.equal(out.error, "target not found in combat");
  }, results);

  runTest("damage_reducing_hp", () => {
    const manager = createActiveCombatForAttackTests();
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 20,
      damage_roll_fn: () => 7
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.hit, true);
    assert.equal(out.payload.target_hp_after, 9);

    const loaded = manager.getCombatById("combat-attack-001");
    const target = loaded.payload.combat.participants.find((p) => p.participant_id === "target-001");
    assert.equal(target.current_hp, 9);
  }, results);

  runTest("attack_against_dodging_target_uses_disadvantage", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    const target = combat.participants.find((p) => p.participant_id === "target-001");
    target.is_dodging = true;
    manager.combats.set("combat-attack-001", combat);

    let callCount = 0;
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      // Should be called twice because target is dodging.
      attack_roll_fn: () => {
        callCount += 1;
        return callCount === 1 ? 19 : 3;
      },
      damage_roll_fn: () => 5
    });

    assert.equal(out.ok, true);
    assert.equal(callCount, 2);
    assert.equal(out.payload.attack_roll_mode, "disadvantage");
    assert.deepEqual(out.payload.attack_roll_values, [19, 3]);
    assert.equal(out.payload.attack_roll, 3);
    assert.equal(out.payload.attack_total, 8);
    assert.equal(out.payload.hit, false);
  }, results);

  runTest("guiding_bolt_marked_target_grants_advantage_and_consumes_mark", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    combat.conditions = [{
      condition_id: "condition-guiding-bolt-001",
      condition_type: "guiding_bolt_marked",
      source_actor_id: "cleric-001",
      target_actor_id: "target-001",
      expiration_trigger: "start_of_source_turn",
      duration: {
        remaining_triggers: 1
      }
    }];
    manager.combats.set("combat-attack-001", combat);

    let callCount = 0;
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => {
        callCount += 1;
        return callCount === 1 ? 2 : 17;
      },
      damage_roll_fn: () => 5
    });

    assert.equal(out.ok, true);
    assert.equal(callCount, 2);
    assert.equal(out.payload.attack_roll_mode, "advantage");
    assert.deepEqual(out.payload.attack_roll_values, [2, 17]);
    assert.equal(out.payload.attack_roll, 17);
    assert.equal(out.payload.hit, true);
    assert.equal(out.payload.combat.conditions.length, 0);
  }, results);

  runTest("defeated_participant_cannot_attack", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    const attacker = combat.participants.find((p) => p.participant_id === "attacker-001");
    attacker.current_hp = 0;
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 20,
      damage_roll_fn: () => 9
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "attack_action_failed");
    assert.equal(out.error, "defeated participants cannot act");
  }, results);

  runTest("cannot_attack_target_that_is_already_defeated", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    const target = combat.participants.find((p) => p.participant_id === "target-001");
    target.current_hp = 0;
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 20,
      damage_roll_fn: () => 9
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "attack_action_failed");
    assert.equal(out.error, "target is already defeated");
  }, results);

  runTest("ended_combat_rejects_attack_actions", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    combat.status = "complete";
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 20,
      damage_roll_fn: () => 7
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "attack_action_failed");
    assert.equal(out.error, "combat is not active");
  }, results);

  runTest("stunned_participant_cannot_attack", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-attack-001",
        condition_type: "stunned",
        target_actor_id: "attacker-001",
        expiration_trigger: "manual"
      }
    ];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 20,
      damage_roll_fn: () => 7
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "stunned participants cannot act");
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
  const summary = runAttackActionTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runAttackActionTests
};
