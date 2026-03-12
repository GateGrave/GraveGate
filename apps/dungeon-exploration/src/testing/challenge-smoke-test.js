"use strict";

const assert = require("assert");
const dungeon = require("../index");

function runChallengeSmokeTests() {
  const store = new dungeon.InMemoryChallengeStore();
  store.save(
    dungeon.createChallenge({
      challenge_id: "challenge-test-001",
      description: "Locked chest with arcane seal.",
      difficulty: "hard",
      solutions: [
        dungeon.CHALLENGE_SOLUTIONS.LOCKPICK,
        dungeon.CHALLENGE_SOLUTIONS.SPELL
      ],
      success_result: {
        status: "success",
        reward: "treasure_cache"
      },
      failure_result: {
        status: "failure",
        consequence: "trap_triggered"
      }
    })
  );

  const success = dungeon.resolveChallenge("challenge-test-001", "spell", {
    challenge_store: store
  });
  assert.equal(success.ok, true);
  assert.equal(success.event_type, "challenge_resolved");
  assert.equal(success.payload.matched_solution, true);
  assert.equal(success.payload.outcome, "challenge_succeeded");

  const failure = dungeon.resolveChallenge("challenge-test-001", "force", {
    challenge_store: store
  });
  assert.equal(failure.ok, true);
  assert.equal(failure.payload.matched_solution, false);
  assert.equal(failure.payload.outcome, "challenge_failed");

  const missing = dungeon.resolveChallenge("challenge-missing-999", "spell", {
    challenge_store: store
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "challenge_not_found");

  return {
    ok: true,
    totals: {
      total: 3,
      passed: 3,
      failed: 0
    },
    results: [
      {
        name: "challenge_success",
        ok: true,
        payload: success.payload
      },
      {
        name: "challenge_failure",
        ok: true,
        payload: failure.payload
      },
      {
        name: "challenge_not_found",
        ok: true,
        payload: missing
      }
    ]
  };
}

if (require.main === module) {
  try {
    const summary = runChallengeSmokeTests();
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error("challenge smoke test failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  runChallengeSmokeTests
};

