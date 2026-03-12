"use strict";

const { DungeonSessionManagerCore } = require("../core/dungeonSessionManager");
const { createRoomObject } = require("../rooms/roomModel");
const { moveParty } = require("../flow/moveParty");
const { resolveRoomEntry } = require("../flow/resolveRoomEntry");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {},
    error: null
  };
}

function failure(eventType, message, payload) {
  return {
    ok: false,
    event_type: eventType,
    payload: payload || {},
    error: message
  };
}

function runDungeonHarness(input) {
  const data = input || {};
  const manager = new DungeonSessionManagerCore();
  const log = [];

  const sessionId = data.session_id || "dungeon-harness-001";

  const created = manager.createSession({
    session_id: sessionId,
    dungeon_id: data.dungeon_id || "dungeon-alpha",
    status: "active"
  });
  log.push({ step: "create_session", result: clone(created) });
  if (!created.ok) {
    return failure("dungeon_harness_failed", "could not create session", { log });
  }

  const partyAssigned = manager.setParty({
    session_id: sessionId,
    party: {
      party_id: "party-alpha",
      leader_id: "player-001",
      members: ["player-001", "player-002"]
    }
  });
  log.push({ step: "assign_party", result: clone(partyAssigned) });
  if (!partyAssigned.ok) {
    return failure("dungeon_harness_failed", "could not assign party", { log });
  }

  const addRooms = manager.addMultipleRoomsToSession({
    session_id: sessionId,
    rooms: [
      createRoomObject({
        room_id: "room-A1",
        name: "Camp",
        room_type: "rest",
        exits: [{ direction: "east", to_room_id: "room-A2" }]
      }),
      createRoomObject({
        room_id: "room-A2",
        name: "Hallway Ambush",
        room_type: "encounter",
        encounter: { encounter_id: "enc-001", name: "Goblin Pack" },
        exits: [
          { direction: "west", to_room_id: "room-A1" },
          { direction: "east", to_room_id: "room-A3" }
        ]
      }),
      createRoomObject({
        room_id: "room-A3",
        name: "Puzzle Door",
        room_type: "challenge",
        challenge: { challenge_id: "chal-001", type: "riddle" },
        exits: [
          { direction: "west", to_room_id: "room-A2" },
          { direction: "east", to_room_id: "room-A4" }
        ]
      }),
      createRoomObject({
        room_id: "room-A4",
        name: "Quiet Chamber",
        room_type: "empty",
        exits: [{ direction: "west", to_room_id: "room-A3" }]
      })
    ]
  });
  log.push({ step: "add_rooms", result: clone(addRooms) });
  if (!addRooms.ok) {
    return failure("dungeon_harness_failed", "could not add rooms", { log });
  }

  const startRoom = manager.setStartRoom({
    session_id: sessionId,
    room_id: "room-A1"
  });
  log.push({ step: "set_start_room", result: clone(startRoom) });
  if (!startRoom.ok) {
    return failure("dungeon_harness_failed", "could not set start room", { log });
  }

  const move = moveParty({
    manager,
    session_id: sessionId,
    target_room_id: "room-A2"
  });
  log.push({ step: "move_party", result: clone(move) });
  if (!move.ok) {
    return failure("dungeon_harness_failed", "party movement failed", { log });
  }

  const entry = resolveRoomEntry({
    manager,
    session_id: sessionId
  });
  log.push({ step: "resolve_room_entry", result: clone(entry) });
  if (!entry.ok) {
    return failure("dungeon_harness_failed", "room entry resolver failed", { log });
  }

  // Harness-only example: mark the entered room cleared to show post-resolution state update.
  const cleared = manager.markRoomCleared({
    session_id: sessionId,
    room_id: move.payload.to_room_id
  });
  log.push({ step: "mark_room_cleared", result: clone(cleared) });
  if (!cleared.ok) {
    return failure("dungeon_harness_failed", "could not mark room cleared", { log });
  }

  const finalState = manager.getSessionById(sessionId);
  log.push({ step: "get_final_session", result: clone(finalState) });
  if (!finalState.ok) {
    return failure("dungeon_harness_failed", "final session fetch failed", { log });
  }

  return success("dungeon_harness_completed", {
    session_id: sessionId,
    final_session: clone(finalState.payload.session),
    resolved_outcome: entry.payload.outcome,
    log
  });
}

if (require.main === module) {
  const out = runDungeonHarness();
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runDungeonHarness
};
