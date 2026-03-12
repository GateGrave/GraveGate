"use strict";

const {
  RANKING_SCHEMA,
  VALID_RANKING_TYPES,
  createRankingRecord,
  normalizeScore,
  normalizeHistory
} = require("./ranking.schema");
const {
  InMemoryRankingStore,
  RankingManager
} = require("./ranking.manager");

const defaultRankingManager = new RankingManager();

function createSuccess(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {},
    error: null
  };
}

function createFailure(eventType, message, payload) {
  return {
    ok: false,
    event_type: eventType,
    payload: payload || {},
    error: message
  };
}

function createRankingEntry(input) {
  return defaultRankingManager.createRankingEntry(input);
}

function getRankingEntry(ranking_id) {
  return defaultRankingManager.getRankingEntry(ranking_id);
}

function updateRankingScore(input) {
  return defaultRankingManager.updateRankingScore(input);
}

function listTopRankings(ranking_type, limit) {
  return defaultRankingManager.listTopRankings(ranking_type, limit);
}

function upsertRankingScore(input) {
  const data = input || {};
  const rankingType = data.ranking_type ? String(data.ranking_type) : "";
  const entityId = data.entity_id ? String(data.entity_id) : "";
  const scoreValue = data.score_value;

  if (!VALID_RANKING_TYPES.has(rankingType)) {
    return createFailure("ranking_upsert_failed", "invalid ranking_type", {
      ranking_type: rankingType
    });
  }
  if (!entityId) {
    return createFailure("ranking_upsert_failed", "entity_id is required");
  }

  const existing = defaultRankingManager
    .listTopRankings(rankingType, Number.MAX_SAFE_INTEGER)
    .find((entry) => entry.entity_id === entityId);

  try {
    if (!existing) {
      const created = defaultRankingManager.createRankingEntry({
        ranking_id: data.ranking_id || "rank-" + rankingType + "-" + entityId,
        ranking_type: rankingType,
        entity_id: entityId,
        score_value: scoreValue
      });
      return createSuccess("ranking_upsert_created", {
        ranking: created,
        created: true
      });
    }

    const updated = defaultRankingManager.updateRankingScore({
      ranking_id: existing.ranking_id,
      score_value: scoreValue,
      reason: data.reason || "upsert"
    });
    return createSuccess("ranking_upsert_updated", {
      ranking: updated,
      created: false
    });
  } catch (error) {
    return createFailure("ranking_upsert_failed", error.message);
  }
}

function readRankingBoard(input) {
  const data = input || {};
  const rankingType = data.ranking_type ? String(data.ranking_type) : "";
  const limit = Number.isFinite(data.limit) ? data.limit : 10;
  if (!VALID_RANKING_TYPES.has(rankingType)) {
    return createFailure("ranking_read_failed", "invalid ranking_type", {
      ranking_type: rankingType
    });
  }

  return createSuccess("ranking_read_completed", {
    ranking_type: rankingType,
    rankings: defaultRankingManager.listTopRankings(rankingType, limit)
  });
}

module.exports = {
  RANKING_SCHEMA,
  VALID_RANKING_TYPES,
  createRankingRecord,
  normalizeScore,
  normalizeHistory,
  InMemoryRankingStore,
  RankingManager,
  defaultRankingManager,
  createRankingEntry,
  getRankingEntry,
  updateRankingScore,
  listTopRankings,
  upsertRankingScore,
  readRankingBoard
};
