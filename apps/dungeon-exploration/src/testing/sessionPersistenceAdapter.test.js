"use strict";

const assert = require("assert");
const { SessionPersistenceBridge } = require("../session.persistence");
const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { createSqliteAdapter } = require("../../../database/src/adapters/sqliteAdapter");
const { DungeonSessionManagerCore } = require("../core/dungeonSessionManager");
const { moveParty } = require("../flow/moveParty");
const { createRoomObject } = require("../rooms/roomModel");

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
            rows.push({
              id: row.session_id,
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
  const persistence = new SessionPersistenceBridge({ adapter });
  return { adapter, persistence };
}

function createSession(overrides) {
  return {
    session_id: "session-persist-001",
    status: "active",
    dungeon_id: "dungeon-001",
    party: {
      party_id: "party-001",
      leader_id: "player-001",
      members: ["player-001"]
    },
    current_room_id: "room-001",
    discovered_rooms: [],
    cleared_rooms: [],
    rooms: [],
    event_log: [],
    ...overrides
  };
}

function runSessionPersistenceAdapterTests() {
  const results = [];

  runTest("session_save_get_round_trip_inmemory", () => {
    const ctx = createContext(createInMemoryAdapter());
    const out = ctx.persistence.saveSession(createSession());
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "session_persistence_saved");
    assert.equal(out.payload.session.session_id, "session-persist-001");

    const loaded = ctx.persistence.loadSessionById("session-persist-001");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.payload.session.session_id, "session-persist-001");
  }, results);

  runTest("session_save_get_round_trip_sqlite", () => {
    const sqlite = createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" });
    const ctx = createContext(sqlite);
    ctx.persistence.saveSession(createSession({ session_id: "session-persist-002", status: "pending" }));

    const out = ctx.persistence.loadSessionById("session-persist-002");
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "session_persistence_loaded");
    assert.equal(out.payload.session.session_id, "session-persist-002");
    assert.equal(out.payload.session.status, "pending");
  }, results);

  runTest("session_update_persists_after_movement_and_discovery_changes", () => {
    const adapter = createInMemoryAdapter();
    const ctx = createContext(adapter);
    const manager = new DungeonSessionManagerCore();

    const created = manager.createSession(createSession({ session_id: "session-persist-003" }));
    assert.equal(created.ok, true);
    manager.setParty({
      session_id: "session-persist-003",
      party: { party_id: "party-001", leader_id: "player-001", members: ["player-001"] }
    });
    manager.addRoomToSession({
      session_id: "session-persist-003",
      room: createRoomObject({
        room_id: "room-A",
        room_type: "empty",
        exits: [{ direction: "east", to_room_id: "room-B" }]
      })
    });
    manager.addRoomToSession({
      session_id: "session-persist-003",
      room: createRoomObject({
        room_id: "room-B",
        room_type: "encounter",
        exits: [{ direction: "west", to_room_id: "room-A" }]
      })
    });
    manager.setStartRoom({
      session_id: "session-persist-003",
      room_id: "room-A"
    });

    const moved = moveParty({
      manager,
      session_id: "session-persist-003",
      target_room_id: "room-B"
    });
    assert.equal(moved.ok, true);

    const cleared = manager.markRoomCleared({
      session_id: "session-persist-003",
      room_id: "room-B"
    });
    assert.equal(cleared.ok, true);

    const latest = manager.getSessionById("session-persist-003");
    assert.equal(latest.ok, true);

    const saved = ctx.persistence.saveSession(latest.payload.session);
    assert.equal(saved.ok, true);

    const loaded = ctx.persistence.loadSessionById("session-persist-003");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.payload.session.current_room_id, "room-B");
    assert.equal(loaded.payload.session.discovered_rooms.includes("room-B"), true);
    assert.equal(loaded.payload.session.cleared_rooms.includes("room-B"), true);
  }, results);

  runTest("session_delete_removes_temporary_state_cleanly", () => {
    const ctx = createContext(createInMemoryAdapter());
    ctx.persistence.saveSession(createSession({ session_id: "session-persist-004" }));

    const deleted = ctx.persistence.deleteSession("session-persist-004");
    assert.equal(deleted.ok, true);
    assert.equal(deleted.payload.deleted, true);

    const afterDelete = ctx.persistence.loadSessionById("session-persist-004");
    assert.equal(afterDelete.ok, false);
    assert.equal(afterDelete.error, "session not found");
  }, results);

  runTest("missing_session_returns_consistent_contract_result", () => {
    const ctx = createContext(createInMemoryAdapter());
    const out = ctx.persistence.loadSessionById("session-missing-001");
    assert.equal(out.ok, false);
    assert.equal(out.event_type, "session_persistence_load_failed");
    assert.equal(out.error, "session not found");
  }, results);

  runTest("sqlite_behavior_matches_inmemory_for_session_methods", () => {
    const memoryBridge = createContext(createInMemoryAdapter()).persistence;
    const sqliteBridge = createContext(
      createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" })
    ).persistence;

    const session = createSession({ session_id: "session-parity-001", status: "active" });
    const memorySaved = memoryBridge.saveSession(session);
    const sqliteSaved = sqliteBridge.saveSession(session);
    const memoryLoaded = memoryBridge.loadSessionById("session-parity-001");
    const sqliteLoaded = sqliteBridge.loadSessionById("session-parity-001");
    const memoryListed = memoryBridge.listSessions();
    const sqliteListed = sqliteBridge.listSessions();
    const memoryDeleted = memoryBridge.deleteSession("session-parity-001");
    const sqliteDeleted = sqliteBridge.deleteSession("session-parity-001");
    const memoryMissing = memoryBridge.loadSessionById("session-parity-001");
    const sqliteMissing = sqliteBridge.loadSessionById("session-parity-001");

    assert.equal(memorySaved.ok, sqliteSaved.ok);
    assert.equal(memorySaved.event_type, sqliteSaved.event_type);
    assert.equal(memoryLoaded.ok, sqliteLoaded.ok);
    assert.equal(memoryLoaded.event_type, sqliteLoaded.event_type);
    assert.equal(memoryLoaded.payload.session.session_id, sqliteLoaded.payload.session.session_id);
    assert.equal(memoryListed.ok, sqliteListed.ok);
    assert.equal(memoryListed.payload.sessions.length, sqliteListed.payload.sessions.length);
    assert.equal(memoryDeleted.payload.deleted, sqliteDeleted.payload.deleted);
    assert.equal(memoryMissing.ok, sqliteMissing.ok);
    assert.equal(memoryMissing.error, sqliteMissing.error);
  }, results);

  runTest("session_bridge_parity_for_invalid_input_failures", () => {
    const memory = createContext(createInMemoryAdapter()).persistence;
    const sqlite = createContext(
      createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" })
    ).persistence;

    const memorySaveWithDefaults = memory.saveSession({});
    const sqliteSaveWithDefaults = sqlite.saveSession({});
    assert.equal(memorySaveWithDefaults.ok, true);
    assert.equal(sqliteSaveWithDefaults.ok, true);
    assert.equal(memorySaveWithDefaults.event_type, sqliteSaveWithDefaults.event_type);
    assert.equal(
      typeof memorySaveWithDefaults.payload.session.session_id === "string" &&
      memorySaveWithDefaults.payload.session.session_id.length > 0,
      true
    );
    assert.equal(
      typeof sqliteSaveWithDefaults.payload.session.session_id === "string" &&
      sqliteSaveWithDefaults.payload.session.session_id.length > 0,
      true
    );

    const memorySaveInvalidType = memory.saveSession(null);
    const sqliteSaveInvalidType = sqlite.saveSession(null);
    assert.equal(memorySaveInvalidType.ok, false);
    assert.equal(sqliteSaveInvalidType.ok, false);
    assert.equal(memorySaveInvalidType.error, sqliteSaveInvalidType.error);
    assert.equal(memorySaveInvalidType.error, "session must be an object");

    const memoryLoadInvalid = memory.loadSessionById("");
    const sqliteLoadInvalid = sqlite.loadSessionById("");
    assert.equal(memoryLoadInvalid.ok, false);
    assert.equal(sqliteLoadInvalid.ok, false);
    assert.equal(memoryLoadInvalid.error, sqliteLoadInvalid.error);

    const memoryDeleteInvalid = memory.deleteSession("");
    const sqliteDeleteInvalid = sqlite.deleteSession("");
    assert.equal(memoryDeleteInvalid.ok, false);
    assert.equal(sqliteDeleteInvalid.ok, false);
    assert.equal(memoryDeleteInvalid.error, sqliteDeleteInvalid.error);
  }, results);

  runTest("invalid_stored_session_data_fails_safely_and_clearly", () => {
    const adapter = createInMemoryAdapter();
    const ctx = createContext(adapter);

    const rawSaved = adapter.save("dungeon_sessions", "session-bad-001", { foo: "bar" });
    assert.equal(rawSaved.ok, true);

    const out = ctx.persistence.loadSessionById("session-bad-001");
    assert.equal(out.ok, false);
    assert.equal(out.error, "stored session data is missing session_id");
  }, results);

  runTest("listing_sessions", () => {
    const ctx = createContext(createInMemoryAdapter());
    ctx.persistence.saveSession(createSession({ session_id: "session-persist-003" }));
    ctx.persistence.saveSession(createSession({ session_id: "session-persist-004" }));

    const out = ctx.persistence.listSessions();
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "session_persistence_listed");
    assert.equal(Array.isArray(out.payload.sessions), true);
    assert.equal(out.payload.sessions.length, 2);
  }, results);

  runTest("deleting_a_session", () => {
    const ctx = createContext(createInMemoryAdapter());
    ctx.persistence.saveSession(createSession({ session_id: "session-persist-005" }));

    const deleted = ctx.persistence.deleteSession("session-persist-005");
    assert.equal(deleted.ok, true);
    assert.equal(deleted.event_type, "session_persistence_deleted");
    assert.equal(deleted.payload.deleted, true);
  }, results);

  runTest("failure_on_missing_session", () => {
    const ctx = createContext(createInMemoryAdapter());
    const out = ctx.persistence.loadSessionById("session-missing-001");
    assert.equal(out.ok, false);
    assert.equal(out.event_type, "session_persistence_load_failed");
    assert.equal(out.error, "session not found");
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
  const summary = runSessionPersistenceAdapterTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runSessionPersistenceAdapterTests
};
