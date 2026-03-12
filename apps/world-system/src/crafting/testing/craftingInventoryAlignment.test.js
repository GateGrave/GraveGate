"use strict";

const assert = require("assert");
const { createInventoryRecord } = require("../../../../inventory-system/src/inventory.schema");
const { finalizeCraftWithResourceConsumption } = require("../craft-resource-consumption.flow");

class InMemoryCanonicalInventoryService {
  constructor() {
    this.byId = new Map();
  }

  getInventory(inventory_id) {
    const record = this.byId.get(String(inventory_id)) || null;
    if (!record) {
      return { ok: false, payload: { inventory: null }, error: "inventory not found" };
    }
    return {
      ok: true,
      payload: { inventory: JSON.parse(JSON.stringify(record)) },
      error: null
    };
  }

  saveInventory(inventory) {
    if (!inventory || !inventory.inventory_id) {
      return { ok: false, error: "inventory.inventory_id is required" };
    }
    this.byId.set(String(inventory.inventory_id), JSON.parse(JSON.stringify(inventory)));
    return { ok: true, payload: { inventory }, error: null };
  }
}

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createCraftJob(overrides) {
  return {
    craft_job_id: "job-align-001",
    player_id: "player-align-001",
    recipe_id: "recipe-align-potion",
    progress_value: 10,
    required_progress: 10,
    status: "completed",
    ...(overrides || {})
  };
}

function createRecipe(overrides) {
  return {
    recipe_id: "recipe-align-potion",
    required_materials: [
      { item_id: "item-herb", quantity: 2 },
      { item_id: "item-water", quantity: 1 }
    ],
    output_item_id: "item-potion",
    output_quantity: 1,
    ...(overrides || {})
  };
}

function seedCanonicalInventory(service, inventoryId) {
  return service.saveInventory(
    createInventoryRecord({
      inventory_id: inventoryId,
      owner_type: "player",
      owner_id: "player-align-001",
      stackable_items: [
        { item_id: "item-herb", quantity: 4, owner_player_id: "player-align-001", stackable: true },
        { item_id: "item-water", quantity: 2, owner_player_id: "player-align-001", stackable: true }
      ]
    })
  );
}

function runCraftingInventoryAlignmentTests() {
  const results = [];

  runTest("crafted_item_output_into_canonical_inventory", () => {
    const inventoryService = new InMemoryCanonicalInventoryService();
    seedCanonicalInventory(inventoryService, "inv-align-001");

    const out = finalizeCraftWithResourceConsumption({
      craft_job: createCraftJob(),
      recipe: createRecipe(),
      inventoryService,
      inventory_id: "inv-align-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "craft_finalize_success");

    const after = inventoryService.getInventory("inv-align-001").payload.inventory;
    assert.equal(Array.isArray(after.stackable_items), true);
    const potion = after.stackable_items.find((x) => x.item_id === "item-potion");
    assert.ok(potion);
    assert.equal(potion.quantity, 1);
  }, results);

  runTest("resource_consumption_from_canonical_inventory", () => {
    const inventoryService = new InMemoryCanonicalInventoryService();
    seedCanonicalInventory(inventoryService, "inv-align-002");

    const out = finalizeCraftWithResourceConsumption({
      craft_job: createCraftJob({ craft_job_id: "job-align-002" }),
      recipe: createRecipe(),
      inventoryService,
      inventory_id: "inv-align-002"
    });

    assert.equal(out.ok, true);
    const after = inventoryService.getInventory("inv-align-002").payload.inventory;
    const herb = after.stackable_items.find((x) => x.item_id === "item-herb");
    const water = after.stackable_items.find((x) => x.item_id === "item-water");
    assert.equal(herb.quantity, 2);
    assert.equal(water.quantity, 1);
  }, results);

  runTest("rollback_behavior_on_failed_grant", () => {
    const inventoryService = new InMemoryCanonicalInventoryService();
    seedCanonicalInventory(inventoryService, "inv-align-003");
    const before = inventoryService.getInventory("inv-align-003").payload.inventory;

    const failingInventoryService = {
      getInventory(id) {
        return inventoryService.getInventory(id);
      },
      saveInventory(inventory) {
        const hasPotion = Array.isArray(inventory?.stackable_items)
          ? inventory.stackable_items.some((x) => x.item_id === "item-potion")
          : false;
        if (hasPotion) {
          return { ok: false, error: "forced_grant_save_failure" };
        }
        return inventoryService.saveInventory(inventory);
      }
    };

    const out = finalizeCraftWithResourceConsumption({
      craft_job: createCraftJob({ craft_job_id: "job-align-003" }),
      recipe: createRecipe(),
      inventoryService: failingInventoryService,
      inventory_id: "inv-align-003"
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "output_grant_failed_rolled_back");
    const after = inventoryService.getInventory("inv-align-003").payload.inventory;
    assert.equal(JSON.stringify(after), JSON.stringify(before));
  }, results);

  runTest("failure_on_invalid_inventory_service_input", () => {
    const out = finalizeCraftWithResourceConsumption({
      craft_job: createCraftJob({ craft_job_id: "job-align-004" }),
      recipe: createRecipe(),
      inventoryService: {},
      inventory_id: "inv-align-004"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "craft_finalize_failed");
    assert.equal(out.payload.reason, "invalid_inventory_service");
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
  const summary = runCraftingInventoryAlignmentTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCraftingInventoryAlignmentTests
};
