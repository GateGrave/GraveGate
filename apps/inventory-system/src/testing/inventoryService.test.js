"use strict";

const assert = require("assert");
const { buildInventory } = require("../inventory.schema");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runInventoryServiceTests() {
  const results = [];

  runTest("inventory_service_builds_default_inventory", () => {
    const out = buildInventory({
      inventory_id: "inv-service-test-001",
      owner_type: "player",
      owner_id: "player-service-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "inventory_schema_built");
    assert.equal(out.payload.inventory.inventory_id, "inv-service-test-001");
    assert.equal(Array.isArray(out.payload.inventory.stackable_items), true);
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
  const summary = runInventoryServiceTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runInventoryServiceTests
};
