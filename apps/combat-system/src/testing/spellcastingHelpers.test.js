"use strict";

const assert = require("assert");
const { getSpellAreaTemplate } = require("../spells/spellcastingHelpers");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runSpellcastingHelpersTests() {
  const results = [];

  runTest("burning_hands_normalizes_to_cone_template", () => {
    const out = getSpellAreaTemplate({
      targeting: { type: "cone_15ft" }
    });
    assert.deepEqual(out, {
      shape: "cone",
      size_feet: 15,
      origin: "self"
    });
  }, results);

  runTest("fireball_metadata_returns_sphere_template", () => {
    const out = getSpellAreaTemplate({
      metadata: {
        area_template: {
          shape: "sphere",
          radius_feet: 20,
          origin: "point_within_range"
        }
      }
    });
    assert.deepEqual(out, {
      shape: "sphere",
      radius_feet: 20,
      origin: "point_within_range"
    });
  }, results);

  runTest("spirit_guardians_normalizes_to_aura_template", () => {
    const out = getSpellAreaTemplate({
      targeting: { type: "aura_15ft" }
    });
    assert.deepEqual(out, {
      shape: "aura",
      radius_feet: 15,
      origin: "self"
    });
  }, results);

  const passed = results.filter((entry) => entry.ok).length;
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
  const summary = runSpellcastingHelpersTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runSpellcastingHelpersTests
};
