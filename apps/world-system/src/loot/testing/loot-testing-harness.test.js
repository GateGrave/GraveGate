"use strict";

const assert = require("assert");
const { LootSimulationRunner } = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runLootTestingHarnessTests() {
  const results = [];

  runTest("expected_loot_generation_path_for_normal_enemy", () => {
    const runner = new LootSimulationRunner();
    runner.setupMocks();

    const out = runner.scenarioNormalEnemyDefeat({
      event_id: "evt-harness-enemy-001",
      rng: () => 0.1
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "loot_generated");
    assert.equal(out.payload.source_type, "enemy");
    assert.ok(Array.isArray(out.payload.loot_result.all_drops));
    assert.ok(out.payload.loot_result.all_drops.length > 0);
  }, results);

  runTest("expected_guaranteed_reward_path_for_boss", () => {
    const runner = new LootSimulationRunner();
    runner.setupMocks();

    const out = runner.scenarioBossDefeat({
      event_id: "evt-harness-boss-001",
      include_bonus_weighted: true,
      bonus_roll_count: 2,
      rng: () => 0.2
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "boss_loot_generated");
    assert.ok(out.payload.guaranteed_drop_count > 0);
    assert.ok(Array.isArray(out.payload.loot_result.guaranteed_drops));
    assert.ok(out.payload.loot_result.guaranteed_drops.length > 0);
  }, results);

  runTest("individual_loot_distribution_across_party", () => {
    const runner = new LootSimulationRunner();
    runner.setupMocks();

    const out = runner.scenarioIndividualLootAssignment({
      source_type: "enemy",
      source_id: "goblin",
      loot_table_id: "table-enemy-goblin-001",
      roll_count: 1
    });

    assert.equal(out.assignment.ok, true);
    assert.equal(out.assignment.payload.per_player_results.length, 3);
    const ids = out.assignment.payload.per_player_results.map((x) => x.player_id);
    assert.ok(ids.includes("char-001"));
    assert.ok(ids.includes("char-002"));
    assert.ok(ids.includes("char-003"));
  }, results);

  runTest("inventory_grant_path", () => {
    const runner = new LootSimulationRunner();
    runner.setupMocks();

    const generated = runner.scenarioNormalEnemyDefeat({
      event_id: "evt-harness-grant-001",
      rng: () => 0.15
    });
    const granted = runner.scenarioInventoryGrant(generated.payload, runner.mockPlayers[0], {
      grant_key: "grant-harness-001"
    });

    assert.ok(granted.event_type === "loot_grant_success" || granted.event_type === "loot_grant_partial_success");
    const inv = runner.worldStorage.inventories.loadInventory(runner.mockPlayers[0].inventory_id);
    assert.ok(Array.isArray(inv.item_entries));
    assert.ok(inv.item_entries.length > 0);
  }, results);

  runTest("failed_inventory_grant_path", () => {
    const runner = new LootSimulationRunner();
    runner.setupMocks();

    const out = runner.scenarioFailedInventoryGrant({
      generated_from_event_id: "evt-harness-failed-grant-001"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "loot_grant_failed");
    assert.equal(out.payload.status, "failure");
  }, results);

  runTest("no_duplicate_reward_generation_in_repeated_simulation_unless_configured", () => {
    const runnerBlocked = new LootSimulationRunner();
    runnerBlocked.setupMocks();
    const blocked = runnerBlocked.scenarioDuplicateEnemyDefeat({
      event_id: "evt-harness-duplicate-001"
    });

    assert.equal(blocked.first.event_type, "loot_generated");
    assert.equal(blocked.second.event_type, "loot_not_generated");
    assert.equal(blocked.duplicate_blocked, true);

    const runnerAllowed = new LootSimulationRunner();
    runnerAllowed.setupMocks();
    const allowed = runnerAllowed.scenarioDuplicateEnemyDefeat({
      event_id: "evt-harness-duplicate-allow-001",
      allow_duplicate_events: true
    });

    assert.equal(allowed.first.event_type, "loot_generated");
    assert.equal(allowed.second.event_type, "loot_generated");
    assert.equal(allowed.duplicate_blocked, false);
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
  const summary = runLootTestingHarnessTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runLootTestingHarnessTests
};

