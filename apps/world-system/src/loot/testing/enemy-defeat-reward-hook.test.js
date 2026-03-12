"use strict";

const assert = require("assert");
const {
  LootTableManager,
  InMemoryLootTableStore,
  createExampleLootTables,
  ProcessedEnemyDefeatStore,
  processEnemyDefeatedRewardHook
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createManagerWithEnemyTable() {
  const manager = new LootTableManager({
    store: new InMemoryLootTableStore()
  });
  const examples = createExampleLootTables();
  manager.createLootTable(examples.normal_enemy);
  return manager;
}

function makeEnemyDefeatedEvent(overrides) {
  return {
    event_id: "evt-enemy-defeat-001",
    event_type: "enemy_defeated",
    session_id: "sess-001",
    party_id: "party-001",
    player_id: "char-001",
    combat_id: "combat-001",
    payload: {
      enemy_id: "goblin"
    },
    ...(overrides || {})
  };
}

function runEnemyDefeatRewardHookTests() {
  const results = [];

  runTest("enemy_with_loot_table_generates_loot", () => {
    const manager = createManagerWithEnemyTable();
    const out = processEnemyDefeatedRewardHook({
      event: makeEnemyDefeatedEvent(),
      lootTableManager: manager,
      rng: () => 0.1
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "loot_generated");
    assert.equal(out.payload.source_type, "enemy");
    assert.equal(out.payload.source_id, "goblin");
    assert.ok(out.payload.loot_result);
    assert.ok(Array.isArray(out.payload.loot_result.all_drops));
  }, results);

  runTest("enemy_without_loot_table_returns_safe_no_loot_result", () => {
    const manager = createManagerWithEnemyTable();
    const out = processEnemyDefeatedRewardHook({
      event: makeEnemyDefeatedEvent({
        event_id: "evt-enemy-defeat-002",
        payload: { enemy_id: "no-table-enemy" }
      }),
      lootTableManager: manager
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "loot_not_generated");
    assert.equal(out.payload.reason, "loot_table_not_found_for_enemy");
    assert.equal(out.payload.grant_status, "not_granted");
  }, results);

  runTest("malformed_enemy_defeated_event_fails_safely", () => {
    const manager = createManagerWithEnemyTable();
    const badType = processEnemyDefeatedRewardHook({
      event: { event_id: "evt-bad-001", event_type: "not_enemy_defeated", payload: {} },
      lootTableManager: manager
    });
    const missingEnemyId = processEnemyDefeatedRewardHook({
      event: { event_id: "evt-bad-002", event_type: "enemy_defeated", payload: {} },
      lootTableManager: manager
    });

    assert.equal(badType.ok, false);
    assert.equal(badType.reason, undefined); // reason is nested in payload for failures
    assert.equal(badType.payload.reason, "invalid_event_type");
    assert.equal(missingEnemyId.ok, false);
    assert.equal(missingEnemyId.payload.reason, "enemy_id_required");
  }, results);

  runTest("duplicate_defeat_event_handling_prevents_double_generation_unless_allowed", () => {
    const manager = createManagerWithEnemyTable();
    const dedupeStore = new ProcessedEnemyDefeatStore();
    const event = makeEnemyDefeatedEvent({ event_id: "evt-dupe-001" });

    const first = processEnemyDefeatedRewardHook({
      event,
      lootTableManager: manager,
      processedEventStore: dedupeStore
    });
    const second = processEnemyDefeatedRewardHook({
      event,
      lootTableManager: manager,
      processedEventStore: dedupeStore
    });
    const thirdAllowed = processEnemyDefeatedRewardHook({
      event,
      lootTableManager: manager,
      processedEventStore: dedupeStore,
      allow_duplicate_events: true
    });

    assert.equal(first.ok, true);
    assert.equal(first.event_type, "loot_generated");
    assert.equal(second.ok, true);
    assert.equal(second.event_type, "loot_not_generated");
    assert.equal(second.payload.reason, "duplicate_enemy_defeat_event");
    assert.equal(thirdAllowed.ok, true);
    assert.equal(thirdAllowed.event_type, "loot_generated");
  }, results);

  runTest("returned_payload_structure_is_valid", () => {
    const manager = createManagerWithEnemyTable();
    const out = processEnemyDefeatedRewardHook({
      event: makeEnemyDefeatedEvent({ event_id: "evt-structure-001" }),
      lootTableManager: manager,
      rng: () => 0.2
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "loot_generated");
    assert.equal(typeof out.payload.loot_table_id, "string");
    assert.equal(out.payload.generated_from_event_type, "enemy_defeated");
    assert.equal(out.payload.grant_status, "not_granted");
    assert.ok(out.payload.loot_result);
    assert.ok(Array.isArray(out.payload.loot_result.guaranteed_drops));
    assert.ok(Array.isArray(out.payload.loot_result.weighted_drops));
    assert.ok(Array.isArray(out.payload.loot_result.all_drops));
    assert.equal(typeof out.payload.loot_result.rarity_result, "object");
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
  const summary = runEnemyDefeatRewardHookTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runEnemyDefeatRewardHookTests
};

