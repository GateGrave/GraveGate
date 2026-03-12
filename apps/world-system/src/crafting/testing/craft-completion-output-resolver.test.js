"use strict";

const assert = require("assert");
const {
  resolveCraftCompletion,
  ProcessedCraftCompletionStore
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createCompletedJob(overrides) {
  return {
    craft_job_id: "job-complete-001",
    player_id: "player-001",
    recipe_id: "recipe-healing-potion",
    progress_value: 10,
    required_progress: 10,
    status: "completed",
    ...(overrides || {})
  };
}

function createRecipe(overrides) {
  return {
    recipe_id: "recipe-healing-potion",
    output_item_id: "item-healing-potion",
    output_quantity: 1,
    ...(overrides || {})
  };
}

function runCraftCompletionOutputResolverTests() {
  const results = [];

  runTest("successful_craft_completion", () => {
    const store = new ProcessedCraftCompletionStore();
    const resolved = resolveCraftCompletion(
      {
        craft_job: createCompletedJob(),
        recipe: createRecipe()
      },
      { processedStore: store }
    );

    assert.equal(resolved.ok, true);
    assert.equal(resolved.completion_payload.event_type, "crafted_output_ready");
    assert.equal(resolved.completion_payload.outputs.length, 1);
  }, results);

  runTest("incomplete_craft_job_rejection", () => {
    const resolved = resolveCraftCompletion({
      craft_job: createCompletedJob({
        status: "in_progress",
        progress_value: 3,
        required_progress: 10
      }),
      recipe: createRecipe()
    });

    assert.equal(resolved.ok, false);
    assert.ok(/not complete/.test(resolved.error));
  }, results);

  runTest("invalid_recipe_output_rejection", () => {
    const resolved = resolveCraftCompletion({
      craft_job: createCompletedJob(),
      recipe: createRecipe({
        output_item_id: "",
        output_quantity: 0
      })
    });

    assert.equal(resolved.ok, false);
    assert.ok(/output_item_id|output_quantity/.test(resolved.error));
  }, results);

  runTest("multi_quantity_output", () => {
    const resolved = resolveCraftCompletion({
      craft_job: createCompletedJob(),
      recipe: createRecipe({
        output_item_id: "item-arrow",
        output_quantity: 20
      })
    });

    assert.equal(resolved.ok, true);
    assert.equal(resolved.completion_payload.outputs[0].quantity, 20);
    assert.equal(resolved.completion_payload.total_output_quantity, 20);
  }, results);

  runTest("malformed_completion_payload_handling", () => {
    const missingCraftJob = resolveCraftCompletion({
      recipe: createRecipe()
    });
    const missingRecipe = resolveCraftCompletion({
      craft_job: createCompletedJob()
    });

    assert.equal(missingCraftJob.ok, false);
    assert.equal(missingRecipe.ok, false);
    assert.ok(/Craft job|recipe/.test(missingCraftJob.error + " " + missingRecipe.error));
  }, results);

  runTest("duplicate_completion_prevention", () => {
    const store = new ProcessedCraftCompletionStore();
    const payload = {
      craft_job: createCompletedJob({ craft_job_id: "job-dupe-001" }),
      recipe: createRecipe()
    };

    const first = resolveCraftCompletion(payload, { processedStore: store });
    const second = resolveCraftCompletion(payload, { processedStore: store });

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.code, "DUPLICATE_COMPLETION");
    assert.equal(second.already_processed, true);
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
  const summary = runCraftCompletionOutputResolverTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCraftCompletionOutputResolverTests
};

