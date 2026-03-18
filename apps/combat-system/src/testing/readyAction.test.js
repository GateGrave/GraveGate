"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { performReadyAction } = require("../actions/readyAction");
const { nextTurn } = require("../flow/nextTurn");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createActiveCombatForReadyTests() {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: "combat-ready-001",
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
        damage: 4
      },
      {
        participant_id: "p2",
        name: "Goblin",
        team: "B",
        armor_class: 11,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 3
      }
    ],
    event_log: []
  });
  return manager;
}

function runReadyActionTests() {
  const results = [];

  runTest("successful_ready_sets_ready_action_payload_and_consumes_action", () => {
    const manager = createActiveCombatForReadyTests();
    const out = performReadyAction({
      combatManager: manager,
      combat_id: "combat-ready-001",
      participant_id: "p1",
      trigger_type: "enemy_enters_reach",
      readied_action_type: "attack",
      target_id: "p2"
    });
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "ready_action_resolved");
    assert.equal(String(out.payload.ready_action.trigger_type || ""), "enemy_enters_reach");
    assert.equal(String(out.payload.ready_action.action_type || ""), "attack");
    assert.equal(String(out.payload.ready_action.target_id || ""), "p2");
    const combat = manager.getCombatById("combat-ready-001").payload.combat;
    const actor = combat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(actor.action_available, false);
    assert.equal(Boolean(actor.ready_action), true);
  }, results);

  runTest("ready_state_clears_on_actors_next_turn", () => {
    const manager = createActiveCombatForReadyTests();
    const ready = performReadyAction({
      combatManager: manager,
      combat_id: "combat-ready-001",
      participant_id: "p1",
      trigger_type: "enemy_enters_reach",
      readied_action_type: "attack",
      target_id: "p2"
    });
    assert.equal(ready.ok, true);

    const turnToP2 = nextTurn({
      combatManager: manager,
      combat_id: "combat-ready-001"
    });
    assert.equal(turnToP2.ok, true);
    const afterP2 = manager.getCombatById("combat-ready-001").payload.combat;
    const p1AfterP2 = afterP2.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(Boolean(p1AfterP2.ready_action), true);

    const turnBackToP1 = nextTurn({
      combatManager: manager,
      combat_id: "combat-ready-001"
    });
    assert.equal(turnBackToP1.ok, true);
    assert.equal(turnBackToP1.payload.ready_cleared, true);
    const afterP1 = manager.getCombatById("combat-ready-001").payload.combat;
    const p1AfterP1 = afterP1.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(Boolean(p1AfterP1.ready_action), false);
  }, results);

  runTest("unsupported_ready_trigger_type_fails_safely", () => {
    const manager = createActiveCombatForReadyTests();
    const out = performReadyAction({
      combatManager: manager,
      combat_id: "combat-ready-001",
      participant_id: "p1",
      trigger_type: "enemy_starts_turn",
      readied_action_type: "attack",
      target_id: "p2"
    });
    assert.equal(out.ok, false);
    assert.equal(out.error, "unsupported trigger_type for ready action");
  }, results);

  runTest("unsupported_readied_action_type_fails_safely", () => {
    const manager = createActiveCombatForReadyTests();
    const out = performReadyAction({
      combatManager: manager,
      combat_id: "combat-ready-001",
      participant_id: "p1",
      trigger_type: "enemy_enters_reach",
      readied_action_type: "cast_spell",
      target_id: "p2"
    });
    assert.equal(out.ok, false);
    assert.equal(out.error, "unsupported readied_action_type");
  }, results);

  runTest("ready_rejects_incapacitated_actor", () => {
    const manager = createActiveCombatForReadyTests();
    const combat = manager.getCombatById("combat-ready-001").payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-ready-stunned-001",
        condition_type: "stunned",
        target_actor_id: "p1"
      }
    ];
    manager.combats.set("combat-ready-001", combat);

    const out = performReadyAction({
      combatManager: manager,
      combat_id: "combat-ready-001",
      participant_id: "p1",
      trigger_type: "enemy_enters_reach",
      readied_action_type: "attack",
      target_id: "p2"
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
  const summary = runReadyActionTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runReadyActionTests
};
