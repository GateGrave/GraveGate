"use strict";

const assert = require("assert");
const {
  validateRecipeMaterials,
  getMissingMaterials,
  hasAllRequiredMaterials
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runResourceRequirementSystemTests() {
  const results = [];

  const baseRecipe = {
    recipe_id: "recipe-iron-sword",
    required_materials: [
      { item_id: "item-iron-ingot", quantity: 3 },
      { item_id: "item-wood-grip", quantity: 1 }
    ]
  };

  runTest("all_materials_present", () => {
    const inventory = {
      items: [
        { item_id: "item-iron-ingot", quantity: 3 },
        { item_id: "item-wood-grip", quantity: 1 }
      ]
    };
    const result = validateRecipeMaterials(baseRecipe, inventory);
    assert.equal(result.ok, true);
    assert.equal(result.missing_materials.length, 0);
  }, results);

  runTest("missing_materials", () => {
    const inventory = {
      items: [{ item_id: "item-iron-ingot", quantity: 3 }]
    };
    const missing = getMissingMaterials(baseRecipe, inventory);
    assert.equal(missing.length, 1);
    assert.equal(missing[0].item_id, "item-wood-grip");
  }, results);

  runTest("insufficient_quantity", () => {
    const inventory = {
      items: [
        { item_id: "item-iron-ingot", quantity: 1 },
        { item_id: "item-wood-grip", quantity: 1 }
      ]
    };
    const result = validateRecipeMaterials(baseRecipe, inventory);
    assert.equal(result.ok, false);
    assert.equal(result.missing_materials.length, 1);
    assert.equal(result.missing_materials[0].item_id, "item-iron-ingot");
    assert.equal(result.missing_materials[0].missing_quantity, 2);
  }, results);

  runTest("exact_quantity_success", () => {
    const inventory = {
      quantities: {
        "item-iron-ingot": 3,
        "item-wood-grip": 1
      }
    };
    assert.equal(hasAllRequiredMaterials(baseRecipe, inventory), true);
  }, results);

  runTest("malformed_material_requirement_handling", () => {
    const malformedRecipe = {
      recipe_id: "bad-recipe",
      required_materials: [{ quantity: 1 }]
    };
    const result = validateRecipeMaterials(malformedRecipe, { items: [] });
    assert.equal(result.ok, false);
    assert.ok(/item_id or alternatives/.test(result.error));
  }, results);

  runTest("empty_inventory_handling", () => {
    const result = validateRecipeMaterials(baseRecipe, { items: [] });
    assert.equal(result.ok, false);
    assert.equal(result.missing_materials.length, 2);
    assert.equal(hasAllRequiredMaterials(baseRecipe, { items: [] }), false);
  }, results);

  runTest("future_safe_alternative_material_structure", () => {
    const alternativeRecipe = {
      recipe_id: "recipe-arcane-powder",
      required_materials: [
        {
          alternatives: [
            { item_id: "item-crystal-shard", quantity: 2 },
            { item_id: "item-mana-dust", quantity: 4 }
          ]
        }
      ]
    };

    const passInventory = {
      items: [{ item_id: "item-mana-dust", quantity: 4 }]
    };
    const failInventory = {
      items: [{ item_id: "item-mana-dust", quantity: 1 }]
    };

    const passResult = validateRecipeMaterials(alternativeRecipe, passInventory);
    const failResult = validateRecipeMaterials(alternativeRecipe, failInventory);

    assert.equal(passResult.ok, true);
    assert.equal(passResult.missing_materials.length, 0);
    assert.equal(failResult.ok, false);
    assert.equal(failResult.missing_materials.length, 1);
    assert.equal(failResult.missing_materials[0].requirement_type, "alternatives");
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
  const summary = runResourceRequirementSystemTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runResourceRequirementSystemTests
};

