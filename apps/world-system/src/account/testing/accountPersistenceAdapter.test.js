"use strict";

const assert = require("assert");
const { createInMemoryAdapter } = require("../../../../database/src/adapters/inMemoryAdapter");
const { createSqliteAdapter } = require("../../../../database/src/adapters/sqliteAdapter");
const { AccountPersistenceBridge } = require("../account.persistence");
const { createAccountRecord } = require("../account.schema");

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
    if (text.includes("CREATE TABLE IF NOT EXISTS accounts")) this.ensureTable("accounts");
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
        if (text.includes("DELETE FROM accounts")) {
          const table = self.ensureTable("accounts");
          const existed = table.has(String(params.id));
          if (existed) table.delete(String(params.id));
          return { changes: existed ? 1 : 0 };
        }
        return { changes: 0 };
      },
      get(params) {
        if (text.includes("SELECT value FROM schema_meta")) {
          const value = self.meta.get(String(params.key));
          return value === undefined ? null : { value };
        }
        if (text.includes("SELECT data FROM accounts")) {
          const row = self.ensureTable("accounts").get(String(params.id));
          return row ? { data: row.data } : null;
        }
        return null;
      },
      all() {
        if (!text.includes("FROM accounts")) {
          return [];
        }
        const rows = [];
        self.ensureTable("accounts").forEach((row) => {
          rows.push({
            id: row.account_id,
            data: row.data
          });
        });
        rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        return rows;
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

function createContext(type) {
  const adapter =
    type === "sqlite"
      ? createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "account-persistence.sqlite" })
      : createInMemoryAdapter();

  return {
    bridge: new AccountPersistenceBridge({ adapter })
  };
}

function runAccountPersistenceAdapterTests() {
  const results = [];

  runTest("save_and_load_account_round_trip", () => {
    const ctx = createContext("memory");
    const account = createAccountRecord({
      account_id: "account-persist-001",
      discord_user_id: "discord-persist-001"
    });

    const saved = ctx.bridge.saveAccount(account);
    const loaded = ctx.bridge.loadAccountById("account-persist-001");

    assert.equal(saved.ok, true);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.payload.account.discord_user_id, "discord-persist-001");
  }, results);

  runTest("find_or_create_returns_same_account_on_repeated_calls", () => {
    const ctx = createContext("memory");

    const first = ctx.bridge.findOrCreateAccountByDiscordUserId({ discord_user_id: "discord-persist-002" });
    const second = ctx.bridge.findOrCreateAccountByDiscordUserId({ discord_user_id: "discord-persist-002" });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.payload.account.account_id, second.payload.account.account_id);
    assert.equal(first.payload.created, true);
    assert.equal(second.payload.created, false);
  }, results);

  runTest("sqlite_behavior_matches_inmemory_for_account_find_or_create", () => {
    const memory = createContext("memory").bridge;
    const sqlite = createContext("sqlite").bridge;

    const memoryFirst = memory.findOrCreateAccountByDiscordUserId({ discord_user_id: "discord-persist-003" });
    const sqliteFirst = sqlite.findOrCreateAccountByDiscordUserId({ discord_user_id: "discord-persist-003" });
    const memorySecond = memory.findOrCreateAccountByDiscordUserId({ discord_user_id: "discord-persist-003" });
    const sqliteSecond = sqlite.findOrCreateAccountByDiscordUserId({ discord_user_id: "discord-persist-003" });

    assert.equal(memoryFirst.ok, sqliteFirst.ok);
    assert.equal(memorySecond.ok, sqliteSecond.ok);
    assert.equal(memoryFirst.payload.account.discord_user_id, sqliteFirst.payload.account.discord_user_id);
    assert.equal(memorySecond.payload.created, sqliteSecond.payload.created);
  }, results);

  const passed = results.filter((x) => x.ok).length;
  const failed = results.length - passed;

  return {
    ok: failed === 0,
    totals: { total: results.length, passed, failed },
    results
  };
}

if (require.main === module) {
  const summary = runAccountPersistenceAdapterTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runAccountPersistenceAdapterTests
};
