"use strict";

const assert = require("assert");
const { resolveInteractionCheck } = require("../flow/resolveInteractionCheck");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runResolveInteractionCheckTests() {
  const results = [];

  runTest("skill_check_uses_stat_and_proficiency", () => {
    const out = resolveInteractionCheck({
      check_type: "skill",
      target_id: "arcana",
      difficulty_class: 10,
      character_profile: {
        stats: { intelligence: 16 },
        proficiency_bonus: 2,
        skills: { arcana: true }
      },
      forced_roll: 5
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.ability_id, "intelligence");
    assert.equal(out.payload.roll.modifier, 5);
    assert.equal(out.payload.roll.total, 10);
    assert.equal(out.payload.passed, true);
  }, results);

  runTest("tool_check_uses_tool_ability_mapping", () => {
    const out = resolveInteractionCheck({
      check_type: "tool",
      target_id: "thieves_tools",
      difficulty_class: 14,
      character_profile: {
        stats: { dexterity: 14 },
        proficiency_bonus: 2,
        tools: ["thieves_tools"]
      },
      forced_roll: 10
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.ability_id, "dexterity");
    assert.equal(out.payload.roll.modifier, 4);
    assert.equal(out.payload.roll.total, 14);
    assert.equal(out.payload.passed, true);
  }, results);

  runTest("failed_check_reports_failure_cleanly", () => {
    const out = resolveInteractionCheck({
      check_type: "skill",
      target_id: "perception",
      difficulty_class: 25,
      character_profile: {
        stats: { wisdom: 10 },
        proficiency_bonus: 2,
        skills: { perception: true }
      },
      forced_roll: 1
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.passed, false);
    assert.equal(out.payload.roll.total, 3);
  }, results);

  const passed = results.filter((entry) => entry.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    totals: { total: results.length, passed, failed },
    results
  };
}

if (require.main === module) {
  const summary = runResolveInteractionCheckTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runResolveInteractionCheckTests
};
