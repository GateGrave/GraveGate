"use strict";

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

function isRestRoom(room) {
  const roomType = room && room.room_type ? String(room.room_type).toLowerCase() : "";
  return roomType === "rest";
}

function resolveRestRoom(input) {
  const data = input || {};
  const manager = data.manager;
  const sessionId = data.session_id ? String(data.session_id) : "";
  const markRestUsed = data.mark_rest_used !== false;

  if (!manager || typeof manager.getSessionById !== "function") {
    return failure("dungeon_rest_room_resolve_failed", "manager with getSessionById is required");
  }
  if (!sessionId) {
    return failure("dungeon_rest_room_resolve_failed", "session_id is required");
  }

  const found = manager.getSessionById(sessionId);
  if (!found.ok) {
    return failure("dungeon_rest_room_resolve_failed", "session not found", {
      session_id: sessionId
    });
  }

  const session = found.payload.session;
  const currentRoomId = session.current_room_id ? String(session.current_room_id) : "";
  if (!currentRoomId) {
    return failure("dungeon_rest_room_resolve_failed", "current_room_id is not set", {
      session_id: sessionId
    });
  }

  const roomList = Array.isArray(session.rooms) ? session.rooms : [];
  const room = roomList.find((x) => String(x.room_id) === currentRoomId);
  if (!room) {
    return failure("dungeon_rest_room_resolve_failed", "current room not found in session rooms", {
      session_id: sessionId,
      current_room_id: currentRoomId
    });
  }

  if (!isRestRoom(room)) {
    return failure("dungeon_rest_room_resolve_failed", "current room is not a rest room", {
      session_id: sessionId,
      room_id: currentRoomId,
      room_type: room.room_type || null
    });
  }

  const liveSession = manager.sessions.get(sessionId);
  if (!liveSession) {
    return failure("dungeon_rest_room_resolve_failed", "session missing during state update", {
      session_id: sessionId
    });
  }

  const liveRoom = Array.isArray(liveSession.rooms)
    ? liveSession.rooms.find((x) => String(x.room_id) === currentRoomId)
    : null;
  if (!liveRoom) {
    return failure("dungeon_rest_room_resolve_failed", "current room missing during state update", {
      session_id: sessionId,
      current_room_id: currentRoomId
    });
  }

  let roomMarkedUsed = false;
  if (markRestUsed) {
    liveRoom.rest_used = true;
    liveRoom.last_rested_at = new Date().toISOString();
    roomMarkedUsed = true;
  }

  liveSession.event_log = Array.isArray(liveSession.event_log) ? liveSession.event_log : [];
  liveSession.event_log.push({
    event_type: "dungeon_rest_room_resolved",
    timestamp: new Date().toISOString(),
    room_id: currentRoomId,
    room_marked_used: roomMarkedUsed
  });
  liveSession.updated_at = new Date().toISOString();
  manager.sessions.set(sessionId, liveSession);

  const updated = manager.getSessionById(sessionId);

  return success("dungeon_rest_room_resolved", {
    session_id: sessionId,
    room_id: currentRoomId,
    room_type: liveRoom.room_type,
    rest_outcome: "rest_available",
    room_marked_used: roomMarkedUsed,
    next_event: {
      event_type: "rest_room_completed",
      target_system: "session_system",
      should_activate: true
    },
    session: updated.ok ? clone(updated.payload.session) : clone(session)
  });
}

module.exports = {
  resolveRestRoom,
  isRestRoom
};
