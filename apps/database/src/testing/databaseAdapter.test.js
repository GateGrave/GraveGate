"use strict";

const assert = require("assert");
const {
  DATABASE_ADAPTER_CONTRACT,
  validateAdapterContract
} = require("../adapters/databaseAdapter.interface");
const { createInMemoryAdapter } = require("../adapters/inMemoryAdapter");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runDatabaseAdapterTests() {
  const results = [];

  runTest("adapter_matches_contract_shape", () => {
    assert.equal(typeof DATABASE_ADAPTER_CONTRACT.getById, "string");
    assert.equal(typeof DATABASE_ADAPTER_CONTRACT.list, "string");
    assert.equal(typeof DATABASE_ADAPTER_CONTRACT.save, "string");
    assert.equal(typeof DATABASE_ADAPTER_CONTRACT.delete, "string");

    const adapter = createInMemoryAdapter();
    const contractResult = validateAdapterContract(adapter);
    assert.equal(contractResult.ok, true);
    assert.equal(contractResult.payload.missing_methods.length, 0);
  }, results);

  runTest("saving_records", () => {
    const adapter = createInMemoryAdapter();
    const out = adapter.save("characters", "char-001", {
      character_id: "char-001",
      name: "Adapter Hero"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.collection, "characters");
    assert.equal(out.payload.id, "char-001");
    assert.equal(out.payload.record.name, "Adapter Hero");
  }, results);

  runTest("loading_records", () => {
    const adapter = createInMemoryAdapter();
    adapter.save("items", "item-001", { item_id: "item-001", name: "Potion" });

    const out = adapter.getById("items", "item-001");
    assert.equal(out.ok, true);
    assert.equal(out.payload.record.item_id, "item-001");
    assert.equal(out.payload.record.name, "Potion");
  }, results);

  runTest("listing_records", () => {
    const adapter = createInMemoryAdapter();
    adapter.save("sessions", "s-1", { session_id: "s-1" });
    adapter.save("sessions", "s-2", { session_id: "s-2" });

    const out = adapter.list("sessions");
    assert.equal(out.ok, true);
    assert.equal(Array.isArray(out.payload.records), true);
    assert.equal(out.payload.records.length, 2);
  }, results);

  runTest("deleting_records", () => {
    const adapter = createInMemoryAdapter();
    adapter.save("loot", "loot-001", { loot_id: "loot-001" });

    const removed = adapter.delete("loot", "loot-001");
    assert.equal(removed.ok, true);
    assert.equal(removed.payload.deleted, true);

    const loaded = adapter.getById("loot", "loot-001");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.payload.record, null);
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
  const summary = runDatabaseAdapterTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runDatabaseAdapterTests
};

