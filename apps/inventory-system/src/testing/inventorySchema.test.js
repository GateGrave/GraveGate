"use strict";

const assert = require("assert");
const { INVENTORY_SCHEMA, createInventoryRecord, buildInventory } = require("../inventory.schema");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runInventorySchemaTests() {
  const results = [];

  runTest("default_inventory_shape", () => {
    const out = buildInventory();
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "inventory_schema_built");
    assert.equal(typeof INVENTORY_SCHEMA, "object");

    const inv = out.payload.inventory;
    assert.equal(typeof inv.inventory_id, "string");
    assert.equal(inv.owner_type, "player");
    assert.equal(inv.owner_id, null);
    assert.deepEqual(inv.currency, { gold: 0, silver: 0, copper: 0 });
    assert.deepEqual(inv.stackable_items, []);
    assert.deepEqual(inv.equipment_items, []);
    assert.deepEqual(inv.quest_items, []);
    assert.deepEqual(inv.metadata, {});
  }, results);

  runTest("custom_values", () => {
    const inv = createInventoryRecord({
      inventory_id: "inv-custom-001",
      owner_type: "character",
      owner_id: "char-001",
      currency: { gold: 25, silver: 8, copper: 3, crafting_tokens: 2 },
      stackable_items: [{ item_id: "item-herb", quantity: 4 }],
      equipment_items: [{ item_id: "item-sword", equipped: true }],
      quest_items: [{ item_id: "item-relic", quantity: 1 }],
      metadata: { source: "loot_loop", tags: ["phase10"] }
    });

    assert.equal(inv.inventory_id, "inv-custom-001");
    assert.equal(inv.owner_type, "character");
    assert.equal(inv.owner_id, "char-001");
    assert.equal(inv.currency.gold, 25);
    assert.equal(inv.currency.silver, 8);
    assert.equal(inv.currency.copper, 3);
    assert.equal(inv.currency.crafting_tokens, 2);
    assert.equal(inv.stackable_items.length, 1);
    assert.equal(inv.equipment_items.length, 1);
    assert.equal(inv.quest_items.length, 1);
    assert.equal(inv.metadata.source, "loot_loop");
  }, results);

  runTest("sensible_defaults_for_nested_objects_and_arrays", () => {
    const out = buildInventory({
      inventory_id: "inv-defaults-001",
      currency: null,
      stackable_items: null,
      equipment_items: null,
      quest_items: null,
      metadata: null
    });

    assert.equal(out.ok, true);
    const inv = out.payload.inventory;
    assert.deepEqual(inv.currency, { gold: 0, silver: 0, copper: 0 });
    assert.deepEqual(inv.stackable_items, []);
    assert.deepEqual(inv.equipment_items, []);
    assert.deepEqual(inv.quest_items, []);
    assert.deepEqual(inv.metadata, {});
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
  const summary = runInventorySchemaTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runInventorySchemaTests
};
