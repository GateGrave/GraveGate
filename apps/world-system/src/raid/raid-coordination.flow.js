"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFailure(eventType, reason, extra) {
  return {
    ok: false,
    event_type: eventType,
    payload: {
      reason,
      ...(extra || {})
    }
  };
}

function createSuccess(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {}
  };
}

function normalizePlayerIds(playerIds) {
  if (!Array.isArray(playerIds)) return [];
  const cleaned = playerIds.map((x) => String(x)).filter((x) => x.trim() !== "");
  return Array.from(new Set(cleaned));
}

function getRaidOrFailure(raidManager, raid_id, eventType) {
  if (!raidManager) return createFailure(eventType, "raid_manager_required");
  if (!raid_id || String(raid_id).trim() === "") return createFailure(eventType, "raid_id_required");
  const raid = raidManager.getRaidInstance(raid_id);
  if (!raid) return createFailure(eventType, "raid_not_found", { raid_id: String(raid_id) });
  return raid;
}

function ensureCoordinationState(raid) {
  const raidState = raid.raid_state && typeof raid.raid_state === "object" ? raid.raid_state : {};
  const coordinationState =
    raidState.coordination_state && typeof raidState.coordination_state === "object"
      ? raidState.coordination_state
      : {};
  const parties = coordinationState.parties && typeof coordinationState.parties === "object"
    ? coordinationState.parties
    : {};

  const normalizedParties = {};
  Object.keys(parties).forEach((partyId) => {
    const party = parties[partyId] || {};
    const playerIds = normalizePlayerIds(party.player_ids);
    const playersReady = party.players_ready && typeof party.players_ready === "object"
      ? party.players_ready
      : {};

    const normalizedPlayersReady = {};
    playerIds.forEach((playerId) => {
      normalizedPlayersReady[playerId] = Boolean(playersReady[playerId]);
    });

    normalizedParties[String(partyId)] = {
      party_id: String(partyId),
      player_ids: playerIds,
      players_ready: normalizedPlayersReady,
      party_ready: Boolean(party.party_ready),
      joined_at: party.joined_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  });

  return {
    ...coordinationState,
    coordination_lock: Boolean(coordinationState.coordination_lock),
    parties: normalizedParties,
    updated_at: new Date().toISOString()
  };
}

function refreshStaleReadiness(coordinationState) {
  const next = clone(coordinationState);
  Object.keys(next.parties).forEach((partyId) => {
    const party = next.parties[partyId];
    const playerIds = normalizePlayerIds(party.player_ids);
    party.player_ids = playerIds;

    const cleanedReady = {};
    playerIds.forEach((pid) => {
      cleanedReady[pid] = Boolean(party.players_ready && party.players_ready[pid]);
    });
    party.players_ready = cleanedReady;

    const allPlayersReady = playerIds.length > 0 && playerIds.every((pid) => cleanedReady[pid] === true);
    if (party.require_all_players_ready === true) {
      party.party_ready = allPlayersReady;
    }
    party.updated_at = new Date().toISOString();
  });
  next.updated_at = new Date().toISOString();
  return next;
}

function applyCoordinationState(raidManager, raid, coordinationState, partyIds, playerIds) {
  return raidManager.updateRaidInstance(raid.raid_id, {
    raid_state: {
      ...(raid.raid_state || {}),
      coordination_state: coordinationState
    },
    participating_party_ids: Array.from(new Set(partyIds)),
    participating_player_ids: Array.from(new Set(playerIds))
  });
}

function joinRaidParty(input) {
  const data = input || {};
  const eventType = "raid_party_join_failed";
  const raid = getRaidOrFailure(data.raidManager, data.raid_id, eventType);
  if (raid?.ok === false) return raid;

  const partyId = String(data.party_id || "");
  if (!partyId) return createFailure(eventType, "party_id_required");
  const playerIds = normalizePlayerIds(data.player_ids);
  if (playerIds.length === 0) return createFailure(eventType, "player_ids_required");

  let coordinationState = ensureCoordinationState(raid);
  if (coordinationState.coordination_lock) {
    return createFailure(eventType, "coordination_locked");
  }

  coordinationState = refreshStaleReadiness(coordinationState);
  if (coordinationState.parties[partyId]) {
    return createFailure(eventType, "party_already_joined", {
      party_id: partyId
    });
  }

  coordinationState.parties[partyId] = {
    party_id: partyId,
    player_ids: playerIds,
    players_ready: Object.fromEntries(playerIds.map((pid) => [pid, false])),
    party_ready: false,
    require_all_players_ready: Boolean(data.require_all_players_ready),
    joined_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const nextPartyIds = [...(raid.participating_party_ids || []), partyId];
  const nextPlayerIds = [...(raid.participating_player_ids || []), ...playerIds];

  const updated = applyCoordinationState(data.raidManager, raid, coordinationState, nextPartyIds, nextPlayerIds);
  return createSuccess("raid_party_joined", {
    raid_id: updated.raid_id,
    party_id: partyId,
    player_ids: playerIds,
    participating_party_ids: updated.participating_party_ids,
    participating_player_ids: updated.participating_player_ids
  });
}

function leaveRaidParty(input) {
  const data = input || {};
  const eventType = "raid_party_leave_failed";
  const raid = getRaidOrFailure(data.raidManager, data.raid_id, eventType);
  if (raid?.ok === false) return raid;

  const partyId = String(data.party_id || "");
  if (!partyId) return createFailure(eventType, "party_id_required");

  let coordinationState = ensureCoordinationState(raid);
  if (coordinationState.coordination_lock) {
    return createFailure(eventType, "coordination_locked");
  }
  coordinationState = refreshStaleReadiness(coordinationState);

  const party = coordinationState.parties[partyId];
  if (!party) return createFailure(eventType, "party_not_joined");

  const leavingPlayers = new Set(party.player_ids || []);
  delete coordinationState.parties[partyId];
  coordinationState.updated_at = new Date().toISOString();

  const remainingPartyIds = (raid.participating_party_ids || []).filter((id) => id !== partyId);
  const playersStillInRaid = new Set();
  Object.values(coordinationState.parties).forEach((entry) => {
    (entry.player_ids || []).forEach((pid) => playersStillInRaid.add(pid));
  });

  const remainingPlayerIds = (raid.participating_player_ids || [])
    .filter((pid) => !leavingPlayers.has(pid) || playersStillInRaid.has(pid));

  const updated = applyCoordinationState(data.raidManager, raid, coordinationState, remainingPartyIds, remainingPlayerIds);
  return createSuccess("raid_party_left", {
    raid_id: updated.raid_id,
    party_id: partyId,
    participating_party_ids: updated.participating_party_ids,
    participating_player_ids: updated.participating_player_ids
  });
}

function markRaidPartyReady(input) {
  const data = input || {};
  const eventType = "raid_party_ready_failed";
  const raid = getRaidOrFailure(data.raidManager, data.raid_id, eventType);
  if (raid?.ok === false) return raid;

  const partyId = String(data.party_id || "");
  if (!partyId) return createFailure(eventType, "party_id_required");

  let coordinationState = ensureCoordinationState(raid);
  coordinationState = refreshStaleReadiness(coordinationState);
  const party = coordinationState.parties[partyId];
  if (!party) return createFailure(eventType, "party_not_joined");

  const nextReady = data.ready !== false;
  party.party_ready = Boolean(nextReady);
  party.updated_at = new Date().toISOString();

  const updated = applyCoordinationState(
    data.raidManager,
    raid,
    coordinationState,
    raid.participating_party_ids || [],
    raid.participating_player_ids || []
  );

  return createSuccess("raid_party_ready_marked", {
    raid_id: updated.raid_id,
    party_id: partyId,
    party_ready: party.party_ready
  });
}

function markRaidPlayerReady(input) {
  const data = input || {};
  const eventType = "raid_player_ready_failed";
  const raid = getRaidOrFailure(data.raidManager, data.raid_id, eventType);
  if (raid?.ok === false) return raid;

  const partyId = String(data.party_id || "");
  const playerId = String(data.player_id || "");
  if (!partyId) return createFailure(eventType, "party_id_required");
  if (!playerId) return createFailure(eventType, "player_id_required");

  let coordinationState = ensureCoordinationState(raid);
  coordinationState = refreshStaleReadiness(coordinationState);
  const party = coordinationState.parties[partyId];
  if (!party) return createFailure(eventType, "party_not_joined");
  if (!(party.player_ids || []).includes(playerId)) {
    return createFailure(eventType, "player_not_in_party");
  }

  party.players_ready[playerId] = data.ready !== false;
  const requireAll = party.require_all_players_ready === true;
  if (requireAll) {
    party.party_ready = party.player_ids.every((pid) => party.players_ready[pid] === true);
  }
  party.updated_at = new Date().toISOString();

  const updated = applyCoordinationState(
    data.raidManager,
    raid,
    coordinationState,
    raid.participating_party_ids || [],
    raid.participating_player_ids || []
  );

  return createSuccess("raid_player_ready_marked", {
    raid_id: updated.raid_id,
    party_id: partyId,
    player_id: playerId,
    player_ready: party.players_ready[playerId],
    party_ready: party.party_ready
  });
}

function setRaidCoordinationLock(input) {
  const data = input || {};
  const eventType = "raid_coordination_lock_failed";
  const raid = getRaidOrFailure(data.raidManager, data.raid_id, eventType);
  if (raid?.ok === false) return raid;

  let coordinationState = ensureCoordinationState(raid);
  coordinationState = refreshStaleReadiness(coordinationState);
  coordinationState.coordination_lock = data.lock !== false;
  coordinationState.updated_at = new Date().toISOString();

  const updated = applyCoordinationState(
    data.raidManager,
    raid,
    coordinationState,
    raid.participating_party_ids || [],
    raid.participating_player_ids || []
  );

  return createSuccess("raid_coordination_lock_set", {
    raid_id: updated.raid_id,
    coordination_lock: coordinationState.coordination_lock
  });
}

function validateMultiPartyParticipation(input) {
  const data = input || {};
  const eventType = "raid_participation_validation_failed";
  const raid = getRaidOrFailure(data.raidManager, data.raid_id, eventType);
  if (raid?.ok === false) return raid;

  const minParties = Number.isFinite(data.min_parties) ? Math.max(1, Math.floor(data.min_parties)) : 2;
  const partyIds = Array.isArray(raid.participating_party_ids) ? raid.participating_party_ids : [];
  const playerIds = Array.isArray(raid.participating_player_ids) ? raid.participating_player_ids : [];
  const hasEnoughParties = partyIds.length >= minParties;
  const hasPlayers = playerIds.length > 0;

  const coordinationState = refreshStaleReadiness(ensureCoordinationState(raid));
  const parties = Object.values(coordinationState.parties);
  const readyPartyCount = parties.filter((party) => party.party_ready === true).length;

  return createSuccess("raid_participation_validated", {
    raid_id: raid.raid_id,
    min_parties: minParties,
    participating_party_count: partyIds.length,
    participating_player_count: playerIds.length,
    ready_party_count: readyPartyCount,
    valid: hasEnoughParties && hasPlayers,
    reasons: {
      has_enough_parties: hasEnoughParties,
      has_players: hasPlayers
    }
  });
}

module.exports = {
  joinRaidParty,
  leaveRaidParty,
  markRaidPartyReady,
  markRaidPlayerReady,
  setRaidCoordinationLock,
  validateMultiPartyParticipation
};

