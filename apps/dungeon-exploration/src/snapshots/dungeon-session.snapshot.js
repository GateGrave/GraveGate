"use strict";

function buildRoomStatuses(rooms) {
  const list = Array.isArray(rooms) ? rooms : [];
  return list.map((room) => ({
    room_id: room.room_id,
    discovered: Boolean(room.discovered),
    cleared: Boolean(room.cleared)
  }));
}

/**
 * Create a lightweight dungeon session snapshot for recovery.
 * Required snapshot fields:
 * - session state
 * - floor number
 * - current room
 * - room statuses
 * - leader id
 * - movement lock
 */
function createSnapshot(sessionState, options) {
  const session = sessionState || {};
  const config = options || {};

  return {
    snapshot_id: config.snapshot_id || `dungeon-snapshot-${Date.now()}`,
    session_id: session.session_id || null,
    created_at: new Date().toISOString(),
    session_state: {
      session_id: session.session_id || null,
      party_id: session.party_id || null,
      session_status: session.session_status || "unknown"
    },
    floor_number: Number.isFinite(session.floor_number) ? session.floor_number : 1,
    current_room: session.current_room_id || null,
    room_statuses: buildRoomStatuses(session.rooms),
    leader_id: session.leader_id || null,
    movement_lock: Boolean(session.movement_locked)
  };
}

/**
 * Restore core session fields from a snapshot.
 * This only restores snapshot-owned fields and leaves all other fields unchanged.
 */
function restoreSnapshot(sessionState, snapshot) {
  const session = sessionState || {};
  const data = snapshot || {};

  const statusMap = new Map(
    (Array.isArray(data.room_statuses) ? data.room_statuses : []).map((entry) => [
      entry.room_id,
      entry
    ])
  );

  const restoredRooms = (Array.isArray(session.rooms) ? session.rooms : []).map((room) => {
    const status = statusMap.get(room.room_id);
    if (!status) return room;
    return {
      ...room,
      discovered: Boolean(status.discovered),
      cleared: Boolean(status.cleared)
    };
  });

  return {
    ...session,
    floor_number: Number.isFinite(data.floor_number) ? data.floor_number : session.floor_number,
    current_room_id: data.current_room ?? session.current_room_id,
    leader_id: data.leader_id ?? session.leader_id,
    movement_locked:
      typeof data.movement_lock === "boolean" ? data.movement_lock : session.movement_locked,
    rooms: restoredRooms,
    updated_at: new Date().toISOString()
  };
}

module.exports = {
  createSnapshot,
  restoreSnapshot
};

