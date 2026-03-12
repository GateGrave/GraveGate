"use strict";

const { createDungeonSessionModel } = require("./dungeonSessionModel");

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

class DungeonSessionManagerCore {
  constructor() {
    // In-memory store. Every session is isolated by session_id.
    this.sessions = new Map();
  }

  createSession(input) {
    try {
      const session = createDungeonSessionModel(input);
      if (this.sessions.has(session.session_id)) {
        return failure("dungeon_session_create_failed", "session_id already exists", {
          session_id: session.session_id
        });
      }

      this.sessions.set(session.session_id, session);
      return success("dungeon_session_created", {
        session: clone(session)
      });
    } catch (error) {
      return failure("dungeon_session_create_failed", error.message);
    }
  }

  getSessionById(sessionId) {
    if (!sessionId || String(sessionId).trim() === "") {
      return failure("dungeon_session_fetch_failed", "session_id is required");
    }

    const session = this.sessions.get(String(sessionId));
    if (!session) {
      return failure("dungeon_session_fetch_failed", "session not found", {
        session_id: String(sessionId)
      });
    }

    return success("dungeon_session_found", {
      session: clone(session)
    });
  }

  setParty(input) {
    const data = input || {};
    const sessionId = data.session_id;
    const party = data.party;

    if (!sessionId || String(sessionId).trim() === "") {
      return failure("dungeon_session_set_party_failed", "session_id is required");
    }
    if (!party || typeof party !== "object") {
      return failure("dungeon_session_set_party_failed", "party object is required");
    }

    const current = this.sessions.get(String(sessionId));
    if (!current) {
      return failure("dungeon_session_set_party_failed", "session not found", {
        session_id: String(sessionId)
      });
    }

    current.party = clone(party);
    current.updated_at = new Date().toISOString();
    this.sessions.set(String(sessionId), current);

    return success("dungeon_session_party_set", {
      session_id: String(sessionId),
      party: clone(current.party),
      session: clone(current)
    });
  }

  addPartyParticipant(input) {
    const data = input || {};
    const sessionId = data.session_id;
    const participant = data.participant;

    if (!sessionId || String(sessionId).trim() === "") {
      return failure("dungeon_session_add_participant_failed", "session_id is required");
    }
    if (!participant || typeof participant !== "object" || Array.isArray(participant)) {
      return failure("dungeon_session_add_participant_failed", "participant object is required");
    }

    const playerId = participant.player_id ? String(participant.player_id) : "";
    if (!playerId) {
      return failure("dungeon_session_add_participant_failed", "participant.player_id is required");
    }

    const current = this.sessions.get(String(sessionId));
    if (!current) {
      return failure("dungeon_session_add_participant_failed", "session not found", {
        session_id: String(sessionId)
      });
    }

    current.party = current.party && typeof current.party === "object" ? current.party : {};
    current.party.members = Array.isArray(current.party.members) ? current.party.members : [];

    const exists = current.party.members.some(function hasMember(member) {
      return member && String(member.player_id || "") === playerId;
    });
    if (exists) {
      return failure("dungeon_session_add_participant_failed", "participant already exists in session party", {
        session_id: String(sessionId),
        player_id: playerId
      });
    }

    current.party.members.push(clone(participant));
    current.updated_at = new Date().toISOString();
    current.event_log = Array.isArray(current.event_log) ? current.event_log : [];
    current.event_log.push({
      event_type: "dungeon_party_participant_added",
      timestamp: new Date().toISOString(),
      player_id: playerId
    });

    this.sessions.set(String(sessionId), current);
    return success("dungeon_session_participant_added", {
      session_id: String(sessionId),
      participant: clone(participant),
      member_count: current.party.members.length,
      session: clone(current)
    });
  }

  removePartyParticipant(input) {
    const data = input || {};
    const sessionId = data.session_id;
    const playerId = data.player_id ? String(data.player_id) : "";

    if (!sessionId || String(sessionId).trim() === "") {
      return failure("dungeon_session_remove_participant_failed", "session_id is required");
    }
    if (!playerId) {
      return failure("dungeon_session_remove_participant_failed", "player_id is required");
    }

    const current = this.sessions.get(String(sessionId));
    if (!current) {
      return failure("dungeon_session_remove_participant_failed", "session not found", {
        session_id: String(sessionId)
      });
    }

    current.party = current.party && typeof current.party === "object" ? current.party : {};
    current.party.members = Array.isArray(current.party.members) ? current.party.members : [];

    const before = current.party.members.length;
    current.party.members = current.party.members.filter(function keepMember(member) {
      return !member || String(member.player_id || "") !== playerId;
    });

    if (current.party.members.length === before) {
      return failure("dungeon_session_remove_participant_failed", "participant not found in session party", {
        session_id: String(sessionId),
        player_id: playerId
      });
    }

    current.updated_at = new Date().toISOString();
    current.event_log = Array.isArray(current.event_log) ? current.event_log : [];
    current.event_log.push({
      event_type: "dungeon_party_participant_removed",
      timestamp: new Date().toISOString(),
      player_id: playerId
    });

    this.sessions.set(String(sessionId), current);
    return success("dungeon_session_participant_removed", {
      session_id: String(sessionId),
      player_id: playerId,
      member_count: current.party.members.length,
      session: clone(current)
    });
  }

  listPartyParticipants(sessionId) {
    if (!sessionId || String(sessionId).trim() === "") {
      return failure("dungeon_session_list_participants_failed", "session_id is required");
    }

    const current = this.sessions.get(String(sessionId));
    if (!current) {
      return failure("dungeon_session_list_participants_failed", "session not found", {
        session_id: String(sessionId)
      });
    }

    const members =
      current.party && Array.isArray(current.party.members)
        ? current.party.members.map(function copyMember(member) {
            return member && typeof member === "object" ? clone(member) : null;
          })
        : [];

    return success("dungeon_session_participants_listed", {
      session_id: String(sessionId),
      members
    });
  }

  getParty(sessionId) {
    if (!sessionId || String(sessionId).trim() === "") {
      return failure("dungeon_session_get_party_failed", "session_id is required");
    }

    const current = this.sessions.get(String(sessionId));
    if (!current) {
      return failure("dungeon_session_get_party_failed", "session not found", {
        session_id: String(sessionId)
      });
    }

    return success("dungeon_session_party_found", {
      session_id: String(sessionId),
      party: clone(current.party)
    });
  }

  setCurrentRoom(input) {
    const data = input || {};
    const sessionId = data.session_id;
    const roomId = data.current_room_id;

    if (!sessionId || String(sessionId).trim() === "") {
      return failure("dungeon_session_set_room_failed", "session_id is required");
    }
    if (!roomId || String(roomId).trim() === "") {
      return failure("dungeon_session_set_room_failed", "current_room_id is required");
    }

    const current = this.sessions.get(String(sessionId));
    if (!current) {
      return failure("dungeon_session_set_room_failed", "session not found", {
        session_id: String(sessionId)
      });
    }

    current.current_room_id = String(roomId);
    current.updated_at = new Date().toISOString();
    current.event_log = Array.isArray(current.event_log) ? current.event_log : [];
    current.event_log.push({
      event_type: "dungeon_room_set",
      timestamp: new Date().toISOString(),
      room_id: String(roomId)
    });
    this.sessions.set(String(sessionId), current);

    return success("dungeon_session_room_set", {
      session_id: String(sessionId),
      current_room_id: current.current_room_id,
      session: clone(current)
    });
  }

  addRoomToSession(input) {
    const data = input || {};
    const sessionId = data.session_id;
    const room = data.room;

    if (!sessionId || String(sessionId).trim() === "") {
      return failure("dungeon_session_add_room_failed", "session_id is required");
    }
    if (!room || typeof room !== "object") {
      return failure("dungeon_session_add_room_failed", "room object is required");
    }
    if (!room.room_id || String(room.room_id).trim() === "") {
      return failure("dungeon_session_add_room_failed", "room.room_id is required");
    }

    const current = this.sessions.get(String(sessionId));
    if (!current) {
      return failure("dungeon_session_add_room_failed", "session not found", {
        session_id: String(sessionId)
      });
    }

    current.rooms = Array.isArray(current.rooms) ? current.rooms : [];
    const roomId = String(room.room_id);
    const alreadyExists = current.rooms.some((x) => String(x.room_id) === roomId);
    if (alreadyExists) {
      return failure("dungeon_session_add_room_failed", "room already exists in session", {
        session_id: String(sessionId),
        room_id: roomId
      });
    }

    current.rooms.push(clone(room));
    current.updated_at = new Date().toISOString();
    current.event_log = Array.isArray(current.event_log) ? current.event_log : [];
    current.event_log.push({
      event_type: "dungeon_room_added",
      timestamp: new Date().toISOString(),
      room_id: roomId
    });
    this.sessions.set(String(sessionId), current);

    return success("dungeon_session_room_added", {
      session_id: String(sessionId),
      room: clone(room),
      room_count: current.rooms.length,
      session: clone(current)
    });
  }

  addMultipleRoomsToSession(input) {
    const data = input || {};
    const sessionId = data.session_id;
    const rooms = Array.isArray(data.rooms) ? data.rooms : null;

    if (!sessionId || String(sessionId).trim() === "") {
      return failure("dungeon_session_add_rooms_failed", "session_id is required");
    }
    if (!rooms) {
      return failure("dungeon_session_add_rooms_failed", "rooms array is required");
    }

    const addedRooms = [];
    for (const room of rooms) {
      const added = this.addRoomToSession({
        session_id: String(sessionId),
        room
      });
      if (!added.ok) {
        return failure("dungeon_session_add_rooms_failed", added.error, {
          session_id: String(sessionId),
          added_count: addedRooms.length,
          last_error: added
        });
      }
      addedRooms.push(clone(added.payload.room));
    }

    const latest = this.getSessionById(String(sessionId));
    if (!latest.ok) {
      return failure("dungeon_session_add_rooms_failed", "session missing after add");
    }

    return success("dungeon_session_rooms_added", {
      session_id: String(sessionId),
      added_rooms: addedRooms,
      room_count: latest.payload.session.rooms.length,
      session: clone(latest.payload.session)
    });
  }

  setStartRoom(input) {
    const data = input || {};
    const sessionId = data.session_id;
    const roomId = data.room_id;
    const initializeCurrentRoom = data.initialize_current_room !== false;

    if (!sessionId || String(sessionId).trim() === "") {
      return failure("dungeon_session_set_start_room_failed", "session_id is required");
    }
    if (!roomId || String(roomId).trim() === "") {
      return failure("dungeon_session_set_start_room_failed", "room_id is required");
    }

    const current = this.sessions.get(String(sessionId));
    if (!current) {
      return failure("dungeon_session_set_start_room_failed", "session not found", {
        session_id: String(sessionId)
      });
    }

    const roomExists = Array.isArray(current.rooms)
      ? current.rooms.some((room) => String(room.room_id) === String(roomId))
      : false;
    if (!roomExists) {
      return failure("dungeon_session_set_start_room_failed", "room does not exist in session", {
        session_id: String(sessionId),
        room_id: String(roomId)
      });
    }

    current.start_room_id = String(roomId);
    if (initializeCurrentRoom) {
      current.current_room_id = String(roomId);
    }
    current.updated_at = new Date().toISOString();
    current.event_log = Array.isArray(current.event_log) ? current.event_log : [];
    current.event_log.push({
      event_type: "dungeon_start_room_set",
      timestamp: new Date().toISOString(),
      room_id: String(roomId),
      current_room_initialized: initializeCurrentRoom
    });
    this.sessions.set(String(sessionId), current);

    return success("dungeon_session_start_room_set", {
      session_id: String(sessionId),
      start_room_id: current.start_room_id,
      current_room_id: current.current_room_id,
      session: clone(current)
    });
  }

  markRoomDiscovered(input) {
    const data = input || {};
    const sessionId = data.session_id;
    const roomId = data.room_id;

    if (!sessionId || String(sessionId).trim() === "") {
      return failure("dungeon_session_mark_discovered_failed", "session_id is required");
    }
    if (!roomId || String(roomId).trim() === "") {
      return failure("dungeon_session_mark_discovered_failed", "room_id is required");
    }

    const current = this.sessions.get(String(sessionId));
    if (!current) {
      return failure("dungeon_session_mark_discovered_failed", "session not found", {
        session_id: String(sessionId)
      });
    }

    current.rooms = Array.isArray(current.rooms) ? current.rooms : [];
    const room = current.rooms.find((x) => String(x.room_id) === String(roomId));
    if (!room) {
      return failure("dungeon_session_mark_discovered_failed", "room does not exist in session", {
        session_id: String(sessionId),
        room_id: String(roomId)
      });
    }

    current.discovered_rooms = Array.isArray(current.discovered_rooms) ? current.discovered_rooms : [];
    const exists = current.discovered_rooms.includes(String(roomId));
    if (!exists) {
      current.discovered_rooms.push(String(roomId));
    }

    room.discovered = true;

    current.updated_at = new Date().toISOString();
    current.event_log = Array.isArray(current.event_log) ? current.event_log : [];
    current.event_log.push({
      event_type: "dungeon_room_discovered",
      timestamp: new Date().toISOString(),
      room_id: String(roomId)
    });
    this.sessions.set(String(sessionId), current);

    return success("dungeon_session_room_discovered", {
      session_id: String(sessionId),
      room_id: String(roomId),
      discovered_rooms: clone(current.discovered_rooms),
      session: clone(current)
    });
  }

  markRoomCleared(input) {
    const data = input || {};
    const sessionId = data.session_id;
    const roomId = data.room_id;

    if (!sessionId || String(sessionId).trim() === "") {
      return failure("dungeon_session_mark_cleared_failed", "session_id is required");
    }
    if (!roomId || String(roomId).trim() === "") {
      return failure("dungeon_session_mark_cleared_failed", "room_id is required");
    }

    const current = this.sessions.get(String(sessionId));
    if (!current) {
      return failure("dungeon_session_mark_cleared_failed", "session not found", {
        session_id: String(sessionId)
      });
    }

    current.rooms = Array.isArray(current.rooms) ? current.rooms : [];
    const room = current.rooms.find((x) => String(x.room_id) === String(roomId));
    if (!room) {
      return failure("dungeon_session_mark_cleared_failed", "room does not exist in session", {
        session_id: String(sessionId),
        room_id: String(roomId)
      });
    }

    current.cleared_rooms = Array.isArray(current.cleared_rooms) ? current.cleared_rooms : [];
    const exists = current.cleared_rooms.includes(String(roomId));
    if (!exists) {
      current.cleared_rooms.push(String(roomId));
    }

    room.cleared = true;

    current.updated_at = new Date().toISOString();
    current.event_log = Array.isArray(current.event_log) ? current.event_log : [];
    current.event_log.push({
      event_type: "dungeon_room_cleared",
      timestamp: new Date().toISOString(),
      room_id: String(roomId)
    });
    this.sessions.set(String(sessionId), current);

    return success("dungeon_session_room_cleared", {
      session_id: String(sessionId),
      room_id: String(roomId),
      cleared_rooms: clone(current.cleared_rooms),
      session: clone(current)
    });
  }
}

module.exports = {
  DungeonSessionManagerCore
};
