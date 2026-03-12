"use strict";

const assert = require("assert");
const {
  CraftJobManager,
  InMemoryCraftJobStore,
  createCraftJobRecord
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createManager() {
  return new CraftJobManager({
    store: new InMemoryCraftJobStore()
  });
}

function baseJob(overrides) {
  return {
    craft_job_id: "job-001",
    player_id: "player-001",
    recipe_id: "recipe-health-potion",
    required_progress: 10,
    progress_value: 0,
    ...(overrides || {})
  };
}

function runCraftingJobProgressTests() {
  const results = [];

  runTest("job_creation", () => {
    const manager = createManager();
    const created = manager.createCraftJob(baseJob());
    assert.equal(created.craft_job_id, "job-001");
    assert.equal(created.status, "in_progress");
    assert.equal(created.progress_value, 0);
  }, results);

  runTest("progress_update", () => {
    const manager = createManager();
    manager.createCraftJob(baseJob());
    const updated = manager.updateCraftProgress("job-001", 4);
    assert.equal(updated.progress_value, 4);
    assert.equal(updated.status, "in_progress");
  }, results);

  runTest("pause_job", () => {
    const manager = createManager();
    manager.createCraftJob(baseJob());
    const paused = manager.pauseCraftJob("job-001");
    assert.equal(paused.status, "paused");
  }, results);

  runTest("resume_job", () => {
    const manager = createManager();
    manager.createCraftJob(baseJob());
    manager.pauseCraftJob("job-001");
    const resumed = manager.resumeCraftJob("job-001");
    assert.equal(resumed.status, "in_progress");
  }, results);

  runTest("cancel_job", () => {
    const manager = createManager();
    manager.createCraftJob(baseJob());
    const cancelled = manager.cancelCraftJob("job-001");
    assert.equal(cancelled.status, "cancelled");
  }, results);

  runTest("instant_complete_configuration", () => {
    const manager = createManager();
    const created = manager.createCraftJob(
      baseJob({
        craft_job_id: "job-instant",
        instant_complete: true
      })
    );
    assert.equal(created.status, "completed");
    assert.equal(created.required_progress, 0);
    assert.equal(created.progress_value, 0);
  }, results);

  runTest("over_complete_progress_handling", () => {
    const manager = createManager();
    manager.createCraftJob(baseJob({ craft_job_id: "job-over", required_progress: 10 }));
    const updated = manager.updateCraftProgress("job-over", 999);
    assert.equal(updated.progress_value, 10);
    assert.equal(updated.status, "completed");
  }, results);

  runTest("malformed_job_data_handling", () => {
    assert.throws(() => createCraftJobRecord({}), /craft_job_id/);
    assert.throws(
      () => createCraftJobRecord(baseJob({ craft_job_id: "", player_id: "x", recipe_id: "y" })),
      /craft_job_id/
    );
    assert.throws(
      () => createCraftJobRecord(baseJob({ craft_job_id: "bad-1", player_id: "" })),
      /player_id/
    );
    assert.throws(
      () => createCraftJobRecord(baseJob({ craft_job_id: "bad-2", required_progress: -1 })),
      /required_progress/
    );
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
  const summary = runCraftingJobProgressTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCraftingJobProgressTests
};

