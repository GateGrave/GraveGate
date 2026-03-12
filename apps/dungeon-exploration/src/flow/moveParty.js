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

function getLinkedRoomIds(room) {
  const exits = room && Array.isArray(room.exits) ? room.exits : [];
  const linked = [];

  for (const exit of exits) {
    if (typeof exit === "string" && exit.trim() !== "") {
      linked.push(exit.trim());
      continue;
    }

    if (exit && typeof exit === "object") {
      if (exit.to_room_id && String(exit.to_room_id).trim() !== "") {
        linked.push(String(exit.to_room_id).trim());
      } else if (exit.room_id && String(exit.room_id).trim() !== "") {
        linked.push(String(exit.room_id).trim());
      } else if (exit.id && String(exit.id).trim() !== "") {
        linked.push(String(exit.id).trim());
      }
    }
  }

  return linked;
}

function moveParty(input) {
  const data = input || {};
  const manager = data.manager;
  const sessionId = data.session_id ? String(data.session_id) : "";
  const targetRoomId = data.target_room_id ? String(data.target_room_id) : "";

  if (!manager || typeof manager.getSessionById !== "function") {
    return failure("dungeon_party_move_failed", "manager with getSessionById is required");
  }
  if (!sessionId) {
    return failure("dungeon_party_move_failed", "session_id is required");
  }
  if (!targetRoomId) {
    return failure("dungeon_party_move_failed", "target_room_id is required", {
      session_id: sessionId
    });
  }

  const found = manager.getSessionById(sessionId);
  if (!found.ok) {
    return failure("dungeon_party_move_failed", "session not found", {
      session_id: sessionId,
      target_room_id: targetRoomId
    });
  }

  const session = found.payload.session;
  if (session.status !== "active") {
    return failure("dungeon_party_move_failed", "session is not active", {
      session_id: sessionId,
      status: session.status
    });
  }

  if (!session.party || typeof session.party !== "object") {
    return failure("dungeon_party_move_failed", "party is not assigned", {
      session_id: sessionId
    });
  }

  const currentRoomId = session.current_room_id ? String(session.current_room_id) : "";
  if (!currentRoomId) {
    return failure("dungeon_party_move_failed", "current room is not set", {
      session_id: sessionId
    });
  }

  const rooms = Array.isArray(session.rooms) ? session.rooms : [];
  const currentRoom = rooms.find((room) => String(room.room_id) === currentRoomId);
  const targetRoom = rooms.find((room) => String(room.room_id) === targetRoomId);

  if (!currentRoom) {
    return failure("dungeon_party_move_failed", "current room does not exist in session", {
      session_id: sessionId,
      current_room_id: currentRoomId
    });
  }

  if (!targetRoom) {
    return failure("dungeon_party_move_failed", "target room does not exist in session", {
      session_id: sessionId,
      target_room_id: targetRoomId
    });
  }

  const linkedRoomIds = getLinkedRoomIds(currentRoom);
  const isConnected = linkedRoomIds.includes(targetRoomId);
  if (!isConnected) {
    return failure("dungeon_party_move_failed", "target room is not connected to current room", {
      session_id: sessionId,
      current_room_id: currentRoomId,
      target_room_id: targetRoomId,
      allowed_rooms: clone(linkedRoomIds)
    });
  }

  const setRoom = manager.setCurrentRoom({
    session_id: sessionId,
    current_room_id: targetRoomId
  });
  if (!setRoom.ok) {
    return failure("dungeon_party_move_failed", setRoom.error || "failed to update current room", {
      session_id: sessionId,
      target_room_id: targetRoomId,
      result: setRoom
    });
  }

  const discovered = manager.markRoomDiscovered({
    session_id: sessionId,
    room_id: targetRoomId
  });
  if (!discovered.ok) {
    return failure("dungeon_party_move_failed", discovered.error || "failed to mark room discovered", {
      session_id: sessionId,
      target_room_id: targetRoomId,
      result: discovered
    });
  }

  // Add a dedicated movement log entry so movement flow is explicit.
  const latest = manager.sessions.get(sessionId);
  if (latest) {
    latest.event_log = Array.isArray(latest.event_log) ? latest.event_log : [];
    latest.event_log.push({
      event_type: "dungeon_party_moved",
      timestamp: new Date().toISOString(),
      from_room_id: currentRoomId,
      to_room_id: targetRoomId,
      party_id: latest.party && latest.party.party_id ? latest.party.party_id : null
    });
    latest.updated_at = new Date().toISOString();
    manager.sessions.set(sessionId, latest);
  }

  const updated = manager.getSessionById(sessionId);
  return success("dungeon_party_moved", {
    session_id: sessionId,
    from_room_id: currentRoomId,
    to_room_id: targetRoomId,
    party: clone(session.party),
    session: updated.ok ? updated.payload.session : setRoom.payload.session
  });
}

module.exports = {
  moveParty,
  getLinkedRoomIds
};
