"use strict";

const PARTY_SCHEMA = {
  party_id: "string",
  leader_player_id: "string",
  member_player_ids: "string[]",
  invited_player_ids: "string[]",
  status: "string",
  created_at: "string",
  updated_at: "string"
};

function createId(prefix) {
  return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function normalizePlayerIdList(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  const out = [];
  for (let index = 0; index < list.length; index += 1) {
    const next = String(list[index] || "").trim();
    if (!next) {
      continue;
    }
    if (!out.includes(next)) {
      out.push(next);
    }
  }
  return out;
}

function createPartyRecord(input) {
  const data = input || {};
  const leaderPlayerId = String(data.leader_player_id || "").trim();
  if (!leaderPlayerId) {
    throw new Error("createParty requires leader_player_id");
  }

  const now = new Date().toISOString();
  const providedMembers = normalizePlayerIdList(data.member_player_ids);
  const memberPlayerIds = providedMembers.includes(leaderPlayerId)
    ? providedMembers
    : [leaderPlayerId].concat(providedMembers);

  return {
    party_id: data.party_id ? String(data.party_id) : createId("party"),
    leader_player_id: leaderPlayerId,
    member_player_ids: memberPlayerIds,
    invited_player_ids: normalizePlayerIdList(data.invited_player_ids),
    status: data.status ? String(data.status) : "active",
    created_at: data.created_at ? String(data.created_at) : now,
    updated_at: data.updated_at ? String(data.updated_at) : now
  };
}

module.exports = {
  PARTY_SCHEMA,
  createPartyRecord,
  normalizePlayerIdList
};

