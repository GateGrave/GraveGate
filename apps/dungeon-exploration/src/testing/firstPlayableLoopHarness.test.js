"use strict";

const assert = require("assert");
const { runFirstPlayableLoopHarness } = require("./firstPlayableLoopHarness");
const { SessionPersistenceBridge } = require("../session.persistence");
const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { createSqliteAdapter } = require("../../../database/src/adapters/sqliteAdapter");

class FakeSqliteDb {
  constructor() {
    this.tables = new Map();
    this.meta = new Map();
  }

  ensureTable(name) {
    if (!this.tables.has(name)) {
      this.tables.set(name, new Map());
    }
    return this.tables.get(name);
  }

  exec(sql) {
    const text = String(sql);
    if (text.includes("CREATE TABLE IF NOT EXISTS schema_meta")) this.ensureTable("schema_meta");
    if (text.includes("CREATE TABLE IF NOT EXISTS characters")) this.ensureTable("characters");
    if (text.includes("CREATE TABLE IF NOT EXISTS inventories")) this.ensureTable("inventories");
    if (text.includes("CREATE TABLE IF NOT EXISTS sessions")) this.ensureTable("sessions");
    if (text.includes("CREATE TABLE IF NOT EXISTS combats")) this.ensureTable("combats");
  }

  prepare(sql) {
    const self = this;
    const text = String(sql);

    return {
      run(params) {
        if (text.includes("INSERT INTO schema_meta")) {
          self.meta.set(String(params.key), String(params.value));
          return { changes: 1 };
        }
        if (text.includes("INSERT INTO sessions")) {
          self.ensureTable("sessions").set(String(params.id), {
            session_id: String(params.id),
            status: params.status === undefined ? null : params.status,
            data: String(params.data),
            updated_at: String(params.updated_at)
          });
          return { changes: 1 };
        }
        if (text.includes("DELETE FROM sessions")) {
          const store = self.ensureTable("sessions");
          const existed = store.has(String(params.id));
          if (existed) store.delete(String(params.id));
          return { changes: existed ? 1 : 0 };
        }
        return { changes: 0 };
      },

      get(params) {
        if (text.includes("SELECT value FROM schema_meta")) {
          if (!self.meta.has(String(params.key))) return null;
          return { value: self.meta.get(String(params.key)) };
        }
        if (text.includes("SELECT data FROM sessions")) {
          const row = self.ensureTable("sessions").get(String(params.id)) || null;
          if (!row) return null;
          return { data: row.data };
        }
        return null;
      },

      all() {
        if (text.includes("SELECT session_id AS id, data FROM sessions")) {
          const rows = [];
          self.ensureTable("sessions").forEach(function eachRow(row) {
            rows.push({ id: row.session_id, data: row.data });
          });
          rows.sort(function byId(a, b) {
            return String(a.id).localeCompare(String(b.id));
          });
          return rows;
        }
        return [];
      }
    };
  }
}

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runFirstPlayableLoopHarnessTests() {
  const results = [];

  runTest("first_playable_loop_runs_end_to_end", () => {
    const out = runFirstPlayableLoopHarness({
      player_id: "player-loop-test-001",
      character_id: "character-loop-test-001",
      character_name: "Loop Character",
      inventory_id: "inventory-loop-test-001",
      session_id: "session-loop-test-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "first_playable_loop_completed");
    assert.equal(out.payload.character_summary.character_id, "character-loop-test-001");
    assert.equal(out.payload.character_summary.player_id, "player-loop-test-001");
    assert.equal(out.payload.character_summary.name, "Loop Character");
    assert.equal(typeof out.payload.character_summary.level, "number");
    assert.equal(typeof out.payload.character_summary.xp, "number");

    assert.equal(out.payload.dungeon_party_member.character_id, "character-loop-test-001");
    assert.equal(out.payload.combat_participant.participant_id, "character-loop-test-001");
    assert.equal(Array.isArray(out.payload.final_inventory.items), true);
    assert.equal(out.payload.final_inventory.items.length >= 1, true);

    const hasGold = out.payload.final_inventory.items.some((item) => item.item_id === "item-gold-coin");
    assert.equal(hasGold, true);

    const hasGrantStep = out.payload.loop_steps.some((step) => step.step === "grant_loot");
    assert.equal(hasGrantStep, true);

    const hasCharacterStep = out.payload.loop_steps.some((step) => step.step === "create_character");
    const hasDungeonAdapterStep = out.payload.loop_steps.some((step) => step.step === "to_dungeon_party_member");
    assert.equal(hasCharacterStep || out.payload.character_source === "loaded", true);
    assert.equal(hasDungeonAdapterStep, true);
  }, results);

  runTest("first_playable_loop_calls_persistence_and_restores_session_state_inmemory", () => {
    const bridge = new SessionPersistenceBridge({ adapter: createInMemoryAdapter() });
    const calls = { save: 0, load: 0 };

    const trackingPersistence = {
      saveSession(session) {
        calls.save += 1;
        return bridge.saveSession(session);
      },
      loadSessionById(sessionId) {
        calls.load += 1;
        return bridge.loadSessionById(sessionId);
      }
    };

    const out = runFirstPlayableLoopHarness({
      session_id: "session-loop-persist-inmemory-001",
      session_persistence: trackingPersistence
    });

    assert.equal(out.ok, true);
    assert.equal(calls.save >= 2, true);
    assert.equal(calls.load >= 1, true);
    assert.equal(out.payload.persisted_session.session_id, "session-loop-persist-inmemory-001");
    assert.equal(out.payload.persisted_session.current_room_id, "room-L2");
    assert.equal(out.payload.persisted_session.discovered_rooms.includes("room-L2"), true);
  }, results);

  runTest("first_playable_loop_calls_persistence_and_restores_session_state_sqlite", () => {
    const sqlite = createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" });
    const bridge = new SessionPersistenceBridge({ adapter: sqlite });

    const out = runFirstPlayableLoopHarness({
      session_id: "session-loop-persist-sqlite-001",
      session_persistence: bridge
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.persisted_session.session_id, "session-loop-persist-sqlite-001");
    assert.equal(out.payload.persisted_session.current_room_id, "room-L2");
    assert.equal(out.payload.persisted_session.discovered_rooms.includes("room-L2"), true);
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
  const summary = runFirstPlayableLoopHarnessTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runFirstPlayableLoopHarnessTests
};
