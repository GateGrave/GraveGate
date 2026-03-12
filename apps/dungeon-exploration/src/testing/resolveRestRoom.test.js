"use strict";

const assert = require("assert");
const { DungeonSessionManagerCore } = require("../core/dungeonSessionManager");
const { createRoomObject } = require("../rooms/roomModel");
const { resolveRestRoom } = require("../flow/resolveRestRoom");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function setupSessionWithRoom(roomInput) {
  const manager = new DungeonSessionManagerCore();

  manager.createSession({
    session_id: "session-rest-001",
    dungeon_id: "dungeon-rest-001",
    status: "active"
  });

  manager.addRoomToSession({
    session_id: "session-rest-001",
    room: createRoomObject(roomInput)
  });

  manager.setStartRoom({
    session_id: "session-rest-001",
    room_id: roomInput.room_id
  });

  return manager;
}

function runResolveRestRoomTests() {
  const results = [];

  runTest("successful_rest_room_resolution", () => {
    const manager = setupSessionWithRoom({
      room_id: "room-R1",
      room_type: "rest"
    });

    const out = resolveRestRoom({
      manager,
      session_id: "session-rest-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dungeon_rest_room_resolved");
    assert.equal(out.payload.rest_outcome, "rest_available");
    assert.equal(out.payload.next_event.event_type, "rest_room_completed");
  }, results);

  runTest("failure_if_current_room_is_not_rest_room", () => {
    const manager = setupSessionWithRoom({
      room_id: "room-R2",
      room_type: "empty"
    });

    const out = resolveRestRoom({
      manager,
      session_id: "session-rest-001"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_rest_room_resolve_failed");
    assert.equal(out.error, "current room is not a rest room");
  }, results);

  runTest("failure_if_session_missing", () => {
    const manager = new DungeonSessionManagerCore();

    const out = resolveRestRoom({
      manager,
      session_id: "session-missing-001"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_rest_room_resolve_failed");
    assert.equal(out.error, "session not found");
  }, results);

  runTest("room_state_updates_when_marked_used", () => {
    const manager = setupSessionWithRoom({
      room_id: "room-R3",
      room_type: "rest"
    });

    const out = resolveRestRoom({
      manager,
      session_id: "session-rest-001",
      mark_rest_used: true
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.room_marked_used, true);

    const room = out.payload.session.rooms.find((x) => x.room_id === "room-R3");
    assert.equal(room.rest_used, true);

    const lastLog = out.payload.session.event_log[out.payload.session.event_log.length - 1];
    assert.equal(lastLog.event_type, "dungeon_rest_room_resolved");
    assert.equal(lastLog.room_marked_used, true);
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
  const summary = runResolveRestRoomTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runResolveRestRoomTests
};
