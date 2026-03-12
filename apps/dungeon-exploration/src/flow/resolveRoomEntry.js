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

function resolveRoomOutcome(room) {
  const roomType = room && room.room_type ? String(room.room_type).toLowerCase() : "";
  const hasEncounter = Boolean(room && (room.encounter || room.encounter_id));
  const hasChallenge = Boolean(room && (room.challenge || room.challenge_id));

  if (roomType === "encounter" || hasEncounter) {
    return {
      outcome: "encounter",
      target_system: "combat_system",
      next_event_type: "room_outcome_encounter"
    };
  }

  if (roomType === "challenge" || hasChallenge) {
    return {
      outcome: "challenge",
      target_system: "challenge_system",
      next_event_type: "room_outcome_challenge"
    };
  }

  if (roomType === "rest") {
    return {
      outcome: "rest",
      target_system: "session_system",
      next_event_type: "room_outcome_rest"
    };
  }

  return {
    outcome: "empty",
    target_system: "none",
    next_event_type: "room_outcome_empty"
  };
}

function resolveRoomEntry(input) {
  const data = input || {};
  const manager = data.manager;
  const sessionId = data.session_id ? String(data.session_id) : "";

  if (!manager || typeof manager.getSessionById !== "function") {
    return failure("dungeon_room_entry_resolve_failed", "manager with getSessionById is required");
  }
  if (!sessionId) {
    return failure("dungeon_room_entry_resolve_failed", "session_id is required");
  }

  const found = manager.getSessionById(sessionId);
  if (!found.ok) {
    return failure("dungeon_room_entry_resolve_failed", "session not found", {
      session_id: sessionId
    });
  }

  const session = found.payload.session;
  const currentRoomId = session.current_room_id ? String(session.current_room_id) : "";
  if (!currentRoomId) {
    return failure("dungeon_room_entry_resolve_failed", "current_room_id is not set", {
      session_id: sessionId
    });
  }

  const rooms = Array.isArray(session.rooms) ? session.rooms : [];
  const room = rooms.find((x) => String(x.room_id) === currentRoomId);
  if (!room) {
    return failure("dungeon_room_entry_resolve_failed", "current room not found in session rooms", {
      session_id: sessionId,
      current_room_id: currentRoomId
    });
  }

  const resolved = resolveRoomOutcome(room);

  const latest = manager.sessions.get(sessionId);
  if (latest) {
    latest.event_log = Array.isArray(latest.event_log) ? latest.event_log : [];
    latest.event_log.push({
      event_type: "dungeon_room_entry_resolved",
      timestamp: new Date().toISOString(),
      room_id: currentRoomId,
      outcome: resolved.outcome,
      next_event_type: resolved.next_event_type
    });
    latest.updated_at = new Date().toISOString();
    manager.sessions.set(sessionId, latest);
  }

  const updated = manager.getSessionById(sessionId);

  return success("dungeon_room_entry_resolved", {
    session_id: sessionId,
    room_id: currentRoomId,
    room_type: room.room_type || null,
    outcome: resolved.outcome,
    next_event: {
      event_type: resolved.next_event_type,
      target_system: resolved.target_system,
      should_activate: resolved.target_system !== "none"
    },
    session: updated.ok ? clone(updated.payload.session) : clone(session)
  });
}

module.exports = {
  resolveRoomEntry,
  resolveRoomOutcome
};
