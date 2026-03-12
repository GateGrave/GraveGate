"use strict";

const assert = require("assert");
const { runCharacterSystemAudit } = require("./characterSystemAudit");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runCharacterSystemAuditTests() {
  const results = [];

  runTest("character_system_audit_runs_without_crashing", () => {
    const out = runCharacterSystemAudit();

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_system_audit_completed");
    assert.equal(typeof out.payload, "object");

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
  const summary = runCharacterSystemAuditTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCharacterSystemAuditTests
};
