"use strict";

const assert = require("assert");
const { LootTableManager, InMemoryLootTableStore, resolveLootRoll } = require("../index");

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

function runLootRollResolverTests() {
  const results = [];

  runTest("weighted_drop_resolution", () => {
    const manager = createManager();
    manager.createLootTable({
      table_id: "table-roll-weighted-001",
      source_type: "enemy",
      source_id: "wolf",
      possible_drops: [
        { item_id: "item-fang", quantity: 1, rarity: "common" },
        { item_id: "item-hide", quantity: 1, rarity: "common" }
      ],
      drop_weights: { "item-fang": 70, "item-hide": 30 },
      guaranteed_drops: [],
      rarity_rules: { default_roll_count: 3 }
    });

    const out = resolveLootRoll({
      source_type: "enemy",
      source_id: "wolf",
      loot_table_id: "table-roll-weighted-001",
      lootTableManager: manager
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "loot_roll_resolved");
    assert.ok(out.payload.weighted_drops.length > 0);
    assert.ok(out.payload.weighted_drops.every((x) => ["item-fang", "item-hide"].includes(x.item_id)));
  }, results);

  runTest("guaranteed_drop_inclusion", () => {
    const manager = createManager();
    manager.createLootTable({
      table_id: "table-roll-guaranteed-001",
      source_type: "enemy",
      source_id: "orc",
      possible_drops: [{ item_id: "item-junk", quantity: 1, rarity: "common" }],
      drop_weights: { "item-junk": 100 },
      guaranteed_drops: [{ item_id: "item-gold", quantity: 12, rarity: "common" }],
      rarity_rules: { default_roll_count: 1 }
    });

    const out = resolveLootRoll({
      source_type: "enemy",
      source_id: "orc",
      loot_table_id: "table-roll-guaranteed-001",
      lootTableManager: manager
    });

    assert.equal(out.ok, true);
    assert.ok(out.payload.guaranteed_drops.some((x) => x.item_id === "item-gold"));
  }, results);

  runTest("quantity_range_behavior", () => {
    const manager = createManager();
    manager.createLootTable({
      table_id: "table-roll-qty-001",
      source_type: "enemy",
      source_id: "slime",
      possible_drops: [{ item_id: "item-goo", quantity: { min: 2, max: 4 }, rarity: "common" }],
      drop_weights: { "item-goo": 100 },
      guaranteed_drops: [],
      rarity_rules: { default_roll_count: 1 }
    });

    const out = resolveLootRoll({
      source_type: "enemy",
      source_id: "slime",
      loot_table_id: "table-roll-qty-001",
      lootTableManager: manager,
      rng: () => 0.99
    });

    const qty = out.payload.weighted_drops[0].quantity;
    assert.equal(out.ok, true);
    assert.ok(qty >= 2 && qty <= 4);
    assert.ok(out.payload.weighted_drops[0].quantity_roll);
  }, results);

  runTest("rarity_output_validity", () => {
    const manager = createManager();
    manager.createLootTable({
      table_id: "table-roll-rarity-001",
      source_type: "enemy",
      source_id: "mage",
      possible_drops: [{ item_id: "item-scroll", quantity: 1, rarity: "rare" }],
      drop_weights: { "item-scroll": 100 },
      guaranteed_drops: [{ item_id: "item-coin", quantity: 5, rarity: "common" }],
      rarity_rules: { default_roll_count: 1 }
    });

    const out = resolveLootRoll({
      source_type: "enemy",
      source_id: "mage",
      loot_table_id: "table-roll-rarity-001",
      lootTableManager: manager
    });

    assert.equal(out.ok, true);
    assert.ok(typeof out.payload.rarity_result === "object");
    assert.ok(out.payload.rarity_result.common >= 1);
    assert.ok(out.payload.rarity_result.rare >= 1);
  }, results);

  runTest("empty_table_handling", () => {
    const manager = createManager();
    manager.createLootTable({
      table_id: "table-roll-empty-001",
      source_type: "enemy",
      source_id: "ghost",
      possible_drops: [],
      drop_weights: {},
      guaranteed_drops: [],
      rarity_rules: {}
    });

    const out = resolveLootRoll({
      source_type: "enemy",
      source_id: "ghost",
      loot_table_id: "table-roll-empty-001",
      lootTableManager: manager
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.all_drops.length, 0);
    assert.deepEqual(out.payload.rarity_result, {});
  }, results);

  runTest("invalid_source_table_handling", () => {
    const manager = createManager();
    manager.createLootTable({
      table_id: "table-roll-invalid-001",
      source_type: "enemy",
      source_id: "goblin",
      possible_drops: [{ item_id: "item-rag", quantity: 1, rarity: "common" }],
      drop_weights: { "item-rag": 100 },
      guaranteed_drops: [],
      rarity_rules: {}
    });

    const missingTable = resolveLootRoll({
      source_type: "enemy",
      source_id: "goblin",
      loot_table_id: "table-does-not-exist",
      lootTableManager: manager
    });
    const mismatch = resolveLootRoll({
      source_type: "enemy",
      source_id: "orc",
      loot_table_id: "table-roll-invalid-001",
      lootTableManager: manager
    });

    assert.equal(missingTable.ok, false);
    assert.equal(missingTable.reason, "loot_table_not_found");
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.reason, "source_table_mismatch");
  }, results);

  runTest("duplicate_malformed_payload_prevention", () => {
    const manager = createManager();
    manager.createLootTable({
      table_id: "table-roll-malformed-001",
      source_type: "enemy",
      source_id: "rat",
      possible_drops: [
        // malformed duplicate entries: missing item_id
        { quantity: 1, rarity: "common" },
        { quantity: 2, rarity: "common" }
      ],
      drop_weights: {},
      guaranteed_drops: [
        { quantity: 1, rarity: "common" },
        { quantity: 1, rarity: "common" }
      ],
      rarity_rules: { default_roll_count: 2 }
    });

    const out = resolveLootRoll({
      source_type: "enemy",
      source_id: "rat",
      loot_table_id: "table-roll-malformed-001",
      lootTableManager: manager
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.all_drops.length, 0);
    assert.ok(out.payload.validation.malformed_entries_skipped >= 1);
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
  const summary = runLootRollResolverTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runLootRollResolverTests
};

