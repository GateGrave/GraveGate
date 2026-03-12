"use strict";

const assert = require("assert");
const { createInventoryRecord } = require("../../../../inventory-system/src/inventory.schema");
const { grantLootToInventory } = require("../flow/grantLootToInventory");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runGrantLootInventoryAlignmentTests() {
  const results = [];

  runTest("granting_loot_into_canonical_inventory", () => {
    const canonicalInventory = createInventoryRecord({
      inventory_id: "inv-align-001",
      owner_type: "player",
      owner_id: "player-align-001"
    });

    const out = grantLootToInventory({
      inventory: canonicalInventory,
      loot_bundle: {
        drop_id: "drop-align-001",
        source_type: "encounter_clear",
        source_id: "enc-align-001",
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
  }, results);

  runTest("stacking_duplicate_loot_entries", () => {
    const canonicalInventory = createInventoryRecord({
      inventory_id: "inv-align-002",
      owner_type: "player",
      owner_id: "player-align-002",
      stackable_items: [
        {
          item_id: "item-coin",
          quantity: 5,
          owner_player_id: "player-align-002",
          stackable: true
        }
      ]
    });

    const out = grantLootToInventory({
      inventory: canonicalInventory,
      loot_bundle: {
        entries: [{ item_id: "item-coin", quantity: 3, target_player_id: "player-align-002" }]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.inventory.stackable_items.length, 1);
    assert.equal(out.payload.inventory.stackable_items[0].quantity, 8);
  }, results);

  runTest("preserving_separate_non_stack_items", () => {
    const canonicalInventory = createInventoryRecord({
      inventory_id: "inv-align-003",
      owner_type: "player",
      owner_id: "player-align-003",
      equipment_items: [
        {
          item_id: "item-relic",
          quantity: 1,
          stackable: false
        }
      ]
    });

    const out = grantLootToInventory({
      inventory: canonicalInventory,
      loot_bundle: {
        entries: [{ item_id: "item-relic", quantity: 1, stackable: false }]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.inventory.equipment_items.length, 2);
  }, results);

  runTest("failure_on_invalid_inventory_service_input", () => {
    const out = grantLootToInventory({
      inventory_service: {},
      inventory_id: "inv-align-004",
      loot_bundle: {
        entries: [{ item_id: "item-bad", quantity: 1 }]
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "loot_grant_failed");
    assert.equal(out.error, "inventory_service must expose getInventory and saveInventory functions");
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
  const summary = runGrantLootInventoryAlignmentTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runGrantLootInventoryAlignmentTests
};
