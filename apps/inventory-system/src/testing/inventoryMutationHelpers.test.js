"use strict";

const assert = require("assert");
const { createInventoryRecord } = require("../inventory.schema");
const {
  addItemToInventory,
  removeItemFromInventory,
  stackInventoryItem,
  normalizeInventoryShape
} = require("../mutationHelpers");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runInventoryMutationHelpersTests() {
  const results = [];

  runTest("adding_new_item_works", () => {
    const base = createInventoryRecord({
      inventory_id: "inv-mutation-001",
      owner_type: "player",
      owner_id: "player-mutation-001"
    });

    const out = addItemToInventory(base, {
      item_id: "item-sword",
      item_name: "Iron Sword",
      item_type: "equipment",
      quantity: 1
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.inventory.equipment_items.length, 1);
    assert.equal(out.payload.inventory.equipment_items[0].item_id, "item-sword");
  }, results);

  runTest("stacking_duplicate_items_works", () => {
    const base = createInventoryRecord({
      inventory_id: "inv-mutation-002",
      owner_type: "player",
      owner_id: "player-mutation-001",
      stackable_items: [{ item_id: "item-potion", quantity: 2, stackable: true }]
    });

    const out = stackInventoryItem(base, {
      item_id: "item-potion",
      item_name: "Health Potion",
      quantity: 3
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.inventory.stackable_items.length, 1);
    assert.equal(out.payload.inventory.stackable_items[0].quantity, 5);
  }, results);

  runTest("removing_items_works", () => {
    const base = createInventoryRecord({
      inventory_id: "inv-mutation-003",
      owner_type: "player",
      owner_id: "player-mutation-001",
      stackable_items: [{ item_id: "item-herb", quantity: 5, stackable: true }]
    });

    const out = removeItemFromInventory(base, "item-herb", 2);
    assert.equal(out.ok, true);
    assert.equal(out.payload.inventory.stackable_items[0].quantity, 3);
  }, results);

  runTest("removing_too_many_items_fails_safely", () => {
    const base = createInventoryRecord({
      inventory_id: "inv-mutation-004",
      owner_type: "player",
      owner_id: "player-mutation-001",
      stackable_items: [{ item_id: "item-herb", quantity: 1, stackable: true }]
    });

    const out = removeItemFromInventory(base, "item-herb", 2);
    assert.equal(out.ok, false);
    assert.equal(out.error, "insufficient_item_quantity");
    assert.equal(out.payload.quantity_owned, 1);
  }, results);

  runTest("inventory_shape_remains_valid", () => {
    const out = normalizeInventoryShape({
      inventory_id: "inv-mutation-005",
      owner_type: "player",
      owner_id: "player-mutation-001",
      stackable_items: null,
      equipment_items: null,
      quest_items: null,
      currency: { gold: -4 }
    });

    assert.equal(out.ok, true);
    const inventory = out.payload.inventory;
    assert.equal(Array.isArray(inventory.stackable_items), true);
    assert.equal(Array.isArray(inventory.equipment_items), true);
    assert.equal(Array.isArray(inventory.quest_items), true);
    assert.equal(inventory.currency.gold, 0);
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
  const summary = runInventoryMutationHelpersTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runInventoryMutationHelpersTests
};

