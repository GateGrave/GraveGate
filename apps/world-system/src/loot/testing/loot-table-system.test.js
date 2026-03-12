"use strict";

const assert = require("assert");
const { LootTableManager, InMemoryLootTableStore, createExampleLootTables } = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createManager() {
  return new LootTableManager({
    store: new InMemoryLootTableStore()
  });
}

function runLootTableSystemTests() {
  const results = [];

  runTest("table_creation", () => {
    const manager = createManager();
    const created = manager.createLootTable({
      table_id: "table-test-001",
      source_type: "enemy",
      source_id: "goblin",
      possible_drops: [{ item_id: "item-rag", quantity: 1, rarity: "common" }],
      drop_weights: { "item-rag": 100 },
      guaranteed_drops: [],
      rarity_rules: { default_roll_count: 1 }
    });

    assert.equal(created.table_id, "table-test-001");
    assert.equal(created.source_type, "enemy");
    assert.equal(Array.isArray(created.possible_drops), true);
  }, results);

  runTest("weighted_rolls_return_valid_configured_entries", () => {
    const manager = createManager();
    manager.createLootTable({
      table_id: "table-weighted-001",
      source_type: "enemy",
      source_id: "bandit",
      possible_drops: [
        { item_id: "item-a", quantity: 1, rarity: "common" },
        { item_id: "item-b", quantity: 1, rarity: "uncommon" },
        { item_id: "item-c", quantity: 1, rarity: "rare" }
      ],
      drop_weights: {
        "item-a": 60,
        "item-b": 30,
        "item-c": 10
      },
      guaranteed_drops: [],
      rarity_rules: { default_roll_count: 5 }
    });

    const rolled = manager.rollFromLootTable("table-weighted-001", { roll_count: 8 });
    assert.equal(rolled.ok, true);
    assert.equal(rolled.event_type, "loot_table_rolled");

    const allowed = new Set(["item-a", "item-b", "item-c"]);
    const allValid = rolled.payload.rolled_drops.every((drop) => allowed.has(drop.item_id));
    assert.equal(allValid, true);
  }, results);

  runTest("guaranteed_drops_always_appear_when_configured", () => {
    const manager = createManager();
    manager.createLootTable({
      table_id: "table-guaranteed-001",
      source_type: "enemy",
      source_id: "orc",
      possible_drops: [{ item_id: "item-random", quantity: 1, rarity: "common" }],
      drop_weights: { "item-random": 100 },
      guaranteed_drops: [
        { item_id: "item-guaranteed-coin", quantity: 10, rarity: "common" },
        { item_id: "item-guaranteed-key", quantity: 1, rarity: "rare" }
      ],
      rarity_rules: { default_roll_count: 1 }
    });

    const rolled = manager.rollFromLootTable("table-guaranteed-001", { roll_count: 2 });
    const guaranteedIds = rolled.payload.guaranteed_drops.map((x) => x.item_id);
    assert.ok(guaranteedIds.includes("item-guaranteed-coin"));
    assert.ok(guaranteedIds.includes("item-guaranteed-key"));
  }, results);

  runTest("invalid_tables_fail_safely", () => {
    const manager = createManager();
    const rolled = manager.rollFromLootTable("table-does-not-exist");
    const updated = manager.updateLootTable("table-does-not-exist", { source_type: "enemy" });
    const deleted = manager.deleteLootTable("table-does-not-exist");

    assert.equal(rolled.ok, false);
    assert.equal(rolled.reason, "loot_table_not_found");
    assert.equal(updated, null);
    assert.equal(deleted, false);
  }, results);

  runTest("missing_weight_data_is_handled_safely", () => {
    const manager = createManager();
    manager.createLootTable({
      table_id: "table-no-weight-001",
      source_type: "enemy",
      source_id: "slime",
      possible_drops: [
        { item_id: "item-goo", quantity: 1, rarity: "common" },
        { item_id: "item-core", quantity: 1, rarity: "uncommon" }
      ],
      // Intentionally missing weights
      drop_weights: {},
      guaranteed_drops: [],
      rarity_rules: { default_roll_count: 1 }
    });

    const rolled = manager.rollFromLootTable("table-no-weight-001", { roll_count: 1 });
    assert.equal(rolled.ok, true);
    assert.equal(rolled.payload.rolled_drops.length, 1);
    assert.ok(["item-goo", "item-core"].includes(rolled.payload.rolled_drops[0].item_id));
  }, results);

  runTest("boss_table_structure_works_correctly", () => {
    const manager = createManager();
    const examples = createExampleLootTables();
    manager.createLootTable(examples.boss);

    const bossTable = manager.getLootTable("table-boss-lich-001");
    assert.ok(bossTable);
    assert.equal(bossTable.source_type, "boss");
    assert.ok(Array.isArray(bossTable.guaranteed_drops));
    assert.ok(bossTable.guaranteed_drops.length > 0);
    assert.equal(Boolean(bossTable.rarity_rules?.boss_bonus), true);

    const rolled = manager.rollFromLootTable("table-boss-lich-001");
    assert.equal(rolled.ok, true);
    assert.ok(rolled.payload.guaranteed_drops.length > 0);
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
  const summary = runLootTableSystemTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runLootTableSystemTests
};

