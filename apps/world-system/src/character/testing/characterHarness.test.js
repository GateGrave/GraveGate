"use strict";

const assert = require("assert");
const { runCharacterHarness } = require("./characterHarness");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runCharacterHarnessTests() {
  const results = [];

  runTest("harness_runs_start_to_finish_without_crashing", () => {
    const out = runCharacterHarness({
      character_id: "char-harness-test-001",
      player_id: "player-test-001",
      inventory_id: "inv-test-001",
      team: "heroes"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_harness_completed");
    assert.equal(out.payload.character.character_id, "char-harness-test-001");
    assert.equal(out.payload.character.xp, 300);
    assert.equal(out.payload.character.level, 2);
    assert.equal(out.payload.combat_participant.participant_id, "char-harness-test-001");
    assert.equal(out.payload.combat_participant.team, "heroes");
    assert.equal(out.payload.dungeon_party_member.character_id, "char-harness-test-001");
    assert.equal(out.payload.dungeon_party_member.player_id, "player-test-001");
    assert.equal(Array.isArray(out.payload.log), true);
    assert.ok(out.payload.log.length >= 6);

    const hasProgressStep = out.payload.log.some((x) => x.step === "update_character_progress");
    assert.equal(hasProgressStep, true);
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
  const summary = runCharacterHarnessTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCharacterHarnessTests
};
