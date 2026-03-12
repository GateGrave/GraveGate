"use strict";

const assert = require("assert");
const {
  RankingManager,
  InMemoryRankingStore,
  createRankingRecord,
  upsertRankingScore,
  readRankingBoard
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createManager() {
  return new RankingManager({
    store: new InMemoryRankingStore()
  });
}

function baseRanking(overrides) {
  return {
    ranking_id: "rank-001",
    ranking_type: "hunter",
    entity_id: "player-001",
    score_value: 120,
    ...(overrides || {})
  };
}

function runRankingSystemTests() {
  const results = [];

  runTest("ranking_entry_creation", () => {
    const manager = createManager();
    const created = manager.createRankingEntry(baseRanking());
    assert.equal(created.ranking_id, "rank-001");
    assert.equal(created.score_value, 120);
  }, results);

  runTest("score_update", () => {
    const manager = createManager();
    manager.createRankingEntry(baseRanking());
    const updated = manager.updateRankingScore({
      ranking_id: "rank-001",
      score_value: 150,
      reason: "contract_complete"
    });

    assert.equal(updated.score_value, 150);
    assert.equal(updated.history.length, 1);
    assert.equal(updated.history[0].previous_score, 120);
    assert.equal(updated.history[0].new_score, 150);
  }, results);

  runTest("top_ranking_listing", () => {
    const manager = createManager();
    manager.createRankingEntry(baseRanking({ ranking_id: "rank-001", entity_id: "player-001", score_value: 50 }));
    manager.createRankingEntry(baseRanking({ ranking_id: "rank-002", entity_id: "player-002", score_value: 200 }));
    manager.createRankingEntry(baseRanking({ ranking_id: "rank-003", entity_id: "player-003", score_value: 150 }));

    const top = manager.listTopRankings("hunter", 2);
    assert.equal(top.length, 2);
    assert.equal(top[0].entity_id, "player-002");
    assert.equal(top[1].entity_id, "player-003");
  }, results);

  runTest("malformed_ranking_rejection", () => {
    assert.throws(() => createRankingRecord({}), /ranking_id/);
    assert.throws(() => createRankingRecord(baseRanking({ ranking_type: "" })), /ranking_type/);
    assert.throws(() => createRankingRecord(baseRanking({ entity_id: "" })), /entity_id/);
  }, results);

  runTest("duplicate_ranking_entity_handling", () => {
    const manager = createManager();
    manager.createRankingEntry(baseRanking({ ranking_id: "rank-001", ranking_type: "hunter", entity_id: "player-001" }));
    assert.throws(
      () => manager.createRankingEntry(baseRanking({ ranking_id: "rank-002", ranking_type: "hunter", entity_id: "player-001" })),
      /duplicate ranking entity/
    );
  }, results);

  runTest("invalid_score_handling", () => {
    assert.throws(() => createRankingRecord(baseRanking({ score_value: Number.NaN })), /finite number/);
    assert.throws(() => createRankingRecord(baseRanking({ score_value: -1 })), /cannot be negative/);

    const manager = createManager();
    manager.createRankingEntry(baseRanking());
    assert.throws(
      () =>
        manager.updateRankingScore({
          ranking_id: "rank-001",
          score_value: -50
        }),
      /cannot be negative/
    );
  }, results);

  runTest("optional_history_structure_validity", () => {
    const created = createRankingRecord(
      baseRanking({
        history: [
          {
            previous_score: 10,
            new_score: 20,
            reason: "seed",
            updated_at: "2026-03-08T10:00:00.000Z"
          }
        ]
      })
    );
    assert.equal(Array.isArray(created.history), true);
    assert.equal(created.history.length, 1);
    assert.equal(created.history[0].reason, "seed");

    assert.throws(
      () =>
        createRankingRecord(
          baseRanking({
            history: "bad"
          })
        ),
      /history must be an array/
    );
  }, results);

  runTest("ranking_upsert_and_safe_read", () => {
    const upsert = upsertRankingScore({
      ranking_type: "dungeon_leaderboard",
      entity_id: "player-501",
      score_value: 17
    });
    assert.equal(upsert.ok, true);

    const board = readRankingBoard({
      ranking_type: "dungeon_leaderboard",
      limit: 5
    });
    assert.equal(board.ok, true);
    assert.equal(Array.isArray(board.payload.rankings), true);
    assert.equal(board.payload.rankings.some((row) => row.entity_id === "player-501"), true);
  }, results);

  runTest("invalid_ranking_category_is_rejected_safely", () => {
    const upsert = upsertRankingScore({
      ranking_type: "invalid_category",
      entity_id: "player-999",
      score_value: 10
    });
    const board = readRankingBoard({
      ranking_type: "invalid_category"
    });

    assert.equal(upsert.ok, false);
    assert.equal(upsert.error, "invalid ranking_type");
    assert.equal(board.ok, false);
    assert.equal(board.error, "invalid ranking_type");
  }, results);

  const passed = results.filter((x) => x.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    totals: {
      total: results.length,
      passed,
      failed
    },
    results
  };
}

if (require.main === module) {
  const summary = runRankingSystemTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runRankingSystemTests
};
