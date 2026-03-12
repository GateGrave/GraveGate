"use strict";

const path = require("path");
const { validateAdapterContract } = require("./databaseAdapter.interface");

const CURRENT_SCHEMA_VERSION = 3;

function success(payload) {
  return {
    ok: true,
    payload: payload || {},
    error: null
  };
}

function failure(message, payload) {
  return {
    ok: false,
    payload: payload || {},
    error: message
  };
}

function normalizeCollection(collection) {
  if (!collection || String(collection).trim() === "") return null;
  return String(collection);
}

function normalizeId(id) {
  if (!id || String(id).trim() === "") return null;
  return String(id);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDefaultSqlitePath() {
  return process.env.SQLITE_DB_PATH || path.join(process.cwd(), "apps", "database", "data", "gategrave.sqlite");
}

function createDatabaseClient(options) {
  const cfg = options || {};
  if (cfg.db) return { db: cfg.db, error: null };

  // Prefer explicit driver injection for tests/custom runtimes.
  if (typeof cfg.openDatabase === "function") {
    try {
      return { db: cfg.openDatabase(cfg.databasePath || getDefaultSqlitePath()), error: null };
    } catch (error) {
      return { db: null, error: error.message };
    }
  }

  // Optional runtime dependency path: better-sqlite3 (if installed by the user).
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const BetterSqlite3 = require("better-sqlite3");
    const filePath = cfg.databasePath || getDefaultSqlitePath();
    const db = new BetterSqlite3(filePath);
    return { db, error: null };
  } catch (error) {
    return {
      db: null,
      error: "SQLite driver unavailable. Install better-sqlite3 or inject a db client."
    };
  }
}

function normalizeCollectionToTable(collection) {
  const key = normalizeCollection(collection);
  if (!key) return null;

  if (key === "characters") {
    return { collection: key, table: "characters", idColumn: "character_id" };
  }
  if (key === "inventories") {
    return { collection: key, table: "inventories", idColumn: "inventory_id" };
  }
  if (key === "sessions" || key === "dungeon_sessions") {
    return { collection: key, table: "sessions", idColumn: "session_id" };
  }
  if (key === "combats" || key === "combat_snapshots") {
    return { collection: key, table: "combats", idColumn: "combat_id" };
  }
  if (key === "accounts") {
    return { collection: key, table: "accounts", idColumn: "account_id" };
  }
  if (key === "parties") {
    return { collection: key, table: "parties", idColumn: "party_id" };
  }

  return null;
}

function deriveIndexedFields(table, record, fallbackId) {
  const safeRecord = record && typeof record === "object" ? record : {};
  const now = new Date().toISOString();

  if (table === "characters") {
    return {
      id: fallbackId,
      updated_at: now
    };
  }

  if (table === "inventories") {
    const ownerId = safeRecord.owner_id || safeRecord.owner_player_id || null;
    return {
      id: fallbackId,
      owner_id: ownerId === null ? null : String(ownerId),
      updated_at: now
    };
  }

  if (table === "sessions") {
    const status = safeRecord.status === undefined || safeRecord.status === null ? null : String(safeRecord.status);
    return {
      id: fallbackId,
      status,
      updated_at: now
    };
  }

  if (table === "combats") {
    const sessionId =
      safeRecord.session_id === undefined || safeRecord.session_id === null ? null : String(safeRecord.session_id);
    const status = safeRecord.status === undefined || safeRecord.status === null ? null : String(safeRecord.status);
    return {
      id: fallbackId,
      session_id: sessionId,
      status,
      updated_at: now
    };
  }

  if (table === "accounts") {
    const discordUserId =
      safeRecord.discord_user_id === undefined || safeRecord.discord_user_id === null
        ? null
        : String(safeRecord.discord_user_id);
    const activeCharacterId =
      safeRecord.active_character_id === undefined || safeRecord.active_character_id === null
        ? null
        : String(safeRecord.active_character_id);
    const maxCharacterSlots = Number.isFinite(safeRecord.max_character_slots)
      ? Math.max(1, Math.floor(Number(safeRecord.max_character_slots)))
      : 3;

    return {
      id: fallbackId,
      discord_user_id: discordUserId,
      active_character_id: activeCharacterId,
      max_character_slots: maxCharacterSlots,
      updated_at: now
    };
  }

  if (table === "parties") {
    const leaderPlayerId =
      safeRecord.leader_player_id === undefined || safeRecord.leader_player_id === null
        ? null
        : String(safeRecord.leader_player_id);
    const status =
      safeRecord.status === undefined || safeRecord.status === null ? null : String(safeRecord.status);
    return {
      id: fallbackId,
      leader_player_id: leaderPlayerId,
      status,
      updated_at: now
    };
  }

  return {
    id: fallbackId,
    updated_at: now
  };
}

class SqliteAdapter {
  constructor(options) {
    const cfg = options || {};
    const opened = createDatabaseClient(cfg);
    this.db = opened.db;
    this.initError = opened.error;
    this.databasePath = cfg.databasePath || getDefaultSqlitePath();
    this.schemaVersion = CURRENT_SCHEMA_VERSION;
    this.isInitialized = false;

    this.initialize();
  }

  initialize() {
    if (!this.db || this.initError) {
      return failure(this.initError || "sqlite db is not available", {
        database_path: this.databasePath
      });
    }

    try {
      this.ensureMetaTable();
      this.runMigrations();
      this.isInitialized = true;
      return success({
        initialized: true,
        schema_version: this.schemaVersion,
        database_path: this.databasePath
      });
    } catch (error) {
      this.initError = "sqlite initialization failed: " + error.message;
      this.isInitialized = false;
      return failure(this.initError, {
        database_path: this.databasePath
      });
    }
  }

  ensureMetaTable() {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_meta (" +
        "key TEXT PRIMARY KEY," +
        "value TEXT NOT NULL" +
      ")"
    );
  }

  getSchemaVersionFromMeta() {
    const row = this.db.prepare("SELECT value FROM schema_meta WHERE key = @key").get({
      key: "schema_version"
    });

    if (!row || row.value === undefined || row.value === null) {
      return 0;
    }

    const parsed = Number(row.value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }

    return Math.floor(parsed);
  }

  setSchemaVersion(version) {
    this.db
      .prepare(
        "INSERT INTO schema_meta (key, value) VALUES (@key, @value) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run({
        key: "schema_version",
        value: String(version)
      });
  }

  runMigrations() {
    const current = this.getSchemaVersionFromMeta();
    if (current >= this.schemaVersion) {
      return;
    }

    if (current < 1) {
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS characters (" +
          "character_id TEXT PRIMARY KEY," +
          "data TEXT NOT NULL," +
          "updated_at TEXT NOT NULL" +
        ")"
      );
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS inventories (" +
          "inventory_id TEXT PRIMARY KEY," +
          "owner_id TEXT," +
          "data TEXT NOT NULL," +
          "updated_at TEXT NOT NULL" +
        ")"
      );
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_inventories_owner_id ON inventories(owner_id)");
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS sessions (" +
          "session_id TEXT PRIMARY KEY," +
          "status TEXT," +
          "data TEXT NOT NULL," +
          "updated_at TEXT NOT NULL" +
        ")"
      );
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)");
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS combats (" +
          "combat_id TEXT PRIMARY KEY," +
          "session_id TEXT," +
          "status TEXT," +
          "data TEXT NOT NULL," +
          "updated_at TEXT NOT NULL" +
        ")"
      );
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_combats_session_id ON combats(session_id)");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_combats_status ON combats(status)");
    }

    if (current < 2) {
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS accounts (" +
          "account_id TEXT PRIMARY KEY," +
          "discord_user_id TEXT NOT NULL UNIQUE," +
          "active_character_id TEXT," +
          "max_character_slots INTEGER NOT NULL," +
          "data TEXT NOT NULL," +
          "updated_at TEXT NOT NULL" +
        ")"
      );
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_accounts_discord_user_id ON accounts(discord_user_id)");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_accounts_active_character_id ON accounts(active_character_id)");
    }

    if (current < 3) {
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS parties (" +
          "party_id TEXT PRIMARY KEY," +
          "leader_player_id TEXT NOT NULL," +
          "status TEXT," +
          "data TEXT NOT NULL," +
          "updated_at TEXT NOT NULL" +
        ")"
      );
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_parties_leader_player_id ON parties(leader_player_id)");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_parties_status ON parties(status)");
    }

    this.setSchemaVersion(this.schemaVersion);
  }

  parseRecordJson(row, context) {
    try {
      return {
        ok: true,
        record: JSON.parse(row.data)
      };
    } catch (error) {
      return {
        ok: false,
        error: "invalid JSON in " + context.table + " for id " + context.id + ": " + error.message
      };
    }
  }

  ensureReady() {
    if (this.initError) {
      return failure(this.initError, {
        database_path: this.databasePath
      });
    }
    if (!this.isInitialized) {
      return failure("sqlite adapter is not initialized", {
        database_path: this.databasePath
      });
    }
    return null;
  }

  getById(collection, id) {
    const readyError = this.ensureReady();
    if (readyError) return readyError;

    const mapping = normalizeCollectionToTable(collection);
    const idKey = normalizeId(id);
    if (!mapping) return failure("collection is not supported");
    if (!idKey) return failure("id is required");

    const row = this.db
      .prepare("SELECT data FROM " + mapping.table + " WHERE " + mapping.idColumn + " = @id")
      .get({ id: idKey });

    if (!row) {
      return success({
        collection: mapping.collection,
        id: idKey,
        record: null
      });
    }

    const parsed = this.parseRecordJson(row, { table: mapping.table, id: idKey });
    if (!parsed.ok) {
      return failure(parsed.error, {
        collection: mapping.collection,
        id: idKey
      });
    }

    return success({
      collection: mapping.collection,
      id: idKey,
      record: clone(parsed.record)
    });
  }

  list(collection) {
    const readyError = this.ensureReady();
    if (readyError) return readyError;

    const mapping = normalizeCollectionToTable(collection);
    if (!mapping) return failure("collection is not supported");

    const rows = this.db
      .prepare("SELECT " + mapping.idColumn + " AS id, data FROM " + mapping.table + " ORDER BY " + mapping.idColumn + " ASC")
      .all();

    const records = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const parsed = this.parseRecordJson(row, { table: mapping.table, id: row.id });
      if (!parsed.ok) {
        return failure(parsed.error, {
          collection: mapping.collection,
          id: row.id
        });
      }
      records.push({
        id: String(row.id),
        record: clone(parsed.record)
      });
    }

    return success({
      collection: mapping.collection,
      records
    });
  }

  save(collection, id, record) {
    const readyError = this.ensureReady();
    if (readyError) return readyError;

    const mapping = normalizeCollectionToTable(collection);
    const idKey = normalizeId(id);
    if (!mapping) return failure("collection is not supported");
    if (!idKey) return failure("id is required");
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return failure("record must be an object");
    }

    const recordJson = JSON.stringify(record);
    const indexedFields = deriveIndexedFields(mapping.table, record, idKey);

    if (mapping.table === "characters") {
      this.db
        .prepare(
          "INSERT INTO characters (character_id, data, updated_at) VALUES (@id, @data, @updated_at) " +
            "ON CONFLICT(character_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
        )
        .run({
          id: indexedFields.id,
          data: recordJson,
          updated_at: indexedFields.updated_at
        });
    } else if (mapping.table === "inventories") {
      this.db
        .prepare(
          "INSERT INTO inventories (inventory_id, owner_id, data, updated_at) VALUES (@id, @owner_id, @data, @updated_at) " +
            "ON CONFLICT(inventory_id) DO UPDATE SET owner_id = excluded.owner_id, data = excluded.data, updated_at = excluded.updated_at"
        )
        .run({
          id: indexedFields.id,
          owner_id: indexedFields.owner_id,
          data: recordJson,
          updated_at: indexedFields.updated_at
        });
    } else if (mapping.table === "sessions") {
      this.db
        .prepare(
          "INSERT INTO sessions (session_id, status, data, updated_at) VALUES (@id, @status, @data, @updated_at) " +
            "ON CONFLICT(session_id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at"
        )
        .run({
          id: indexedFields.id,
          status: indexedFields.status,
          data: recordJson,
          updated_at: indexedFields.updated_at
        });
    } else if (mapping.table === "combats") {
      this.db
        .prepare(
          "INSERT INTO combats (combat_id, session_id, status, data, updated_at) VALUES (@id, @session_id, @status, @data, @updated_at) " +
            "ON CONFLICT(combat_id) DO UPDATE SET session_id = excluded.session_id, status = excluded.status, data = excluded.data, updated_at = excluded.updated_at"
        )
        .run({
          id: indexedFields.id,
          session_id: indexedFields.session_id,
          status: indexedFields.status,
          data: recordJson,
          updated_at: indexedFields.updated_at
        });
    } else if (mapping.table === "accounts") {
      this.db
        .prepare(
          "INSERT INTO accounts (account_id, discord_user_id, active_character_id, max_character_slots, data, updated_at) " +
            "VALUES (@id, @discord_user_id, @active_character_id, @max_character_slots, @data, @updated_at) " +
            "ON CONFLICT(account_id) DO UPDATE SET " +
            "discord_user_id = excluded.discord_user_id, " +
            "active_character_id = excluded.active_character_id, " +
            "max_character_slots = excluded.max_character_slots, " +
            "data = excluded.data, " +
            "updated_at = excluded.updated_at"
        )
        .run({
          id: indexedFields.id,
          discord_user_id: indexedFields.discord_user_id,
          active_character_id: indexedFields.active_character_id,
          max_character_slots: indexedFields.max_character_slots,
          data: recordJson,
          updated_at: indexedFields.updated_at
        });
    } else if (mapping.table === "parties") {
      this.db
        .prepare(
          "INSERT INTO parties (party_id, leader_player_id, status, data, updated_at) " +
            "VALUES (@id, @leader_player_id, @status, @data, @updated_at) " +
            "ON CONFLICT(party_id) DO UPDATE SET " +
            "leader_player_id = excluded.leader_player_id, " +
            "status = excluded.status, " +
            "data = excluded.data, " +
            "updated_at = excluded.updated_at"
        )
        .run({
          id: indexedFields.id,
          leader_player_id: indexedFields.leader_player_id,
          status: indexedFields.status,
          data: recordJson,
          updated_at: indexedFields.updated_at
        });
    }

    return success({
      collection: mapping.collection,
      id: idKey,
      record: clone(record)
    });
  }

  delete(collection, id) {
    const readyError = this.ensureReady();
    if (readyError) return readyError;

    const mapping = normalizeCollectionToTable(collection);
    const idKey = normalizeId(id);
    if (!mapping) return failure("collection is not supported");
    if (!idKey) return failure("id is required");

    const out = this.db.prepare("DELETE FROM " + mapping.table + " WHERE " + mapping.idColumn + " = @id").run({ id: idKey });

    return success({
      collection: mapping.collection,
      id: idKey,
      deleted: Number(out && out.changes ? out.changes : 0) > 0
    });
  }

  // Domain-friendly wrappers that keep gameplay concerns out of persistence.
  saveCharacter(characterId, character) {
    return this.save("characters", characterId, character);
  }

  getCharacterById(characterId) {
    return this.getById("characters", characterId);
  }

  saveInventory(inventoryId, inventory) {
    return this.save("inventories", inventoryId, inventory);
  }

  getInventoryById(inventoryId) {
    return this.getById("inventories", inventoryId);
  }

  saveSession(sessionOrId, maybeSession) {
    if (maybeSession !== undefined) {
      return this.save("dungeon_sessions", sessionOrId, maybeSession);
    }

    const session = sessionOrId;
    if (!session || typeof session !== "object" || Array.isArray(session)) {
      return failure("session must be an object");
    }
    const sessionId = normalizeId(session.session_id);
    if (!sessionId) {
      return failure("session.session_id is required");
    }
    return this.save("dungeon_sessions", sessionId, session);
  }

  getSessionById(sessionId) {
    return this.getById("dungeon_sessions", sessionId);
  }

  listSessions() {
    return this.list("dungeon_sessions");
  }

  deleteSession(sessionId) {
    return this.delete("dungeon_sessions", sessionId);
  }

  saveCombat(combatOrId, maybeCombat) {
    if (maybeCombat !== undefined) {
      return this.save("combats", combatOrId, maybeCombat);
    }

    const combat = combatOrId;
    if (!combat || typeof combat !== "object" || Array.isArray(combat)) {
      return failure("combat must be an object");
    }
    const combatId = normalizeId(combat.combat_id);
    if (!combatId) {
      return failure("combat.combat_id is required");
    }
    return this.save("combats", combatId, combat);
  }

  getCombatById(combatId) {
    return this.getById("combats", combatId);
  }

  listCombats() {
    return this.list("combats");
  }

  deleteCombat(combatId) {
    return this.delete("combats", combatId);
  }

  saveParty(partyOrId, maybeParty) {
    if (maybeParty !== undefined) {
      return this.save("parties", partyOrId, maybeParty);
    }

    const party = partyOrId;
    if (!party || typeof party !== "object" || Array.isArray(party)) {
      return failure("party must be an object");
    }
    const partyId = normalizeId(party.party_id);
    if (!partyId) {
      return failure("party.party_id is required");
    }
    return this.save("parties", partyId, party);
  }

  getPartyById(partyId) {
    return this.getById("parties", partyId);
  }

  listParties() {
    return this.list("parties");
  }

  deleteParty(partyId) {
    return this.delete("parties", partyId);
  }

  close() {
    const readyError = this.ensureReady();
    if (readyError) return readyError;

    if (this.db && typeof this.db.close === "function") {
      this.db.close();
    }

    this.isInitialized = false;

    return success({
      closed: true,
      database_path: this.databasePath
    });
  }
}

function createSqliteAdapter(options) {
  const adapter = new SqliteAdapter(options);
  const contract = validateAdapterContract(adapter);
  if (!contract.ok) {
    throw new Error(contract.error);
  }
  return adapter;
}

module.exports = {
  SqliteAdapter,
  createSqliteAdapter,
  getDefaultSqlitePath,
  CURRENT_SCHEMA_VERSION
};
