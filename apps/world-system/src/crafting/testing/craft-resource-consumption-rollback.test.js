"use strict";

const assert = require("assert");
const {
  finalizeCraftWithResourceConsumption,
  ProcessedCraftFinalizationStore
} = require("../index");

class TestInventoryStore {
  constructor() {
    this.map = new Map();
  }

  saveInventory(inventory) {
    if (!inventory || !inventory.inventory_id) {
      throw new Error("saveInventory requires inventory_id");
    }
    this.map.set(inventory.inventory_id, inventory);
    return inventory;
  }

  loadInventory(inventoryId) {
    return this.map.get(inventoryId) || null;
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createInventory() {
  return {
    inventory_id: "inv-player-001",
    owner_character_id: "player-001",
    item_entries: [
      { entry_id: "e1", item_id: "item-herb", quantity: 4 },
      { entry_id: "e2", item_id: "item-water", quantity: 2 }
    ]
  };
}

function createCraftJob(overrides) {
  return {
    craft_job_id: "job-001",
    player_id: "player-001",
    recipe_id: "recipe-potion",
    progress_value: 10,
    required_progress: 10,
    status: "completed",
    ...(overrides || {})
  };
}

function createRecipe(overrides) {
  return {
    recipe_id: "recipe-potion",
    required_materials: [
      { item_id: "item-herb", quantity: 2 },
      { item_id: "item-water", quantity: 1 }
    ],
    output_item_id: "item-potion",
    output_quantity: 1,
    ...(overrides || {})
  };
}

function countItem(inventory, itemId) {
  const rows = Array.isArray(inventory.item_entries) ? inventory.item_entries : [];
  return rows
    .filter((x) => x.item_id === itemId)
    .reduce((sum, x) => sum + (Number.isFinite(x.quantity) ? x.quantity : 1), 0);
}

function createSuccessfulOutputAdapter(inventoryStore) {
  return {
    addDropToInventory(input) {
      const inventory = inventoryStore.loadInventory(input.inventory_id);
      const drop = input.drop || {};
      const quantity = Number.isFinite(drop.quantity) ? Math.floor(drop.quantity) : 1;
      const entries = Array.isArray(inventory.item_entries) ? [...inventory.item_entries] : [];
      entries.push({
        entry_id: `grant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        item_id: drop.item_id,
        quantity
      });
      inventoryStore.saveInventory({
        ...inventory,
        item_entries: entries
      });
      return { ok: true, item_id: drop.item_id, quantity_applied: quantity };
    }
  };
}

function runCraftResourceConsumptionRollbackTests() {
  const results = [];

  runTest("successful_material_consumption_and_output_grant", () => {
    const inventoryStore = new TestInventoryStore();
    inventoryStore.saveInventory(createInventory());

    const outputAdapter = createSuccessfulOutputAdapter(inventoryStore);
    const out = finalizeCraftWithResourceConsumption({
      craft_job: createCraftJob(),
      recipe: createRecipe(),
      inventoryStore,
      inventory_id: "inv-player-001",
      outputGrantAdapter: outputAdapter
    });

    assert.equal(out.ok, true);
    const after = inventoryStore.loadInventory("inv-player-001");
    assert.equal(countItem(after, "item-herb"), 2);
    assert.equal(countItem(after, "item-water"), 1);
    assert.equal(countItem(after, "item-potion"), 1);
  }, results);

  runTest("insufficient_materials_at_finalization", () => {
    const inventoryStore = new TestInventoryStore();
    inventoryStore.saveInventory({
      inventory_id: "inv-player-001",
      owner_character_id: "player-001",
      item_entries: [{ entry_id: "e1", item_id: "item-herb", quantity: 1 }]
    });

    const out = finalizeCraftWithResourceConsumption({
      craft_job: createCraftJob(),
      recipe: createRecipe(),
      inventoryStore,
      inventory_id: "inv-player-001",
      outputGrantAdapter: createSuccessfulOutputAdapter(inventoryStore)
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "insufficient_materials");
  }, results);

  runTest("failed_output_grant_does_not_incorrectly_consume_materials_without_recovery", () => {
    const inventoryStore = new TestInventoryStore();
    const before = createInventory();
    inventoryStore.saveInventory(clone(before));

    const failingAdapter = {
      addDropToInventory() {
        return { ok: false, reason: "forced_output_grant_failure" };
      }
    };

    const out = finalizeCraftWithResourceConsumption({
      craft_job: createCraftJob(),
      recipe: createRecipe(),
      inventoryStore,
      inventory_id: "inv-player-001",
      outputGrantAdapter: failingAdapter
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "output_grant_failed_rolled_back");
    const after = inventoryStore.loadInventory("inv-player-001");
    assert.equal(JSON.stringify(after), JSON.stringify(before));
  }, results);

  runTest("duplicate_completion_attempts_do_not_double_consume_or_double_grant", () => {
    const inventoryStore = new TestInventoryStore();
    inventoryStore.saveInventory(createInventory());
    const processedStore = new ProcessedCraftFinalizationStore();
    const outputAdapter = createSuccessfulOutputAdapter(inventoryStore);

    const first = finalizeCraftWithResourceConsumption({
      craft_job: createCraftJob({ craft_job_id: "job-dupe-001" }),
      recipe: createRecipe(),
      inventoryStore,
      inventory_id: "inv-player-001",
      processedFinalizationStore: processedStore,
      outputGrantAdapter: outputAdapter
    });

    const afterFirst = clone(inventoryStore.loadInventory("inv-player-001"));

    const second = finalizeCraftWithResourceConsumption({
      craft_job: createCraftJob({ craft_job_id: "job-dupe-001" }),
      recipe: createRecipe(),
      inventoryStore,
      inventory_id: "inv-player-001",
      processedFinalizationStore: processedStore,
      outputGrantAdapter: outputAdapter
    });

    const afterSecond = inventoryStore.loadInventory("inv-player-001");

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.event_type, "craft_finalize_skipped");
    assert.equal(JSON.stringify(afterSecond), JSON.stringify(afterFirst));
  }, results);

  runTest("malformed_payload_handling", () => {
    const inventoryStore = new TestInventoryStore();
    const out = finalizeCraftWithResourceConsumption({
      inventoryStore
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "craft_job_and_recipe_required");
  }, results);

  runTest("rollback_behavior_for_partial_failure", () => {
    const inventoryStore = new TestInventoryStore();
    const before = createInventory();
    inventoryStore.saveInventory(clone(before));

    let calls = 0;
    const partialFailAdapter = {
      addDropToInventory(input) {
        calls += 1;
        const inventory = inventoryStore.loadInventory(input.inventory_id);
        const entries = [...inventory.item_entries];
        if (calls === 1) {
          entries.push({
            entry_id: "grant-first",
            item_id: input.drop.item_id,
            quantity: input.drop.quantity
          });
          inventoryStore.saveInventory({ ...inventory, item_entries: entries });
          return { ok: true };
        }
        return { ok: false, reason: "forced_second_output_failure" };
      }
    };

    const out = finalizeCraftWithResourceConsumption({
      craft_job: createCraftJob({ craft_job_id: "job-partial-001" }),
      recipe: createRecipe({
        outputs: [
          { item_id: "item-potion-small", quantity: 1 },
          { item_id: "item-potion-large", quantity: 1 }
        ]
      }),
      inventoryStore,
      inventory_id: "inv-player-001",
      outputGrantAdapter: partialFailAdapter
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "output_grant_failed_rolled_back");
    const after = inventoryStore.loadInventory("inv-player-001");
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
  const summary = runCraftResourceConsumptionRollbackTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCraftResourceConsumptionRollbackTests
};

