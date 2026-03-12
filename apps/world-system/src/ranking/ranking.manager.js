"use strict";

const { createRankingRecord, normalizeScore } = require("./ranking.schema");

class InMemoryRankingStore {
  constructor() {
    this.rankings = new Map();
  }

  save(record) {
    this.rankings.set(record.ranking_id, record);
    return record;
  }

  load(rankingId) {
    if (!rankingId) return null;
    return this.rankings.get(String(rankingId)) || null;
  }

  list() {
    return Array.from(this.rankings.values());
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class RankingManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryRankingStore();
  }

  createRankingEntry(input) {
    const record = createRankingRecord(input);

    if (this.store.load(record.ranking_id)) {
      throw new Error("createRankingEntry requires unique ranking_id");
    }

    const duplicateEntity = this.store
      .list()
      .find((entry) => entry.ranking_type === record.ranking_type && entry.entity_id === record.entity_id);
    if (duplicateEntity) {
      throw new Error("duplicate ranking entity for ranking_type is not allowed");
    }

    this.store.save(record);
    return clone(record);
  }

  getRankingEntry(ranking_id) {
    const loaded = this.store.load(ranking_id);
    return loaded ? clone(loaded) : null;
  }

  updateRankingScore(input) {
    const data = input || {};
    if (!data.ranking_id || String(data.ranking_id).trim() === "") {
      throw new Error("updateRankingScore requires ranking_id");
    }

    const current = this.store.load(data.ranking_id);
    if (!current) return null;

    const nextScore = normalizeScore(data.score_value);
    const now = new Date().toISOString();
    const appendHistory = data.append_history !== false;

    const historyEntry = {
      previous_score: current.score_value,
      new_score: nextScore,
      reason: data.reason ? String(data.reason) : "score_update",
      updated_at: now
    };

    const updated = createRankingRecord({
      ...current,
      score_value: nextScore,
      updated_at: now,
      history: appendHistory ? [...(current.history || []), historyEntry] : current.history || []
    });

    this.store.save(updated);
    return clone(updated);
  }

  listTopRankings(ranking_type, limit) {
    const type = ranking_type ? String(ranking_type) : "";
    if (!type) return [];

    const max = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 10;
    return this.store
      .list()
      .filter((entry) => entry.ranking_type === type)
      .sort((a, b) => b.score_value - a.score_value)
      .slice(0, max)
      .map((entry) => clone(entry));
  }
}

module.exports = {
  InMemoryRankingStore,
  RankingManager
};

