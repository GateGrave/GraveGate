"use strict";

const assert = require("assert");
const { createInventoryRecord } = require("../../../../inventory-system/src/inventory.schema");
const {
  addItemToInventory,
  removeItemFromInventory,
  normalizeInventoryShape
} = require("../../../../inventory-system/src/mutationHelpers");
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

function createCraftJob(overrides) {
  return {
    craft_job_id: "job-mut-001",
    player_id: "player-mut-001",
    recipe_id: "recipe-mut-001",
    progress_value: 100,
    required_progress: 100,
    status: "completed",
    ...overrides
  };
}

function createRecipe(overrides) {
  return {
    recipe_id: "recipe-mut-001",
    required_materials: [{ item_id: "item-herb", quantity: 2 }],
    output_item_id: "item-potion",
    output_quantity: 1,
    ...overrides
  };
}

function seedCanonicalInventory(service, inventoryId) {
  service.saveInventory(
    createInventoryRecord({
      inventory_id: inventoryId,
      owner_type: "player",
      owner_id: "player-mut-001",
      stackable_items: [{ item_id: "item-herb", quantity: 5, owner_player_id: "player-mut-001", stackable: true }]
    })
  );
}

function createMutationHelpersSpy() {
  const calls = {
    add: 0,
    remove: 0,
    normalize: 0
  };

  return {
    helpers: {
      addItemToInventory(inventory, item) {
        calls.add += 1;
        return addItemToInventory(inventory, item);
      },
      removeItemFromInventory(inventory, item_id, quantity, options) {
        calls.remove += 1;
        return removeItemFromInventory(inventory, item_id, quantity, options);
      },
      normalizeInventoryShape(inventory) {
        calls.normalize += 1;
        return normalizeInventoryShape(inventory);
      }
    },
    calls
  };
}

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runCraftingMutationAlignmentTests() {
  const results = [];

  runTest("crafted_items_are_added_correctly", () => {
    const inventoryService = new InMemoryCanonicalInventoryService();
    const spy = createMutationHelpersSpy();
    seedCanonicalInventory(inventoryService, "inv-mut-001");

    const out = finalizeCraftWithResourceConsumption({
      craft_job: createCraftJob(),
      recipe: createRecipe(),
      inventoryService,
      inventory_id: "inv-mut-001",
      mutation_helpers: spy.helpers
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "craft_finalize_success");
    assert.equal(spy.calls.add > 0, true);

    const after = inventoryService.getInventory("inv-mut-001").payload.inventory;
    const potion = after.stackable_items.find((x) => x.item_id === "item-potion");
    assert.ok(potion);
    assert.equal(potion.quantity, 1);
  }, results);

  runTest("consumed_materials_are_removed_correctly", () => {
    const inventoryService = new InMemoryCanonicalInventoryService();
    const spy = createMutationHelpersSpy();
    seedCanonicalInventory(inventoryService, "inv-mut-002");

    const out = finalizeCraftWithResourceConsumption({
      craft_job: createCraftJob({ craft_job_id: "job-mut-002" }),
      recipe: createRecipe(),
      inventoryService,
      inventory_id: "inv-mut-002",
      mutation_helpers: spy.helpers
    });

    assert.equal(out.ok, true);
    assert.equal(spy.calls.remove > 0, true);
    assert.equal(spy.calls.normalize > 0, true);

    const after = inventoryService.getInventory("inv-mut-002").payload.inventory;
    const herb = after.stackable_items.find((x) => x.item_id === "item-herb");
    assert.ok(herb);
    assert.equal(herb.quantity, 3);
  }, results);

  runTest("rollback_works_on_failure", () => {
    const inventoryService = new InMemoryCanonicalInventoryService();
    const spy = createMutationHelpersSpy();
    seedCanonicalInventory(inventoryService, "inv-mut-003");
    const before = inventoryService.getInventory("inv-mut-003").payload.inventory;

    const failingService = {
      getInventory(id) {
        return inventoryService.getInventory(id);
      },
      saveInventory(inventory) {
        const hasCraftedOutput = Array.isArray(inventory?.stackable_items)
          ? inventory.stackable_items.some((x) => x.item_id === "item-potion")
          : false;
        if (hasCraftedOutput) {
          return { ok: false, error: "forced_output_save_failure" };
        }
        return inventoryService.saveInventory(inventory);
      }
    };

    const out = finalizeCraftWithResourceConsumption({
      craft_job: createCraftJob({ craft_job_id: "job-mut-003" }),
      recipe: createRecipe(),
      inventoryService: failingService,
      inventory_id: "inv-mut-003",
      mutation_helpers: spy.helpers
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "output_grant_failed_rolled_back");

    const after = inventoryService.getInventory("inv-mut-003").payload.inventory;
    assert.equal(JSON.stringify(after), JSON.stringify(before));
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
  const summary = runCraftingMutationAlignmentTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCraftingMutationAlignmentTests
};

