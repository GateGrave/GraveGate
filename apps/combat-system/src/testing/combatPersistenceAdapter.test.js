"use strict";

const assert = require("assert");
const { CombatPersistenceBridge } = require("../combat.persistence");
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
        if (text.includes("INSERT INTO combats")) {
          self.ensureTable("combats").set(String(params.id), {
            combat_id: String(params.id),
            session_id: params.session_id === undefined ? null : params.session_id,
            status: params.status === undefined ? null : params.status,
            data: String(params.data),
            updated_at: String(params.updated_at)
          });
          return { changes: 1 };
        }
        if (text.includes("DELETE FROM combats")) {
          const store = self.ensureTable("combats");
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
        if (text.includes("SELECT data FROM combats")) {
          const row = self.ensureTable("combats").get(String(params.id)) || null;
          if (!row) return null;
          return { data: row.data };
        }
        return null;
      },

      all() {
        if (text.includes("SELECT combat_id AS id, data FROM combats")) {
          const rows = [];
          self.ensureTable("combats").forEach(function eachRow(row) {
            rows.push({
              id: row.combat_id,
              data: row.data
            });
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

function createContext(adapter) {
  const persistence = new CombatPersistenceBridge({ adapter });
  return { adapter, persistence };
}

function createSnapshot(overrides) {
  return {
    snapshot_id: "snapshot-persist-001",
    combat_id: "combat-persist-001",
    snapshot_timestamp: new Date().toISOString(),
    round_number: 1,
    current_turn_index: 0,
    combat_status: "active",
    initiative_order: ["p1", "p2"],
    grid_positions: [],
    active_effects: [],
    ...overrides
  };
}

function runCombatPersistenceAdapterTests() {
  const results = [];

  runTest("save_get_combat_round_trip_inmemory", () => {
    const ctx = createContext(createInMemoryAdapter());
    const out = ctx.persistence.saveCombatSnapshot(createSnapshot());
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "combat_snapshot_persistence_saved");
    assert.equal(out.payload.snapshot.snapshot_id, "snapshot-persist-001");

    const loaded = ctx.persistence.loadCombatSnapshotById("snapshot-persist-001");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.payload.snapshot.snapshot_id, "snapshot-persist-001");
  }, results);

  runTest("save_get_combat_round_trip_sqlite", () => {
    const ctx = createContext(createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" }));
    ctx.persistence.saveCombatSnapshot(createSnapshot({ snapshot_id: "snapshot-persist-002" }));

    const out = ctx.persistence.loadCombatSnapshotById("snapshot-persist-002");
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "combat_snapshot_persistence_loaded");
    assert.equal(out.payload.snapshot.snapshot_id, "snapshot-persist-002");
  }, results);

  runTest("combat_update_persists_after_state_change", () => {
    const ctx = createContext(createInMemoryAdapter());
    ctx.persistence.saveCombatSnapshot(
      createSnapshot({
        snapshot_id: "snapshot-update-001",
        current_turn_index: 0,
        round_number: 1
      })
    );

    ctx.persistence.saveCombatSnapshot(
      createSnapshot({
        snapshot_id: "snapshot-update-001",
        current_turn_index: 1,
        round_number: 2
      })
    );

    const loaded = ctx.persistence.loadCombatSnapshotById("snapshot-update-001");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.payload.snapshot.current_turn_index, 1);
    assert.equal(loaded.payload.snapshot.round_number, 2);
  }, results);

  runTest("listing_combat_snapshots", () => {
    const ctx = createContext(createInMemoryAdapter());
    ctx.persistence.saveCombatSnapshot(createSnapshot({ snapshot_id: "snapshot-persist-003" }));
    ctx.persistence.saveCombatSnapshot(createSnapshot({ snapshot_id: "snapshot-persist-004" }));

    const out = ctx.persistence.listCombatSnapshots();
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "combat_snapshot_persistence_listed");
    assert.equal(Array.isArray(out.payload.snapshots), true);
    assert.equal(out.payload.snapshots.length, 2);
  }, results);

  runTest("deleting_a_combat_snapshot", () => {
    const ctx = createContext(createInMemoryAdapter());
    ctx.persistence.saveCombatSnapshot(createSnapshot({ snapshot_id: "snapshot-persist-005" }));

    const deleted = ctx.persistence.deleteCombatSnapshot("snapshot-persist-005");
    assert.equal(deleted.ok, true);
    assert.equal(deleted.event_type, "combat_snapshot_persistence_deleted");
    assert.equal(deleted.payload.deleted, true);
  }, results);

  runTest("failure_on_missing_snapshot", () => {
    const ctx = createContext(createInMemoryAdapter());
    const out = ctx.persistence.loadCombatSnapshotById("snapshot-missing-001");
    assert.equal(out.ok, false);
    assert.equal(out.event_type, "combat_snapshot_persistence_load_failed");
    assert.equal(out.error, "snapshot not found");
  }, results);

  runTest("sqlite_behavior_matches_inmemory_for_combat_methods", () => {
    const memoryBridge = createContext(createInMemoryAdapter()).persistence;
    const sqliteBridge = createContext(
      createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" })
    ).persistence;

    const snapshot = createSnapshot({ snapshot_id: "snapshot-parity-001" });
    const memorySaved = memoryBridge.saveCombatSnapshot(snapshot);
    const sqliteSaved = sqliteBridge.saveCombatSnapshot(snapshot);
    const memoryLoaded = memoryBridge.loadCombatSnapshotById("snapshot-parity-001");
    const sqliteLoaded = sqliteBridge.loadCombatSnapshotById("snapshot-parity-001");
    const memoryListed = memoryBridge.listCombatSnapshots();
    const sqliteListed = sqliteBridge.listCombatSnapshots();
    const memoryDeleted = memoryBridge.deleteCombatSnapshot("snapshot-parity-001");
    const sqliteDeleted = sqliteBridge.deleteCombatSnapshot("snapshot-parity-001");
    const memoryMissing = memoryBridge.loadCombatSnapshotById("snapshot-parity-001");
    const sqliteMissing = sqliteBridge.loadCombatSnapshotById("snapshot-parity-001");

    assert.equal(memorySaved.ok, sqliteSaved.ok);
    assert.equal(memoryLoaded.ok, sqliteLoaded.ok);
    assert.equal(memoryLoaded.payload.snapshot.snapshot_id, sqliteLoaded.payload.snapshot.snapshot_id);
    assert.equal(memoryListed.ok, sqliteListed.ok);
    assert.equal(memoryListed.payload.snapshots.length, sqliteListed.payload.snapshots.length);
    assert.equal(memoryDeleted.payload.deleted, sqliteDeleted.payload.deleted);
    assert.equal(memoryMissing.ok, sqliteMissing.ok);
    assert.equal(memoryMissing.error, sqliteMissing.error);
  }, results);

  runTest("combat_bridge_parity_for_invalid_input_failures", () => {
    const memory = createContext(createInMemoryAdapter()).persistence;
    const sqlite = createContext(
      createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" })
    ).persistence;

    const memorySaveInvalid = memory.saveCombatSnapshot({});
    const sqliteSaveInvalid = sqlite.saveCombatSnapshot({});
    assert.equal(memorySaveInvalid.ok, false);
    assert.equal(sqliteSaveInvalid.ok, false);
    assert.equal(memorySaveInvalid.error, sqliteSaveInvalid.error);

    const memoryLoadInvalid = memory.loadCombatSnapshotById("");
    const sqliteLoadInvalid = sqlite.loadCombatSnapshotById("");
    assert.equal(memoryLoadInvalid.ok, false);
    assert.equal(sqliteLoadInvalid.ok, false);
    assert.equal(memoryLoadInvalid.error, sqliteLoadInvalid.error);

    const memoryDeleteInvalid = memory.deleteCombatSnapshot("");
    const sqliteDeleteInvalid = sqlite.deleteCombatSnapshot("");
    assert.equal(memoryDeleteInvalid.ok, false);
    assert.equal(sqliteDeleteInvalid.ok, false);
    assert.equal(memoryDeleteInvalid.error, sqliteDeleteInvalid.error);
  }, results);

  runTest("malformed_stored_combat_snapshot_fails_safely", () => {
    const adapter = createInMemoryAdapter();
    const ctx = createContext(adapter);

    const rawSaved = adapter.save("combats", "bad-snapshot-001", { combat_id: "combat-only" });
    assert.equal(rawSaved.ok, true);

    const loaded = ctx.persistence.loadCombatSnapshotById("bad-snapshot-001");
    assert.equal(loaded.ok, false);
    assert.equal(loaded.error, "stored snapshot data is missing snapshot_id");
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
  const summary = runCombatPersistenceAdapterTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCombatPersistenceAdapterTests
};
