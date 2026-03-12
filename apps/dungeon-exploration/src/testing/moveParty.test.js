"use strict";

const assert = require("assert");
const { DungeonSessionManagerCore } = require("../core/dungeonSessionManager");
const { createRoomObject } = require("../rooms/roomModel");
const { moveParty } = require("../flow/moveParty");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function buildActiveSessionWithRooms() {
  const manager = new DungeonSessionManagerCore();

  manager.createSession({
    session_id: "session-move-001",
    dungeon_id: "dungeon-move-001",
    status: "active"
  });

  manager.setParty({
    session_id: "session-move-001",
    party: {
      party_id: "party-001",
      leader_id: "player-001",
      members: ["player-001", "player-002"]
    }
  });

  manager.addMultipleRoomsToSession({
    session_id: "session-move-001",
    rooms: [
      createRoomObject({
        room_id: "room-A1",
        name: "Entry",
        exits: [{ direction: "east", to_room_id: "room-A2" }]
      }),
      createRoomObject({
        room_id: "room-A2",
        name: "Hall",
        exits: [{ direction: "west", to_room_id: "room-A1" }]
      }),
      createRoomObject({
        room_id: "room-B1",
        name: "Side Room",
        exits: []
      })
    ]
  });

  manager.setStartRoom({
    session_id: "session-move-001",
    room_id: "room-A1"
  });

  return manager;
}

function runMovePartyTests() {
  const results = [];

  runTest("successful_move_to_connected_room", () => {
    const manager = buildActiveSessionWithRooms();

    const out = moveParty({
      manager,
      session_id: "session-move-001",
      target_room_id: "room-A2"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dungeon_party_moved");
    assert.equal(out.payload.from_room_id, "room-A1");
    assert.equal(out.payload.to_room_id, "room-A2");
    assert.equal(out.payload.session.current_room_id, "room-A2");
  }, results);

  runTest("failure_on_unconnected_room", () => {
    const manager = buildActiveSessionWithRooms();

    const out = moveParty({
      manager,
      session_id: "session-move-001",
      target_room_id: "room-B1"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_party_move_failed");
    assert.equal(out.error, "target room is not connected to current room");
  }, results);

  runTest("failure_if_session_missing", () => {
    const manager = buildActiveSessionWithRooms();

    const out = moveParty({
      manager,
      session_id: "session-does-not-exist",
      target_room_id: "room-A2"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_party_move_failed");
    assert.equal(out.error, "session not found");
  }, results);

  runTest("failure_if_target_room_missing", () => {
    const manager = buildActiveSessionWithRooms();

    const out = moveParty({
      manager,
      session_id: "session-move-001",
      target_room_id: "room-Z9"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_party_move_failed");
    assert.equal(out.error, "target room does not exist in session");
  }, results);

  runTest("room_discovered_on_entry", () => {
    const manager = buildActiveSessionWithRooms();

    const out = moveParty({
      manager,
      session_id: "session-move-001",
      target_room_id: "room-A2"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.session.discovered_rooms.includes("room-A2"), true);
    const room = out.payload.session.rooms.find((x) => x.room_id === "room-A2");
    assert.equal(room.discovered, true);

    const lastLog = out.payload.session.event_log[out.payload.session.event_log.length - 1];
    assert.equal(lastLog.event_type, "dungeon_party_moved");
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
  const summary = runMovePartyTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runMovePartyTests
};
