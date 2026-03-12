"use strict";

const assert = require("assert");
const { DungeonSessionManagerCore } = require("../core/dungeonSessionManager");
const { createRoomObject } = require("../rooms/roomModel");
const { resolveRoomEntry } = require("../flow/resolveRoomEntry");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function setupSessionWithCurrentRoom(room) {
  const manager = new DungeonSessionManagerCore();

  manager.createSession({
    session_id: "session-entry-001",
    dungeon_id: "dungeon-entry-001",
    status: "active"
  });

  manager.addRoomToSession({
    session_id: "session-entry-001",
    room
  });

  manager.setStartRoom({
    session_id: "session-entry-001",
    room_id: room.room_id
  });

  return manager;
}

function runResolveRoomEntryTests() {
  const results = [];

  runTest("empty_room_resolution", () => {
    const manager = setupSessionWithCurrentRoom(
      createRoomObject({
        room_id: "room-empty",
        room_type: "empty",
        exits: []
      })
    );

    const out = resolveRoomEntry({
      manager,
      session_id: "session-entry-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dungeon_room_entry_resolved");
    assert.equal(out.payload.outcome, "empty");
    assert.equal(out.payload.next_event.target_system, "none");
  }, results);

  runTest("encounter_room_resolution", () => {
    const manager = setupSessionWithCurrentRoom(
      createRoomObject({
        room_id: "room-encounter",
        room_type: "encounter",
        encounter: { encounter_id: "enc-001" }
      })
    );

    const out = resolveRoomEntry({
      manager,
      session_id: "session-entry-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.outcome, "encounter");
    assert.equal(out.payload.next_event.target_system, "combat_system");
  }, results);

  runTest("challenge_room_resolution", () => {
    const manager = setupSessionWithCurrentRoom(
      createRoomObject({
        room_id: "room-challenge",
        room_type: "challenge",
        challenge: { challenge_id: "chal-001" }
      })
    );

    const out = resolveRoomEntry({
      manager,
      session_id: "session-entry-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.outcome, "challenge");
    assert.equal(out.payload.next_event.target_system, "challenge_system");
  }, results);

  runTest("rest_room_resolution", () => {
    const manager = setupSessionWithCurrentRoom(
      createRoomObject({
        room_id: "room-rest",
        room_type: "rest"
      })
    );

    const out = resolveRoomEntry({
      manager,
      session_id: "session-entry-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.outcome, "rest");
    assert.equal(out.payload.next_event.target_system, "session_system");

    const lastLog = out.payload.session.event_log[out.payload.session.event_log.length - 1];
    assert.equal(lastLog.event_type, "dungeon_room_entry_resolved");
    assert.equal(lastLog.outcome, "rest");
  }, results);

  runTest("failure_if_session_missing", () => {
    const manager = new DungeonSessionManagerCore();

    const out = resolveRoomEntry({
      manager,
      session_id: "session-missing-001"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_room_entry_resolve_failed");
    assert.equal(out.error, "session not found");
  }, results);

  runTest("failure_if_current_room_missing", () => {
    const manager = new DungeonSessionManagerCore();

    manager.createSession({
      session_id: "session-entry-002",
      dungeon_id: "dungeon-entry-002",
      status: "active"
    });

    // Intentionally points to a room that is not stored on session.rooms.
    manager.setCurrentRoom({
      session_id: "session-entry-002",
      current_room_id: "room-does-not-exist"
    });

    const out = resolveRoomEntry({
      manager,
      session_id: "session-entry-002"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_room_entry_resolve_failed");
    assert.equal(out.error, "current room not found in session rooms");
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
  const summary = runResolveRoomEntryTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runResolveRoomEntryTests
};
