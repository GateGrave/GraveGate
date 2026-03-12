"use strict";

const assert = require("assert");
const {
  resolveCraftCheck,
  getCraftCheckModifiers
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runCraftingCheckResolverTests() {
  const results = [];

  runTest("successful_craft_check", () => {
    const resolved = resolveCraftCheck({
      difficulty_target: 15,
      player_modifier: 3,
      tool_modifier: 2,
      forced_roll: 12
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.success, true);
  }, results);

  runTest("failed_craft_check", () => {
    const resolved = resolveCraftCheck({
      difficulty_target: 18,
      player_modifier: 1,
      forced_roll: 5
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.success, false);
  }, results);

  runTest("modifier_application", () => {
    const modifiers = getCraftCheckModifiers({
      player_modifier: 2,
      tool_modifier: 1,
      profession_modifier: 3,
      misc_modifier: -1
    });
    assert.equal(modifiers.total_modifier, 5);

    const resolved = resolveCraftCheck({
      difficulty_target: 10,
      player_modifier: 2,
      tool_modifier: 1,
      profession_modifier: 3,
      misc_modifier: -1,
      forced_roll: 4
    });
    assert.equal(resolved.roll_breakdown.final_total, 9);
  }, results);

  runTest("zero_modifier_handling", () => {
    const modifiers = getCraftCheckModifiers({});
    assert.equal(modifiers.total_modifier, 0);

    const resolved = resolveCraftCheck({
      difficulty_target: 10,
      forced_roll: 10
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.roll_breakdown.final_total, 10);
  }, results);

  runTest("malformed_craft_context_handling", () => {
    const resolved = resolveCraftCheck({
      difficulty_target: "not-a-number",
      forced_roll: 10
    });
    assert.equal(resolved.ok, false);
    assert.ok(/difficulty_target/.test(resolved.error));
  }, results);

  runTest("deterministic_testing_mode", () => {
    const resolved = resolveCraftCheck({
      difficulty_target: 12,
      player_modifier: 2,
      forced_roll: 8
    });
    assert.equal(resolved.roll_breakdown.d20_roll, 8);
    assert.equal(resolved.roll_breakdown.final_total, 10);
  }, results);

  runTest("output_structure_validity", () => {
    const resolved = resolveCraftCheck({
      difficulty_target: 10,
      forced_roll: 10
    });

    assert.equal(typeof resolved.ok, "boolean");
    assert.equal(typeof resolved.success, "boolean");
    assert.ok(resolved.roll_breakdown);
    assert.equal(typeof resolved.roll_breakdown.difficulty_target, "number");
    assert.equal(typeof resolved.roll_breakdown.d20_roll, "number");
    assert.equal(typeof resolved.roll_breakdown.final_total, "number");
    assert.equal(typeof resolved.roll_breakdown.margin, "number");
    assert.ok(resolved.roll_breakdown.modifiers);
    assert.equal(typeof resolved.roll_breakdown.modifiers.total_modifier, "number");
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
  const summary = runCraftingCheckResolverTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCraftingCheckResolverTests
};

