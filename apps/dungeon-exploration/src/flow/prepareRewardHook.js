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

const SUPPORTED_REWARD_CONTEXTS = [
  "encounter_clear",
  "boss_clear",
  "dungeon_complete",
  "chest_opened"
];

function normalizeRewardContext(value) {
  return value ? String(value).trim().toLowerCase() : "";
}

function buildRewardSource(context, room) {
  if (context === "boss_clear") {
    return {
      source_type: "boss",
      source_id:
        (room.encounter && room.encounter.encounter_id) ||
        room.boss_id ||
        room.room_id
    };
  }

  if (context === "dungeon_complete") {
    return {
      source_type: "dungeon",
      source_id: room.dungeon_id || room.room_id
    };
  }

  if (context === "chest_opened") {
    return {
      source_type: "chest",
      source_id: room.room_id
    };
  }

  return {
    source_type: "encounter",
    source_id:
      (room.encounter && room.encounter.encounter_id) ||
      room.encounter_id ||
      room.room_id
  };
}

function prepareRewardHook(input) {
  const data = input || {};
  const manager = data.manager;
  const sessionPersistence = data.sessionPersistence || null;
  const sessionId = data.session_id ? String(data.session_id) : "";
  const rewardContext = normalizeRewardContext(data.reward_context);
  const sourceOverride =
    data.source_override && typeof data.source_override === "object"
      ? data.source_override
      : null;
  const rewardKeySuffix = data.reward_key_suffix ? String(data.reward_key_suffix) : "";

  if (!manager || typeof manager.getSessionById !== "function") {
    return failure("dungeon_reward_hook_prepare_failed", "manager with getSessionById is required");
  }
  if (!sessionId) {
    return failure("dungeon_reward_hook_prepare_failed", "session_id is required");
  }
  if (!SUPPORTED_REWARD_CONTEXTS.includes(rewardContext)) {
    return failure("dungeon_reward_hook_prepare_failed", "unsupported reward context", {
      reward_context: rewardContext,
      supported_reward_contexts: clone(SUPPORTED_REWARD_CONTEXTS)
    });
  }

  const found = manager.getSessionById(sessionId);
  if (!found.ok) {
    return failure("dungeon_reward_hook_prepare_failed", "session not found", {
      session_id: sessionId
    });
  }

  const session = found.payload.session;
  if (String(session.status || "") !== "active") {
    return failure("dungeon_reward_hook_prepare_failed", "session is not active", {
      session_id: sessionId,
      status: session.status || null
    });
  }
  if ((rewardContext === "encounter_clear" || rewardContext === "boss_clear") && session.active_combat_id) {
    return failure("dungeon_reward_hook_prepare_failed", "session still has active combat", {
      session_id: sessionId,
      active_combat_id: String(session.active_combat_id)
    });
  }
  const currentRoomId = session.current_room_id ? String(session.current_room_id) : "";
  if (!currentRoomId) {
    return failure("dungeon_reward_hook_prepare_failed", "current_room_id is not set", {
      session_id: sessionId
    });
  }

  const rooms = Array.isArray(session.rooms) ? session.rooms : [];
  const room = rooms.find((x) => String(x.room_id) === currentRoomId);
  if (!room) {
    return failure("dungeon_reward_hook_prepare_failed", "current room not found in session rooms", {
      session_id: sessionId,
      current_room_id: currentRoomId
    });
  }

  const rewardSource = sourceOverride && sourceOverride.source_type && sourceOverride.source_id
    ? {
        source_type: String(sourceOverride.source_type),
        source_id: String(sourceOverride.source_id)
      }
    : buildRewardSource(rewardContext, room);
  const rewardKey =
    String(currentRoomId) +
    ":" +
    String(rewardContext) +
    (rewardKeySuffix ? ":" + rewardKeySuffix : "");

  const liveSession = manager.sessions.get(sessionId);
  if (!liveSession) {
    return failure("dungeon_reward_hook_prepare_failed", "session missing during state update", {
      session_id: sessionId
    });
  }

  liveSession.reward_state = liveSession.reward_state && typeof liveSession.reward_state === "object"
    ? liveSession.reward_state
    : { consumed_keys: [] };
  liveSession.reward_state.consumed_keys = Array.isArray(liveSession.reward_state.consumed_keys)
    ? liveSession.reward_state.consumed_keys
    : [];
  if (liveSession.reward_state.consumed_keys.includes(rewardKey)) {
    return failure("dungeon_reward_hook_prepare_failed", "reward already consumed for room/context", {
      session_id: sessionId,
      room_id: currentRoomId,
      reward_context: rewardContext
    });
  }
  liveSession.reward_state.consumed_keys.push(rewardKey);

  liveSession.event_log = Array.isArray(liveSession.event_log) ? liveSession.event_log : [];
  liveSession.event_log.push({
    event_type: "dungeon_reward_hook_prepared",
    timestamp: new Date().toISOString(),
    room_id: currentRoomId,
    reward_context: rewardContext,
    reward_key: rewardKey,
    source_type: rewardSource.source_type,
    source_id: rewardSource.source_id
  });
  liveSession.updated_at = new Date().toISOString();
  manager.sessions.set(sessionId, liveSession);

  if (sessionPersistence && typeof sessionPersistence.saveSession === "function") {
    const persisted = sessionPersistence.saveSession(liveSession);
    if (!persisted.ok) {
      liveSession.reward_state.consumed_keys = liveSession.reward_state.consumed_keys.filter((entry) => entry !== rewardKey);
      liveSession.event_log = Array.isArray(liveSession.event_log)
        ? liveSession.event_log.filter((entry) => !(entry && entry.event_type === "dungeon_reward_hook_prepared" && entry.reward_key === rewardKey))
        : [];
      liveSession.updated_at = new Date().toISOString();
      manager.sessions.set(sessionId, liveSession);
      return failure("dungeon_reward_hook_prepare_failed", persisted.error || "failed to persist reward state", {
        session_id: sessionId,
        reward_key: rewardKey
      });
    }
  }

  const updated = manager.getSessionById(sessionId);

  return success("dungeon_reward_hook_prepared", {
    session_id: sessionId,
    room_id: currentRoomId,
    reward_context: rewardContext,
    reward_event: {
      event_type: "reward_generation_requested",
      target_system: "loot_system",
      should_activate: true,
      payload: {
        session_id: sessionId,
        dungeon_id: session.dungeon_id || null,
        room_id: currentRoomId,
        party_id: session.party && session.party.party_id ? session.party.party_id : null,
        reward_context: rewardContext,
        reward_key: rewardKey,
        source_type: rewardSource.source_type,
        source_id: rewardSource.source_id
      }
    },
    session: updated.ok ? clone(updated.payload.session) : clone(session)
  });
}

module.exports = {
  SUPPORTED_REWARD_CONTEXTS,
  prepareRewardHook
};
