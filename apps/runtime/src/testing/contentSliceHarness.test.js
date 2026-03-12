"use strict";

const assert = require("assert");
const { runContentSliceHarness } = require("./contentSliceHarness");

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

async function runContentSliceHarnessTests() {
  const results = [];

  await runTest("content_slice_runs_create_to_exit_with_starter_content", async () => {
    const out = await runContentSliceHarness({
      player_id: "player-content-loop-test-001",
      character_name: "Starter Loop Tester"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "content_slice_completed");
    assert.equal(typeof out.payload, "object");

    const responses = out.payload.command_responses;
    assert.equal(responses.start.payload.response_type, "start");
    assert.equal(responses.profile.payload.response_type, "profile");
    assert.equal(responses.inventory.payload.response_type, "inventory");
    assert.equal(responses.equip.payload.response_type, "equip");
    assert.equal(responses.dungeon_enter.payload.response_type, "dungeon_enter");
    assert.equal(responses.move.payload.response_type, "move");
    assert.equal(responses.attack.payload.response_type, "attack");
    assert.equal(responses.use.payload.response_type, "use");
    assert.equal(responses.leave.payload.response_type, "leave_session");
  }, results);

  await runTest("content_slice_persists_loot_and_closes_session", async () => {
    const out = await runContentSliceHarness({
      player_id: "player-content-loop-test-002",
      character_name: "Starter Loop Tester 2"
    });

    assert.equal(out.ok, true);
    assert.equal(typeof out.payload.final_inventory, "object");
    assert.equal(Array.isArray(out.payload.final_inventory.stackable_items), true);

    const hasRatTail = out.payload.final_inventory.stackable_items.some((entry) => {
      return String(entry.item_id || "") === "item_rat_tail";
    });
    assert.equal(hasRatTail, true);
    assert.equal(out.payload.sessions_remaining, 0);
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
  runContentSliceHarnessTests()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      if (!summary.ok) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  runContentSliceHarnessTests
};
