"use strict";

const assert = require("assert");
const { LootTableCoreManager } = require("../tables/lootTableManager");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createSampleTable(manager) {
  return manager.createLootTable({
    loot_table_id: "table-core-001",
    name: "Goblin Camp Table",
    weighted_entries: [
      {
        item_id: "item-iron-dagger",
        item_name: "Iron Dagger",
        weight: 60,
        rarity: "common",
        quantity: 1
      },
      {
        item_id: "item-small-gem",
        item_name: "Small Gem",
        weight: 20,
        rarity: "uncommon",
        quantity_min: 1,
        quantity_max: 2
      }
    ],
    guaranteed_entries: [
      {
        item_id: "item-gold-coin",
        item_name: "Gold Coin",
        rarity: "common",
        quantity_min: 5,
        quantity_max: 12
      }
    ],
    metadata: {
      source_type: "encounter"
    }
  });
}

function runLootTableTests() {
  const results = [];

  runTest("creating_a_loot_table", () => {
    const manager = new LootTableCoreManager();
    const out = createSampleTable(manager);

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "loot_table_created");
    assert.equal(out.payload.loot_table.loot_table_id, "table-core-001");
    assert.equal(out.payload.loot_table.name, "Goblin Camp Table");
  }, results);

  runTest("weighted_entries_stored_correctly", () => {
    const manager = new LootTableCoreManager();
    createSampleTable(manager);

    const out = manager.listWeightedEntries("table-core-001");

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "loot_table_weighted_entries_listed");
    assert.equal(out.payload.weighted_entries.length, 2);
    assert.equal(out.payload.weighted_entries[0].item_id, "item-iron-dagger");
    assert.equal(out.payload.weighted_entries[1].quantity_min, 1);
    assert.equal(out.payload.weighted_entries[1].quantity_max, 2);
  }, results);

  runTest("guaranteed_entries_stored_correctly", () => {
    const manager = new LootTableCoreManager();
    createSampleTable(manager);

    const out = manager.listGuaranteedEntries("table-core-001");

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "loot_table_guaranteed_entries_listed");
    assert.equal(out.payload.guaranteed_entries.length, 1);
    assert.equal(out.payload.guaranteed_entries[0].item_id, "item-gold-coin");
    assert.equal(out.payload.guaranteed_entries[0].quantity_min, 5);
    assert.equal(out.payload.guaranteed_entries[0].quantity_max, 12);
  }, results);

  runTest("retrieving_loot_table_by_id", () => {
    const manager = new LootTableCoreManager();
    createSampleTable(manager);

    const out = manager.getLootTableById("table-core-001");

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "loot_table_found");
    assert.equal(out.payload.loot_table.loot_table_id, "table-core-001");
    assert.equal(out.payload.loot_table.metadata.source_type, "encounter");
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
  const summary = runLootTableTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runLootTableTests
};
