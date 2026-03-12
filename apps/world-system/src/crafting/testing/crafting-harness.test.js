"use strict";

const assert = require("assert");
const { loadRecipeContent } = require("../../content");
const { mapContentRecipeToCraftRecipe, canCraftRecipe } = require("../index");
const { CraftingSimulationRunner } = require("./crafting-simulation-runner");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runCraftingHarnessTests() {
  const results = [];

  runTest("successful_end_to_end_craft_flow", () => {
    const runner = new CraftingSimulationRunner();
    runner.setupMocks();
    const out = runner.scenarioSuccessfulEndToEndCraftFlow();
    assert.equal(out.ok, true);
    assert.equal(out.payload.finalize.ok, true);
  }, results);

  runTest("failed_eligibility_scenario", () => {
    const runner = new CraftingSimulationRunner();
    runner.setupMocks();
    const out = runner.scenarioFailedEligibility();
    assert.equal(out.ok, false);
    assert.equal(out.payload.eligibility.ok, false);
  }, results);

  runTest("failed_missing_materials_scenario", () => {
    const runner = new CraftingSimulationRunner();
    runner.setupMocks();
    const out = runner.scenarioFailedMissingMaterials();
    assert.equal(out.ok, false);
    assert.equal(out.payload.material_validation.ok, false);
  }, results);

  runTest("successful_output_grant", () => {
    const runner = new CraftingSimulationRunner();
    runner.setupMocks();
    const out = runner.scenarioSuccessfulEndToEndCraftFlow();
    const inventory = runner.worldStorage.inventories.loadInventory(runner.players.crafter.inventory_id);
    const potionRow = inventory.item_entries.find((x) => x.item_id === "item-healing-potion");
    assert.equal(out.payload.finalize.ok, true);
    assert.ok(potionRow);
  }, results);

  runTest("duplicate_completion_prevention", () => {
    const runner = new CraftingSimulationRunner();
    runner.setupMocks();
    const out = runner.scenarioDuplicateCompletionPrevention();
    assert.equal(out.payload.first.ok, true);
    assert.equal(out.payload.second.ok, true);
    assert.equal(out.payload.second.event_type, "craft_finalize_skipped");
  }, results);

  runTest("rollback_safety_for_partial_failure", () => {
    const runner = new CraftingSimulationRunner();
    runner.setupMocks();
    const out = runner.scenarioRollbackSafetyPartialFailure();
    assert.equal(out.payload.finalized.ok, false);
    assert.equal(out.payload.finalized.payload.reason, "output_grant_failed_rolled_back");
    assert.equal(out.payload.inventory_restored, true);
  }, results);

  runTest("snapshot_restore_correctness", () => {
    const runner = new CraftingSimulationRunner();
    runner.setupMocks();
    runner.scenarioSuccessfulEndToEndCraftFlow();
    const out = runner.scenarioSnapshotRestore();
    assert.equal(out.payload.snapshot.ok, true);
    assert.equal(out.payload.restore.ok, true);
  }, results);

  runTest("starter_content_recipe_can_be_resolved_and_completed", () => {
    const runner = new CraftingSimulationRunner();
    runner.setupMocks();
    const out = runner.scenarioContentRecipeResolutionAndCraft();

    assert.equal(out.ok, true);
    assert.equal(out.payload.eligibility.ok, true);
    assert.equal(out.payload.material_validation.ok, true);

    const inventoryAfterReload = runner.worldStorage.inventories.loadInventory(runner.players.crafter.inventory_id);
    const crafted = inventoryAfterReload.item_entries.find((row) => row.item_id === "item_minor_heal_potion");
    assert.ok(crafted);
    assert.ok(crafted.quantity >= 1);
  }, results);

  runTest("blocked_starter_recipe_attempt_behaves_clearly", () => {
    const runner = new CraftingSimulationRunner();
    runner.setupMocks();

    const content = loadRecipeContent();
    assert.equal(content.ok, true);

    const blacksmithRecipeEntry = content.payload.entries.find((row) => row.recipe_id === "recipe_sharpened_blade_kit");
    assert.ok(blacksmithRecipeEntry);

    const mapped = mapContentRecipeToCraftRecipe(blacksmithRecipeEntry);
    assert.equal(mapped.ok, true);

    const noviceContext = runner.getPlayerContext(runner.players.novice.player_id);
    const noviceInventory = runner.toMaterialView(runner.getInventory(runner.players.novice.player_id));
    const eligibility = canCraftRecipe(noviceContext, mapped.payload.recipe, noviceInventory);

    assert.equal(eligibility.ok, false);
    assert.equal(Array.isArray(eligibility.failure_reasons), true);
    assert.ok(eligibility.failure_reasons.length >= 1);
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
  const summary = runCraftingHarnessTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCraftingHarnessTests
};
