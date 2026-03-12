"use strict";

const assert = require("assert");
const { LootLogger } = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runLootLoggingSystemTests() {
  const results = [];

  runTest("log_entry_creation", () => {
    const logger = new LootLogger();
    const entry = logger.log({
      source_type: "enemy",
      source_id: "goblin",
      player_id: "char-001",
      item_id: "item-coin",
      quantity: 5,
      rarity: "common",
      result: "rolled",
      event_kind: "loot_rolled"
    });

    assert.equal(typeof entry.timestamp, "string");
    assert.equal(entry.source_type, "enemy");
    assert.equal(entry.item_id, "item-coin");
    assert.equal(entry.event_kind, "loot_rolled");
  }, results);

  runTest("correct_log_type_assignment", () => {
    const logger = new LootLogger();
    logger.logLootRolled({
      source_type: "enemy",
      source_id: "bandit",
      player_id: "char-001",
      all_drops: [{ item_id: "item-rag", quantity: 1, rarity: "common" }]
    });
    logger.logLootGranted({
      source_type: "enemy",
      source_id: "bandit",
      owner_character_id: "char-001",
      drop_results: [{ loot_id: "loot-1", item_id: "item-rag", requested_quantity: 1, granted: true, result: {} }]
    });

    const logs = logger.listLogs();
    assert.equal(logs[0].event_kind, "loot_rolled");
    assert.equal(logs[1].event_kind, "loot_granted");
  }, results);

  runTest("failed_grant_logging", () => {
    const logger = new LootLogger();
    logger.logLootGrantFailed({
      source_type: "enemy",
      source_id: "orc",
      owner_character_id: "char-001",
      drop_results: [
        {
          loot_id: "loot-fail-1",
          item_id: "item-bad",
          requested_quantity: 1,
          granted: false,
          result: { reason: "inventory_write_failed" }
        }
      ]
    });

    const logs = logger.listLogs();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].event_kind, "loot_grant_failed");
    assert.equal(logs[0].result, "inventory_write_failed");
  }, results);

  runTest("rolled_loot_logging", () => {
    const logger = new LootLogger();
    logger.logLootRolled({
      source_type: "boss",
      source_id: "lich-king",
      context: { player_id: "char-001" },
      all_drops: [
        { item_id: "item-gold", quantity: 100, rarity: "common" },
        { item_id: "item-staff", quantity: 1, rarity: "epic" }
      ]
    });

    const logs = logger.listLogs();
    assert.equal(logs.length, 2);
    assert.equal(logs[0].event_kind, "loot_rolled");
    assert.equal(logs[1].event_kind, "loot_rolled");
  }, results);

  runTest("malformed_log_payload_handling", () => {
    const logger = new LootLogger();
    const base = logger.log(null);
    const rolled = logger.logLootRolled(null);
    const granted = logger.logLootGranted(null);
    const failed = logger.logLootGrantFailed(null);

    assert.equal(base.event_kind, "loot_event");
    assert.equal(Array.isArray(rolled), true);
    assert.equal(Array.isArray(granted), true);
    assert.equal(Array.isArray(failed), true);
    assert.ok(logger.listLogs().length >= 4);
  }, results);

  runTest("logs_remain_separate_from_loot_state_mutation", () => {
    const logger = new LootLogger();
    const source = {
      source_type: "enemy",
      source_id: "goblin",
      player_id: "char-001",
      all_drops: [{ item_id: "item-coin", quantity: 5, rarity: "common" }]
    };

    logger.logLootRolled(source);
    source.all_drops[0].quantity = 9999;

    const logs = logger.listLogs();
    assert.equal(logs[0].quantity, 5);

    // Also verify listLogs returns cloned data.
    logs[0].quantity = 7777;
    const logsAgain = logger.listLogs();
    assert.equal(logsAgain[0].quantity, 5);
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
  const summary = runLootLoggingSystemTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runLootLoggingSystemTests
};

