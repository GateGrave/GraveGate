"use strict";

const assert = require("assert");
const { createInventoryRecord } = require("../inventory.schema");
const { InventoryPersistenceBridge } = require("../inventory.persistence");
const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { createSqliteAdapter } = require("../../../database/src/adapters/sqliteAdapter");

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
        if (text.includes("INSERT INTO inventories")) {
          self.ensureTable("inventories").set(String(params.id), {
            inventory_id: String(params.id),
            owner_id: params.owner_id === undefined ? null : params.owner_id,
            data: String(params.data),
            updated_at: String(params.updated_at)
          });
          return { changes: 1 };
        }
        if (text.includes("DELETE FROM inventories")) {
          const table = self.ensureTable("inventories");
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
        if (text.includes("SELECT data FROM inventories")) {
          const row = self.ensureTable("inventories").get(String(params.id));
          return row ? { data: row.data } : null;
        }
        return null;
      },
      all() {
        if (!text.includes("FROM inventories")) {
          return [];
        }
        const rows = [];
        self.ensureTable("inventories").forEach(function each(row) {
          rows.push({
            id: row.inventory_id,
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
      ? createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "inventory-persistence.sqlite" })
      : createInMemoryAdapter();
  const persistence = new InventoryPersistenceBridge({ adapter });
  return { adapter, persistence };
}

function runInventoryPersistenceAdapterTests() {
  const results = [];

  runTest("saving_inventory_through_persistence_bridge", () => {
    const ctx = createContext("memory");
    const inventory = createInventoryRecord({
      inventory_id: "inv-persist-001",
      owner_type: "player",
      owner_id: "player-persist-001"
    });

    const out = ctx.persistence.saveInventory(inventory);
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "inventory_persistence_saved");
    assert.equal(out.payload.inventory.inventory_id, "inv-persist-001");
  }, results);

  runTest("loading_inventory_through_persistence_bridge", () => {
    const ctx = createContext("memory");
    ctx.persistence.saveInventory(
      createInventoryRecord({
        inventory_id: "inv-persist-002",
        owner_type: "player",
        owner_id: "player-persist-002",
        stackable_items: [{ item_id: "item-herb", quantity: 3 }]
      })
    );

    const out = ctx.persistence.loadInventoryById("inv-persist-002");
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "inventory_persistence_loaded");
    assert.equal(out.payload.inventory.owner_id, "player-persist-002");
  }, results);

  runTest("listing_inventories", () => {
    const ctx = createContext("memory");
    ctx.persistence.saveInventory(
      createInventoryRecord({ inventory_id: "inv-persist-003", owner_type: "player", owner_id: "p3" })
    );
    ctx.persistence.saveInventory(
      createInventoryRecord({ inventory_id: "inv-persist-004", owner_type: "player", owner_id: "p4" })
    );

    const out = ctx.persistence.listInventories();
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "inventory_persistence_listed");
    assert.equal(Array.isArray(out.payload.inventories), true);
    assert.equal(out.payload.inventories.length, 2);
  }, results);

  runTest("deleting_inventory", () => {
    const ctx = createContext("memory");
    ctx.persistence.saveInventory(
      createInventoryRecord({ inventory_id: "inv-persist-005", owner_type: "player", owner_id: "p5" })
    );

    const deleted = ctx.persistence.deleteInventory("inv-persist-005");
    assert.equal(deleted.ok, true);
    assert.equal(deleted.event_type, "inventory_persistence_deleted");
    assert.equal(deleted.payload.deleted, true);

    const loaded = ctx.persistence.loadInventoryById("inv-persist-005");
    assert.equal(loaded.ok, false);
    assert.equal(loaded.error, "inventory not found");
  }, results);

  runTest("failure_on_missing_inventory", () => {
    const ctx = createContext("memory");
    const out = ctx.persistence.loadInventoryById("inv-missing-001");
    assert.equal(out.ok, false);
    assert.equal(out.event_type, "inventory_persistence_load_failed");
    assert.equal(out.error, "inventory not found");
  }, results);

  runTest("inventory_bridge_parity_inmemory_and_sqlite_for_crud_and_missing", () => {
    const memory = createContext("memory").persistence;
    const sqlite = createContext("sqlite").persistence;
    const inventory = createInventoryRecord({
      inventory_id: "inv-persist-parity-001",
      owner_type: "player",
      owner_id: "player-persist-parity-001",
      stackable_items: [
        {
          item_id: "item-parity-001",
          quantity: 2
        }
      ]
    });

    const memorySaved = memory.saveInventory(inventory);
    const sqliteSaved = sqlite.saveInventory(inventory);
    const memoryLoaded = memory.loadInventoryById("inv-persist-parity-001");
    const sqliteLoaded = sqlite.loadInventoryById("inv-persist-parity-001");
    const memoryList = memory.listInventories();
    const sqliteList = sqlite.listInventories();
    const memoryDeleted = memory.deleteInventory("inv-persist-parity-001");
    const sqliteDeleted = sqlite.deleteInventory("inv-persist-parity-001");
    const memoryMissing = memory.loadInventoryById("inv-persist-parity-001");
    const sqliteMissing = sqlite.loadInventoryById("inv-persist-parity-001");

    assert.equal(memorySaved.ok, sqliteSaved.ok);
    assert.equal(memoryLoaded.ok, sqliteLoaded.ok);
    assert.deepEqual(memoryLoaded.payload.inventory, sqliteLoaded.payload.inventory);
    assert.equal(memoryList.ok, sqliteList.ok);
    assert.equal(memoryList.payload.inventories.length, sqliteList.payload.inventories.length);
    assert.equal(memoryDeleted.payload.deleted, sqliteDeleted.payload.deleted);
    assert.equal(memoryMissing.ok, sqliteMissing.ok);
    assert.equal(memoryMissing.error, sqliteMissing.error);
  }, results);

  runTest("inventory_bridge_parity_for_invalid_input_failures", () => {
    const adapterTypes = ["memory", "sqlite"];
    adapterTypes.forEach((adapterType) => {
      const ctx = createContext(adapterType).persistence;

      const saveMissingId = ctx.saveInventory({
        owner_type: "player",
        owner_id: "player-no-id"
      });
      assert.equal(saveMissingId.ok, true);
      assert.equal(saveMissingId.event_type, "inventory_persistence_saved");
      assert.equal(typeof saveMissingId.payload.inventory.inventory_id, "string");
      assert.equal(saveMissingId.payload.inventory.inventory_id.length > 0, true);

      const saveInvalidType = ctx.saveInventory(null);
      assert.equal(saveInvalidType.ok, false);
      assert.equal(saveInvalidType.event_type, "inventory_persistence_save_failed");
      assert.equal(saveInvalidType.error, "inventory must be an object");

      const loadMissingId = ctx.loadInventoryById("");
      assert.equal(loadMissingId.ok, false);
      assert.equal(loadMissingId.event_type, "inventory_persistence_load_failed");
      assert.equal(loadMissingId.error, "inventory_id is required");

      const deleteMissingId = ctx.deleteInventory("");
      assert.equal(deleteMissingId.ok, false);
      assert.equal(deleteMissingId.event_type, "inventory_persistence_delete_failed");
      assert.equal(deleteMissingId.error, "inventory_id is required");
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
  const summary = runInventoryPersistenceAdapterTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runInventoryPersistenceAdapterTests
};
