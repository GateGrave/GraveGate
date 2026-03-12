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

function getSessionPersistence(context) {
  if (!context.sessionPersistence || typeof context.sessionPersistence.listSessions !== "function") {
    return null;
  }
  return context.sessionPersistence;
}

function listSessions(context) {
  const persistence = getSessionPersistence(context);
  if (!persistence) {
    return failure("session_lifecycle_failed", "sessionPersistence is required");
  }

  const listed = persistence.listSessions();
  if (!listed.ok) {
    return failure("session_lifecycle_failed", listed.error || "failed to list sessions");
  }

  return success("session_lifecycle_listed", {
    sessions: Array.isArray(listed.payload.sessions) ? listed.payload.sessions : []
  });
}

function persistSession(context, session) {
  const persistence = getSessionPersistence(context);
  if (!persistence || typeof persistence.saveSession !== "function") {
    return failure("session_lifecycle_failed", "sessionPersistence.saveSession is required");
  }

  const saved = persistence.saveSession(session);
  if (!saved.ok) {
    return failure("session_lifecycle_failed", saved.error || "failed to persist session");
  }

  return success("session_lifecycle_saved", {
    session: clone(saved.payload.session)
  });
}

function deleteSession(context, sessionId) {
  const persistence = getSessionPersistence(context);
  if (!persistence || typeof persistence.deleteSession !== "function") {
    return failure("session_lifecycle_failed", "sessionPersistence.deleteSession is required");
  }

  const deleted = persistence.deleteSession(String(sessionId));
  if (!deleted.ok) {
    return failure("session_lifecycle_failed", deleted.error || "failed to delete session");
  }

  return success("session_lifecycle_deleted", {
    deleted: Boolean(deleted.payload.deleted)
  });
}

function getSessionLeaderId(session) {
  if (!session || typeof session !== "object") {
    return null;
  }
  if (session.leader_id) {
    return String(session.leader_id);
  }
  if (session.party && session.party.leader_id) {
    return String(session.party.leader_id);
  }
  return null;
}

function getSessionStatus(session) {
  if (!session || typeof session !== "object") {
    return null;
  }
  if (session.status) {
    return String(session.status);
  }
  if (session.session_status) {
    return String(session.session_status);
  }
  return null;
}

function normalizePartyMembers(party) {
  const sourceMembers = Array.isArray(party && party.members) ? party.members : [];
  const out = [];

  for (let index = 0; index < sourceMembers.length; index += 1) {
    const member = sourceMembers[index];
    const playerId = member && typeof member === "object"
      ? String(member.player_id || "").trim()
      : String(member || "").trim();
    if (!playerId) {
      continue;
    }
    if (out.some((entry) => String(entry.player_id || "") === playerId)) {
      continue;
    }
    out.push(member && typeof member === "object" ? clone(member) : { player_id: playerId });
  }

  return out;
}

function listSessionParticipantIds(session) {
  const party = session && session.party && typeof session.party === "object" ? session.party : {};
  const memberObjects = normalizePartyMembers(party);
  const out = memberObjects.map((entry) => String(entry.player_id || ""));

  const leaderId = party.leader_id ? String(party.leader_id) : null;
  if (leaderId && !out.includes(leaderId)) {
    out.push(leaderId);
  }

  return out;
}

function isPlayerInSessionParty(session, playerId) {
  const target = String(playerId || "").trim();
  if (!target) {
    return false;
  }
  return listSessionParticipantIds(session).includes(target);
}

function buildSessionPartyFromPlayerIds(partyId, leaderId, memberIds) {
  const seen = [];
  const members = [];

  function pushMember(playerId) {
    const id = String(playerId || "").trim();
    if (!id || seen.includes(id)) {
      return;
    }
    seen.push(id);
    members.push({ player_id: id });
  }

  pushMember(leaderId);
  const list = Array.isArray(memberIds) ? memberIds : [];
  for (let index = 0; index < list.length; index += 1) {
    pushMember(list[index]);
  }

  return {
    party_id: String(partyId || ("party-" + String(leaderId || "unknown"))),
    leader_id: String(leaderId || "unknown"),
    members
  };
}

function loadOrBootstrapParty(partyService, partyId, playerId) {
  const loaded = partyService.getPartyById(String(partyId));
  if (loaded.ok) {
    return loaded;
  }
  if (loaded.error !== "party not found") {
    return loaded;
  }

  if (typeof partyService.createParty !== "function") {
    return loaded;
  }

  const created = partyService.createParty({
    party_id: String(partyId),
    leader_player_id: String(playerId)
  });
  if (!created.ok) {
    return created;
  }

  return {
    ok: true,
    event_type: "party_loaded_or_bootstrapped",
    payload: {
      party: clone(created.payload.party)
    },
    error: null
  };
}

function hydrateSessionManagerFromSnapshot(context, session) {
  if (!context || !context.sessionManager || !context.sessionManager.sessions || typeof context.sessionManager.sessions.set !== "function") {
    return;
  }
  if (!session || !session.session_id) {
    return;
  }
  context.sessionManager.sessions.set(String(session.session_id), clone(session));
}

function processEnterDungeonRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const playerId = data.player_id;
  const dungeonId = data.dungeon_id;
  const partyId = data.party_id;
  const requestedSessionId = data.session_id;

  if (!playerId || String(playerId).trim() === "") {
    return failure("player_enter_dungeon_failed", "player_id is required");
  }
  if (!dungeonId || String(dungeonId).trim() === "") {
    return failure("player_enter_dungeon_failed", "dungeon_id is required");
  }
  if (!context.sessionManager || typeof context.sessionManager.createSession !== "function") {
    return failure("player_enter_dungeon_failed", "sessionManager is required");
  }

  const listed = listSessions(context);
  if (!listed.ok) {
    return failure("player_enter_dungeon_failed", listed.error);
  }

  const existing = listed.payload.sessions.find((session) => {
    if (String(getSessionStatus(session) || "") !== "active") {
      return false;
    }
    if (partyId && String(partyId).trim() !== "") {
      return String(session && session.party && session.party.party_id ? session.party.party_id : "") === String(partyId);
    }
    return String(getSessionLeaderId(session) || "") === String(playerId);
  });
  if (existing) {
    hydrateSessionManagerFromSnapshot(context, existing);

    if (!isPlayerInSessionParty(existing, playerId)) {
      if (partyId && context.partyService && typeof context.partyService.getPartyById === "function") {
        const partyLoaded = loadOrBootstrapParty(context.partyService, partyId, playerId);
        if (!partyLoaded.ok) {
          return failure("player_enter_dungeon_failed", partyLoaded.error || "party not found", {
            party_id: String(partyId)
          });
        }

        const party = partyLoaded.payload.party || {};
        const partyMembers = Array.isArray(party.member_player_ids) ? party.member_player_ids.map(String) : [];
        if (!partyMembers.includes(String(playerId))) {
          return failure("player_enter_dungeon_failed", "player is not a member of this party session", {
            player_id: String(playerId),
            session_id: String(existing.session_id || ""),
            party_id: existing.party && existing.party.party_id ? String(existing.party.party_id) : null
          });
        }

        const nextExisting = clone(existing);
        const nextParty = nextExisting.party && typeof nextExisting.party === "object" ? nextExisting.party : {};
        nextParty.members = normalizePartyMembers(nextParty).concat([{ player_id: String(playerId) }]);
        nextParty.members = normalizePartyMembers(nextParty);
        nextExisting.party = nextParty;
        nextExisting.updated_at = new Date().toISOString();
        hydrateSessionManagerFromSnapshot(context, nextExisting);

        const persistedJoin = persistSession(context, nextExisting);
        if (!persistedJoin.ok) {
          return failure("player_enter_dungeon_failed", persistedJoin.error || "failed to persist party session join", {
            session_id: String(nextExisting.session_id || "")
          });
        }

        return success("player_enter_dungeon_processed", {
          enter_status: "joined_existing",
          created: false,
          session: clone(persistedJoin.payload.session)
        });
      }

      return failure("player_enter_dungeon_failed", "player is not a member of this party session", {
        player_id: String(playerId),
        session_id: String(existing.session_id || ""),
        party_id: existing.party && existing.party.party_id ? String(existing.party.party_id) : null
      });
    }

    return success("player_enter_dungeon_processed", {
      enter_status: "already_exists",
      created: false,
      session: clone(existing)
    });
  }

  const nextSessionId = requestedSessionId || ("session-" + String(playerId) + "-" + String(dungeonId));
  const nextPartyId = partyId || ("party-" + String(playerId));
  let sessionParty = null;

  if (context.partyService && typeof context.partyService.getPartyById === "function" && partyId) {
    const partyLoaded = loadOrBootstrapParty(context.partyService, partyId, playerId);
    if (!partyLoaded.ok) {
      return failure("player_enter_dungeon_failed", partyLoaded.error || "party not found", {
        party_id: String(partyId)
      });
    }

    const party = partyLoaded.payload.party || {};
    const partyMembers = Array.isArray(party.member_player_ids) ? party.member_player_ids.map(String) : [];
    if (!partyMembers.includes(String(playerId))) {
      return failure("player_enter_dungeon_failed", "player is not a member of the requested party", {
        player_id: String(playerId),
        party_id: String(partyId)
      });
    }
    sessionParty = buildSessionPartyFromPlayerIds(
      party.party_id || String(partyId),
      party.leader_player_id || String(playerId),
      partyMembers
    );
  } else {
    sessionParty = buildSessionPartyFromPlayerIds(nextPartyId, String(playerId), [String(playerId)]);
  }

  const created = context.sessionManager.createSession({
    session_id: nextSessionId,
    status: "active",
    dungeon_id: String(dungeonId)
  });
  if (!created.ok) {
    return failure("player_enter_dungeon_failed", created.error || "failed to create dungeon session");
  }

  const partySet = context.sessionManager.setParty({
    session_id: nextSessionId,
    party: sessionParty
  });
  if (!partySet.ok) {
    return failure("player_enter_dungeon_failed", partySet.error || "failed to assign session party");
  }

  const persisted = persistSession(context, partySet.payload.session);
  if (!persisted.ok) {
    return failure("player_enter_dungeon_failed", persisted.error);
  }

  return success("player_enter_dungeon_processed", {
    enter_status: "created",
    created: true,
    session: clone(persisted.payload.session)
  });
}

function processLeaveSessionRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const playerId = data.player_id;
  const sessionId = data.session_id;

  if (!playerId || String(playerId).trim() === "") {
    return failure("player_leave_session_failed", "player_id is required");
  }
  if (!context.sessionManager || typeof context.sessionManager.createSession !== "function") {
    return failure("player_leave_session_failed", "sessionManager is required");
  }

  const listed = listSessions(context);
  if (!listed.ok) {
    return failure("player_leave_session_failed", listed.error);
  }

  let target = null;
  if (sessionId && String(sessionId).trim() !== "") {
    target = listed.payload.sessions.find((session) => String(session.session_id || "") === String(sessionId));
  } else {
    target = listed.payload.sessions.find((session) => {
      return (
        String(getSessionLeaderId(session) || "") === String(playerId) &&
        String(getSessionStatus(session) || "") === "active"
      );
    });
  }

  if (!target) {
    return failure("player_leave_session_failed", "active session not found for player", {
      player_id: String(playerId),
      session_id: sessionId ? String(sessionId) : null
    });
  }

  const targetLeaderId = getSessionLeaderId(target);
  const isLeader = String(targetLeaderId || "") === String(playerId);

  if (!isPlayerInSessionParty(target, playerId)) {
    return failure("player_leave_session_failed", "player is not a participant in this session", {
      player_id: String(playerId),
      session_id: String(target.session_id)
    });
  }

  if (!isLeader) {
    const removed = context.sessionManager.removePartyParticipant({
      session_id: String(target.session_id),
      player_id: String(playerId)
    });
    if (!removed.ok) {
      return failure("player_leave_session_failed", removed.error || "failed to remove session participant", {
        session_id: String(target.session_id),
        player_id: String(playerId)
      });
    }

    const persisted = persistSession(context, removed.payload.session);
    if (!persisted.ok) {
      return failure("player_leave_session_failed", persisted.error);
    }

    return success("player_leave_session_processed", {
      leave_status: "left",
      session_id: String(target.session_id),
      deleted: false,
      session: clone(persisted.payload.session)
    });
  }

  const closedSession = {
    ...target,
    status: "ended",
    updated_at: new Date().toISOString()
  };
  const persistedClosed = persistSession(context, closedSession);
  if (!persistedClosed.ok) {
    return failure("player_leave_session_failed", persistedClosed.error);
  }

  const deleted = deleteSession(context, target.session_id);
  if (!deleted.ok) {
    return failure("player_leave_session_failed", deleted.error);
  }

  if (context.sessionManager.sessions && typeof context.sessionManager.sessions.delete === "function") {
    context.sessionManager.sessions.delete(String(target.session_id));
  }

  return success("player_leave_session_processed", {
    leave_status: "left",
    session_id: String(target.session_id),
    deleted: Boolean(deleted.payload.deleted),
    session: clone(closedSession)
  });
}

module.exports = {
  processEnterDungeonRequest,
  processLeaveSessionRequest
};
