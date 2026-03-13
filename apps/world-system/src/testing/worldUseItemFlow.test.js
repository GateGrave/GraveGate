"use strict";

const assert = require("assert");
const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { createSqliteAdapter } = require("../../../database/src/adapters/sqliteAdapter");
const { InventoryPersistenceBridge } = require("../../../inventory-system/src/inventory.persistence");
const { createInventoryRecord } = require("../../../inventory-system/src/inventory.schema");
const { CharacterPersistenceBridge } = require("../character/character.persistence");
const { createCharacterRecord } = require("../character/character.schema");
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
        if (text.includes("SELECT data FROM characters")) {
          const row = self.ensureTable("characters").get(String(params.id));
          return row ? { data: row.data } : null;
        }
        if (text.includes("SELECT data FROM inventories")) {
          const row = self.ensureTable("inventories").get(String(params.id));
          return row ? { data: row.data } : null;
        }
        return null;
      },
      all() {
        if (text.includes("FROM characters")) {
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
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
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
            metadata: {
              heal_amount: 1
            }
          }
        ]
      })
    ]);
    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-world-use-001",
      player_id: "player-world-use-001",
      name: "Use Hero",
      inventory_id: "inv-world-use-001",
      current_hitpoints: 6,
      hitpoint_max: 10
    }));

    const out = processWorldUseItemRequest({
      context: {
        inventoryPersistence: persistence,
        characterPersistence
      },
      player_id: "player-world-use-001",
      item_id: "potion-heal-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "player_use_item_processed");
    assert.equal(out.payload.item_id, "potion-heal-001");
    assert.equal(out.payload.inventory.stackable_items[0].quantity, 1);
    assert.equal(out.payload.character.current_hitpoints, 7);
  }, results);

  runTest("world_use_item_can_apply_hitpoint_max_bonus_effect", () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const persistence = createInventoryPersistence([
      createInventoryRecord({
        inventory_id: "inv-world-use-aid-001",
        owner_type: "player",
        owner_id: "player-world-use-aid-001",
        stackable_items: [
          {
            item_id: "item_aid_phial",
            quantity: 1,
            owner_player_id: "player-world-use-aid-001",
            metadata: {
              use_effect: {
                hitpoint_max_bonus: 5
              }
            }
          }
        ]
      })
    ]);
    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-world-use-aid-001",
      player_id: "player-world-use-aid-001",
      name: "Aid Hero",
      inventory_id: "inv-world-use-aid-001",
      current_hitpoints: 10,
      hitpoint_max: 10
    }));

    const out = processWorldUseItemRequest({
      context: {
        inventoryPersistence: persistence,
        characterPersistence
      },
      player_id: "player-world-use-aid-001",
      item_id: "item_aid_phial"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.character.hitpoint_max, 15);
    assert.equal(out.payload.character.current_hitpoints, 15);
    assert.equal(out.payload.effect_result.hitpoint_max_bonus, 5);
  }, results);

  runTest("world_use_item_can_clear_matching_status_flags", () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const persistence = createInventoryPersistence([
      createInventoryRecord({
        inventory_id: "inv-world-use-purity-001",
        owner_type: "player",
        owner_id: "player-world-use-purity-001",
        stackable_items: [
          {
            item_id: "item_phial_of_purity",
            quantity: 1,
            owner_player_id: "player-world-use-purity-001",
            metadata: {
              use_effect: {
                remove_conditions: ["poisoned"]
              }
            }
          }
        ]
      })
    ]);
    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-world-use-purity-001",
      player_id: "player-world-use-purity-001",
      name: "Purity Hero",
      inventory_id: "inv-world-use-purity-001",
      status_flags: ["poisoned", "blessed"]
    }));

    const out = processWorldUseItemRequest({
      context: {
        inventoryPersistence: persistence,
        characterPersistence
      },
      player_id: "player-world-use-purity-001",
      item_id: "item_phial_of_purity"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.character.status_flags.includes("poisoned"), false);
    assert.equal(out.payload.character.status_flags.includes("blessed"), true);
    assert.equal(out.payload.effect_result.removed_conditions.includes("poisoned"), true);
  }, results);

  runTest("world_use_item_fails_safely_when_item_missing", () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const persistence = createInventoryPersistence([
      createInventoryRecord({
        inventory_id: "inv-world-use-002",
        owner_type: "player",
        owner_id: "player-world-use-002",
        stackable_items: []
      })
    ]);
    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-world-use-002",
      player_id: "player-world-use-002",
      name: "Use Hero",
      inventory_id: "inv-world-use-002"
    }));

    const out = processWorldUseItemRequest({
      context: {
        inventoryPersistence: persistence,
        characterPersistence
      },
      player_id: "player-world-use-002",
      item_id: "missing-item-001"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "player_use_item_failed");
  }, results);

  runTest("world_use_item_fails_safely_when_save_fails_mid_operation", () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
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
    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-world-use-003",
      player_id: "player-world-use-003",
      name: "Use Hero",
      inventory_id: "inv-world-use-003"
    }));

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
        inventoryPersistence: persistence,
        characterPersistence
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
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
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
    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-world-use-004",
      player_id: "player-world-use-004",
      name: "Use Hero",
      inventory_id: "inv-world-use-004"
    }));

    const out = processWorldUseItemRequest({
      context: {
        inventoryPersistence: persistence,
        characterPersistence
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
          metadata: {
            heal_amount: 1
          }
        }
      ]
    });

    const memorySetup = createBridgeInventoryPersistence("memory");
    const sqliteSetup = createBridgeInventoryPersistence("sqlite");
    const memoryCharacterPersistence = new CharacterPersistenceBridge({ adapter: memorySetup.adapter });
    const sqliteCharacterPersistence = new CharacterPersistenceBridge({ adapter: sqliteSetup.adapter });
    memorySetup.bridge.saveInventory(startingInventory);
    sqliteSetup.bridge.saveInventory(startingInventory);
    memoryCharacterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-world-use-parity-001",
      player_id: "player-world-use-parity-001",
      name: "Parity Hero",
      inventory_id: "inv-world-use-parity-001",
      current_hitpoints: 5,
      hitpoint_max: 10
    }));
    sqliteCharacterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-world-use-parity-001",
      player_id: "player-world-use-parity-001",
      name: "Parity Hero",
      inventory_id: "inv-world-use-parity-001",
      current_hitpoints: 5,
      hitpoint_max: 10
    }));

    const memoryOut = processWorldUseItemRequest({
      context: {
        inventoryPersistence: memorySetup.bridge,
        characterPersistence: memoryCharacterPersistence
      },
      player_id: "player-world-use-parity-001",
      item_id: "potion-heal-parity-001"
    });
    const sqliteOut = processWorldUseItemRequest({
      context: {
        inventoryPersistence: sqliteSetup.bridge,
        characterPersistence: sqliteCharacterPersistence
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

  runTest("world_use_item_applies_healing_and_temporary_hitpoints_to_character", () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const persistence = createInventoryPersistence([
      createInventoryRecord({
        inventory_id: "inv-world-use-heroism-001",
        owner_type: "player",
        owner_id: "player-world-use-heroism-001",
        stackable_items: [
          {
            item_id: "item-arcane-restorative-001",
            quantity: 1,
            owner_player_id: "player-world-use-heroism-001",
            metadata: {
              heal_amount: 5,
              temporary_hitpoints: 7
            }
          }
        ]
      })
    ]);
    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-world-use-heroism-001",
      player_id: "player-world-use-heroism-001",
      name: "Arcane Survivor",
      inventory_id: "inv-world-use-heroism-001",
      current_hitpoints: 4,
      hitpoint_max: 10,
      temporary_hitpoints: 2
    }));

    const out = processWorldUseItemRequest({
      context: {
        inventoryPersistence: persistence,
        characterPersistence
      },
      player_id: "player-world-use-heroism-001",
      item_id: "item-arcane-restorative-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.effect_result.healed_for, 5);
    assert.equal(out.payload.effect_result.temporary_hp_before, 2);
    assert.equal(out.payload.effect_result.temporary_hp_after, 7);
    assert.equal(out.payload.character.current_hitpoints, 9);
    assert.equal(out.payload.character.temporary_hitpoints, 7);
  }, results);

  runTest("world_use_item_uses_charged_magical_item_without_removing_it", () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const persistence = createInventoryPersistence([
      createInventoryRecord({
        inventory_id: "inv-world-use-charged-001",
        owner_type: "player",
        owner_id: "player-world-use-charged-001",
        equipment_items: [
          {
            item_id: "item_charm_of_vital_reserve",
            quantity: 1,
            owner_player_id: "player-world-use-charged-001",
            item_type: "equipment",
            metadata: {
              magical: true,
              requires_attunement: true,
              equipped: true,
              equipped_slot: "accessory",
              is_attuned: true,
              charges: 2,
              charges_remaining: 2,
              use_effect: {
                temporary_hitpoints: 6
              }
            }
          }
        ]
      })
    ]);
    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-world-use-charged-001",
      player_id: "player-world-use-charged-001",
      name: "Ward Bearer",
      inventory_id: "inv-world-use-charged-001",
      current_hitpoints: 9,
      hitpoint_max: 12,
      temporary_hitpoints: 0
    }));

    const out = processWorldUseItemRequest({
      context: {
        inventoryPersistence: persistence,
        characterPersistence
      },
      player_id: "player-world-use-charged-001",
      item_id: "item_charm_of_vital_reserve"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.use_status, "charged_activation");
    assert.equal(out.payload.effect_result.charges_before, 2);
    assert.equal(out.payload.effect_result.charges_after, 1);
    assert.equal(out.payload.character.temporary_hitpoints, 6);
    assert.equal(out.payload.inventory.equipment_items.length, 1);
    assert.equal(out.payload.inventory.equipment_items[0].metadata.charges_remaining, 1);
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
