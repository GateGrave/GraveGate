"use strict";

const assert = require("assert");
const {
  LootTableManager,
  InMemoryLootTableStore,
  createExampleLootTables,
  processBossDefeatedRewardHook
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createManagerWithBossTable() {
  const manager = new LootTableManager({
    store: new InMemoryLootTableStore()
  });
  const examples = createExampleLootTables();
  manager.createLootTable(examples.boss);
  return manager;
}

function makeBossDefeatedEvent(overrides) {
  return {
    event_id: "evt-boss-defeat-001",
    event_type: "boss_defeated",
    session_id: "sess-001",
    party_id: "party-001",
    player_id: "char-001",
    combat_id: "combat-001",
    payload: {
      boss_id: "lich-king"
    },
    ...(overrides || {})
  };
}

function runBossGuaranteedDropHookTests() {
  const results = [];

  runTest("boss_guaranteed_drop_always_appears", () => {
    const manager = createManagerWithBossTable();
    const out = processBossDefeatedRewardHook({
      event: makeBossDefeatedEvent(),
      lootTableManager: manager
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "boss_loot_generated");
    assert.ok(out.payload.guaranteed_drop_count >= 1);
    assert.ok(out.payload.loot_result.guaranteed_drops.length >= 1);
  }, results);

  runTest("optional_bonus_weighted_drops_resolve_correctly", () => {
    const manager = createManagerWithBossTable();

    const noBonus = processBossDefeatedRewardHook({
      event: makeBossDefeatedEvent({
        event_id: "evt-boss-defeat-002",
        payload: { boss_id: "lich-king", include_bonus_weighted: false }
      }),
      lootTableManager: manager
    });

    const withBonus = processBossDefeatedRewardHook({
      event: makeBossDefeatedEvent({
        event_id: "evt-boss-defeat-003",
        payload: { boss_id: "lich-king", include_bonus_weighted: true, bonus_roll_count: 2 }
      }),
      lootTableManager: manager,
      rng: () => 0.2
    });

    assert.equal(noBonus.ok, true);
    assert.equal(noBonus.payload.bonus_weighted_enabled, false);
    assert.equal(noBonus.payload.loot_result.weighted_drops.length, 0);

    assert.equal(withBonus.ok, true);
    assert.equal(withBonus.payload.bonus_weighted_enabled, true);
    assert.equal(withBonus.payload.bonus_weighted_roll_count, 2);
    assert.equal(withBonus.payload.loot_result.weighted_drops.length, 2);
  }, results);

  runTest("malformed_boss_loot_config_fails_safely", () => {
    const manager = new LootTableManager({
      store: new InMemoryLootTableStore()
    });
    manager.createLootTable({
      table_id: "table-boss-bad-001",
      source_type: "boss",
      source_id: "broken-boss",
      possible_drops: [{ item_id: "item-bad", quantity: 1, rarity: "rare" }],
      drop_weights: { "item-bad": 100 },
      guaranteed_drops: [], // invalid for boss in this phase
      rarity_rules: { boss_bonus: true, default_roll_count: 1 }
    });

    const out = processBossDefeatedRewardHook({
      event: makeBossDefeatedEvent({
        event_id: "evt-boss-defeat-004",
        payload: { boss_id: "broken-boss" }
      }),
      lootTableManager: manager
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "boss_loot_generation_failed");
    assert.equal(out.payload.reason, "boss_guaranteed_drop_required");
  }, results);

  runTest("boss_defeat_payload_structure_is_valid", () => {
    const manager = createManagerWithBossTable();
    const out = processBossDefeatedRewardHook({
      event: makeBossDefeatedEvent({
        event_id: "evt-boss-defeat-005"
      }),
      lootTableManager: manager,
      rng: () => 0.1
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "boss_loot_generated");
    assert.equal(typeof out.payload.loot_table_id, "string");
    assert.equal(out.payload.source_type, "boss");
    assert.equal(out.payload.generated_from_event_type, "boss_defeated");
    assert.equal(out.payload.grant_status, "not_granted");
    assert.ok(out.payload.loot_result);
    assert.ok(Array.isArray(out.payload.loot_result.guaranteed_drops));
    assert.ok(Array.isArray(out.payload.loot_result.weighted_drops));
  }, results);

  runTest("guaranteed_drop_does_not_disappear_under_weighted_logic", () => {
    const manager = createManagerWithBossTable();
    const out = processBossDefeatedRewardHook({
      event: makeBossDefeatedEvent({
        event_id: "evt-boss-defeat-006",
        payload: { boss_id: "lich-king", include_bonus_weighted: true, bonus_roll_count: 3 }
      }),
      lootTableManager: manager
    });

    assert.equal(out.ok, true);
    assert.ok(out.payload.loot_result.guaranteed_drops.length >= 1);
    assert.equal(
      out.payload.loot_result.all_drops.length,
      out.payload.loot_result.guaranteed_drops.length + out.payload.loot_result.weighted_drops.length
    );
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
  const summary = runBossGuaranteedDropHookTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runBossGuaranteedDropHookTests
};

