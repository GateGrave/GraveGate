"use strict";

const assert = require("assert");
const { DungeonSessionManagerCore } = require("../core/dungeonSessionManager");
const { createRoomObject } = require("../rooms/roomModel");
const { resolveBossRoom } = require("../flow/resolveBossRoom");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function setupSessionWithRoom(room) {
  const manager = new DungeonSessionManagerCore();

  manager.createSession({
    session_id: "session-boss-001",
    dungeon_id: "dungeon-boss-001",
    status: "active"
  });

  manager.addRoomToSession({
    session_id: "session-boss-001",
    room
  });

  manager.setStartRoom({
    session_id: "session-boss-001",
    room_id: room.room_id
  });

  return manager;
}

function runResolveBossRoomTests() {
  const results = [];

  runTest("successful_boss_room_resolution", () => {
    const manager = setupSessionWithRoom(
      createRoomObject({
        room_id: "room-B1",
        room_type: "boss",
        encounter: {
          encounter_id: "enc-boss-001",
          encounter_type: "boss"
        }
      })
    );

    const out = resolveBossRoom({
      manager,
      session_id: "session-boss-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dungeon_boss_room_resolved");
    assert.equal(out.payload.boss_trigger_ready, true);
    assert.equal(out.payload.next_event.event_type, "boss_encounter_trigger_requested");

    const lastLog = out.payload.session.event_log[out.payload.session.event_log.length - 1];
    assert.equal(lastLog.event_type, "dungeon_boss_room_resolved");
  }, results);

  runTest("failure_if_current_room_is_not_boss_room", () => {
    const manager = setupSessionWithRoom(
      createRoomObject({
        room_id: "room-B2",
        room_type: "encounter",
        encounter: {
          encounter_id: "enc-regular-001",
          encounter_type: "normal"
        }
      })
    );

    const out = resolveBossRoom({
      manager,
      session_id: "session-boss-001"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_boss_room_resolve_failed");
    assert.equal(out.error, "current room is not a boss room");
  }, results);

  runTest("failure_if_session_missing", () => {
    const manager = new DungeonSessionManagerCore();

    const out = resolveBossRoom({
      manager,
      session_id: "session-missing-001"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_boss_room_resolve_failed");
    assert.equal(out.error, "session not found");
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
  const summary = runResolveBossRoomTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runResolveBossRoomTests
};
