"use strict";

const assert = require("assert");
const { createCharacterRecord } = require("../character.schema");
const { CharacterPersistenceBridge } = require("../character.persistence");
const { createInMemoryAdapter } = require("../../../../database/src/adapters/inMemoryAdapter");
const { createSqliteAdapter } = require("../../../../database/src/adapters/sqliteAdapter");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

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
        if (text.includes("INSERT INTO characters")) {
          self.ensureTable("characters").set(String(params.id), {
            character_id: String(params.id),
            data: String(params.data),
            updated_at: String(params.updated_at)
          });
          return { changes: 1 };
        }
        if (text.includes("DELETE FROM characters")) {
          const table = self.ensureTable("characters");
          const existed = table.has(String(params.id));
          if (existed) {
            table.delete(String(params.id));
          }
          return { changes: existed ? 1 : 0 };
        }
        return { changes: 0 };
      },
      get(params) {
        if (text.includes("SELECT value FROM schema_meta")) {
          const value = self.meta.get(String(params.key));
          return value === undefined ? null : { value };
        }
        if (text.includes("SELECT data FROM characters")) {
          const row = self.ensureTable("characters").get(String(params.id));
          return row ? { data: row.data } : null;
        }
        return null;
      },
      all() {
        if (!text.includes("FROM characters")) {
          return [];
        }
        const rows = [];
        self.ensureTable("characters").forEach(function each(row) {
          rows.push({
            id: row.character_id,
            data: row.data
          });
        });
        rows.sort(function byId(a, b) {
          return String(a.id).localeCompare(String(b.id));
        });
        return rows;
      }
    };
  }
}

function createContext(adapterType) {
  const adapter =
    adapterType === "sqlite"
      ? createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "character-persistence.sqlite" })
      : createInMemoryAdapter();
  const persistence = new CharacterPersistenceBridge({ adapter });
  return { adapter, persistence };
}

function runCharacterPersistenceAdapterTests() {
  const results = [];

  runTest("saving_character_through_persistence_bridge", () => {
    const ctx = createContext("memory");
    const character = createCharacterRecord({
      character_id: "char-persist-001",
      player_id: "player-persist-001",
      name: "Persist Hero",
      race: "human",
      class: "fighter",
      level: 1
    });

    const out = ctx.persistence.saveCharacter(character);
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_persistence_saved");
    assert.equal(out.payload.character.character_id, "char-persist-001");
  }, results);

  runTest("loading_character_through_persistence_bridge", () => {
    const ctx = createContext("memory");
    const character = createCharacterRecord({
      character_id: "char-persist-002",
      player_id: "player-persist-002",
      name: "Load Hero",
      race: "elf",
      class: "wizard",
      level: 2
    });
    ctx.persistence.saveCharacter(character);

    const out = ctx.persistence.loadCharacterById("char-persist-002");
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_persistence_loaded");
    assert.equal(out.payload.character.name, "Load Hero");
  }, results);

  runTest("listing_characters", () => {
    const ctx = createContext("memory");
    ctx.persistence.saveCharacter(
      createCharacterRecord({
        character_id: "char-persist-003",
        name: "List One",
        race: "human",
        class: "fighter"
      })
    );
    ctx.persistence.saveCharacter(
      createCharacterRecord({
        character_id: "char-persist-004",
        name: "List Two",
        race: "dwarf",
        class: "cleric"
      })
    );

    const out = ctx.persistence.listCharacters();
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_persistence_listed");
    assert.equal(Array.isArray(out.payload.characters), true);
    assert.equal(out.payload.characters.length, 2);
  }, results);

  runTest("deleting_character", () => {
    const ctx = createContext("memory");
    ctx.persistence.saveCharacter(
      createCharacterRecord({
        character_id: "char-persist-005",
        name: "Delete Me",
        race: "human",
        class: "rogue"
      })
    );

    const deleted = ctx.persistence.deleteCharacter("char-persist-005");
    assert.equal(deleted.ok, true);
    assert.equal(deleted.event_type, "character_persistence_deleted");
    assert.equal(deleted.payload.deleted, true);

    const loaded = ctx.persistence.loadCharacterById("char-persist-005");
    assert.equal(loaded.ok, false);
    assert.equal(loaded.error, "character not found");
  }, results);

  runTest("failure_on_missing_character", () => {
    const ctx = createContext("memory");
    const out = ctx.persistence.loadCharacterById("char-missing-001");
    assert.equal(out.ok, false);
    assert.equal(out.event_type, "character_persistence_load_failed");
    assert.equal(out.error, "character not found");
  }, results);

  runTest("character_bridge_parity_inmemory_and_sqlite_for_crud_and_missing", () => {
    const memory = createContext("memory").persistence;
    const sqlite = createContext("sqlite").persistence;
    const character = createCharacterRecord({
      character_id: "char-persist-parity-001",
      player_id: "player-persist-parity-001",
      name: "Parity Hero",
      race: "human",
      class: "fighter",
      level: 3
    });

    const memorySaved = memory.saveCharacter(character);
    const sqliteSaved = sqlite.saveCharacter(character);
    const memoryLoaded = memory.loadCharacterById("char-persist-parity-001");
    const sqliteLoaded = sqlite.loadCharacterById("char-persist-parity-001");
    const memoryList = memory.listCharacters();
    const sqliteList = sqlite.listCharacters();
    const memoryDeleted = memory.deleteCharacter("char-persist-parity-001");
    const sqliteDeleted = sqlite.deleteCharacter("char-persist-parity-001");
    const memoryMissing = memory.loadCharacterById("char-persist-parity-001");
    const sqliteMissing = sqlite.loadCharacterById("char-persist-parity-001");

    assert.equal(memorySaved.ok, sqliteSaved.ok);
    assert.equal(memoryLoaded.ok, sqliteLoaded.ok);
    assert.deepEqual(memoryLoaded.payload.character, sqliteLoaded.payload.character);
    assert.equal(memoryList.ok, sqliteList.ok);
    assert.equal(memoryList.payload.characters.length, sqliteList.payload.characters.length);
    assert.equal(memoryDeleted.payload.deleted, sqliteDeleted.payload.deleted);
    assert.equal(memoryMissing.ok, sqliteMissing.ok);
    assert.equal(memoryMissing.error, sqliteMissing.error);
  }, results);

  runTest("character_bridge_parity_for_invalid_input_failures", () => {
    const adapterTypes = ["memory", "sqlite"];
    adapterTypes.forEach((adapterType) => {
      const ctx = createContext(adapterType).persistence;
      const saved = ctx.saveCharacter({
        name: "Missing Id"
      });
      assert.equal(saved.ok, false);
      assert.equal(saved.event_type, "character_persistence_save_failed");
      assert.equal(saved.error, "character.character_id is required");

      const loadMissingId = ctx.loadCharacterById("");
      assert.equal(loadMissingId.ok, false);
      assert.equal(loadMissingId.event_type, "character_persistence_load_failed");
      assert.equal(loadMissingId.error, "character_id is required");

      const deleteMissingId = ctx.deleteCharacter("");
      assert.equal(deleteMissingId.ok, false);
      assert.equal(deleteMissingId.event_type, "character_persistence_delete_failed");
      assert.equal(deleteMissingId.error, "character_id is required");
    });
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
  const summary = runCharacterPersistenceAdapterTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCharacterPersistenceAdapterTests
};
