"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { performGrappleAction } = require("../actions/grappleAction");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createActiveCombatForGrappleTests() {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: "combat-grapple-001",
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
        position: { x: 1, y: 1 }
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
        position: { x: 2, y: 1 }
      }
    ],
    event_log: []
  });
  return manager;
}

function runGrappleActionTests() {
  const results = [];

  runTest("successful_grapple_applies_condition_and_consumes_action", () => {
    const manager = createActiveCombatForGrappleTests();
    const out = performGrappleAction({
      combatManager: manager,
      combat_id: "combat-grapple-001",
      attacker_id: "p1",
      target_id: "p2",
      contest_roll_fn(_participant, _ability, _combat, role) {
        return role === "attacker" ? 18 : 5;
      }
    });
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "grapple_action_resolved");
    assert.equal(String(out.payload.applied_condition.condition_type || ""), "grappled");
    const combat = manager.getCombatById("combat-grapple-001").payload.combat;
    const attacker = combat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(attacker.action_available, false);
    assert.equal(combat.conditions.some((entry) => {
      return String(entry && entry.condition_type || "") === "grappled" &&
        String(entry && entry.source_actor_id || "") === "p1" &&
        String(entry && entry.target_actor_id || "") === "p2";
    }), true);
  }, results);

  runTest("grapple_fails_for_out_of_range_target", () => {
    const manager = createActiveCombatForGrappleTests();
    const combat = manager.getCombatById("combat-grapple-001").payload.combat;
    const target = combat.participants.find((entry) => entry.participant_id === "p2");
    target.position = { x: 5, y: 5 };
    manager.combats.set("combat-grapple-001", combat);
    const out = performGrappleAction({
      combatManager: manager,
      combat_id: "combat-grapple-001",
      attacker_id: "p1",
      target_id: "p2"
    });
    assert.equal(out.ok, false);
    assert.equal(out.error, "target is out of grapple range");
  }, results);

  const passed = results.filter((x) => x.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    totals: { total: results.length, passed, failed },
    results
  };
}

if (require.main === module) {
  const summary = runGrappleActionTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runGrappleActionTests
};
