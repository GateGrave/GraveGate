"use strict";

const assert = require("assert");
const { CraftingLogger } = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runCraftingLoggingSystemTests() {
  const results = [];

  runTest("log_creation", () => {
    const logger = new CraftingLogger();
    const entry = logger.logCraftStarted({
      craft_job_id: "job-001",
      player_id: "player-001",
      recipe_id: "recipe-001",
      result: "started"
    });

    assert.equal(entry.craft_job_id, "job-001");
    assert.equal(entry.event_type, "craft_started");
    assert.equal(typeof entry.timestamp, "string");
    assert.equal(logger.listLogs().length, 1);
  }, results);

  runTest("correct_event_type_assignment", () => {
    const logger = new CraftingLogger();
    logger.logCraftStarted({ craft_job_id: "job-1" });
    logger.logCraftProgressed({ craft_job_id: "job-1" });
    logger.logCraftCheckResolved({ craft_job_id: "job-1" });
    logger.logCraftCompleted({ craft_job_id: "job-1" });
    logger.logMaterialsConsumed({ craft_job_id: "job-1" });

    const types = logger.listLogs().map((x) => x.event_type);
    assert.ok(types.includes("craft_started"));
    assert.ok(types.includes("craft_progressed"));
    assert.ok(types.includes("craft_check_resolved"));
    assert.ok(types.includes("craft_completed"));
    assert.ok(types.includes("materials_consumed"));
  }, results);

  runTest("failed_craft_logging", () => {
    const logger = new CraftingLogger();
    const failed = logger.logCraftFailed({
      craft_job_id: "job-fail",
      player_id: "player-001",
      recipe_id: "recipe-001",
      reason: "check_failed"
    });

    assert.equal(failed.event_type, "craft_failed");
    assert.equal(failed.result, "check_failed");
  }, results);

  runTest("malformed_log_payload_handling", () => {
    const logger = new CraftingLogger();
    const bad = logger.log("not-an-object");

    assert.equal(bad.event_type, "craft_failed");
    assert.equal(bad.result, "invalid_payload");
    assert.equal(logger.listLogs().length, 1);
  }, results);

  runTest("logs_do_not_mutate_inventory_recipe_or_craft_job_state", () => {
    const logger = new CraftingLogger();
    const inventory = {
      inventory_id: "inv-001",
      item_entries: [{ item_id: "item-herb", quantity: 2 }]
    };
    const recipe = {
      recipe_id: "recipe-001",
      required_materials: [{ item_id: "item-herb", quantity: 1 }]
    };
    const craftJob = {
      craft_job_id: "job-001",
      status: "in_progress"
    };

    const beforeInventory = JSON.stringify(inventory);
    const beforeRecipe = JSON.stringify(recipe);
    const beforeCraftJob = JSON.stringify(craftJob);

    logger.logCraftProgressed({
      craft_job_id: craftJob.craft_job_id,
      player_id: "player-001",
      recipe_id: recipe.recipe_id,
      materials_snapshot: { inventory },
      output_snapshot: { recipe, craftJob },
      result: "tick"
    });

    assert.equal(JSON.stringify(inventory), beforeInventory);
    assert.equal(JSON.stringify(recipe), beforeRecipe);
    assert.equal(JSON.stringify(craftJob), beforeCraftJob);
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
  const summary = runCraftingLoggingSystemTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCraftingLoggingSystemTests
};

