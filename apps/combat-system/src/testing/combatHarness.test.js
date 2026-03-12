"use strict";

const assert = require("assert");
const { runCombatHarness } = require("./combatHarness");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runCombatHarnessTests() {
  const results = [];

  runTest("harness_runs_start_to_finish_without_crashing", () => {
    const out = runCombatHarness({
      attack_rolls: [18, 17, 16, 15, 14, 13],
      damage_rolls: [4, 3, 4, 3, 4, 3],
      max_loops: 12
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "combat_harness_completed");
    assert.equal(Array.isArray(out.payload.log), true);
    assert.ok(out.payload.log.length > 0);
    assert.equal(typeof out.payload.completed, "boolean");
    assert.equal(out.payload.final_combat.combat_id, "combat-harness-001");
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
  const summary = runCombatHarnessTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCombatHarnessTests
};

