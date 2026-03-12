"use strict";

const assert = require("assert");
const { createInventoryRecord } = require("../../../../inventory-system/src/inventory.schema");
const {
  addItemToInventory,
  normalizeInventoryShape
} = require("../../../../inventory-system/src/mutationHelpers");
const { grantLootToInventory } = require("../flow/grantLootToInventory");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runGrantLootMutationAlignmentTests() {
  const results = [];

  runTest("loot_grants_correctly_with_canonical_shape", () => {
    const inventory = createInventoryRecord({
      inventory_id: "inv-mutation-align-001",
      owner_type: "player",
      owner_id: "player-mutation-align-001"
    });

    const out = grantLootToInventory({
      inventory,
      loot_bundle: {
        drop_id: "drop-mutation-001",
        source_type: "encounter_clear",
        source_id: "enc-mutation-001",
        entries: [{ item_id: "item-herb", item_name: "Herb", quantity: 2 }]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "loot_granted_to_inventory");
    assert.equal(Array.isArray(out.payload.inventory.stackable_items), true);
    assert.equal(Array.isArray(out.payload.inventory.equipment_items), true);
    assert.equal(Array.isArray(out.payload.inventory.quest_items), true);
    assert.equal(out.payload.inventory.stackable_items.length, 1);
    assert.equal(out.payload.inventory.stackable_items[0].item_id, "item-herb");
    assert.equal(out.payload.inventory.stackable_items[0].quantity, 2);
  }, results);

  runTest("duplicate_stackable_loot_stacks", () => {
    const inventory = createInventoryRecord({
      inventory_id: "inv-mutation-align-002",
      owner_type: "player",
      owner_id: "player-mutation-align-002",
      stackable_items: [{ item_id: "item-coin", quantity: 5, stackable: true }]
    });

    const out = grantLootToInventory({
      inventory,
      loot_bundle: {
        entries: [{ item_id: "item-coin", quantity: 3 }]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.inventory.stackable_items.length, 1);
    assert.equal(out.payload.inventory.stackable_items[0].quantity, 8);
  }, results);

  runTest("mutation_helpers_are_used_for_canonical_updates", () => {
    let normalizeCalls = 0;
    let addCalls = 0;

    const mutationHelpers = {
      normalizeInventoryShape(inventory) {
        normalizeCalls += 1;
        return normalizeInventoryShape(inventory);
      },
      addItemToInventory(inventory, item) {
        addCalls += 1;
        return addItemToInventory(inventory, item);
      }
    };

    const inventory = createInventoryRecord({
      inventory_id: "inv-mutation-align-003",
      owner_type: "player",
      owner_id: "player-mutation-align-003"
    });

    const out = grantLootToInventory({
      inventory,
      mutation_helpers: mutationHelpers,
      loot_bundle: {
        entries: [
          { item_id: "item-potion", item_type: "consumable", quantity: 1 },
          { item_id: "item-relic", stackable: false, quantity: 1 }
        ]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(normalizeCalls > 0, true);
    assert.equal(addCalls, 2);
    assert.equal(out.payload.metadata.mutation_helpers_used, true);
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
  const summary = runGrantLootMutationAlignmentTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runGrantLootMutationAlignmentTests
};

