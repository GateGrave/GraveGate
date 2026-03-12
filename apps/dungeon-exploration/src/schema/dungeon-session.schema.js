"use strict";

// Dungeon Session schema scaffold (Session State only).
// This is intentionally simple and does not include gameplay rules yet.
const DUNGEON_SESSION_SCHEMA = {
  session_id: "string",
  party_id: "string",
  dungeon_type: "string",
  floor_number: "number",
  current_room_id: "string|null",
  rooms: "array",
  encounters: "array",
  completed_rooms: "array",
  session_status: "string",
  leader_id: "string",
  movement_locked: "boolean",
  final_room_id: "string|null",
  final_room_cleared: "boolean",
  boss_defeated: "boolean",
  objectives: "array",
  objective_completed: "boolean",
  completion_requirements: "object",
  lock_flag: "boolean",
  created_at: "string (ISO date)",
  updated_at: "string (ISO date)"
};

function createDungeonSessionRecord(input) {
  const now = new Date().toISOString();

  return {
    session_id: String(input.session_id),
    party_id: String(input.party_id),
    dungeon_type: String(input.dungeon_type || "unknown"),
    floor_number: Number.isFinite(input.floor_number) ? input.floor_number : 1,
    current_room_id: input.current_room_id || null,
    rooms: Array.isArray(input.rooms) ? input.rooms : [],
    encounters: Array.isArray(input.encounters) ? input.encounters : [],
    completed_rooms: Array.isArray(input.completed_rooms) ? input.completed_rooms : [],
    session_status: String(input.session_status || "active"),
    leader_id: String(input.leader_id),
    movement_locked: Boolean(input.movement_locked),
    final_room_id: input.final_room_id || null,
    final_room_cleared: Boolean(input.final_room_cleared),
    boss_defeated: Boolean(input.boss_defeated),
    objectives: Array.isArray(input.objectives) ? input.objectives : [],
    objective_completed: Boolean(input.objective_completed),
    completion_requirements:
      input.completion_requirements && typeof input.completion_requirements === "object"
        ? input.completion_requirements
        : {},
    lock_flag: Boolean(input.lock_flag),
    lock: {
      locked: Boolean(input.lock_flag),
      locked_at: input.lock?.locked_at || null,
      locked_by: input.lock?.locked_by || null,
      reason: input.lock?.reason || null
    },
    created_at: input.created_at || now,
    updated_at: input.updated_at || now
  };
}

function isDungeonSessionShapeValid(session) {
  if (!session || typeof session !== "object") return false;

  return (
    typeof session.session_id === "string" &&
    typeof session.party_id === "string" &&
    typeof session.dungeon_type === "string" &&
    typeof session.floor_number === "number" &&
    (typeof session.current_room_id === "string" || session.current_room_id === null) &&
    Array.isArray(session.rooms) &&
    Array.isArray(session.encounters) &&
    Array.isArray(session.completed_rooms) &&
    typeof session.session_status === "string" &&
    typeof session.leader_id === "string" &&
    typeof session.movement_locked === "boolean" &&
    (typeof session.final_room_id === "string" || session.final_room_id === null) &&
    typeof session.final_room_cleared === "boolean" &&
    typeof session.boss_defeated === "boolean" &&
    Array.isArray(session.objectives) &&
    typeof session.objective_completed === "boolean" &&
    session.completion_requirements &&
    typeof session.completion_requirements === "object" &&
    typeof session.lock_flag === "boolean" &&
    typeof session.created_at === "string" &&
    typeof session.updated_at === "string"
  );
}

module.exports = {
  DUNGEON_SESSION_SCHEMA,
  createDungeonSessionRecord,
  isDungeonSessionShapeValid
};
