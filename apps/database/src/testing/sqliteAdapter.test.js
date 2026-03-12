"use strict";

const assert = require("assert");
const { createInMemoryAdapter } = require("../adapters/inMemoryAdapter");
const { createSqliteAdapter, CURRENT_SCHEMA_VERSION } = require("../adapters/sqliteAdapter");

class FakeSqliteDb {
  constructor() {
    this.tables = new Map();
    this.meta = new Map();
    this.indexes = new Set();
    this.closed = false;
  }

  ensureTable(name) {
    if (!this.tables.has(name)) {
      this.tables.set(name, new Map());
    }
    return this.tables.get(name);
  }

  exec(sql) {
    const text = String(sql);

    if (text.includes("CREATE TABLE IF NOT EXISTS schema_meta")) {
      this.ensureTable("schema_meta");
      return;
    }
    if (text.includes("CREATE TABLE IF NOT EXISTS characters")) {
      this.ensureTable("characters");
      return;
    }
    if (text.includes("CREATE TABLE IF NOT EXISTS inventories")) {
      this.ensureTable("inventories");
      return;
    }
    if (text.includes("CREATE TABLE IF NOT EXISTS sessions")) {
      this.ensureTable("sessions");
      return;
    }
    if (text.includes("CREATE TABLE IF NOT EXISTS combats")) {
      this.ensureTable("combats");
      return;
    }
    if (text.includes("CREATE TABLE IF NOT EXISTS accounts")) {
      this.ensureTable("accounts");
      return;
    }
    if (text.includes("CREATE TABLE IF NOT EXISTS parties")) {
      this.ensureTable("parties");
      return;
    }
    if (text.includes("CREATE INDEX IF NOT EXISTS")) {
      this.indexes.add(text);
    }
  }

  close() {
    this.closed = true;
  }

  getMetaRow(key) {
    if (!this.meta.has(key)) return null;
    return { key, value: this.meta.get(key) };
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

        if (text.includes("INSERT INTO characters")) {
          self.ensureTable("characters").set(String(params.id), {
            character_id: String(params.id),
            data: String(params.data),
            updated_at: String(params.updated_at)
          });
          return { changes: 1 };
        }

        if (text.includes("INSERT INTO inventories")) {
          self.ensureTable("inventories").set(String(params.id), {
            inventory_id: String(params.id),
            owner_id: params.owner_id === undefined ? null : params.owner_id,
            data: String(params.data),
            updated_at: String(params.updated_at)
          });
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

        if (text.includes("INSERT INTO accounts")) {
          self.ensureTable("accounts").set(String(params.id), {
            account_id: String(params.id),
            discord_user_id: String(params.discord_user_id),
            active_character_id: params.active_character_id === undefined ? null : params.active_character_id,
            max_character_slots: Number(params.max_character_slots),
            data: String(params.data),
            updated_at: String(params.updated_at)
          });
          return { changes: 1 };
        }

        if (text.includes("INSERT INTO parties")) {
          self.ensureTable("parties").set(String(params.id), {
            party_id: String(params.id),
            leader_player_id: String(params.leader_player_id),
            status: params.status === undefined ? null : params.status,
            data: String(params.data),
            updated_at: String(params.updated_at)
          });
          return { changes: 1 };
        }

        if (text.includes("DELETE FROM")) {
          const tableName = text.includes("DELETE FROM sessions")
            ? "sessions"
            : text.includes("DELETE FROM combats")
              ? "combats"
              : text.includes("DELETE FROM accounts")
                ? "accounts"
              : text.includes("DELETE FROM parties")
                ? "parties"
              : text.includes("DELETE FROM inventories")
                ? "inventories"
                : "characters";
          const store = self.ensureTable(tableName);
          const existed = store.has(String(params.id));
          if (existed) {
            store.delete(String(params.id));
          }
          return { changes: existed ? 1 : 0 };
        }

        return { changes: 0 };
      },

      get(params) {
        if (text.includes("SELECT value FROM schema_meta")) {
          return self.getMetaRow(String(params.key));
        }

        if (text.includes("SELECT data FROM")) {
          const tableName = text.includes("FROM characters")
            ? "characters"
            : text.includes("FROM inventories")
              ? "inventories"
              : text.includes("FROM sessions")
                ? "sessions"
                : text.includes("FROM combats")
                  ? "combats"
                  : text.includes("FROM parties")
                    ? "parties"
                  : "accounts";
          const store = self.ensureTable(tableName);
          const row = store.get(String(params.id)) || null;
          if (!row) return null;
          return { data: row.data };
        }

        return null;
      },

      all() {
        if (text.includes("SELECT") && text.includes("AS id") && text.includes("FROM")) {
          const tableName = text.includes("FROM characters")
            ? "characters"
            : text.includes("FROM inventories")
              ? "inventories"
              : text.includes("FROM sessions")
                ? "sessions"
                : text.includes("FROM combats")
                  ? "combats"
                  : text.includes("FROM parties")
                    ? "parties"
                  : "accounts";

          const store = self.ensureTable(tableName);
          const rows = [];
          store.forEach(function eachRow(row) {
            const id =
              row.character_id || row.inventory_id || row.session_id || row.combat_id || row.account_id || row.party_id;
            rows.push({
              id,
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

function runSqliteAdapterTests() {
  const results = [];

  runTest("sqlite_adapter_can_initialize_fresh_db", () => {
    const fakeDb = new FakeSqliteDb();
    const adapter = createSqliteAdapter({ db: fakeDb, databasePath: "test.sqlite" });

    assert.equal(adapter.isInitialized, true);
    assert.equal(fakeDb.tables.has("characters"), true);
    assert.equal(fakeDb.tables.has("inventories"), true);
    assert.equal(fakeDb.tables.has("sessions"), true);
    assert.equal(fakeDb.tables.has("combats"), true);
    assert.equal(fakeDb.tables.has("accounts"), true);
    assert.equal(fakeDb.tables.has("parties"), true);
    assert.equal(fakeDb.meta.get("schema_version"), String(CURRENT_SCHEMA_VERSION));
  }, results);

  runTest("migrations_are_idempotent", () => {
    const fakeDb = new FakeSqliteDb();
    const adapter = createSqliteAdapter({ db: fakeDb, databasePath: "test.sqlite" });
    const indexCountBefore = fakeDb.indexes.size;
    const tableCountBefore = fakeDb.tables.size;

    adapter.runMigrations();

    assert.equal(fakeDb.indexes.size, indexCountBefore);
    assert.equal(fakeDb.tables.size, tableCountBefore);
    assert.equal(fakeDb.meta.get("schema_version"), String(CURRENT_SCHEMA_VERSION));
  }, results);

  runTest("save_get_character_round_trip", () => {
    const adapter = createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" });
    const character = { character_id: "char-001", name: "Ari", class: "fighter" };

    const saved = adapter.save("characters", "char-001", character);
    const loaded = adapter.getById("characters", "char-001");

    assert.equal(saved.ok, true);
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.payload.record, character);
  }, results);

  runTest("save_get_inventory_round_trip", () => {
    const adapter = createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" });
    const inventory = { inventory_id: "inv-001", owner_id: "player-1", stackable_items: [] };

    const saved = adapter.save("inventories", "inv-001", inventory);
    const loaded = adapter.getById("inventories", "inv-001");

    assert.equal(saved.ok, true);
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.payload.record, inventory);
  }, results);

  runTest("save_get_account_round_trip", () => {
    const adapter = createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" });
    const account = {
      account_id: "account-001",
      discord_user_id: "discord-user-001",
      active_character_id: null,
      max_character_slots: 3
    };

    const saved = adapter.save("accounts", "account-001", account);
    const loaded = adapter.getById("accounts", "account-001");

    assert.equal(saved.ok, true);
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.payload.record, account);
  }, results);

  runTest("save_get_party_round_trip", () => {
    const adapter = createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" });
    const party = {
      party_id: "party-001",
      leader_player_id: "player-001",
      member_player_ids: ["player-001", "player-002"],
      invited_player_ids: [],
      status: "active"
    };

    const saved = adapter.save("parties", "party-001", party);
    const loaded = adapter.getById("parties", "party-001");

    assert.equal(saved.ok, true);
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.payload.record, party);
  }, results);

  runTest("save_get_delete_session_round_trip", () => {
    const adapter = createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" });
    const session = { session_id: "sess-1", status: "active", current_room_id: "room-a" };

    adapter.save("sessions", "sess-1", session);
    const loaded = adapter.getById("sessions", "sess-1");
    const deleted = adapter.delete("sessions", "sess-1");
    const afterDelete = adapter.getById("sessions", "sess-1");

    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.payload.record, session);
    assert.equal(deleted.ok, true);
    assert.equal(deleted.payload.deleted, true);
    assert.equal(afterDelete.ok, true);
    assert.equal(afterDelete.payload.record, null);
  }, results);

  runTest("session_update_persists_correctly", () => {
    const adapter = createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" });
    adapter.save("sessions", "sess-update-1", {
      session_id: "sess-update-1",
      status: "active",
      current_room_id: "room-a",
      discovered_rooms: []
    });

    adapter.save("sessions", "sess-update-1", {
      session_id: "sess-update-1",
      status: "active",
      current_room_id: "room-b",
      discovered_rooms: ["room-b"]
    });

    const loaded = adapter.getById("sessions", "sess-update-1");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.payload.record.current_room_id, "room-b");
    assert.equal(loaded.payload.record.discovered_rooms.includes("room-b"), true);
  }, results);

  runTest("session_specific_methods_work_with_adapter_boundary", () => {
    const adapter = createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" });
    const session = { session_id: "sess-api-1", status: "active", current_room_id: "room-1" };

    const saved = adapter.saveSession(session);
    const loaded = adapter.getSessionById("sess-api-1");
    const listed = adapter.listSessions();
    const deleted = adapter.deleteSession("sess-api-1");
    const afterDelete = adapter.getSessionById("sess-api-1");

    assert.equal(saved.ok, true);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.payload.record.session_id, "sess-api-1");
    assert.equal(listed.ok, true);
    assert.equal(Array.isArray(listed.payload.records), true);
    assert.equal(deleted.ok, true);
    assert.equal(deleted.payload.deleted, true);
    assert.equal(afterDelete.ok, true);
    assert.equal(afterDelete.payload.record, null);
  }, results);

  runTest("save_get_delete_combat_round_trip", () => {
    const adapter = createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" });
    const combat = { combat_id: "combat-1", session_id: "sess-1", status: "active" };

    adapter.save("combats", "combat-1", combat);
    const loaded = adapter.getById("combats", "combat-1");
    const deleted = adapter.delete("combats", "combat-1");
    const afterDelete = adapter.getById("combats", "combat-1");

    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.payload.record, combat);
    assert.equal(deleted.ok, true);
    assert.equal(deleted.payload.deleted, true);
    assert.equal(afterDelete.ok, true);
    assert.equal(afterDelete.payload.record, null);
  }, results);

  runTest("combat_update_persists_correctly", () => {
    const adapter = createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" });
    adapter.save("combats", "combat-update-1", {
      combat_id: "combat-update-1",
      session_id: "sess-1",
      status: "active",
      round_number: 1,
      current_turn_index: 0
    });

    adapter.save("combats", "combat-update-1", {
      combat_id: "combat-update-1",
      session_id: "sess-1",
      status: "active",
      round_number: 2,
      current_turn_index: 1
    });

    const loaded = adapter.getById("combats", "combat-update-1");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.payload.record.round_number, 2);
    assert.equal(loaded.payload.record.current_turn_index, 1);
  }, results);

  runTest("combat_specific_methods_work_with_adapter_boundary", () => {
    const adapter = createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" });
    const combat = { combat_id: "combat-api-1", session_id: "sess-1", status: "active" };

    const saved = adapter.saveCombat(combat);
    const loaded = adapter.getCombatById("combat-api-1");
    const listed = adapter.listCombats();
    const deleted = adapter.deleteCombat("combat-api-1");
    const afterDelete = adapter.getCombatById("combat-api-1");

    assert.equal(saved.ok, true);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.payload.record.combat_id, "combat-api-1");
    assert.equal(listed.ok, true);
    assert.equal(Array.isArray(listed.payload.records), true);
    assert.equal(deleted.ok, true);
    assert.equal(deleted.payload.deleted, true);
    assert.equal(afterDelete.ok, true);
    assert.equal(afterDelete.payload.record, null);
  }, results);

  runTest("sqlite_adapter_behavior_matches_inmemory_for_supported_methods", () => {
    const sqlite = createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "test.sqlite" });
    const memory = createInMemoryAdapter();
    const payload = { character_id: "char-parity", name: "Parity" };

    const sqliteSaved = sqlite.save("characters", "char-parity", payload);
    const memorySaved = memory.save("characters", "char-parity", payload);
    const sqliteLoaded = sqlite.getById("characters", "char-parity");
    const memoryLoaded = memory.getById("characters", "char-parity");
    const sqliteDeleted = sqlite.delete("characters", "char-parity");
    const memoryDeleted = memory.delete("characters", "char-parity");
    const sqliteMissing = sqlite.getById("characters", "char-parity");
    const memoryMissing = memory.getById("characters", "char-parity");

    assert.equal(sqliteSaved.ok, memorySaved.ok);
    assert.equal(sqliteLoaded.ok, memoryLoaded.ok);
    assert.deepEqual(sqliteLoaded.payload.record, memoryLoaded.payload.record);
    assert.equal(sqliteDeleted.payload.deleted, memoryDeleted.payload.deleted);
    assert.equal(sqliteMissing.ok, memoryMissing.ok);
    assert.equal(sqliteMissing.payload.record, memoryMissing.payload.record);
  }, results);

  runTest("invalid_json_row_handling_fails_safely_and_clearly", () => {
    const fakeDb = new FakeSqliteDb();
    fakeDb.exec("CREATE TABLE IF NOT EXISTS characters");
    fakeDb.ensureTable("characters").set("bad-json", {
      character_id: "bad-json",
      data: "{bad-json",
      updated_at: new Date().toISOString()
    });

    const adapter = createSqliteAdapter({ db: fakeDb, databasePath: "test.sqlite" });
    const loaded = adapter.getById("characters", "bad-json");

    assert.equal(loaded.ok, false);
    assert.equal(loaded.error.includes("invalid JSON"), true);
  }, results);

  runTest("malformed_combat_row_fails_safely_and_clearly", () => {
    const fakeDb = new FakeSqliteDb();
    fakeDb.exec("CREATE TABLE IF NOT EXISTS combats");
    fakeDb.ensureTable("combats").set("bad-combat", {
      combat_id: "bad-combat",
      session_id: "sess-1",
      status: "active",
      data: "{broken-json",
      updated_at: new Date().toISOString()
    });

    const adapter = createSqliteAdapter({ db: fakeDb, databasePath: "test.sqlite" });
    const loaded = adapter.getById("combats", "bad-combat");

    assert.equal(loaded.ok, false);
    assert.equal(loaded.error.includes("invalid JSON"), true);
  }, results);

  runTest("close_shuts_down_cleanly", () => {
    const fakeDb = new FakeSqliteDb();
    const adapter = createSqliteAdapter({ db: fakeDb, databasePath: "test.sqlite" });
    const out = adapter.close();

    assert.equal(out.ok, true);
    assert.equal(out.payload.closed, true);
    assert.equal(fakeDb.closed, true);
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
  const summary = runSqliteAdapterTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runSqliteAdapterTests
};
