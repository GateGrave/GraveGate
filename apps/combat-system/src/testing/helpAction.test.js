"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { performHelpAction } = require("../actions/helpAction");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createActiveCombatForHelpTests() {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: "combat-help-001",
    status: "active",
    round: 1,
    turn_index: 0,
    initiative_order: ["p1", "p2", "e1"],
    participants: [
      {
        participant_id: "p1",
        name: "Helper",
        team: "heroes",
        armor_class: 12,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 3,
        damage: 4
      },
      {
        participant_id: "p2",
        name: "Ally",
        team: "heroes",
        armor_class: 11,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 3,
        damage: 3
      },
      {
        participant_id: "e1",
        name: "Enemy",
        team: "monsters",
        armor_class: 10,
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

function runHelpActionTests() {
  const results = [];

  runTest("successful_help_applies_helped_attack_condition_to_ally", () => {
    const manager = createActiveCombatForHelpTests();
    const out = performHelpAction({
      combatManager: manager,
      combat_id: "combat-help-001",
      helper_id: "p1",
      target_id: "p2"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "help_action_resolved");
    assert.equal(String(out.payload.applied_condition.condition_type || ""), "helped_attack");
    const combat = manager.getCombatById("combat-help-001").payload.combat;
    assert.equal(combat.conditions.some((entry) => {
      return String(entry && entry.condition_type || "") === "helped_attack" &&
        String(entry && entry.target_actor_id || "") === "p2";
    }), true);
  }, results);

  runTest("help_rejects_enemy_target", () => {
    const manager = createActiveCombatForHelpTests();
    const out = performHelpAction({
      combatManager: manager,
      combat_id: "combat-help-001",
      helper_id: "p1",
      target_id: "e1"
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "help action requires an ally target");
  }, results);

  runTest("help_rejects_incapacitated_helper", () => {
    const manager = createActiveCombatForHelpTests();
    const combat = manager.getCombatById("combat-help-001").payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-help-paralyzed-001",
        condition_type: "paralyzed",
        target_actor_id: "p1"
      }
    ];
    manager.combats.set("combat-help-001", combat);

    const out = performHelpAction({
      combatManager: manager,
      combat_id: "combat-help-001",
      helper_id: "p1",
      target_id: "p2"
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "paralyzed participants cannot act");
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
  const summary = runHelpActionTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runHelpActionTests
};
