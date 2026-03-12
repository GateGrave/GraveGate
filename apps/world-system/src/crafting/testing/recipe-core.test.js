"use strict";

const assert = require("assert");
const {
  RecipeManager,
  InMemoryRecipeStore,
  createRecipeRecord
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
  return new RecipeManager({
    store: new InMemoryRecipeStore()
  });
}

function baseRecipe(overrides) {
  return {
    recipe_id: "recipe-health-potion",
    recipe_name: "Health Potion",
    output_item_id: "item-health-potion",
    output_quantity: 1,
    recipe_type: "alchemy",
    required_materials: [
      { item_id: "item-herb-red", quantity: 2 },
      { item_id: "item-water-flask", quantity: 1 }
    ],
    required_profession: "alchemist",
    required_tool: "tool-alchemy-kit",
    required_station: "station-lab",
    craft_time: 60,
    difficulty: "easy",
    active_flag: true,
    ...(overrides || {})
  };
}

function runRecipeCoreTests() {
  const results = [];

  runTest("recipe_creation", () => {
    const manager = createManager();
    const created = manager.createRecipe(baseRecipe());

    assert.equal(created.recipe_id, "recipe-health-potion");
    assert.equal(created.recipe_name, "Health Potion");
    assert.equal(created.output_item_id, "item-health-potion");
    assert.equal(created.output_quantity, 1);
    assert.equal(created.required_materials.length, 2);
    assert.equal(created.active_flag, true);
    assert.equal(typeof created.updated_at, "string");
  }, results);

  runTest("fetch_recipe", () => {
    const manager = createManager();
    manager.createRecipe(baseRecipe());

    const loaded = manager.getRecipe("recipe-health-potion");
    assert.ok(loaded);
    assert.equal(loaded.recipe_id, "recipe-health-potion");
  }, results);

  runTest("update_recipe", () => {
    const manager = createManager();
    manager.createRecipe(baseRecipe());

    const updated = manager.updateRecipe("recipe-health-potion", {
      recipe_name: "Greater Health Potion",
      output_quantity: 2,
      difficulty: "medium"
    });

    assert.ok(updated);
    assert.equal(updated.recipe_name, "Greater Health Potion");
    assert.equal(updated.output_quantity, 2);
    assert.equal(updated.difficulty, "medium");
  }, results);

  runTest("delete_recipe", () => {
    const manager = createManager();
    manager.createRecipe(baseRecipe());

    const removed = manager.deleteRecipe("recipe-health-potion");
    const loaded = manager.getRecipe("recipe-health-potion");

    assert.equal(removed, true);
    assert.equal(loaded, null);
  }, results);

  runTest("list_by_profession", () => {
    const manager = createManager();
    manager.createRecipe(baseRecipe({ recipe_id: "r-1", recipe_type: "alchemy", required_profession: "alchemist" }));
    manager.createRecipe(baseRecipe({ recipe_id: "r-2", recipe_type: "smithing", required_profession: "blacksmith" }));
    manager.createRecipe(baseRecipe({ recipe_id: "r-3", recipe_type: "alchemy", required_profession: "alchemist" }));

    const listed = manager.listRecipesByProfession("alchemist");
    assert.equal(listed.length, 2);
    assert.ok(listed.every((recipe) => recipe.required_profession === "alchemist"));
  }, results);

  runTest("list_by_type", () => {
    const manager = createManager();
    manager.createRecipe(baseRecipe({ recipe_id: "r-4", recipe_type: "alchemy" }));
    manager.createRecipe(baseRecipe({ recipe_id: "r-5", recipe_type: "smithing", required_profession: "blacksmith" }));
    manager.createRecipe(baseRecipe({ recipe_id: "r-6", recipe_type: "alchemy" }));

    const listed = manager.listRecipesByType("alchemy");
    assert.equal(listed.length, 2);
    assert.ok(listed.every((recipe) => recipe.recipe_type === "alchemy"));
  }, results);

  runTest("malformed_recipe_rejection", () => {
    assert.throws(
      () =>
        createRecipeRecord(
          baseRecipe({
            required_materials: "not-an-array"
          })
        ),
      /required_materials/
    );

    assert.throws(
      () =>
        createRecipeRecord(
          baseRecipe({
            output_quantity: -1
          })
        ),
      /output_quantity/
    );
  }, results);

  runTest("missing_required_fields_handling", () => {
    assert.throws(() => createRecipeRecord({}), /recipe_id/);
    assert.throws(
      () =>
        createRecipeRecord({
          recipe_id: "recipe-missing-name"
        }),
      /recipe_name/
    );
    assert.throws(
      () =>
        createRecipeRecord({
          recipe_id: "recipe-missing-output",
          recipe_name: "Broken Recipe"
        }),
      /output_item_id/
    );
  }, results);

  runTest("inactive_recipe_handling", () => {
    const manager = createManager();
    manager.createRecipe(
      baseRecipe({
        recipe_id: "r-inactive",
        active_flag: false
      })
    );

    const hiddenByDefault = manager.getRecipe("r-inactive");
    const visibleWithOption = manager.getRecipe("r-inactive", { includeInactive: true });
    const listHiddenByDefault = manager.listRecipesByProfession("alchemist");
    const listWithOption = manager.listRecipesByProfession("alchemist", { includeInactive: true });

    assert.equal(hiddenByDefault, null);
    assert.ok(visibleWithOption);
    assert.equal(listHiddenByDefault.length, 0);
    assert.equal(listWithOption.length, 1);
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
  const summary = runRecipeCoreTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runRecipeCoreTests
};

