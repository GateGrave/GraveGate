"use strict";

const assert = require("assert");
const dungeon = require("../index");

function buildSessionWithRooms(manager, overrides) {
  const roomA = dungeon.createRoom({
    room_id: "room-A",
    room_type: "hall",
    description: "Entry hall",
    exits: [
      { direction: "east", to_room_id: "room-B", locked: false },
      { direction: "north", to_room_id: "room-C", locked: true }
    ]
  });
  const roomB = dungeon.createRoom({
    room_id: "room-B",
    room_type: "empty_room",
    description: "Quiet room",
    exits: [{ direction: "west", to_room_id: "room-A", locked: false }]
  });
  const roomC = dungeon.createRoom({
    room_id: "room-C",
    room_type: "challenge",
    description: "Puzzle room",
    challenge_id: "challenge-001",
    exits: [{ direction: "south", to_room_id: "room-A", locked: false }]
  });

  return manager.createDungeonSession({
    session_id: "session-phase4-001",
    party_id: "party-001",
    dungeon_type: "crypt",
    floor_number: 1,
    current_room_id: "room-A",
    rooms: [roomA, roomB, roomC],
    encounters: [],
    completed_rooms: [],
    session_status: "active",
    leader_id: "player-leader",
    movement_locked: false,
    ...(overrides || {})
  });
}

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

async function runAsyncTest(name, fn, results) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

async function runPhase4SmokeTests() {
  const results = [];

  runTest("session_schema_create_and_validate", () => {
    const session = dungeon.createDungeonSessionRecord({
      session_id: "session-raw-001",
      party_id: "party-raw-001",
      dungeon_type: "cave",
      leader_id: "player-raw-001"
    });
    assert.equal(dungeon.isDungeonSessionShapeValid(session), true);
    assert.equal(session.lock_flag, false);
  }, results);

  runTest("session_manager_crud_and_active_list", () => {
    const manager = new dungeon.DungeonSessionManager();
    manager.createDungeonSession({
      session_id: "session-crud-001",
      party_id: "party-001",
      dungeon_type: "crypt",
      leader_id: "player-001",
      session_status: "active"
    });
    manager.createDungeonSession({
      session_id: "session-crud-002",
      party_id: "party-002",
      dungeon_type: "crypt",
      leader_id: "player-002",
      session_status: "paused"
    });

    const active = manager.listActiveDungeonSessions();
    assert.equal(active.length, 1);
    assert.equal(manager.getDungeonSession("session-crud-001").party_id, "party-001");
    assert.equal(manager.deleteDungeonSession("session-crud-002"), true);
    assert.equal(manager.getDungeonSession("session-crud-002"), null);
  }, results);

  runTest("room_model_helpers", () => {
    const room = dungeon.createRoom({
      room_id: "room-test-001",
      room_type: "interactable_objects",
      description: "Object room",
      exits: [
        { direction: "east", to_room_id: "room-test-002", locked: false },
        { direction: "west", to_room_id: "room-test-003", locked: false }
      ],
      objects: [{ object_id: "lever-1" }]
    });

    const discovered = dungeon.markRoomDiscovered(room);
    const cleared = dungeon.markRoomCleared(discovered);
    const exits = dungeon.getRoomExits(cleared);

    assert.equal(cleared.discovered, true);
    assert.equal(cleared.cleared, true);
    assert.equal(exits.length, 2);
  }, results);

  runTest("session_lock_helpers", () => {
    const manager = new dungeon.DungeonSessionManager();
    buildSessionWithRooms(manager, { session_id: "session-lock-001" });

    const lockResult = dungeon.lockDungeonSession(manager, "session-lock-001", {
      locked_by: "test",
      reason: "smoke_test"
    });
    assert.equal(lockResult.ok, true);
    assert.equal(dungeon.isDungeonSessionLocked(manager, "session-lock-001"), true);

    const secondLock = dungeon.lockDungeonSession(manager, "session-lock-001");
    assert.equal(secondLock.ok, false);
    assert.equal(secondLock.reason, "session_locked");

    const unlockResult = dungeon.unlockDungeonSession(manager, "session-lock-001");
    assert.equal(unlockResult.ok, true);
    assert.equal(dungeon.isDungeonSessionLocked(manager, "session-lock-001"), false);
  }, results);

  await runAsyncTest("safe_session_event_processing_success", async () => {
    const manager = new dungeon.DungeonSessionManager();
    buildSessionWithRooms(manager, { session_id: "session-safe-ok-001" });

    const result = await dungeon.processDungeonSessionEventSafe({
      manager,
      event: {
        event_id: "evt-safe-001",
        event_type: "session_room_updated",
        session_id: "session-safe-ok-001",
        payload: { current_room_id: "room-B" }
      },
      processEventFn: async ({ event }) => ({
        statePatch: { current_room_id: event.payload.current_room_id },
        output: { event_type: "session_room_updated_result" }
      })
    });

    assert.equal(result.ok, true);
    assert.equal(result.updated_session.current_room_id, "room-B");
    assert.equal(dungeon.isDungeonSessionLocked(manager, "session-safe-ok-001"), false);
  }, results);

  await runAsyncTest("safe_session_event_processing_error_unlocks", async () => {
    const manager = new dungeon.DungeonSessionManager();
    buildSessionWithRooms(manager, { session_id: "session-safe-err-001" });

    const result = await dungeon.processDungeonSessionEventSafe({
      manager,
      event: {
        event_id: "evt-safe-err-001",
        event_type: "forced_error_event",
        session_id: "session-safe-err-001"
      },
      processEventFn: async () => {
        throw new Error("forced_failure");
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, "error");
    assert.equal(dungeon.isDungeonSessionLocked(manager, "session-safe-err-001"), false);
  }, results);

  runTest("party_movement_and_exit_validation", () => {
    const manager = new dungeon.DungeonSessionManager();
    buildSessionWithRooms(manager, { session_id: "session-move-001" });

    const nonLeaderMove = dungeon.moveParty({
      manager,
      session_id: "session-move-001",
      destination_room: "room-B",
      player_id: "player-not-leader"
    });
    assert.equal(nonLeaderMove.ok, false);
    assert.equal(nonLeaderMove.reason, "leader_required");

    const successMove = dungeon.moveParty({
      manager,
      session_id: "session-move-001",
      destination_room: "room-B",
      player_id: "player-leader"
    });
    assert.equal(successMove.ok, true);
    assert.equal(successMove.updated_session.current_room_id, "room-B");

    const backMoveLockedExit = dungeon.moveParty({
      manager,
      session_id: "session-move-001",
      destination_room: "room-C",
      player_id: "player-leader"
    });
    assert.equal(backMoveLockedExit.ok, false);
    assert.equal(backMoveLockedExit.reason, "exit_not_found");
  }, results);

  runTest("party_movement_respects_session_movement_lock", () => {
    const manager = new dungeon.DungeonSessionManager();
    buildSessionWithRooms(manager, {
      session_id: "session-move-lock-001",
      movement_locked: true
    });

    const result = dungeon.moveParty({
      manager,
      session_id: "session-move-lock-001",
      destination_room: "room-B",
      player_id: "player-leader"
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "movement_locked");
  }, results);

  runTest("leader_transfer_support", () => {
    const manager = new dungeon.DungeonSessionManager();
    buildSessionWithRooms(manager, { session_id: "session-leader-001" });

    const transfer = dungeon.transferLeader({
      manager,
      session_id: "session-leader-001",
      new_leader_id: "player-new-leader"
    });

    assert.equal(transfer.ok, true);
    const leaderCheck = dungeon.validateLeader("player-new-leader", transfer.updated_session);
    assert.equal(leaderCheck.ok, true);
  }, results);

  runTest("room_entry_resolver_outcomes", () => {
    const session = {
      session_id: "session-room-entry-001",
      party_id: "party-room-entry-001"
    };
    const cases = [
      dungeon.createRoom({ room_id: "r1", room_type: "combat_encounter", encounter_id: "enc-1" }),
      dungeon.createRoom({ room_id: "r2", room_type: "challenge", challenge_id: "ch-1" }),
      dungeon.createRoom({ room_id: "r3", room_type: "hall", objects: [{ object_id: "obj-1" }] }),
      dungeon.createRoom({ room_id: "r4", room_type: "rest_room" }),
      dungeon.createRoom({ room_id: "r5", room_type: "boss_room", encounter_id: "boss-1" }),
      dungeon.createRoom({ room_id: "r6", room_type: "hall" })
    ];

    const outcomes = cases.map((room) => dungeon.resolveRoomEntry({ session, room }).payload.outcome);
    assert.deepEqual(outcomes, [
      "combat_encounter",
      "challenge",
      "interactable_objects",
      "rest_room",
      "boss_room",
      "empty_room"
    ]);
  }, results);

  const passed = results.filter((x) => x.ok).length;
  const failed = results.filter((x) => !x.ok).length;

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
  runPhase4SmokeTests()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      if (!summary.ok) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error("phase4 smoke test runner failed:", error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  runPhase4SmokeTests
};

