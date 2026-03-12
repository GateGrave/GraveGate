"use strict";

const HUNTER_ASSOCIATION_SCHEMA = {
  association_id: "string",
  hunter_profiles: "object",
  rank_tiers: "array",
  active_contracts: "array",
  completed_contracts: "array",
  updated_at: "string (ISO date)"
};

function ensureObject(value, fieldName) {
  const next = value || {};
  if (typeof next !== "object" || Array.isArray(next)) {
    throw new Error(fieldName + " must be an object");
  }
  return next;
}

function ensureArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(fieldName + " must be an array");
  }
  return value;
}

function normalizeRankTiers(value) {
  const list = ensureArray(value, "rank_tiers")
    .map((entry) => String(entry).trim())
    .filter((entry) => entry !== "");

  if (list.length === 0) {
    throw new Error("rank_tiers must contain at least one rank");
  }

  return Array.from(new Set(list));
}

function normalizeContractList(value, fieldName) {
  const list = ensureArray(value, fieldName);
  return list.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(fieldName + "[" + index + "] must be an object");
    }
    if (!entry.contract_id || String(entry.contract_id).trim() === "") {
      throw new Error(fieldName + "[" + index + "] requires contract_id");
    }

    return {
      contract_id: String(entry.contract_id),
      contract_name: entry.contract_name ? String(entry.contract_name) : null,
      contract_status: entry.contract_status ? String(entry.contract_status) : "active",
      contract_type: entry.contract_type ? String(entry.contract_type) : null,
      target_id: entry.target_id ? String(entry.target_id) : null,
      updated_at: entry.updated_at || new Date().toISOString()
    };
  });
}

function createHunterAssociationRecord(input) {
  const data = input || {};

  if (!data.association_id || String(data.association_id).trim() === "") {
    throw new Error("createHunterAssociation requires association_id");
  }

  const rankTiersInput = data.rank_tiers || ["F", "E", "D", "C", "B", "A", "S"];
  const now = new Date().toISOString();

  return {
    association_id: String(data.association_id),
    hunter_profiles: ensureObject(data.hunter_profiles, "hunter_profiles"),
    rank_tiers: normalizeRankTiers(rankTiersInput),
    active_contracts: normalizeContractList(data.active_contracts || [], "active_contracts"),
    completed_contracts: normalizeContractList(data.completed_contracts || [], "completed_contracts"),
    updated_at: data.updated_at || now
  };
}

function createHunterProfileRecord(input, associationRecord) {
  const data = input || {};

  if (!data.player_id || String(data.player_id).trim() === "") {
    throw new Error("createHunterProfile requires player_id");
  }

  const allowedRanks = associationRecord.rank_tiers || [];
  const nextRank = data.rank_tier ? String(data.rank_tier) : allowedRanks[0];
  if (!allowedRanks.includes(nextRank)) {
    throw new Error("rank_tier must be defined in association rank_tiers");
  }

  const now = new Date().toISOString();
  return {
    player_id: String(data.player_id),
    hunter_name: data.hunter_name ? String(data.hunter_name) : null,
    rank_tier: nextRank,
    profile_status: data.profile_status ? String(data.profile_status) : "active",
    unlocked_contract_ids: Array.isArray(data.unlocked_contract_ids)
      ? data.unlocked_contract_ids.map((x) => String(x))
      : [],
    updated_at: now,
    created_at: data.created_at || now
  };
}

module.exports = {
  HUNTER_ASSOCIATION_SCHEMA,
  createHunterAssociationRecord,
  createHunterProfileRecord
};

