"use strict";

/**
 * Validate that the acting player is the current session leader.
 * Leader transfer is supported by updating session.leader_id separately.
 */
function validateLeader(player_id, session) {
  const isLeader = Boolean(session && session.leader_id === player_id);

  return {
    ok: isLeader,
    code: isLeader ? "leader_valid" : "leader_required",
    message: isLeader ? "Player is the current party leader" : "Only the party leader can move the party",
    details: {
      player_id,
      leader_id: session ? session.leader_id : null
    }
  };
}

/**
 * Check whether destination_room is reachable from current_room through exits.
 * Supports multiple exits by scanning the room.exits array.
 */
function checkExitConnection(current_room, destination_room) {
  const exits = Array.isArray(current_room?.exits) ? current_room.exits : [];

  const matchingExit = exits.find((exit) => exit.to_room_id === destination_room);
  if (!matchingExit) {
    return {
      ok: false,
      code: "exit_not_found",
      message: "Destination room is not connected to current room",
      details: {
        current_room_id: current_room ? current_room.room_id : null,
        destination_room
      }
    };
  }

  if (matchingExit.locked) {
    return {
      ok: false,
      code: "exit_locked",
      message: "Destination path is currently locked",
      details: {
        current_room_id: current_room.room_id,
        destination_room,
        direction: matchingExit.direction
      }
    };
  }

  return {
    ok: true,
    code: "exit_valid",
    message: "Destination is connected by a valid exit",
    details: {
      current_room_id: current_room.room_id,
      destination_room,
      direction: matchingExit.direction
    }
  };
}

/**
 * Move the whole party to a connected destination room.
 * Party split is not supported by design: session tracks one current_room_id.
 *
 * @param {object} input
 * @param {object} input.manager - DungeonSessionManager
 * @param {string} input.session_id
 * @param {string} input.destination_room
 * @param {string} input.player_id - acting player
 */
function moveParty(input) {
  const manager = input.manager;
  const session_id = input.session_id;
  const destination_room = input.destination_room;
  const player_id = input.player_id;

  const session = manager.getDungeonSession(session_id);
  if (!session) {
    return {
      ok: false,
      event_type: "party_move_rejected",
      session_id,
      reason: "session_not_found",
      output: null
    };
  }

  if (session.movement_locked) {
    return {
      ok: false,
      event_type: "party_move_rejected",
      session_id,
      reason: "movement_locked",
      output: {
        current_room_id: session.current_room_id
      }
    };
  }

  const leaderCheck = validateLeader(player_id, session);
  if (!leaderCheck.ok) {
    return {
      ok: false,
      event_type: "party_move_rejected",
      session_id,
      reason: leaderCheck.code,
      output: leaderCheck
    };
  }

  const currentRoom = (session.rooms || []).find((room) => room.room_id === session.current_room_id);
  if (!currentRoom) {
    return {
      ok: false,
      event_type: "party_move_rejected",
      session_id,
      reason: "current_room_not_found",
      output: {
        current_room_id: session.current_room_id
      }
    };
  }

  const exitCheck = checkExitConnection(currentRoom, destination_room);
  if (!exitCheck.ok) {
    return {
      ok: false,
      event_type: "party_move_rejected",
      session_id,
      reason: exitCheck.code,
      output: exitCheck
    };
  }

  const updatedSession = manager.updateDungeonSession(session_id, {
    current_room_id: destination_room
  });

  return {
    ok: true,
    event_type: "party_moved",
    session_id,
    output: {
      moved_by: player_id,
      from_room_id: session.current_room_id,
      to_room_id: destination_room,
      timestamp: new Date().toISOString()
    },
    updated_session: updatedSession
  };
}

/**
 * Leader transfer helper to support changing who can move the party.
 */
function transferLeader(input) {
  const manager = input.manager;
  const session_id = input.session_id;
  const new_leader_id = input.new_leader_id;

  const session = manager.getDungeonSession(session_id);
  if (!session) {
    return {
      ok: false,
      event_type: "leader_transfer_rejected",
      session_id,
      reason: "session_not_found"
    };
  }

  const updatedSession = manager.updateDungeonSession(session_id, {
    leader_id: new_leader_id
  });

  return {
    ok: true,
    event_type: "leader_transferred",
    session_id,
    output: {
      previous_leader_id: session.leader_id,
      new_leader_id
    },
    updated_session: updatedSession
  };
}

module.exports = {
  moveParty,
  validateLeader,
  checkExitConnection,
  transferLeader
};

