"use strict";

const assert = require("assert");
const {
  canCraftRecipe,
  getCraftingFailureReasons
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function hasCode(reasons, code) {
  return reasons.some((entry) => entry && entry.code === code);
}

function baseRecipe(overrides) {
  return {
    recipe_id: "recipe-steel-sword",
    recipe_name: "Steel Sword",
    active_flag: true,
    required_profession: "blacksmith",
    required_tool: "tool-hammer",
    required_station: "station-anvil",
    unlock_required: true,
    required_materials: [
      { item_id: "item-steel-ingot", quantity: 3 },
      { item_id: "item-wood-grip", quantity: 1 }
    ],
    ...(overrides || {})
  };
}

function basePlayerContext(overrides) {
  return {
    player_id: "player-001",
    professions: ["blacksmith"],
    unlocked_recipe_ids: ["recipe-steel-sword"],
    tools: ["tool-hammer"],
    stations: ["station-anvil"],
    ...(overrides || {})
  };
}

function baseInventory(overrides) {
  const value = {
    items: [
      { item_id: "item-steel-ingot", quantity: 3 },
      { item_id: "item-wood-grip", quantity: 1 }
    ]
  };
  return { ...value, ...(overrides || {}) };
}

function runCraftingEligibilityValidatorTests() {
  const results = [];

  runTest("valid_crafting_eligibility", () => {
    const result = canCraftRecipe(basePlayerContext(), baseRecipe(), baseInventory());
    assert.equal(result.ok, true);
    assert.equal(result.failure_reasons.length, 0);
  }, results);

  runTest("inactive_recipe_rejection", () => {
    const reasons = getCraftingFailureReasons(
      basePlayerContext(),
      baseRecipe({ active_flag: false }),
      baseInventory()
    );
    assert.equal(hasCode(reasons, "RECIPE_INACTIVE"), true);
  }, results);

  runTest("missing_profession", () => {
    const reasons = getCraftingFailureReasons(
      basePlayerContext({ professions: ["alchemist"] }),
      baseRecipe(),
      baseInventory()
    );
    assert.equal(hasCode(reasons, "MISSING_PROFESSION"), true);
  }, results);

  runTest("missing_tool", () => {
    const reasons = getCraftingFailureReasons(
      basePlayerContext({ tools: [] }),
      baseRecipe(),
      baseInventory()
    );
    assert.equal(hasCode(reasons, "MISSING_TOOL"), true);
  }, results);

  runTest("missing_station", () => {
    const reasons = getCraftingFailureReasons(
      basePlayerContext({ stations: [] }),
      baseRecipe(),
      baseInventory()
    );
    assert.equal(hasCode(reasons, "MISSING_STATION"), true);
  }, results);

  runTest("missing_materials", () => {
    const reasons = getCraftingFailureReasons(
      basePlayerContext(),
      baseRecipe(),
      baseInventory({
        items: [{ item_id: "item-steel-ingot", quantity: 1 }]
      })
    );
    assert.equal(hasCode(reasons, "MISSING_MATERIALS"), true);
  }, results);

  runTest("missing_recipe_unlock", () => {
    const reasons = getCraftingFailureReasons(
      basePlayerContext({ unlocked_recipe_ids: [] }),
      baseRecipe({ unlock_required: true }),
      baseInventory()
    );
    assert.equal(hasCode(reasons, "MISSING_RECIPE_UNLOCK"), true);
  }, results);

  runTest("malformed_player_context_handling", () => {
    const result = canCraftRecipe(null, baseRecipe(), baseInventory());
    assert.equal(result.ok, false);
    assert.equal(hasCode(result.failure_reasons, "INVALID_PLAYER_CONTEXT"), true);
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
  const summary = runCraftingEligibilityValidatorTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCraftingEligibilityValidatorTests
};

