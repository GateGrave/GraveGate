"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildSessionId() {
  return "session-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function createDungeonSessionModel(input) {
  const data = input || {};
  const now = new Date().toISOString();

  return {
    session_id: data.session_id || buildSessionId(),
    status: data.status || "pending",
    dungeon_id: data.dungeon_id || null,
    party: data.party && typeof data.party === "object" ? clone(data.party) : null,
    current_room_id: data.current_room_id || null,
    active_combat_id: data.active_combat_id || null,
    last_combat_id: data.last_combat_id || null,
    last_completed_combat_id: data.last_completed_combat_id || null,
    discovered_rooms: Array.isArray(data.discovered_rooms) ? clone(data.discovered_rooms) : [],
    cleared_rooms: Array.isArray(data.cleared_rooms) ? clone(data.cleared_rooms) : [],
    rooms: Array.isArray(data.rooms) ? clone(data.rooms) : [],
    combat_history: Array.isArray(data.combat_history) ? clone(data.combat_history) : [],
    trigger_state: data.trigger_state && typeof data.trigger_state === "object"
      ? clone(data.trigger_state)
      : { consumed_keys: [] },
    reward_state: data.reward_state && typeof data.reward_state === "object"
      ? clone(data.reward_state)
      : { consumed_keys: [] },
    event_log: Array.isArray(data.event_log) ? clone(data.event_log) : [],
    created_at: data.created_at || now,
    updated_at: data.updated_at || now
  };
}

module.exports = {
  createDungeonSessionModel
};
