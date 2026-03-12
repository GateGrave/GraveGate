"use strict";

const assert = require("assert");
const { createLootTableObject } = require("../tables/lootTableModel");
const { consumeRewardHook } = require("../flow/consumeRewardHook");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runConsumeRewardHookTests() {
  const results = [];

  runTest("successful_encounter_reward_hook_consumption", () => {
    const table = createLootTableObject({ loot_table_id: "table-enc-001", weighted_entries: [] });

    const out = consumeRewardHook({
      reward_hook: {
        source_type: "encounter",
        source_id: "enc-001",
        reward_context: "encounter_clear",
        loot_table_id: "table-enc-001"
      },
      loot_table: table
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "reward_hook_consumed");
    assert.equal(out.payload.reward_context, "encounter_clear");
    assert.equal(out.payload.next_step.event_type, "loot_roll_requested");
  }, results);

  runTest("successful_boss_reward_hook_consumption", () => {
    const out = consumeRewardHook({
      reward_hook: {
        source_type: "boss",
        source_id: "boss-001",
        reward_context: "boss_clear",
        loot_table_id: "table-boss-001"
      },
      resolve_loot_table_fn: (tableId) => ({
        loot_table_id: tableId,
        weighted_entries: [],
        guaranteed_entries: []
      })
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.reward_context, "boss_clear");
    assert.equal(out.payload.loot_table_id, "table-boss-001");
    assert.equal(out.payload.next_step.roll_input.loot_table.loot_table_id, "table-boss-001");
  }, results);

  runTest("failure_on_invalid_reward_hook_payload", () => {
    const out = consumeRewardHook({
      reward_hook: {
        source_type: "encounter",
        reward_context: "encounter_clear"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "reward_hook_consume_failed");
    assert.equal(out.error, "missing required reward_hook fields");
  }, results);

  runTest("preserving_target_player_id", () => {
    const out = consumeRewardHook({
      reward_hook: {
        source_type: "chest",
        source_id: "chest-001",
        reward_context: "chest_opened",
        target_player_id: "player-123",
        loot_table_id: "table-chest-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.target_player_id, "player-123");
    assert.equal(out.payload.next_step.roll_input.target_player_id, "player-123");
  }, results);

  runTest("reward_curve_metadata_is_preserved_for_next_step", () => {
    const out = consumeRewardHook({
      reward_hook: {
        source_type: "boss",
        source_id: "boss-curve-001",
        reward_context: "boss_clear",
        reward_curve: {
          quantity_multiplier: 1.5,
          guaranteed_quantity_bonus: 1,
          weighted_bonus_rolls: 1,
          xp_multiplier: 1.25
        }
      }
    });

    assert.equal(out.ok, true);
    assert.equal(typeof out.payload.next_step.roll_input.metadata.reward_curve, "object");
    assert.equal(out.payload.next_step.roll_input.metadata.reward_curve.guaranteed_quantity_bonus, 1);
  }, results);

  runTest("reward_key_is_preserved_for_downstream_idempotency", () => {
    const out = consumeRewardHook({
      reward_hook: {
        source_type: "encounter",
        source_id: "enc-key-001",
        reward_context: "encounter_clear",
        reward_key: "reward-key-enc-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.next_step.roll_input.metadata.reward_key, "reward-key-enc-001");
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
  const summary = runConsumeRewardHookTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runConsumeRewardHookTests
};
