"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { performShoveAction } = require("../actions/shoveAction");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createActiveCombatForShoveTests() {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: "combat-shove-001",
    status: "active",
    round: 1,
    turn_index: 0,
    initiative_order: ["p1", "p2"],
    participants: [
      {
        participant_id: "p1",
        name: "Hero",
        team: "A",
        current_hp: 10,
        max_hp: 10,
        position: { x: 1, y: 1 },
        stats: { strength: 16, dexterity: 10 }
      },
      {
        participant_id: "p2",
        name: "Goblin",
        team: "B",
        current_hp: 10,
        max_hp: 10,
        position: { x: 2, y: 1 },
        stats: { strength: 10, dexterity: 10 }
      }
    ],
    conditions: [],
    event_log: []
  });
  return manager;
}

function runShoveActionTests() {
  const results = [];

  runTest("successful_shove_push_moves_target_one_tile", () => {
    const manager = createActiveCombatForShoveTests();
    const out = performShoveAction({
      combatManager: manager,
      combat_id: "combat-shove-001",
      attacker_id: "p1",
      target_id: "p2",
      shove_mode: "push",
      contest_roll_fn(_participant, _ability, _combat, role) {
        return role === "attacker" ? 18 : 5;
      }
    });
    assert.equal(out.ok, true);
    assert.equal(out.payload.success, true);
    assert.deepEqual(out.payload.moved_to, { x: 3, y: 1 });
  }, results);

  runTest("successful_shove_prone_applies_prone_condition", () => {
    const manager = createActiveCombatForShoveTests();
    const out = performShoveAction({
      combatManager: manager,
      combat_id: "combat-shove-001",
      attacker_id: "p1",
      target_id: "p2",
      shove_mode: "prone",
      contest_roll_fn(_participant, _ability, _combat, role) {
        return role === "attacker" ? 18 : 5;
      }
    });
    assert.equal(out.ok, true);
    assert.equal(out.payload.success, true);
    assert.equal(String(out.payload.applied_condition.condition_type || ""), "prone");
  }, results);

  runTest("shove_push_breaks_grapple_when_target_is_moved_out_of_reach", () => {
    const manager = createActiveCombatForShoveTests();
    const combat = manager.getCombatById("combat-shove-001").payload.combat;
    combat.conditions = [{
      condition_id: "condition-shove-grapple-001",
      condition_type: "grappled",
      source_actor_id: "p1",
      target_actor_id: "p2",
      expiration_trigger: "manual"
    }];
    manager.combats.set("combat-shove-001", combat);

    const out = performShoveAction({
      combatManager: manager,
      combat_id: "combat-shove-001",
      attacker_id: "p1",
      target_id: "p2",
      shove_mode: "push",
      contest_roll_fn(_participant, _ability, _combat, role) {
        return role === "attacker" ? 18 : 5;
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.success, true);
    assert.equal(out.payload.combat.conditions.some((entry) => {
      return String(entry && entry.condition_type || "") === "grappled";
    }), false);
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
  const summary = runShoveActionTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runShoveActionTests
};
