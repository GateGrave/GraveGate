"use strict";

const assert = require("assert");
const { DungeonSessionManagerCore } = require("../core/dungeonSessionManager");
const { createRoomObject } = require("../rooms/roomModel");
const { resolveChallenge } = require("../flow/resolveChallenge");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function setupChallengeSession(options) {
  const config = options || {};
  const manager = new DungeonSessionManagerCore();

  manager.createSession({
    session_id: "session-challenge-001",
    dungeon_id: "dungeon-challenge-001",
    status: "active"
  });

  const room = createRoomObject({
    room_id: "room-C1",
    room_type: "challenge",
    challenge: config.withoutChallenge
      ? null
      : {
          challenge_id: "challenge-001",
          allowed_solution_types: ["skill", "spell"]
        }
  });

  manager.addRoomToSession({
    session_id: "session-challenge-001",
    room
  });

  manager.setStartRoom({
    session_id: "session-challenge-001",
    room_id: "room-C1"
  });

  return manager;
}

function runResolveChallengeTests() {
  const results = [];

  runTest("successful_allowed_challenge_solution", () => {
    const manager = setupChallengeSession();

    const out = resolveChallenge({
      manager,
      session_id: "session-challenge-001",
      challenge_attempt: {
        attempt_type: "skill"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dungeon_challenge_resolved");
    assert.equal(out.payload.challenge_success, true);
    assert.equal(out.payload.next_event.event_type, "challenge_succeeded");
  }, results);

  runTest("failed_unsupported_attempt_type", () => {
    const manager = setupChallengeSession();

    const out = resolveChallenge({
      manager,
      session_id: "session-challenge-001",
      challenge_attempt: {
        attempt_type: "dance"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_challenge_resolve_failed");
    assert.equal(out.error, "unsupported attempt type");
  }, results);

  runTest("failure_when_no_challenge_exists", () => {
    const manager = setupChallengeSession({ withoutChallenge: true });

    const out = resolveChallenge({
      manager,
      session_id: "session-challenge-001",
      challenge_attempt: {
        attempt_type: "skill"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_challenge_resolve_failed");
    assert.equal(out.error, "room has no challenge");
  }, results);

  runTest("room_marked_cleared_on_success", () => {
    const manager = setupChallengeSession();

    const out = resolveChallenge({
      manager,
      session_id: "session-challenge-001",
      challenge_attempt: {
        attempt_type: "spell"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.challenge_success, true);
    assert.equal(out.payload.room_cleared, true);
    assert.equal(out.payload.session.cleared_rooms.includes("room-C1"), true);

    const room = out.payload.session.rooms.find((x) => x.room_id === "room-C1");
    assert.equal(room.cleared, true);

    const lastLog = out.payload.session.event_log[out.payload.session.event_log.length - 1];
    assert.equal(lastLog.event_type, "dungeon_challenge_resolved");
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
  const summary = runResolveChallengeTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runResolveChallengeTests
};
