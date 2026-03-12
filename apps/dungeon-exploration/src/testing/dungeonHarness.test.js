"use strict";

const assert = require("assert");
const { runDungeonHarness } = require("./dungeonHarness");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runDungeonHarnessTests() {
  const results = [];

  runTest("dungeon_harness_runs_start_to_finish", () => {
    const out = runDungeonHarness({
      session_id: "dungeon-harness-test-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dungeon_harness_completed");
    assert.equal(out.payload.session_id, "dungeon-harness-test-001");
    assert.equal(out.payload.final_session.current_room_id, "room-A2");
    assert.equal(out.payload.final_session.discovered_rooms.includes("room-A2"), true);
    assert.equal(out.payload.final_session.cleared_rooms.includes("room-A2"), true);

    const hasMoveStep = out.payload.log.some((x) => x.step === "move_party");
    const hasResolveStep = out.payload.log.some((x) => x.step === "resolve_room_entry");
    assert.equal(hasMoveStep, true);
    assert.equal(hasResolveStep, true);
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
  const summary = runDungeonHarnessTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runDungeonHarnessTests
};
