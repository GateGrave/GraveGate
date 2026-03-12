"use strict";

const assert = require("assert");
const {
  LootDropManager,
  InMemoryLootDropStore,
  createLootDropRecord
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createManager() {
  return new LootDropManager({
    store: new InMemoryLootDropStore()
  });
}

function runLootCoreSchemaTests() {
  const results = [];

  runTest("valid_loot_creation", () => {
    const manager = createManager();
    const created = manager.createLootDrop({
      loot_id: "loot-001",
      source_type: "enemy",
      source_id: "goblin",
      party_id: "party-001",
      player_id: "char-001",
      item_id: "item-copper-coin",
      quantity: 5,
      rarity: "common",
      drop_type: "weighted",
      granted: false
    });

    assert.equal(created.loot_id, "loot-001");
    assert.equal(created.source_type, "enemy");
    assert.equal(created.granted, false);
    assert.equal(typeof created.created_at, "string");
  }, results);

  runTest("fetch_by_id", () => {
    const manager = createManager();
    manager.createLootDrop({
      loot_id: "loot-002",
      source_type: "enemy",
      source_id: "orc",
      item_id: "item-hide",
      quantity: 1
    });

    const loaded = manager.getLootDrop("loot-002");
    assert.ok(loaded);
    assert.equal(loaded.loot_id, "loot-002");
  }, results);

  runTest("update_loot_state", () => {
    const manager = createManager();
    manager.createLootDrop({
      loot_id: "loot-003",
      source_type: "boss",
      source_id: "lich-king",
      item_id: "item-gold-coin",
      quantity: 100,
      granted: false
    });

    const updated = manager.updateLootDrop("loot-003", {
      granted: true,
      rarity: "rare"
    });

    assert.ok(updated);
    assert.equal(updated.granted, true);
    assert.equal(updated.rarity, "rare");
  }, results);

  runTest("delete_loot_drop", () => {
    const manager = createManager();
    manager.createLootDrop({
      loot_id: "loot-004",
      source_type: "enemy",
      source_id: "wolf",
      item_id: "item-fang",
      quantity: 2
    });

    const deleted = manager.deleteLootDrop("loot-004");
    const loaded = manager.getLootDrop("loot-004");

    assert.equal(deleted, true);
    assert.equal(loaded, null);
  }, results);

  runTest("list_by_source", () => {
    const manager = createManager();
    manager.createLootDrop({
      loot_id: "loot-005a",
      source_type: "enemy",
      source_id: "bandit",
      item_id: "item-rag",
      quantity: 1
    });
    manager.createLootDrop({
      loot_id: "loot-005b",
      source_type: "enemy",
      source_id: "bandit",
      item_id: "item-silver",
      quantity: 2
    });
    manager.createLootDrop({
      loot_id: "loot-005c",
      source_type: "enemy",
      source_id: "goblin",
      item_id: "item-copper-coin",
      quantity: 3
    });

    const listed = manager.listLootDropsBySource("enemy", "bandit");
    assert.equal(listed.length, 2);
    assert.ok(listed.every((x) => x.source_id === "bandit"));
  }, results);

  runTest("invalid_loot_id_handling", () => {
    const manager = createManager();
    const missing = manager.getLootDrop("loot-does-not-exist");
    const updated = manager.updateLootDrop("loot-does-not-exist", { granted: true });
    const deleted = manager.deleteLootDrop("loot-does-not-exist");
    const invalidIdGet = manager.getLootDrop("");
    const invalidIdDelete = manager.deleteLootDrop("");

    assert.equal(missing, null);
    assert.equal(updated, null);
    assert.equal(deleted, false);
    assert.equal(invalidIdGet, null);
    assert.equal(invalidIdDelete, false);
  }, results);

  runTest("missing_required_fields_handling", () => {
    assert.throws(() => createLootDropRecord({}), /loot_id/);
    assert.throws(
      () =>
        createLootDropRecord({
          loot_id: "loot-missing-source-type"
        }),
      /source_type/
    );
    assert.throws(
      () =>
        createLootDropRecord({
          loot_id: "loot-missing-source-id",
          source_type: "enemy"
        }),
      /source_id/
    );
    assert.throws(
      () =>
        createLootDropRecord({
          loot_id: "loot-missing-item-id",
          source_type: "enemy",
          source_id: "goblin"
        }),
      /item_id/
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
  const summary = runLootCoreSchemaTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runLootCoreSchemaTests
};

