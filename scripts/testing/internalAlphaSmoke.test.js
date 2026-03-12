"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const internalAlphaSmoke = require("../internal-alpha-smoke");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runInternalAlphaSmokeScriptTests() {
  const results = [];

  runTest("internal_alpha_smoke_plan_tracks_canonical_supported_slice", () => {
    const originalArgv = process.argv.slice();
    try {
      process.argv = ["node", path.resolve(__dirname, "../internal-alpha-smoke.js"), "--skip-multiplayer"];
      const plan = internalAlphaSmoke.getSteps();

      assert.equal(plan.strict_preflight, false);
      assert.equal(plan.include_multiplayer, false);
      assert.deepEqual(plan.steps.map((step) => step.id), [
        "preflight",
        "character_assembly",
        "content_loop",
        "dungeon_loop",
        "combat_actions",
        "combat_render"
      ]);

      const repoRoot = path.resolve(__dirname, "../..");
      for (let i = 0; i < plan.steps.length; i += 1) {
        const absoluteScript = path.resolve(repoRoot, plan.steps[i].script);
        assert.equal(fs.existsSync(absoluteScript), true);
      }
    } finally {
      process.argv = originalArgv;
    }
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
  const summary = runInternalAlphaSmokeScriptTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runInternalAlphaSmokeScriptTests
};
