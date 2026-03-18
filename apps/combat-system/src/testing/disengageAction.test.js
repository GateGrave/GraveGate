"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { performDisengageAction } = require("../actions/disengageAction");
const { nextTurn } = require("../flow/nextTurn");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createActiveCombatForDisengageTests() {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: "combat-disengage-001",
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
    event_log: [],
    conditions: []
  });
  return manager;
}

function runDisengageActionTests() {
  const results = [];

  runTest("successful_disengage_applies_oa_immunity_and_consumes_action", () => {
    const manager = createActiveCombatForDisengageTests();
    const out = performDisengageAction({
      combatManager: manager,
      combat_id: "combat-disengage-001",
      participant_id: "p1"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "disengage_action_resolved");
    assert.equal(String(out.payload.immunity_condition.condition_type || ""), "opportunity_attack_immunity");

    const loaded = manager.getCombatById("combat-disengage-001");
    const combat = loaded.payload.combat;
    const actor = combat.participants.find((p) => p.participant_id === "p1");
    assert.equal(actor.action_available, false);
    assert.equal(combat.conditions.some((entry) => {
      return String(entry && entry.condition_type || "") === "opportunity_attack_immunity" &&
        String(entry && entry.target_actor_id || "") === "p1";
    }), true);
    assert.equal(combat.event_log.some((entry) => String(entry && entry.event_type || "") === "disengage_action"), true);
  }, results);

  runTest("disengage_immunity_expires_on_participants_next_turn_start", () => {
    const manager = createActiveCombatForDisengageTests();
    const out = performDisengageAction({
      combatManager: manager,
      combat_id: "combat-disengage-001",
      participant_id: "p1"
    });
    assert.equal(out.ok, true);

    const turnToP2 = nextTurn({
      combatManager: manager,
      combat_id: "combat-disengage-001"
    });
    assert.equal(turnToP2.ok, true);
    const afterP2 = manager.getCombatById("combat-disengage-001").payload.combat;
    assert.equal(afterP2.conditions.some((entry) => {
      return String(entry && entry.condition_type || "") === "opportunity_attack_immunity" &&
        String(entry && entry.target_actor_id || "") === "p1";
    }), true);

    const turnBackToP1 = nextTurn({
      combatManager: manager,
      combat_id: "combat-disengage-001"
    });
    assert.equal(turnBackToP1.ok, true);
    const afterP1 = manager.getCombatById("combat-disengage-001").payload.combat;
    assert.equal(afterP1.conditions.some((entry) => {
      return String(entry && entry.condition_type || "") === "opportunity_attack_immunity" &&
        String(entry && entry.target_actor_id || "") === "p1";
    }), false);
  }, results);

  runTest("disengage_rejects_incapacitated_actor", () => {
    const manager = createActiveCombatForDisengageTests();
    const combat = manager.getCombatById("combat-disengage-001").payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-disengage-stunned-001",
        condition_type: "stunned",
        target_actor_id: "p1"
      }
    ];
    manager.combats.set("combat-disengage-001", combat);

    const out = performDisengageAction({
      combatManager: manager,
      combat_id: "combat-disengage-001",
      participant_id: "p1"
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
  const summary = runDisengageActionTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runDisengageActionTests
};
