"use strict";

// Room scaffold for Session State dungeon exploration.
// This is data modeling only (no movement/combat/encounter resolution).
const DUNGEON_ROOM_SCHEMA = {
  room_id: "string",
  room_type: "string",
  description: "string",
  exits: "array",
  encounter_id: "string|null",
  challenge_id: "string|null",
  objects: "array",
  discovered: "boolean",
  cleared: "boolean"
};

/**
 * Create one room object with safe defaults.
 * Exits supports multiple paths using an array.
 *
 * Example exits:
 * [
 *   { direction: "north", to_room_id: "room-002", locked: false },
 *   { direction: "east", to_room_id: "room-003", locked: true }
 * ]
 */
function createRoom(input) {
  const value = input || {};

  if (!value.room_id) {
    throw new Error("createRoom requires room_id");
  }

  return {
    room_id: String(value.room_id),
    room_type: String(value.room_type || "unknown"),
    description: String(value.description || ""),
    exits: Array.isArray(value.exits) ? value.exits.map(normalizeExit) : [],
    encounter_id: value.encounter_id || null,
    challenge_id: value.challenge_id || null,
    objects: Array.isArray(value.objects) ? value.objects : [],
    discovered: Boolean(value.discovered),
    cleared: Boolean(value.cleared)
  };
}

function normalizeExit(exit) {
  const value = exit || {};
  return {
    direction: String(value.direction || "unknown"),
    to_room_id: String(value.to_room_id || ""),
    locked: Boolean(value.locked)
  };
}

function markRoomDiscovered(room) {
  return {
    ...room,
    discovered: true
  };
}

function markRoomCleared(room) {
  return {
    ...room,
    cleared: true
  };
}

function getRoomExits(room) {
  return Array.isArray(room?.exits) ? room.exits : [];
}

module.exports = {
  DUNGEON_ROOM_SCHEMA,
  createRoom,
  markRoomDiscovered,
  markRoomCleared,
  getRoomExits
};

