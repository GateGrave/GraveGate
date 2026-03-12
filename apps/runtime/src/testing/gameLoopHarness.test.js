"use strict";

const assert = require("assert");
const { createGameLoopHarness, runGameLoopHarness } = require("../gameLoopHarness");

function runTest(name, fn, results) {
  return Promise.resolve()
    .then(fn)
    .then(function onPass() {
      results.push({ name, ok: true });
    })
    .catch(function onFail(error) {
      results.push({ name, ok: false, reason: error.message });
    });
}

async function runGameLoopHarnessTests() {
  const results = [];

  await runTest("harness_runs_end_to_end_with_stable_result_shape", async () => {
    const harness = createGameLoopHarness({
      character_id: "harness-character-001",
      player_id: "harness-player-001",
      inventory_id: "harness-inventory-001",
      session_id: "harness-session-001"
    });

    const out = await harness.run();

    assert.equal(out.ok, true);
    assert.equal(Array.isArray(out.events_processed), true);
    assert.equal(Array.isArray(out.event_log), true);
    assert.equal(typeof out.character_summary, "object");
    assert.equal(typeof out.inventory_summary, "object");

    const processedTypes = out.events_processed.map((x) => x.event_type);
    assert.equal(processedTypes.includes("game_loop_start"), true);
    assert.equal(processedTypes.includes("dungeon_session_start_requested"), true);
    assert.equal(processedTypes.includes("encounter_triggered"), true);
    assert.equal(processedTypes.includes("enemy_defeated"), true);
    assert.equal(processedTypes.includes("reward_event_emitted"), true);
    assert.equal(processedTypes.includes("loot_resolve_requested"), true);
    assert.equal(processedTypes.includes("loot_grant_requested"), true);

    assert.equal(out.character_summary.character_id, "harness-character-001");
    assert.equal(out.character_summary.player_id, "harness-player-001");
    assert.equal(out.inventory_summary.inventory_id, "harness-inventory-001");
    assert.equal(out.inventory_summary.stackable_count >= 1, true);
  }, results);

  await runTest("runGameLoopHarness_is_repeatable_for_integration_foundation", async () => {
    const outA = await runGameLoopHarness({
      character_id: "repeat-character-001",
      player_id: "repeat-player-001",
      inventory_id: "repeat-inventory-001",
      session_id: "repeat-session-001"
    });
    const outB = await runGameLoopHarness({
      character_id: "repeat-character-001",
      player_id: "repeat-player-001",
      inventory_id: "repeat-inventory-001",
      session_id: "repeat-session-001"
    });

    assert.equal(outA.ok, true);
    assert.equal(outB.ok, true);
    assert.equal(Array.isArray(outA.events_processed), true);
    assert.equal(Array.isArray(outB.events_processed), true);
    assert.equal(typeof outA.character_summary.character_id, "string");
    assert.equal(typeof outB.character_summary.character_id, "string");
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
  runGameLoopHarnessTests()
    .then(function done(summary) {
      console.log(JSON.stringify(summary, null, 2));
      if (!summary.ok) {
        process.exitCode = 1;
      }
    })
    .catch(function failed(error) {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  runGameLoopHarnessTests
};
