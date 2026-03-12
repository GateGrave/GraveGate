"use strict";

const RANKING_SCHEMA = {
  ranking_id: "string",
  ranking_type: "hunter|guild|dungeon_leaderboard|world_event_contribution",
  entity_id: "string",
  score_value: "number",
  updated_at: "string (ISO date)",
  history: "array (optional)"
};

const VALID_RANKING_TYPES = new Set([
  "hunter",
  "guild",
  "dungeon_leaderboard",
  "world_event_contribution"
]);

function normalizeHistory(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("history must be an array");
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("history[" + index + "] must be an object");
    }
    return {
      previous_score: Number.isFinite(entry.previous_score) ? entry.previous_score : 0,
      new_score: Number.isFinite(entry.new_score) ? entry.new_score : 0,
      reason: entry.reason ? String(entry.reason) : "score_update",
      updated_at: entry.updated_at || new Date().toISOString()
    };
  });
}

function normalizeScore(value) {
  if (!Number.isFinite(value)) {
    throw new Error("score_value must be a finite number");
  }
  if (value < 0) {
    throw new Error("score_value cannot be negative");
  }
  return value;
}

function createRankingRecord(input) {
  const data = input || {};

  if (!data.ranking_id || String(data.ranking_id).trim() === "") {
    throw new Error("createRankingEntry requires ranking_id");
  }
  if (!data.ranking_type || String(data.ranking_type).trim() === "") {
    throw new Error("createRankingEntry requires ranking_type");
  }
  if (!VALID_RANKING_TYPES.has(String(data.ranking_type))) {
    throw new Error("ranking_type is invalid");
  }
  if (!data.entity_id || String(data.entity_id).trim() === "") {
    throw new Error("createRankingEntry requires entity_id");
  }

  const scoreValue = normalizeScore(data.score_value === undefined ? 0 : data.score_value);

  return {
    ranking_id: String(data.ranking_id),
    ranking_type: String(data.ranking_type),
    entity_id: String(data.entity_id),
    score_value: scoreValue,
    updated_at: data.updated_at || new Date().toISOString(),
    history: normalizeHistory(data.history)
  };
}

module.exports = {
  RANKING_SCHEMA,
  VALID_RANKING_TYPES,
  createRankingRecord,
  normalizeScore,
  normalizeHistory
};

