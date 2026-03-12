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

function isBossRoom(room) {
  const roomType = room && room.room_type ? String(room.room_type).toLowerCase() : "";
  const hasBossEncounterMarker = Boolean(
    room && room.encounter && (
      room.encounter.is_boss === true ||
      String(room.encounter.encounter_type || "").toLowerCase() === "boss"
    )
  );

  return roomType === "boss" || hasBossEncounterMarker;
}

function resolveBossRoom(input) {
  const data = input || {};
  const manager = data.manager;
  const sessionId = data.session_id ? String(data.session_id) : "";

  if (!manager || typeof manager.getSessionById !== "function") {
    return failure("dungeon_boss_room_resolve_failed", "manager with getSessionById is required");
  }
  if (!sessionId) {
    return failure("dungeon_boss_room_resolve_failed", "session_id is required");
  }

  const found = manager.getSessionById(sessionId);
  if (!found.ok) {
    return failure("dungeon_boss_room_resolve_failed", "session not found", {
      session_id: sessionId
    });
  }

  const session = found.payload.session;
  const currentRoomId = session.current_room_id ? String(session.current_room_id) : "";
  if (!currentRoomId) {
    return failure("dungeon_boss_room_resolve_failed", "current_room_id is not set", {
      session_id: sessionId
    });
  }

  const rooms = Array.isArray(session.rooms) ? session.rooms : [];
  const room = rooms.find((x) => String(x.room_id) === currentRoomId);
  if (!room) {
    return failure("dungeon_boss_room_resolve_failed", "current room not found in session rooms", {
      session_id: sessionId,
      current_room_id: currentRoomId
    });
  }

  if (!isBossRoom(room)) {
    return failure("dungeon_boss_room_resolve_failed", "current room is not a boss room", {
      session_id: sessionId,
      room_id: currentRoomId,
      room_type: room.room_type || null
    });
  }

  const liveSession = manager.sessions.get(sessionId);
  if (!liveSession) {
    return failure("dungeon_boss_room_resolve_failed", "session missing during state update", {
      session_id: sessionId
    });
  }

  liveSession.event_log = Array.isArray(liveSession.event_log) ? liveSession.event_log : [];
  liveSession.event_log.push({
    event_type: "dungeon_boss_room_resolved",
    timestamp: new Date().toISOString(),
    room_id: currentRoomId,
    boss_trigger_ready: true
  });
  liveSession.updated_at = new Date().toISOString();
  manager.sessions.set(sessionId, liveSession);

  const updated = manager.getSessionById(sessionId);

  return success("dungeon_boss_room_resolved", {
    session_id: sessionId,
    room_id: currentRoomId,
    room_type: room.room_type || null,
    boss_trigger_ready: true,
    next_event: {
      event_type: "boss_encounter_trigger_requested",
      target_system: "combat_system",
      should_activate: true
    },
    session: updated.ok ? clone(updated.payload.session) : clone(session)
  });
}

module.exports = {
  resolveBossRoom,
  isBossRoom
};
