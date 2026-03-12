"use strict";

const assert = require("assert");
const { createLootTableObject } = require("../tables/lootTableModel");
const { rollLoot } = require("../flow/rollLoot");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runRollLootTests() {
  const results = [];

  runTest("guaranteed_drops_are_always_included", () => {
    const table = createLootTableObject({
      loot_table_id: "table-roll-001",
      name: "Guaranteed Test",
      weighted_entries: [],
      guaranteed_entries: [
        { item_id: "item-gold", item_name: "Gold Coin", quantity: 5, rarity: "common" }
      ]
    });

    const out = rollLoot({
      loot_table: table,
      source_context: "encounter_clear",
      random_fn: () => 0.5
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "loot_rolled");
    assert.equal(out.payload.loot_bundle.entries.length, 1);
    assert.equal(out.payload.loot_bundle.entries[0].item_id, "item-gold");
  }, results);

  runTest("weighted_drop_selection_is_deterministic", () => {
    const table = createLootTableObject({
      loot_table_id: "table-roll-002",
      name: "Weighted Test",
      weighted_entries: [
        { item_id: "item-a", item_name: "Item A", weight: 10, rarity: "common", quantity: 1 },
        { item_id: "item-b", item_name: "Item B", weight: 30, rarity: "uncommon", quantity: 1 }
      ],
      guaranteed_entries: []
    });

    // Total weight = 40. Roll 0.8 => 32, should select item-b.
    const out = rollLoot({
      loot_table: table,
      source_context: "boss_clear",
      random_fn: () => 0.8
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.loot_bundle.entries.length, 1);
    assert.equal(out.payload.loot_bundle.entries[0].item_id, "item-b");
  }, results);

  runTest("target_player_id_is_preserved", () => {
    const table = createLootTableObject({
      loot_table_id: "table-roll-003",
      name: "Target Player Test",
      weighted_entries: [
        { item_id: "item-c", item_name: "Item C", weight: 1, rarity: "common", quantity: 1 }
      ],
      guaranteed_entries: []
    });

    const out = rollLoot({
      loot_table: table,
      source_context: "chest_opened",
      target_player_id: "player-007",
      random_fn: () => 0
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.target_player_id, "player-007");
    assert.equal(out.payload.loot_bundle.entries[0].target_player_id, "player-007");
  }, results);

  runTest("failure_if_loot_table_invalid", () => {
    const out = rollLoot({
      loot_table: { name: "Broken Table" },
      source_context: "dungeon_complete"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "loot_roll_failed");
    assert.equal(out.error, "loot_table.loot_table_id is required");
  }, results);

  runTest("reward_curve_can_scale_quantities_and_weighted_roll_count", () => {
    const table = createLootTableObject({
      loot_table_id: "table-roll-curve-001",
      name: "Curve Test",
      weighted_entries: [
        { item_id: "item-bonus", item_name: "Bonus", weight: 1, rarity: "uncommon", quantity: 1 }
      ],
      guaranteed_entries: [
        { item_id: "item-core", item_name: "Core", quantity: 1, rarity: "common" }
      ]
    });

    const out = rollLoot({
      loot_table: table,
      source_context: "boss_clear",
      random_fn: () => 0,
      metadata: {
        reward_curve: {
          quantity_multiplier: 1.5,
          guaranteed_quantity_bonus: 1,
          weighted_bonus_rolls: 1,
          xp_multiplier: 1.25
        }
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.loot_bundle.entries.length, 3);
    const guaranteed = out.payload.loot_bundle.entries.find((entry) => entry.item_id === "item-core");
    assert.equal(Boolean(guaranteed), true);
    assert.equal(Number(guaranteed.quantity), 2);
    assert.equal(out.payload.reward_curve.weighted_bonus_rolls, 1);
  }, results);

  runTest("reward_update_metadata_is_preserved_on_loot_bundle", () => {
    const table = createLootTableObject({
      loot_table_id: "table-roll-update-001",
      name: "Reward Update Test",
      weighted_entries: [],
      guaranteed_entries: [{ item_id: "item-token", item_name: "Token", quantity: 1, rarity: "common" }]
    });

    const out = rollLoot({
      loot_table: table,
      source_context: "encounter_clear",
      metadata: {
        reward_key: "reward-key-roll-001",
        reward_curve: {
          xp_multiplier: 1.5
        },
        reward_update: {
          gold: 10,
          xp: 100
        }
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.loot_bundle.metadata.reward_key, "reward-key-roll-001");
    assert.equal(out.payload.loot_bundle.metadata.reward_update.gold, 10);
    assert.equal(out.payload.loot_bundle.metadata.reward_update.xp, 150);
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
  const summary = runRollLootTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runRollLootTests
};
