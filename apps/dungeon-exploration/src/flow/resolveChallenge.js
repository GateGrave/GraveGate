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

const SUPPORTED_ATTEMPT_TYPES = ["skill", "force", "spell", "item"];

function normalizeAttemptType(value) {
  return value ? String(value).trim().toLowerCase() : "";
}

function getAllowedSolutionTypes(challenge) {
  const raw = [];

  if (Array.isArray(challenge.allowed_solution_types)) {
    raw.push(...challenge.allowed_solution_types);
  }
  if (Array.isArray(challenge.solutions)) {
    raw.push(...challenge.solutions);
  }

  return raw
    .map((x) => normalizeAttemptType(x))
    .filter((x) => x !== "");
}

function appendChallengeLog(manager, sessionId, logEntry) {
  if (!manager || !manager.sessions || !manager.sessions.get) {
    return;
  }

  const liveSession = manager.sessions.get(sessionId);
  if (!liveSession) {
    return;
  }

  liveSession.event_log = Array.isArray(liveSession.event_log) ? liveSession.event_log : [];
  liveSession.event_log.push(logEntry);
  liveSession.updated_at = new Date().toISOString();
  manager.sessions.set(sessionId, liveSession);
}

function resolveChallenge(input) {
  const data = input || {};
  const manager = data.manager;
  const sessionId = data.session_id ? String(data.session_id) : "";
  const attempt = data.challenge_attempt || {};
  const attemptType = normalizeAttemptType(attempt.attempt_type || attempt.type);
  const markClearedOnSuccess = data.mark_cleared_on_success !== false;

  if (!manager || typeof manager.getSessionById !== "function") {
    return failure("dungeon_challenge_resolve_failed", "manager with getSessionById is required");
  }
  if (!sessionId) {
    return failure("dungeon_challenge_resolve_failed", "session_id is required");
  }

  const sessionResult = manager.getSessionById(sessionId);
  if (!sessionResult.ok) {
    return failure("dungeon_challenge_resolve_failed", "session not found", {
      session_id: sessionId
    });
  }

  const session = sessionResult.payload.session;
  const currentRoomId = session.current_room_id ? String(session.current_room_id) : "";
  if (!currentRoomId) {
    return failure("dungeon_challenge_resolve_failed", "current_room_id is not set", {
      session_id: sessionId
    });
  }

  const rooms = Array.isArray(session.rooms) ? session.rooms : [];
  const room = rooms.find((x) => String(x.room_id) === currentRoomId);
  if (!room) {
    return failure("dungeon_challenge_resolve_failed", "current room not found in session rooms", {
      session_id: sessionId,
      current_room_id: currentRoomId
    });
  }

  if (!room.challenge || typeof room.challenge !== "object") {
    return failure("dungeon_challenge_resolve_failed", "room has no challenge", {
      session_id: sessionId,
      room_id: currentRoomId
    });
  }

  if (!attemptType) {
    return failure("dungeon_challenge_resolve_failed", "challenge_attempt.attempt_type is required", {
      session_id: sessionId,
      room_id: currentRoomId
    });
  }

  if (!SUPPORTED_ATTEMPT_TYPES.includes(attemptType)) {
    return failure("dungeon_challenge_resolve_failed", "unsupported attempt type", {
      session_id: sessionId,
      room_id: currentRoomId,
      attempt_type: attemptType,
      supported_attempt_types: clone(SUPPORTED_ATTEMPT_TYPES)
    });
  }

  const allowedTypes = getAllowedSolutionTypes(room.challenge);
  const isSuccess = allowedTypes.includes(attemptType);

  let clearedResult = null;
  if (isSuccess && markClearedOnSuccess) {
    clearedResult = manager.markRoomCleared({
      session_id: sessionId,
      room_id: currentRoomId
    });
  }

  appendChallengeLog(manager, sessionId, {
    event_type: "dungeon_challenge_resolved",
    timestamp: new Date().toISOString(),
    room_id: currentRoomId,
    challenge_id: room.challenge.challenge_id || null,
    attempt_type: attemptType,
    success: isSuccess,
    room_cleared: Boolean(clearedResult && clearedResult.ok)
  });

  const latest = manager.getSessionById(sessionId);

  return success("dungeon_challenge_resolved", {
    session_id: sessionId,
    room_id: currentRoomId,
    challenge_id: room.challenge.challenge_id || null,
    attempt_type: attemptType,
    allowed_solution_types: clone(allowedTypes),
    challenge_success: isSuccess,
    room_cleared: Boolean(clearedResult && clearedResult.ok),
    next_event: {
      event_type: isSuccess ? "challenge_succeeded" : "challenge_failed",
      target_system: "session_system",
      should_activate: true
    },
    session: latest.ok ? clone(latest.payload.session) : clone(session)
  });
}

module.exports = {
  SUPPORTED_ATTEMPT_TYPES,
  resolveChallenge,
  getAllowedSolutionTypes
};
