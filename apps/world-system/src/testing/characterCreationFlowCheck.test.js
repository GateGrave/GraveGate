"use strict";

const assert = require("assert");
const { runCharacterCreationFlowCheck } = require("./characterCreationFlowCheck");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runCharacterCreationFlowCheckTests() {
  const results = [];

  runTest("character_creation_flow_check_returns_structured_result", () => {
    const out = runCharacterCreationFlowCheck();

    assert.equal(typeof out, "object");
    assert.equal(typeof out.ok, "boolean");
    assert.equal(typeof out.event_type, "string");
    assert.equal(typeof out.payload, "object");
    assert.equal("error" in out, true);

    assert.equal(Array.isArray(out.payload.found_modules), true);
    assert.equal(Array.isArray(out.payload.missing_modules), true);
    assert.equal(Array.isArray(out.payload.likely_entry_points), true);
    assert.equal(Array.isArray(out.payload.notes), true);
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
  const summary = runCharacterCreationFlowCheckTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCharacterCreationFlowCheckTests
};
