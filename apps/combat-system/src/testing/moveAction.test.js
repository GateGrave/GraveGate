"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { performMoveAction } = require("../actions/moveAction");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createActiveCombatForMoveTests() {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: "combat-move-001",
    status: "active",
    round: 1,
    turn_index: 0,
    initiative_order: ["p1", "p2"],
    participants: [
      {
        participant_id: "p1",
        name: "Hero",
        team: "A",
        armor_class: 12,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 3,
        damage: 4,
        position: { x: 0, y: 0 }
      },
      {
        participant_id: "p2",
        name: "Goblin",
        team: "B",
        armor_class: 11,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 3,
        position: { x: 2, y: 2 }
      }
    ],
    conditions: [],
    event_log: []
  });
  return manager;
}

function runMoveActionTests() {
  const results = [];

  runTest("successful_move", () => {
    const manager = createActiveCombatForMoveTests();
    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 }
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "move_action_resolved");
    assert.deepEqual(out.payload.to_position, { x: 1, y: 0 });
    assert.equal(out.payload.combat.event_log.length, 1);
    assert.equal(out.payload.combat.event_log[0].event_type, "move_action");
    const actor = out.payload.combat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(actor.movement_remaining, 25);
  }, results);

  runTest("movement_cost_cannot_exceed_remaining_pool", () => {
    const manager = createActiveCombatForMoveTests();
    const found = manager.getCombatById("combat-move-001");
    const combat = found.payload.combat;
    const actor = combat.participants.find((entry) => entry.participant_id === "p1");
    actor.movement_remaining = 5;
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 2, y: 0 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "not enough movement remaining");
  }, results);

  runTest("out_of_bounds_move", () => {
    const manager = createActiveCombatForMoveTests();
    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 9, y: 0 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "move_action_failed");
    assert.equal(out.error, "target position is out of battlefield bounds");
  }, results);

  runTest("occupied_tile_failure", () => {
    const manager = createActiveCombatForMoveTests();
    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 2, y: 2 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "move_action_failed");
    assert.equal(out.error, "target tile is occupied");
  }, results);

  runTest("wrong_turn_failure", () => {
    const manager = createActiveCombatForMoveTests();
    const found = manager.getCombatById("combat-move-001");
    const combat = found.payload.combat;
    combat.turn_index = 1;
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "move_action_failed");
    assert.equal(out.error, "it is not the participant's turn");
  }, results);

  runTest("defeated_participant_cannot_move", () => {
    const manager = createActiveCombatForMoveTests();
    const found = manager.getCombatById("combat-move-001");
    const combat = found.payload.combat;
    const actor = combat.participants.find((p) => p.participant_id === "p1");
    actor.current_hp = 0;
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "move_action_failed");
    assert.equal(out.error, "defeated participants cannot act");
  }, results);

  runTest("stunned_participant_cannot_move", () => {
    const manager = createActiveCombatForMoveTests();
    const found = manager.getCombatById("combat-move-001");
    const combat = found.payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-move-001",
        condition_type: "stunned",
        target_actor_id: "p1",
        expiration_trigger: "manual"
      }
    ];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "stunned participants cannot act");
  }, results);

  runTest("restrained_participant_cannot_move", () => {
    const manager = createActiveCombatForMoveTests();
    const found = manager.getCombatById("combat-move-001");
    const combat = found.payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-move-002",
        condition_type: "restrained",
        target_actor_id: "p1",
        expiration_trigger: "manual"
      }
    ];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "restrained participants cannot move");
  }, results);

  runTest("paralyzed_participant_cannot_move", () => {
    const manager = createActiveCombatForMoveTests();
    const found = manager.getCombatById("combat-move-001");
    const combat = found.payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-move-003",
        condition_type: "paralyzed",
        target_actor_id: "p1",
        expiration_trigger: "manual"
      }
    ];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "paralyzed participants cannot move");
  }, results);

  runTest("frightened_participant_cannot_move_closer_to_fear_source", () => {
    const manager = createActiveCombatForMoveTests();
    const found = manager.getCombatById("combat-move-001");
    const combat = found.payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-move-fear-001",
        condition_type: "frightened",
        source_actor_id: "p2",
        target_actor_id: "p1",
        expiration_trigger: "manual"
      }
    ];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 1 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "frightened participants cannot move closer to the source of fear");
  }, results);

  runTest("moving_grappler_out_of_reach_clears_grappled_condition", () => {
    const manager = createActiveCombatForMoveTests();
    const combat = manager.getCombatById("combat-move-001").payload.combat;
    combat.participants[1].position = { x: 1, y: 0 };
    combat.conditions = [{
      condition_id: "condition-grapple-move-001",
      condition_type: "grappled",
      source_actor_id: "p1",
      target_actor_id: "p2",
      expiration_trigger: "manual"
    }];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 4, y: 0 }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.combat.conditions.some((entry) => {
      return String(entry && entry.condition_type || "") === "grappled";
    }), false);
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
  const summary = runMoveActionTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runMoveActionTests
};
