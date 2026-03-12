"use strict";

const RAID_SCHEMA = {
  raid_id: "string",
  raid_name: "string",
  participating_party_ids: "array",
  participating_player_ids: "array",
  raid_state: "object",
  encounter_state: "object",
  raid_status: "pending|active|completed|failed|cancelled",
  created_at: "string (ISO date)",
  updated_at: "string (ISO date)"
};

const VALID_RAID_STATUSES = new Set(["pending", "active", "completed", "failed", "cancelled"]);

function normalizeIdArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(fieldName + " must be an array");
  }

  const normalized = value
    .map((entry) => String(entry))
    .filter((entry) => entry.trim() !== "");

  return Array.from(new Set(normalized));
}

function normalizeStateObject(value, fieldName) {
  const state = value || {};
  if (typeof state !== "object" || Array.isArray(state)) {
    throw new Error(fieldName + " must be an object");
  }
  return state;
}

function createRaidRecord(input) {
  const data = input || {};

  if (!data.raid_id || String(data.raid_id).trim() === "") {
    throw new Error("createRaidInstance requires raid_id");
  }
  if (!data.raid_name || String(data.raid_name).trim() === "") {
    throw new Error("createRaidInstance requires raid_name");
  }

  const partyIds = normalizeIdArray(data.participating_party_ids || [], "participating_party_ids");
  const playerIds = normalizeIdArray(data.participating_player_ids || [], "participating_player_ids");
  const raidStatus = data.raid_status ? String(data.raid_status) : "pending";

  if (!VALID_RAID_STATUSES.has(raidStatus)) {
    throw new Error("raid_status must be one of: pending, active, completed, failed, cancelled");
  }

  const now = new Date().toISOString();
  return {
    raid_id: String(data.raid_id),
    raid_name: String(data.raid_name),
    participating_party_ids: partyIds,
    participating_player_ids: playerIds,
    raid_state: normalizeStateObject(data.raid_state, "raid_state"),
    encounter_state: normalizeStateObject(data.encounter_state, "encounter_state"),
    raid_status: raidStatus,
    created_at: data.created_at || now,
    updated_at: data.updated_at || now
  };
}

module.exports = {
  RAID_SCHEMA,
  VALID_RAID_STATUSES,
  createRaidRecord
};

