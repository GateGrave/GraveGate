"use strict";

const assert = require("assert");
const { createLootTableObject } = require("../tables/lootTableModel");
const { resolveBossLoot } = require("../flow/resolveBossLoot");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createBossTable() {
  return createLootTableObject({
    loot_table_id: "table-boss-resolve-001",
    name: "Boss Dragon Table",
    guaranteed_entries: [
      { item_id: "item-dragon-core", item_name: "Dragon Core", rarity: "epic", quantity: 1 }
    ],
    weighted_entries: [
      { item_id: "item-bonus-gem", item_name: "Bonus Gem", rarity: "rare", weight: 50, quantity: 1 }
    ]
  });
}

function runResolveBossLootTests() {
  const results = [];

  runTest("guaranteed_boss_drops_always_included", () => {
    const table = createBossTable();

    const out = resolveBossLoot({
      reward_context: "boss_clear",
      loot_table: table,
      include_weighted_bonus: false,
      random_fn: () => 0.2
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "boss_loot_resolved");
    assert.equal(out.payload.loot_bundle.entries.length, 1);
    assert.equal(out.payload.loot_bundle.entries[0].item_id, "item-dragon-core");
  }, results);

  runTest("weighted_bonus_drops_can_be_included", () => {
    const table = createBossTable();

    const out = resolveBossLoot({
      reward_context: "boss_clear",
      loot_table: table,
      include_weighted_bonus: true,
      random_fn: () => 0
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.loot_bundle.entries.length, 2);
    const hasBonus = out.payload.loot_bundle.entries.some((entry) => entry.item_id === "item-bonus-gem");
    assert.equal(hasBonus, true);
  }, results);

  runTest("target_player_id_is_preserved", () => {
    const table = createBossTable();

    const out = resolveBossLoot({
      reward_context: "boss_clear",
      loot_table: table,
      target_player_id: "player-555",
      include_weighted_bonus: false
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.target_player_id, "player-555");
    assert.equal(out.payload.loot_bundle.entries[0].target_player_id, "player-555");
  }, results);

  runTest("failure_on_invalid_boss_loot_context", () => {
    const table = createBossTable();

    const out = resolveBossLoot({
      reward_context: "encounter_clear",
      loot_table: table
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "boss_loot_resolve_failed");
    assert.equal(out.error, "invalid boss reward context");
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
  const summary = runResolveBossLootTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runResolveBossLootTests
};
