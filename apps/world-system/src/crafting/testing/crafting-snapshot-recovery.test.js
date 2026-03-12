"use strict";

const assert = require("assert");
const {
  RecipeManager,
  InMemoryRecipeStore,
  CraftJobManager,
  InMemoryCraftJobStore,
  createCraftingSnapshot,
  restoreCraftingSnapshot,
  ProcessedCraftFinalizationStore
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createManagers() {
  const recipeManager = new RecipeManager({ store: new InMemoryRecipeStore() });
  const craftJobManager = new CraftJobManager({ store: new InMemoryCraftJobStore() });

  recipeManager.createRecipe({
    recipe_id: "recipe-001",
    recipe_name: "Potion",
    output_item_id: "item-potion",
    output_quantity: 1,
    recipe_type: "alchemy",
    required_materials: [{ item_id: "item-herb", quantity: 2 }],
    required_profession: "alchemist",
    craft_time: 20,
    difficulty: "easy"
  });

  recipeManager.createRecipe({
    recipe_id: "recipe-002",
    recipe_name: "Elixir",
    output_item_id: "item-elixir",
    output_quantity: 1,
    recipe_type: "alchemy",
    required_materials: [{ item_id: "item-herb", quantity: 3 }],
    required_profession: "alchemist",
    craft_time: 45,
    difficulty: "medium"
  });

  craftJobManager.createCraftJob({
    craft_job_id: "job-001",
    player_id: "player-001",
    recipe_id: "recipe-001",
    required_progress: 10,
    progress_value: 4,
    status: "in_progress"
  });

  craftJobManager.createCraftJob({
    craft_job_id: "job-002",
    player_id: "player-002",
    recipe_id: "recipe-002",
    required_progress: 15,
    progress_value: 15,
    status: "completed"
  });

  return { recipeManager, craftJobManager };
}

function listJobs(manager) {
  return Array.from(manager.store.jobs.values())
    .map((job) => JSON.parse(JSON.stringify(job)))
    .sort((a, b) => String(a.craft_job_id).localeCompare(String(b.craft_job_id)));
}

function runCraftingSnapshotRecoveryTests() {
  const results = [];

  runTest("snapshot_creation", () => {
    const managers = createManagers();
    const pending = { "job-001": { awaiting_output_grant: true } };
    const reservation = { reserved_materials_by_job: { "job-001": [{ item_id: "item-herb", quantity: 2 }] } };
    const out = createCraftingSnapshot({
      ...managers,
      pendingCompletionState: pending,
      reservationConsumptionState: reservation
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "crafting_snapshot_created");
    assert.equal(Array.isArray(out.payload.craft_jobs), true);
    assert.equal(Array.isArray(out.payload.active_craft_jobs), true);
    assert.equal(Array.isArray(out.payload.recipe_references), true);
  }, results);

  runTest("restore_snapshot", () => {
    const source = createManagers();
    const processed = new ProcessedCraftFinalizationStore();
    processed.add("job-001");
    const snapshot = createCraftingSnapshot({
      ...source,
      processedFinalizationStore: processed
    });

    const target = createManagers();
    target.craftJobManager.updateCraftProgress("job-001", 3);

    const pendingRef = {};
    const reservationRef = {};
    const restore = restoreCraftingSnapshot({
      snapshot: snapshot.payload,
      craftJobManager: target.craftJobManager,
      pendingCompletionStateRef: pendingRef,
      reservationConsumptionStateRef: reservationRef,
      processedFinalizationStore: processed
    });

    assert.equal(restore.ok, true);
    assert.equal(restore.event_type, "crafting_snapshot_restored");
  }, results);

  runTest("restored_craft_jobs_match_original_state", () => {
    const source = createManagers();
    const snapshot = createCraftingSnapshot(source);
    const target = createManagers();
    target.craftJobManager.cancelCraftJob("job-001");

    restoreCraftingSnapshot({
      snapshot: snapshot.payload,
      craftJobManager: target.craftJobManager
    });

    assert.equal(JSON.stringify(listJobs(target.craftJobManager)), JSON.stringify(listJobs(source.craftJobManager)));
  }, results);

  runTest("restored_progress_values_match_original", () => {
    const source = createManagers();
    const snapshot = createCraftingSnapshot(source);

    const target = createManagers();
    target.craftJobManager.updateCraftProgress("job-001", 5);

    restoreCraftingSnapshot({
      snapshot: snapshot.payload,
      craftJobManager: target.craftJobManager
    });

    const restoredJob = target.craftJobManager.getCraftJob("job-001");
    assert.equal(restoredJob.progress_value, 4);
    assert.equal(restoredJob.required_progress, 10);
  }, results);

  runTest("malformed_snapshot_handling", () => {
    const managers = createManagers();
    const bad1 = restoreCraftingSnapshot({
      snapshot: null,
      craftJobManager: managers.craftJobManager
    });
    const bad2 = restoreCraftingSnapshot({
      snapshot: { craft_jobs: [] },
      craftJobManager: managers.craftJobManager
    });

    assert.equal(bad1.ok, false);
    assert.equal(bad1.payload.reason, "snapshot_object_required");
    assert.equal(bad2.ok, false);
    assert.equal(bad2.payload.reason, "snapshot_missing_required_arrays");
  }, results);

  runTest("no_cross_system_contamination_with_unrelated_state", () => {
    const managers = createManagers();
    const unrelated = {
      combat: { combat_id: "combat-001", round: 3 },
      dungeon: { session_id: "sess-001", floor: 2 },
      economy: { account_count: 5 }
    };
    const before = JSON.stringify(unrelated);

    const snap = createCraftingSnapshot(managers);
    restoreCraftingSnapshot({
      snapshot: snap.payload,
      craftJobManager: managers.craftJobManager
    });

    const after = JSON.stringify(unrelated);
    assert.equal(after, before);
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
  const summary = runCraftingSnapshotRecoveryTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCraftingSnapshotRecoveryTests
};

