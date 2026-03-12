"use strict";

const assert = require("assert");
const { LootManager } = require("../core/lootManager");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runLootCoreTests() {
  const results = [];

  runTest("creating_a_loot_entry", () => {
    const manager = new LootManager();
    const out = manager.createLootEntry({
      item_id: "item-001",
      item_name: "Iron Sword",
      rarity: "common",
      quantity: 1,
      source_type: "encounter",
      source_id: "enc-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "loot_entry_created");
    assert.equal(out.payload.loot_entry.item_id, "item-001");
    assert.equal(out.payload.loot_entry.item_name, "Iron Sword");
  }, results);

  runTest("creating_a_loot_bundle", () => {
    const manager = new LootManager();
    const out = manager.createLootBundle({
      source_type: "boss",
      source_id: "boss-001",
      entries: [
        {
          item_id: "item-001",
          item_name: "Iron Sword",
          quantity: 1,
          source_type: "boss",
          source_id: "boss-001"
        },
        {
          item_id: "item-002",
          item_name: "Health Potion",
          quantity: 2,
          source_type: "boss",
          source_id: "boss-001"
        }
      ]
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "loot_bundle_created");
    assert.equal(out.payload.loot_bundle.source_type, "boss");
    assert.equal(out.payload.loot_bundle.entries.length, 2);
  }, results);

  runTest("listing_bundle_entries", () => {
    const manager = new LootManager();
    const created = manager.createLootBundle({
      source_type: "encounter",
      source_id: "enc-001",
      entries: [
        {
          item_id: "item-003",
          item_name: "Gold Coin",
          quantity: 5,
          source_type: "encounter",
          source_id: "enc-001"
        }
      ]
    });

    const out = manager.listBundleEntries(created.payload.loot_bundle.drop_id);
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "loot_bundle_entries_listed");
    assert.equal(out.payload.entries.length, 1);
    assert.equal(out.payload.entries[0].item_id, "item-003");
  }, results);

  runTest("sensible_defaults", () => {
    const manager = new LootManager();
    const out = manager.createLootEntry({
      item_id: "item-004"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.loot_entry.item_name, "Unknown Item");
    assert.equal(out.payload.loot_entry.rarity, "common");
    assert.equal(out.payload.loot_entry.quantity, 1);
    assert.equal(out.payload.loot_entry.source_type, "unknown");
    assert.equal(out.payload.loot_entry.source_id, "unknown");
    assert.equal(out.payload.loot_entry.target_player_id, null);
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
  const summary = runLootCoreTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runLootCoreTests
};
