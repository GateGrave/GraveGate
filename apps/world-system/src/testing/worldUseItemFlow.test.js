"use strict";

const assert = require("assert");
const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { createSqliteAdapter } = require("../../../database/src/adapters/sqliteAdapter");
const { InventoryPersistenceBridge } = require("../../../inventory-system/src/inventory.persistence");
const { createInventoryRecord } = require("../../../inventory-system/src/inventory.schema");
const { processWorldUseItemRequest } = require("../flow/processWorldUseItemRequest");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createInventoryPersistence(inventories) {
  const byId = new Map();
  (inventories || []).forEach((inventory) => {
    byId.set(String(inventory.inventory_id), JSON.parse(JSON.stringify(inventory)));
  });

  return {
    listInventories() {
      return {
        ok: true,
        payload: {
          inventories: Array.from(byId.values()).map((x) => JSON.parse(JSON.stringify(x)))
        }
      };
    },
    saveInventory(inventory) {
      byId.set(String(inventory.inventory_id), JSON.parse(JSON.stringify(inventory)));
      return {
        ok: true,
        payload: {
          inventory: JSON.parse(JSON.stringify(inventory))
        }
      };
    }
  };
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
    const text = String(sql);
    const self = this;
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
        if (text.includes("SELECT data FROM inventories")) {
          const row = self.ensureTable("inventories").get(String(params.id));
          return row ? { data: row.data } : null;
        }
        return null;
      },
      all() {
        if (!text.includes("FROM inventories")) return [];
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

function createBridgeInventoryPersistence(adapterType) {
  const adapter =
    adapterType === "sqlite"
      ? createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "world-use-item.sqlite" })
      : createInMemoryAdapter();
  const bridge = new InventoryPersistenceBridge({ adapter });
  return {
    bridge,
    adapter
  };
}

function runWorldUseItemFlowTests() {
  const results = [];

  runTest("world_use_item_consumes_item_through_inventory_persistence", () => {
    const persistence = createInventoryPersistence([
      createInventoryRecord({
        inventory_id: "inv-world-use-001",
        owner_type: "player",
        owner_id: "player-world-use-001",
        stackable_items: [
          {
            item_id: "potion-heal-001",
            quantity: 2,
            owner_player_id: "player-world-use-001",
            metadata: {}
          }
        ]
      })
    ]);

    const out = processWorldUseItemRequest({
      context: {
        inventoryPersistence: persistence
      },
      player_id: "player-world-use-001",
      item_id: "potion-heal-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "player_use_item_processed");
    assert.equal(out.payload.item_id, "potion-heal-001");
    assert.equal(out.payload.inventory.stackable_items[0].quantity, 1);
  }, results);

  runTest("world_use_item_fails_safely_when_item_missing", () => {
    const persistence = createInventoryPersistence([
      createInventoryRecord({
        inventory_id: "inv-world-use-002",
        owner_type: "player",
        owner_id: "player-world-use-002",
        stackable_items: []
      })
    ]);

    const out = processWorldUseItemRequest({
      context: {
        inventoryPersistence: persistence
      },
      player_id: "player-world-use-002",
      item_id: "missing-item-001"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "player_use_item_failed");
  }, results);

  runTest("world_use_item_fails_safely_when_save_fails_mid_operation", () => {
    const inventory = createInventoryRecord({
      inventory_id: "inv-world-use-003",
      owner_type: "player",
      owner_id: "player-world-use-003",
      stackable_items: [
        {
          item_id: "potion-heal-003",
          quantity: 1,
          owner_player_id: "player-world-use-003",
          metadata: {}
        }
      ]
    });
    const persistence = createInventoryPersistence([inventory]);

    const beforeList = persistence.listInventories();
    const before = beforeList.payload.inventories[0];

    const originalSave = persistence.saveInventory;
    persistence.saveInventory = function failSave() {
      return {
        ok: false,
        error: "forced inventory save failure"
      };
    };

    const out = processWorldUseItemRequest({
      context: {
        inventoryPersistence: persistence
      },
      player_id: "player-world-use-003",
      item_id: "potion-heal-003"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "player_use_item_failed");

    persistence.saveInventory = originalSave;
    const afterList = persistence.listInventories();
    const after = afterList.payload.inventories[0];
    assert.deepEqual(after, before);
  }, results);

  runTest("world_use_item_rejects_missing_ownership_metadata", () => {
    const persistence = createInventoryPersistence([
      createInventoryRecord({
        inventory_id: "inv-world-use-004",
        owner_type: "player",
        owner_id: null,
        stackable_items: [
          {
            item_id: "potion-heal-004",
            quantity: 1,
            metadata: {}
          }
        ]
      })
    ]);

    const out = processWorldUseItemRequest({
      context: {
        inventoryPersistence: persistence
      },
      player_id: "player-world-use-004",
      item_id: "potion-heal-004"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "player_use_item_failed");
  }, results);

  runTest("world_use_item_adapter_parity_inmemory_vs_sqlite", () => {
    const startingInventory = createInventoryRecord({
      inventory_id: "inv-world-use-parity-001",
      owner_type: "player",
      owner_id: "player-world-use-parity-001",
      stackable_items: [
        {
          item_id: "potion-heal-parity-001",
          quantity: 2,
          owner_player_id: "player-world-use-parity-001",
          metadata: {}
        }
      ]
    });

    const memorySetup = createBridgeInventoryPersistence("memory");
    const sqliteSetup = createBridgeInventoryPersistence("sqlite");
    memorySetup.bridge.saveInventory(startingInventory);
    sqliteSetup.bridge.saveInventory(startingInventory);

    const memoryOut = processWorldUseItemRequest({
      context: {
        inventoryPersistence: memorySetup.bridge
      },
      player_id: "player-world-use-parity-001",
      item_id: "potion-heal-parity-001"
    });
    const sqliteOut = processWorldUseItemRequest({
      context: {
        inventoryPersistence: sqliteSetup.bridge
      },
      player_id: "player-world-use-parity-001",
      item_id: "potion-heal-parity-001"
    });

    assert.equal(memoryOut.ok, true);
    assert.equal(sqliteOut.ok, true);

    const memoryList = memorySetup.bridge.listInventories();
    const sqliteList = sqliteSetup.bridge.listInventories();
    assert.equal(memoryList.ok, true);
    assert.equal(sqliteList.ok, true);

    const memoryInventory = memoryList.payload.inventories[0];
    const sqliteInventory = sqliteList.payload.inventories[0];
    assert.deepEqual(sqliteInventory.stackable_items, memoryInventory.stackable_items);
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
  const summary = runWorldUseItemFlowTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runWorldUseItemFlowTests
};
