"use strict";

const assert = require("assert");
const { createInMemoryAdapter } = require("../../../../database/src/adapters/inMemoryAdapter");
const { createSqliteAdapter } = require("../../../../database/src/adapters/sqliteAdapter");
const { CharacterPersistenceBridge } = require("../character.persistence");
const { InventoryPersistenceBridge } = require("../../../../inventory-system/src/inventory.persistence");
const { createCharacterRecord } = require("../character.schema");
const { createInventoryRecord } = require("../../../../inventory-system/src/inventory.schema");
const { processEquipRequest, processUnequipRequest } = require("../flow/processEquipmentRequest");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createContext(options) {
  const cfg = options || {};
  const characterMap = new Map();
  const inventoryMap = new Map();

  const character = createCharacterRecord({
    character_id: cfg.character_id || "char-equip-consistency-001",
    player_id: cfg.player_id || "player-equip-consistency-001",
    name: "Consistency Hero",
    inventory_id: cfg.inventory_id || "inv-equip-consistency-001",
    equipment: cfg.equipment || {}
  });
  characterMap.set(String(character.character_id), clone(character));

  const inventory = createInventoryRecord({
    inventory_id: cfg.inventory_id || "inv-equip-consistency-001",
    owner_type: "player",
    owner_id: cfg.player_id || "player-equip-consistency-001",
    equipment_items: Array.isArray(cfg.equipment_items)
      ? clone(cfg.equipment_items)
      : [
        {
          item_id: "item-equip-consistency-001",
          quantity: 1,
          owner_player_id: cfg.player_id || "player-equip-consistency-001",
          metadata: cfg.item_metadata || {}
        }
      ],
    stackable_items: Array.isArray(cfg.stackable_items) ? clone(cfg.stackable_items) : []
  });
  inventoryMap.set(String(inventory.inventory_id), clone(inventory));

  return {
    characterPersistence: {
      listCharacters() {
        return {
          ok: true,
          payload: {
            characters: Array.from(characterMap.values()).map((x) => clone(x))
          }
        };
      },
      saveCharacter(nextCharacter) {
        if (cfg.fail_character_save === true) {
          return { ok: false, error: "forced character save failure" };
        }
        characterMap.set(String(nextCharacter.character_id), clone(nextCharacter));
        return {
          ok: true,
          payload: {
            character: clone(nextCharacter)
          }
        };
      },
      getCharacter(characterId) {
        return characterMap.get(String(characterId)) || null;
      }
    },
    inventoryPersistence: {
      loadInventoryById(inventoryId) {
        const found = inventoryMap.get(String(inventoryId));
        if (!found) {
          return { ok: false, error: "inventory not found" };
        }
        return {
          ok: true,
          payload: {
            inventory: clone(found)
          }
        };
      },
      saveInventory(nextInventory) {
        inventoryMap.set(String(nextInventory.inventory_id), clone(nextInventory));
        return {
          ok: true,
          payload: {
            inventory: clone(nextInventory)
          }
        };
      },
      getInventory(inventoryId) {
        return inventoryMap.get(String(inventoryId)) || null;
      }
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
        if (text.includes("DELETE FROM")) {
          const table = text.includes("characters") ? self.ensureTable("characters") : self.ensureTable("inventories");
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
            rows.push({ id: row.character_id, data: row.data });
          });
          rows.sort(function byId(a, b) {
            return String(a.id).localeCompare(String(b.id));
          });
          return rows;
        }
        if (text.includes("FROM inventories")) {
          const rows = [];
          self.ensureTable("inventories").forEach(function each(row) {
            rows.push({ id: row.inventory_id, data: row.data });
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

function createBridgeBackedContext(adapterType, options) {
  const cfg = options || {};
  const adapter =
    adapterType === "sqlite"
      ? createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "equipment-consistency.sqlite" })
      : createInMemoryAdapter();
  const characterPersistence = new CharacterPersistenceBridge({ adapter });
  const inventoryPersistence = new InventoryPersistenceBridge({ adapter });

  const character = createCharacterRecord({
    character_id: cfg.character_id || "char-equip-bridge-001",
    player_id: cfg.player_id || "player-equip-bridge-001",
    name: "Bridge Hero",
    inventory_id: cfg.inventory_id || "inv-equip-bridge-001",
    equipment: cfg.equipment || {}
  });
  const inventory = createInventoryRecord({
    inventory_id: cfg.inventory_id || "inv-equip-bridge-001",
    owner_type: "player",
    owner_id: cfg.player_id || "player-equip-bridge-001",
    equipment_items: Array.isArray(cfg.equipment_items)
      ? clone(cfg.equipment_items)
      : [
        {
          item_id: "item-equip-bridge-001",
          quantity: 1,
          owner_player_id: cfg.player_id || "player-equip-bridge-001",
          metadata: cfg.item_metadata || {}
        }
      ],
    stackable_items: Array.isArray(cfg.stackable_items) ? clone(cfg.stackable_items) : []
  });

  characterPersistence.saveCharacter(character);
  inventoryPersistence.saveInventory(inventory);

  const wrappedCharacterPersistence = {
    listCharacters: characterPersistence.listCharacters.bind(characterPersistence),
    saveCharacter(nextCharacter) {
      if (cfg.fail_character_save === true) {
        return { ok: false, error: "forced character save failure" };
      }
      return characterPersistence.saveCharacter(nextCharacter);
    },
    getCharacter(characterId) {
      const loaded = characterPersistence.loadCharacterById(characterId);
      return loaded.ok ? clone(loaded.payload.character) : null;
    }
  };

  const wrappedInventoryPersistence = {
    loadInventoryById: inventoryPersistence.loadInventoryById.bind(inventoryPersistence),
    saveInventory(nextInventory) {
      return inventoryPersistence.saveInventory(nextInventory);
    },
    getInventory(inventoryId) {
      const loaded = inventoryPersistence.loadInventoryById(inventoryId);
      return loaded.ok ? clone(loaded.payload.inventory) : null;
    }
  };

  return {
    characterPersistence: wrappedCharacterPersistence,
    inventoryPersistence: wrappedInventoryPersistence
  };
}

function runProcessEquipmentRequestConsistencyTests() {
  const results = [];

  runTest("successful_equip_flow_persists_inventory_and_character", () => {
    const context = createContext({});
    const out = processEquipRequest({
      context,
      player_id: "player-equip-consistency-001",
      item_id: "item-equip-consistency-001",
      slot: "main_hand"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "player_equip_processed");

    const savedCharacter = context.characterPersistence.getCharacter("char-equip-consistency-001");
    assert.equal(savedCharacter.equipment.main_hand, "item-equip-consistency-001");

    const savedInventory = context.inventoryPersistence.getInventory("inv-equip-consistency-001");
    assert.equal(savedInventory.equipment_items[0].metadata.equipped, true);
    assert.equal(savedInventory.equipment_items[0].metadata.equipped_slot, "main_hand");
  }, results);

  runTest("equip_valid_weapon_from_starter_items_succeeds", () => {
    const context = createContext({
      equipment_items: [
        {
          item_id: "item_longsword",
          quantity: 1,
          owner_player_id: "player-equip-consistency-001",
          metadata: {}
        }
      ]
    });

    const out = processEquipRequest({
      context,
      player_id: "player-equip-consistency-001",
      item_id: "item_longsword",
      slot: "main_hand"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.equipped.slot, "main_hand");
  }, results);

  runTest("equip_valid_armor_from_starter_items_succeeds", () => {
    const context = createContext({
      equipment_items: [
        {
          item_id: "item_chain_shirt",
          quantity: 1,
          owner_player_id: "player-equip-consistency-001",
          metadata: {}
        }
      ]
    });

    const out = processEquipRequest({
      context,
      player_id: "player-equip-consistency-001",
      item_id: "item_chain_shirt",
      slot: "body"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.equipped.slot, "body");
  }, results);

  runTest("equip_valid_shield_from_starter_items_succeeds", () => {
    const context = createContext({
      equipment_items: [
        {
          item_id: "item_shield",
          quantity: 1,
          owner_player_id: "player-equip-consistency-001",
          metadata: {}
        }
      ]
    });

    const out = processEquipRequest({
      context,
      player_id: "player-equip-consistency-001",
      item_id: "item_shield",
      slot: "off_hand"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.equipped.slot, "off_hand");
  }, results);

  runTest("equipping_consumable_fails_cleanly", () => {
    const context = createContext({
      equipment_items: [],
      stackable_items: [
        {
          item_id: "item_healing_potion",
          quantity: 2,
          owner_player_id: "player-equip-consistency-001",
          item_type: "consumable",
          metadata: {
            heal_amount: 7
          }
        }
      ]
    });

    const out = processEquipRequest({
      context,
      player_id: "player-equip-consistency-001",
      item_id: "item_healing_potion",
      slot: "main_hand"
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "consumable items cannot be equipped");
  }, results);

  runTest("invalid_slot_item_type_mismatch_fails_cleanly", () => {
    const context = createContext({
      equipment_items: [
        {
          item_id: "item_chain_mail",
          quantity: 1,
          owner_player_id: "player-equip-consistency-001",
          metadata: {}
        }
      ]
    });

    const out = processEquipRequest({
      context,
      player_id: "player-equip-consistency-001",
      item_id: "item_chain_mail",
      slot: "off_hand"
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "item cannot be equipped to requested slot");
  }, results);

  runTest("successful_unequip_flow_persists_inventory_and_character", () => {
    const context = createContext({
      equipment: {
        main_hand: "item-equip-consistency-001"
      },
      item_metadata: {
        equipped: true,
        equipped_slot: "main_hand"
      }
    });

    const out = processUnequipRequest({
      context,
      player_id: "player-equip-consistency-001",
      item_id: "item-equip-consistency-001",
      slot: "main_hand"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "player_unequip_processed");

    const savedCharacter = context.characterPersistence.getCharacter("char-equip-consistency-001");
    assert.equal(savedCharacter.equipment.main_hand, null);

    const savedInventory = context.inventoryPersistence.getInventory("inv-equip-consistency-001");
    assert.equal(savedInventory.equipment_items[0].metadata.equipped, false);
    assert.equal(savedInventory.equipment_items[0].metadata.equipped_slot, undefined);
  }, results);

  runTest("character_save_failure_rolls_back_inventory_for_equip", () => {
    const context = createContext({
      fail_character_save: true
    });
    const beforeInventory = clone(context.inventoryPersistence.getInventory("inv-equip-consistency-001"));

    const out = processEquipRequest({
      context,
      player_id: "player-equip-consistency-001",
      item_id: "item-equip-consistency-001",
      slot: "main_hand"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "player_equip_failed");

    const afterInventory = context.inventoryPersistence.getInventory("inv-equip-consistency-001");
    assert.deepEqual(afterInventory, beforeInventory);
  }, results);

  runTest("character_save_failure_rolls_back_inventory_for_unequip", () => {
    const context = createContext({
      fail_character_save: true,
      equipment: {
        main_hand: "item-equip-consistency-001"
      },
      item_metadata: {
        equipped: true,
        equipped_slot: "main_hand"
      }
    });
    const beforeInventory = clone(context.inventoryPersistence.getInventory("inv-equip-consistency-001"));

    const out = processUnequipRequest({
      context,
      player_id: "player-equip-consistency-001",
      item_id: "item-equip-consistency-001",
      slot: "main_hand"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "player_unequip_failed");

    const afterInventory = context.inventoryPersistence.getInventory("inv-equip-consistency-001");
    assert.deepEqual(afterInventory, beforeInventory);
  }, results);

  runTest("equip_flow_parity_inmemory_and_sqlite_adapters", () => {
    const memoryContext = createBridgeBackedContext("memory", {});
    const sqliteContext = createBridgeBackedContext("sqlite", {});

    const memoryOut = processEquipRequest({
      context: memoryContext,
      player_id: "player-equip-bridge-001",
      item_id: "item-equip-bridge-001",
      slot: "off_hand"
    });
    const sqliteOut = processEquipRequest({
      context: sqliteContext,
      player_id: "player-equip-bridge-001",
      item_id: "item-equip-bridge-001",
      slot: "off_hand"
    });

    assert.equal(memoryOut.ok, true);
    assert.equal(sqliteOut.ok, true);
    assert.equal(memoryOut.payload.character.equipment.off_hand, "item-equip-bridge-001");
    assert.equal(sqliteOut.payload.character.equipment.off_hand, "item-equip-bridge-001");
  }, results);

  runTest("mid_operation_character_save_failure_rolls_back_for_both_adapters", () => {
    const memoryContext = createBridgeBackedContext("memory", {
      fail_character_save: true
    });
    const sqliteContext = createBridgeBackedContext("sqlite", {
      fail_character_save: true
    });

    const beforeMemoryInventory = clone(memoryContext.inventoryPersistence.getInventory("inv-equip-bridge-001"));
    const beforeSqliteInventory = clone(sqliteContext.inventoryPersistence.getInventory("inv-equip-bridge-001"));

    const memoryOut = processEquipRequest({
      context: memoryContext,
      player_id: "player-equip-bridge-001",
      item_id: "item-equip-bridge-001",
      slot: "head"
    });
    const sqliteOut = processEquipRequest({
      context: sqliteContext,
      player_id: "player-equip-bridge-001",
      item_id: "item-equip-bridge-001",
      slot: "head"
    });

    assert.equal(memoryOut.ok, false);
    assert.equal(sqliteOut.ok, false);
    assert.equal(memoryOut.event_type, "player_equip_failed");
    assert.equal(sqliteOut.event_type, "player_equip_failed");

    const afterMemoryInventory = memoryContext.inventoryPersistence.getInventory("inv-equip-bridge-001");
    const afterSqliteInventory = sqliteContext.inventoryPersistence.getInventory("inv-equip-bridge-001");
    assert.deepEqual(afterMemoryInventory, beforeMemoryInventory);
    assert.deepEqual(afterSqliteInventory, beforeSqliteInventory);
  }, results);

  runTest("mid_operation_unequip_character_save_failure_rolls_back_for_both_adapters", () => {
    const memoryContext = createBridgeBackedContext("memory", {
      fail_character_save: true,
      equipment: {
        main_hand: "item-equip-bridge-001"
      },
      item_metadata: {
        equipped: true,
        equipped_slot: "main_hand"
      }
    });
    const sqliteContext = createBridgeBackedContext("sqlite", {
      fail_character_save: true,
      equipment: {
        main_hand: "item-equip-bridge-001"
      },
      item_metadata: {
        equipped: true,
        equipped_slot: "main_hand"
      }
    });

    const beforeMemoryInventory = clone(memoryContext.inventoryPersistence.getInventory("inv-equip-bridge-001"));
    const beforeSqliteInventory = clone(sqliteContext.inventoryPersistence.getInventory("inv-equip-bridge-001"));

    const memoryOut = processUnequipRequest({
      context: memoryContext,
      player_id: "player-equip-bridge-001",
      item_id: "item-equip-bridge-001",
      slot: "main_hand"
    });
    const sqliteOut = processUnequipRequest({
      context: sqliteContext,
      player_id: "player-equip-bridge-001",
      item_id: "item-equip-bridge-001",
      slot: "main_hand"
    });

    assert.equal(memoryOut.ok, false);
    assert.equal(sqliteOut.ok, false);
    assert.equal(memoryOut.event_type, "player_unequip_failed");
    assert.equal(sqliteOut.event_type, "player_unequip_failed");

    const afterMemoryInventory = memoryContext.inventoryPersistence.getInventory("inv-equip-bridge-001");
    const afterSqliteInventory = sqliteContext.inventoryPersistence.getInventory("inv-equip-bridge-001");
    assert.deepEqual(afterMemoryInventory, beforeMemoryInventory);
    assert.deepEqual(afterSqliteInventory, beforeSqliteInventory);
  }, results);

  runTest("equipped_metadata_survives_persistence_reload", () => {
    const memoryContext = createBridgeBackedContext("memory", {
      equipment_items: [
        {
          item_id: "item_longsword",
          quantity: 1,
          owner_player_id: "player-equip-bridge-001",
          metadata: {}
        }
      ]
    });
    const sqliteContext = createBridgeBackedContext("sqlite", {
      equipment_items: [
        {
          item_id: "item_longsword",
          quantity: 1,
          owner_player_id: "player-equip-bridge-001",
          metadata: {}
        }
      ]
    });

    const memoryOut = processEquipRequest({
      context: memoryContext,
      player_id: "player-equip-bridge-001",
      item_id: "item_longsword",
      slot: "main_hand"
    });
    const sqliteOut = processEquipRequest({
      context: sqliteContext,
      player_id: "player-equip-bridge-001",
      item_id: "item_longsword",
      slot: "main_hand"
    });

    assert.equal(memoryOut.ok, true);
    assert.equal(sqliteOut.ok, true);

    const memoryCharacter = memoryContext.characterPersistence.getCharacter("char-equip-bridge-001");
    const sqliteCharacter = sqliteContext.characterPersistence.getCharacter("char-equip-bridge-001");
    const memoryInventory = memoryContext.inventoryPersistence.getInventory("inv-equip-bridge-001");
    const sqliteInventory = sqliteContext.inventoryPersistence.getInventory("inv-equip-bridge-001");

    assert.equal(memoryCharacter.equipped_item_profiles.main_hand.item_id, "item_longsword");
    assert.equal(sqliteCharacter.equipped_item_profiles.main_hand.item_id, "item_longsword");
    assert.equal(memoryInventory.equipment_items[0].metadata.equipment_profile.item_id, "item_longsword");
    assert.equal(sqliteInventory.equipment_items[0].metadata.equipment_profile.item_id, "item_longsword");
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
  const summary = runProcessEquipmentRequestConsistencyTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runProcessEquipmentRequestConsistencyTests
};
