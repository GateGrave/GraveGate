"use strict";

const assert = require("assert");
const { DungeonSessionManagerCore } = require("../core/dungeonSessionManager");
const { createRoomObject } = require("../rooms/roomModel");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createSession(manager) {
  manager.createSession({
    session_id: "session-rooms-001",
    dungeon_id: "dungeon-rooms-001",
    status: "active"
  });
}

function runSessionRoomsTests() {
  const results = [];

  runTest("adding_one_room", () => {
    const manager = new DungeonSessionManagerCore();
    createSession(manager);

    const room = createRoomObject({
      room_id: "room-A1",
      name: "Entry Hall"
    });
    const out = manager.addRoomToSession({
      session_id: "session-rooms-001",
      room
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dungeon_session_room_added");
    assert.equal(out.payload.room_count, 1);
  }, results);

  runTest("adding_multiple_rooms", () => {
    const manager = new DungeonSessionManagerCore();
    createSession(manager);

    const out = manager.addMultipleRoomsToSession({
      session_id: "session-rooms-001",
      rooms: [
        createRoomObject({ room_id: "room-A1", name: "Entry Hall" }),
        createRoomObject({ room_id: "room-A2", name: "Corridor" }),
        createRoomObject({ room_id: "room-A3", name: "Chamber" })
      ]
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dungeon_session_rooms_added");
    assert.equal(out.payload.room_count, 3);
  }, results);

  runTest("setting_start_room", () => {
    const manager = new DungeonSessionManagerCore();
    createSession(manager);
    manager.addRoomToSession({
      session_id: "session-rooms-001",
      room: createRoomObject({ room_id: "room-A1", name: "Entry Hall" })
    });

    const out = manager.setStartRoom({
      session_id: "session-rooms-001",
      room_id: "room-A1"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dungeon_session_start_room_set");
    assert.equal(out.payload.start_room_id, "room-A1");
    assert.equal(out.payload.current_room_id, "room-A1");
  }, results);

  runTest("marking_a_room_discovered", () => {
    const manager = new DungeonSessionManagerCore();
    createSession(manager);
    manager.addRoomToSession({
      session_id: "session-rooms-001",
      room: createRoomObject({ room_id: "room-A1", name: "Entry Hall" })
    });

    const out = manager.markRoomDiscovered({
      session_id: "session-rooms-001",
      room_id: "room-A1"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dungeon_session_room_discovered");
    assert.equal(out.payload.discovered_rooms.includes("room-A1"), true);
    const room = out.payload.session.rooms.find((x) => x.room_id === "room-A1");
    assert.equal(room.discovered, true);
  }, results);

  runTest("marking_a_room_cleared", () => {
    const manager = new DungeonSessionManagerCore();
    createSession(manager);
    manager.addRoomToSession({
      session_id: "session-rooms-001",
      room: createRoomObject({ room_id: "room-A1", name: "Entry Hall" })
    });

    const out = manager.markRoomCleared({
      session_id: "session-rooms-001",
      room_id: "room-A1"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dungeon_session_room_cleared");
    assert.equal(out.payload.cleared_rooms.includes("room-A1"), true);
    const room = out.payload.session.rooms.find((x) => x.room_id === "room-A1");
    assert.equal(room.cleared, true);
  }, results);

  runTest("failure_when_session_does_not_exist", () => {
    const manager = new DungeonSessionManagerCore();

    const out = manager.addRoomToSession({
      session_id: "missing-session",
      room: createRoomObject({ room_id: "room-X1", name: "Ghost Room" })
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_session_add_room_failed");
    assert.equal(out.error, "session not found");
  }, results);

  runTest("failure_when_room_does_not_exist", () => {
    const manager = new DungeonSessionManagerCore();
    createSession(manager);
    manager.addRoomToSession({
      session_id: "session-rooms-001",
      room: createRoomObject({ room_id: "room-A1", name: "Entry Hall" })
    });

    const startMissing = manager.setStartRoom({
      session_id: "session-rooms-001",
      room_id: "room-missing"
    });
    assert.equal(startMissing.ok, false);
    assert.equal(startMissing.event_type, "dungeon_session_set_start_room_failed");
    assert.equal(startMissing.error, "room does not exist in session");

    const discoveredMissing = manager.markRoomDiscovered({
      session_id: "session-rooms-001",
      room_id: "room-missing"
    });
    assert.equal(discoveredMissing.ok, false);
    assert.equal(discoveredMissing.event_type, "dungeon_session_mark_discovered_failed");
    assert.equal(discoveredMissing.error, "room does not exist in session");

    const clearedMissing = manager.markRoomCleared({
      session_id: "session-rooms-001",
      room_id: "room-missing"
    });
    assert.equal(clearedMissing.ok, false);
    assert.equal(clearedMissing.event_type, "dungeon_session_mark_cleared_failed");
    assert.equal(clearedMissing.error, "room does not exist in session");
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
  const summary = runSessionRoomsTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runSessionRoomsTests
};
