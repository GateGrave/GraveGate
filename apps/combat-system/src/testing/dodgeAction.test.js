"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { performDodgeAction } = require("../actions/dodgeAction");
const { nextTurn } = require("../flow/nextTurn");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createActiveCombatForDodgeTests() {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: "combat-dodge-001",
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

function runDodgeActionTests() {
  const results = [];

  runTest("successful_dodge", () => {
    const manager = createActiveCombatForDodgeTests();
    const out = performDodgeAction({
      combatManager: manager,
      combat_id: "combat-dodge-001",
      participant_id: "p1"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dodge_action_resolved");
    assert.equal(out.payload.is_dodging, true);

    const loaded = manager.getCombatById("combat-dodge-001");
    const actor = loaded.payload.combat.participants.find((p) => p.participant_id === "p1");
    assert.equal(actor.is_dodging, true);
    assert.equal(loaded.payload.combat.event_log.length, 1);
    assert.equal(loaded.payload.combat.event_log[0].event_type, "dodge_action");
  }, results);

  runTest("wrong_turn_failure", () => {
    const manager = createActiveCombatForDodgeTests();
    const found = manager.getCombatById("combat-dodge-001");
    const combat = found.payload.combat;
    combat.turn_index = 1;
    manager.combats.set("combat-dodge-001", combat);

    const out = performDodgeAction({
      combatManager: manager,
      combat_id: "combat-dodge-001",
      participant_id: "p1"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dodge_action_failed");
    assert.equal(out.error, "it is not the participant's turn");
  }, results);

  runTest("invalid_participant_failure", () => {
    const manager = createActiveCombatForDodgeTests();
    const out = performDodgeAction({
      combatManager: manager,
      combat_id: "combat-dodge-001",
      participant_id: "p-missing-001"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dodge_action_failed");
    assert.equal(out.error, "participant not found in combat");
  }, results);

  runTest("dodge_clears_on_participants_next_turn", () => {
    const manager = createActiveCombatForDodgeTests();

    // p1 dodges on p1 turn.
    const dodge = performDodgeAction({
      combatManager: manager,
      combat_id: "combat-dodge-001",
      participant_id: "p1"
    });
    assert.equal(dodge.ok, true);

    // Advance to p2 turn: p1 dodge should still be active.
    const turnToP2 = nextTurn({
      combatManager: manager,
      combat_id: "combat-dodge-001"
    });
    assert.equal(turnToP2.ok, true);
    const afterP2 = manager.getCombatById("combat-dodge-001");
    const p1AfterP2 = afterP2.payload.combat.participants.find((p) => p.participant_id === "p1");
    assert.equal(p1AfterP2.is_dodging, true);

    // Advance again to p1 turn: dodge clears at start of p1 next turn.
    const turnToP1 = nextTurn({
      combatManager: manager,
      combat_id: "combat-dodge-001"
    });
    assert.equal(turnToP1.ok, true);
    assert.equal(turnToP1.payload.active_participant_id, "p1");
    assert.equal(turnToP1.payload.dodge_cleared, true);

    const afterP1 = manager.getCombatById("combat-dodge-001");
    const p1AfterP1 = afterP1.payload.combat.participants.find((p) => p.participant_id === "p1");
    assert.equal(p1AfterP1.is_dodging, false);
  }, results);

  runTest("defeated_participant_cannot_dodge", () => {
    const manager = createActiveCombatForDodgeTests();
    const found = manager.getCombatById("combat-dodge-001");
    const combat = found.payload.combat;
    const actor = combat.participants.find((p) => p.participant_id === "p1");
    actor.current_hp = 0;
    manager.combats.set("combat-dodge-001", combat);

    const out = performDodgeAction({
      combatManager: manager,
      combat_id: "combat-dodge-001",
      participant_id: "p1"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dodge_action_failed");
    assert.equal(out.error, "defeated participants cannot act");
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
  const summary = runDodgeActionTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runDodgeActionTests
};
