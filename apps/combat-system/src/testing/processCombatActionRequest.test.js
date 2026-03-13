"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { startCombat } = require("../flow/startCombat");
const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { createSqliteAdapter } = require("../../../database/src/adapters/sqliteAdapter");
const { InventoryPersistenceBridge } = require("../../../inventory-system/src/inventory.persistence");
const { createInventoryRecord } = require("../../../inventory-system/src/inventory.schema");
const {
  processCombatAttackRequest,
  processCombatUseItemRequest,
  processCombatMoveRequest
} = require("../flow/processCombatActionRequest");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createSpellProvider(spells) {
  const entries = Array.isArray(spells) ? JSON.parse(JSON.stringify(spells)) : [];
  return function provideSpells() {
    return {
      ok: true,
      payload: {
        spells: JSON.parse(JSON.stringify(entries))
      }
    };
  };
}

function createMoveRequestContext(combatManager, overrides) {
  return Object.assign({
    combatManager,
    opportunityAttackAttackRollFn: () => 18,
    opportunityAttackDamageRollFn: () => 3,
    aiMonsterAttackRollFn: () => 1,
    aiMonsterDamageRollFn: () => 3
  }, overrides || {});
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

function createCombatReadyForUse(combatId, playerId) {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: combatId,
    status: "pending"
  });

  manager.addParticipant({
    combat_id: combatId,
    participant: {
      participant_id: playerId,
      name: "Use Hero",
      team: "heroes",
      armor_class: 12,
      current_hp: 5,
      max_hp: 10,
      attack_bonus: 3,
      damage: 4,
      position: { x: 0, y: 0 }
    }
  });
  manager.addParticipant({
    combat_id: combatId,
    participant: {
      participant_id: "enemy-use-001",
      name: "Use Goblin",
      team: "monsters",
      armor_class: 10,
      current_hp: 8,
      max_hp: 8,
      attack_bonus: 2,
      damage: 3,
      position: { x: 1, y: 0 }
    }
  });

  startCombat({
    combatManager: manager,
    combat_id: combatId,
    roll_function: (participant) => (participant.participant_id === playerId ? 20 : 1)
  });

  return manager;
}

function createCombatReadyForMove(combatId, playerId, options) {
  const cfg = options || {};
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: combatId,
    status: cfg.status || "pending"
  });

  manager.addParticipant({
    combat_id: combatId,
    participant: {
      participant_id: playerId,
      name: "Move Hero",
      team: "heroes",
      armor_class: 12,
      current_hp: cfg.mover_hp === undefined ? 10 : cfg.mover_hp,
      max_hp: 10,
      attack_bonus: 3,
      damage: 4,
      position: cfg.mover_position || { x: 1, y: 1 },
      metadata: { owner_player_id: playerId },
      reaction_available: true
    }
  });
  manager.addParticipant({
    combat_id: combatId,
    participant: {
      participant_id: "enemy-reactor-001",
      name: "Enemy Reactor",
      team: "monsters",
      armor_class: 11,
      current_hp: cfg.reactor_hp === undefined ? 10 : cfg.reactor_hp,
      max_hp: 10,
      attack_bonus: 2,
      damage: 3,
      position: cfg.reactor_position || { x: 2, y: 1 },
      reaction_available: cfg.reactor_reaction_available === undefined ? true : cfg.reactor_reaction_available
    }
  });
  manager.addParticipant({
    combat_id: combatId,
    participant: {
      participant_id: "enemy-other-001",
      name: "Enemy Other",
      team: "monsters",
      armor_class: 11,
      current_hp: 10,
      max_hp: 10,
      attack_bonus: 2,
      damage: 3,
      position: { x: 4, y: 4 },
      reaction_available: true
    }
  });

  startCombat({
    combatManager: manager,
    combat_id: combatId,
    roll_function: (participant) => (participant.participant_id === playerId ? 20 : 1)
  });

  const loaded = manager.getCombatById(combatId);
  const combat = loaded.payload.combat;
  if (Array.isArray(cfg.conditions)) {
    combat.conditions = JSON.parse(JSON.stringify(cfg.conditions));
  }
  manager.combats.set(combatId, combat);
  return manager;
}

function createInventoryPersistence(options) {
  const cfg = options || {};
  const byId = new Map();
  let saveCalls = 0;
  const inventory = createInventoryRecord({
    inventory_id: cfg.inventory_id || "inv-combat-use-001",
    owner_type: "player",
    owner_id: cfg.player_id || "player-combat-use-001",
    stackable_items: [
      {
        item_id: "potion-heal-combat-001",
        item_type: "consumable",
        quantity: 1,
        owner_player_id: cfg.omit_owner_player_id ? undefined : (cfg.player_id || "player-combat-use-001"),
        metadata: {
          heal_amount: 4
        }
      }
    ],
    owner_id: cfg.inventory_owner_id === undefined ? (cfg.player_id || "player-combat-use-001") : cfg.inventory_owner_id
  });
  byId.set(String(inventory.inventory_id), JSON.parse(JSON.stringify(inventory)));

  return {
    listInventories() {
      return {
        ok: true,
        payload: {
          inventories: Array.from(byId.values()).map((x) => JSON.parse(JSON.stringify(x)))
        }
      };
    },
    saveInventory(nextInventory) {
      saveCalls += 1;
      if (cfg.fail_save === true) {
        return {
          ok: false,
          error: "forced inventory save failure"
        };
      }
      if (Array.isArray(cfg.fail_on_save_calls) && cfg.fail_on_save_calls.includes(saveCalls)) {
        return {
          ok: false,
          error: "forced inventory save failure on call " + saveCalls
        };
      }
      byId.set(String(nextInventory.inventory_id), JSON.parse(JSON.stringify(nextInventory)));
      return {
        ok: true,
        payload: {
          inventory: JSON.parse(JSON.stringify(nextInventory))
        }
      };
    },
    getCurrentInventory() {
      const first = Array.from(byId.values())[0];
      return first ? JSON.parse(JSON.stringify(first)) : null;
    },
    getSaveCalls() {
      return saveCalls;
    }
  };
}

function createBridgeInventoryPersistence(options) {
  const cfg = options || {};
  const adapter =
    cfg.adapter_type === "sqlite"
      ? createSqliteAdapter({ db: new FakeSqliteDb(), databasePath: "combat-use.sqlite" })
      : createInMemoryAdapter();
  const bridge = new InventoryPersistenceBridge({ adapter });
  const inventory = createInventoryRecord({
    inventory_id: cfg.inventory_id || "inv-combat-bridge-001",
    owner_type: "player",
    owner_id: cfg.player_id || "player-combat-bridge-001",
    stackable_items: [
      {
        item_id: "potion-heal-combat-001",
        item_type: "consumable",
        quantity: 1,
        owner_player_id: cfg.player_id || "player-combat-bridge-001",
        metadata: {
          heal_amount: 4
        }
      }
    ]
  });
  bridge.saveInventory(inventory);

  return {
    listInventories: bridge.listInventories.bind(bridge),
    saveInventory: bridge.saveInventory.bind(bridge),
    getCurrentInventory() {
      const listed = bridge.listInventories();
      const inventories = listed.ok ? listed.payload.inventories : [];
      return inventories.length > 0 ? JSON.parse(JSON.stringify(inventories[0])) : null;
    }
  };
}

function runProcessCombatActionRequestTests() {
  const results = [];

  runTest("combat_use_item_success_consumes_inventory_then_applies_combat_effect", () => {
    const playerId = "player-combat-use-ok-001";
    const combatId = "combat-use-ok-001";
    const manager = createCombatReadyForUse(combatId, playerId);
    const inventoryPersistence = createInventoryPersistence({
      inventory_id: "inv-combat-use-ok-001",
      player_id: playerId
    });

    const out = processCombatUseItemRequest({
      context: {
        combatManager: manager,
        inventoryPersistence,
        aiMonsterAttackRollFn: () => 18,
        aiMonsterDamageRollFn: () => 3
      },
      player_id: playerId,
      combat_id: combatId,
      payload: {
        item_id: "potion-heal-combat-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "player_use_item_processed");
    assert.equal(Array.isArray(out.payload.progression.ai_turns), true);
    assert.equal(out.payload.progression.ai_turns.length, 1);

    const combatAfter = manager.getCombatById(combatId);
    assert.equal(combatAfter.ok, true);
    const actor = combatAfter.payload.combat.participants.find((x) => x.participant_id === playerId);
    assert.equal(actor.current_hp, 6);
    assert.equal(typeof combatAfter.payload.combat.battlefield_grid, "object");
    assert.equal(Number.isFinite(combatAfter.payload.combat.battlefield_grid.width), true);

    const inventoryAfter = inventoryPersistence.getCurrentInventory();
    assert.equal(Array.isArray(inventoryAfter.stackable_items), true);
    assert.equal(inventoryAfter.stackable_items.length, 0);
    assert.equal(out.payload.render && out.payload.render.combat_id === combatId, true);
    assert.equal(Array.isArray(out.payload.render.layer_order), true);
  }, results);

  runTest("combat_use_item_inventory_save_failure_keeps_combat_state_unchanged", () => {
    const playerId = "player-combat-use-fail-001";
    const combatId = "combat-use-fail-001";
    const manager = createCombatReadyForUse(combatId, playerId);
    const inventoryPersistence = createInventoryPersistence({
      inventory_id: "inv-combat-use-fail-001",
      player_id: playerId,
      fail_save: true
    });

    const before = manager.getCombatById(combatId);
    assert.equal(before.ok, true);
    const beforeCombat = JSON.parse(JSON.stringify(before.payload.combat));

    const out = processCombatUseItemRequest({
      context: {
        combatManager: manager,
        inventoryPersistence
      },
      player_id: playerId,
      combat_id: combatId,
      payload: {
        item_id: "potion-heal-combat-001"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "player_use_item_failed");

    const after = manager.getCombatById(combatId);
    assert.equal(after.ok, true);
    assert.deepEqual(after.payload.combat.participants, beforeCombat.participants);
    assert.deepEqual(after.payload.combat.event_log, beforeCombat.event_log);
  }, results);

  runTest("combat_use_item_snapshot_persist_failure_rolls_back_inventory_and_combat_state", () => {
    const playerId = "player-combat-use-snapshot-fail-001";
    const combatId = "combat-use-snapshot-fail-001";
    const manager = createCombatReadyForUse(combatId, playerId);
    const inventoryPersistence = createInventoryPersistence({
      inventory_id: "inv-combat-use-snapshot-fail-001",
      player_id: playerId
    });

    const before = manager.getCombatById(combatId);
    assert.equal(before.ok, true);
    const beforeCombat = JSON.parse(JSON.stringify(before.payload.combat));
    const beforeInventory = inventoryPersistence.getCurrentInventory();

    const out = processCombatUseItemRequest({
      context: {
        combatManager: manager,
        inventoryPersistence,
        combatPersistence: {
          saveCombatSnapshot() {
            return {
              ok: false,
              error: "forced combat snapshot failure"
            };
          }
        }
      },
      player_id: playerId,
      combat_id: combatId,
      payload: {
        item_id: "potion-heal-combat-001"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "player_use_item_failed");

    const after = manager.getCombatById(combatId);
    assert.equal(after.ok, true);
    assert.deepEqual(after.payload.combat.participants, beforeCombat.participants);
    assert.deepEqual(after.payload.combat.event_log, beforeCombat.event_log);

    const afterInventory = inventoryPersistence.getCurrentInventory();
    assert.deepEqual(afterInventory, beforeInventory);
  }, results);

  runTest("combat_use_item_snapshot_persist_failure_with_inventory_rollback_failure_reports_partial_commit", () => {
    const playerId = "player-combat-use-rollback-fail-001";
    const combatId = "combat-use-rollback-fail-001";
    const manager = createCombatReadyForUse(combatId, playerId);
    const inventoryPersistence = createInventoryPersistence({
      inventory_id: "inv-combat-use-rollback-fail-001",
      player_id: playerId,
      fail_on_save_calls: [2]
    });

    const out = processCombatUseItemRequest({
      context: {
        combatManager: manager,
        inventoryPersistence,
        combatPersistence: {
          saveCombatSnapshot() {
            return {
              ok: false,
              error: "forced combat snapshot failure"
            };
          }
        }
      },
      player_id: playerId,
      combat_id: combatId,
      payload: {
        item_id: "potion-heal-combat-001"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "player_use_item_failed");
    assert.equal(out.payload.partial_commit, true);
    assert.equal(inventoryPersistence.getSaveCalls() >= 2, true);
  }, results);

  runTest("combat_use_item_rejects_missing_ownership_metadata", () => {
    const playerId = "player-combat-use-owner-001";
    const combatId = "combat-use-owner-001";
    const manager = createCombatReadyForUse(combatId, playerId);
    const inventoryPersistence = createInventoryPersistence({
      inventory_id: "inv-combat-use-owner-001",
      player_id: playerId,
      omit_owner_player_id: true,
      inventory_owner_id: null
    });

    const out = processCombatUseItemRequest({
      context: {
        combatManager: manager,
        inventoryPersistence
      },
      player_id: playerId,
      combat_id: combatId,
      payload: {
        item_id: "potion-heal-combat-001"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "player_use_item_failed");
  }, results);

  runTest("combat_use_item_rejects_actor_control_for_other_players", () => {
    const leaderId = "player-combat-owner-leader-001";
    const memberId = "player-combat-owner-member-001";
    const combatId = "combat-owner-guard-001";
    const manager = new CombatManager();
    manager.createCombat({
      combat_id: combatId,
      status: "pending"
    });
    manager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: leaderId,
        name: "Leader",
        team: "heroes",
        armor_class: 12,
        current_hp: 8,
        max_hp: 10,
        attack_bonus: 3,
        damage: 4,
        position: { x: 0, y: 0 },
        metadata: { owner_player_id: leaderId }
      }
    });
    manager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: memberId,
        name: "Member",
        team: "heroes",
        armor_class: 12,
        current_hp: 8,
        max_hp: 10,
        attack_bonus: 3,
        damage: 4,
        position: { x: 1, y: 0 },
        metadata: { owner_player_id: memberId }
      }
    });
    manager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "enemy-owner-guard-001",
        name: "Enemy",
        team: "monsters",
        armor_class: 10,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 3,
        position: { x: 2, y: 0 }
      }
    });
    startCombat({
      combatManager: manager,
      combat_id: combatId,
      roll_function: (participant) => (participant.participant_id === memberId ? 20 : 1)
    });

    const inventoryPersistence = createInventoryPersistence({
      inventory_id: "inv-owner-guard-001",
      player_id: memberId
    });

    const out = processCombatUseItemRequest({
      context: {
        combatManager: manager,
        inventoryPersistence
      },
      player_id: memberId,
      combat_id: combatId,
      payload: {
        actor_id: leaderId,
        item_id: "potion-heal-combat-001"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "player_use_item_failed");
    assert.equal(out.error, "player is not authorized to control this combat participant");
  }, results);

  runTest("combat_spell_like_payload_without_supported_item_id_fails_safely", () => {
    const playerId = "player-combat-use-spell-001";
    const combatId = "combat-use-spell-001";
    const manager = createCombatReadyForUse(combatId, playerId);
    const inventoryPersistence = createInventoryPersistence({
      inventory_id: "inv-combat-use-spell-001",
      player_id: playerId
    });

    const out = processCombatUseItemRequest({
      context: {
        combatManager: manager,
        inventoryPersistence
      },
      player_id: playerId,
      combat_id: combatId,
      payload: {
        ability_id: "magic_missile"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "player_use_item_failed");
    assert.equal(out.error, "item_id is required");
  }, results);

  runTest("combat_use_item_rejects_malformed_non_object_payload", () => {
    const playerId = "player-combat-use-malformed-001";
    const combatId = "combat-use-malformed-001";
    const manager = createCombatReadyForUse(combatId, playerId);
    const inventoryPersistence = createInventoryPersistence({
      inventory_id: "inv-combat-use-malformed-001",
      player_id: playerId
    });

    const out = processCombatUseItemRequest({
      context: {
        combatManager: manager,
        inventoryPersistence
      },
      player_id: playerId,
      combat_id: combatId,
      payload: "invalid-payload"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "player_use_item_failed");
    assert.equal(out.error, "payload must be an object");
  }, results);

  runTest("combat_use_item_render_failure_is_non_fatal_for_state_updates", () => {
    const playerId = "player-combat-use-render-fail-001";
    const combatId = "combat-use-render-fail-001";
    const manager = createCombatReadyForUse(combatId, playerId);
    const loaded = manager.getCombatById(combatId);
    const combat = loaded.payload.combat;
    const actor = combat.participants.find((p) => p.participant_id === playerId);
    actor.position = { x: 999, y: 999 };
    manager.combats.set(combatId, combat);

    const inventoryPersistence = createInventoryPersistence({
      inventory_id: "inv-combat-use-render-fail-001",
      player_id: playerId
    });

    const out = processCombatUseItemRequest({
      context: {
        combatManager: manager,
        inventoryPersistence
      },
      player_id: playerId,
      combat_id: combatId,
      payload: {
        item_id: "potion-heal-combat-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "player_use_item_processed");
    assert.equal(out.payload.render, null);
    assert.equal(typeof out.payload.render_error, "string");
  }, results);

  runTest("combat_use_item_parity_inmemory_vs_sqlite_inventory_persistence", () => {
    const playerId = "player-combat-use-parity-001";
    const memoryCombatId = "combat-use-parity-memory-001";
    const sqliteCombatId = "combat-use-parity-sqlite-001";
    const memoryManager = createCombatReadyForUse(memoryCombatId, playerId);
    const sqliteManager = createCombatReadyForUse(sqliteCombatId, playerId);
    const memoryInventoryPersistence = createBridgeInventoryPersistence({
      adapter_type: "memory",
      inventory_id: "inv-combat-use-parity-memory-001",
      player_id: playerId
    });
    const sqliteInventoryPersistence = createBridgeInventoryPersistence({
      adapter_type: "sqlite",
      inventory_id: "inv-combat-use-parity-sqlite-001",
      player_id: playerId
    });

    const memoryOut = processCombatUseItemRequest({
      context: {
        combatManager: memoryManager,
        inventoryPersistence: memoryInventoryPersistence
      },
      player_id: playerId,
      combat_id: memoryCombatId,
      payload: {
        item_id: "potion-heal-combat-001"
      }
    });
    const sqliteOut = processCombatUseItemRequest({
      context: {
        combatManager: sqliteManager,
        inventoryPersistence: sqliteInventoryPersistence
      },
      player_id: playerId,
      combat_id: sqliteCombatId,
      payload: {
        item_id: "potion-heal-combat-001"
      }
    });

    assert.equal(memoryOut.ok, true);
    assert.equal(sqliteOut.ok, true);
    assert.equal(memoryOut.event_type, sqliteOut.event_type);

    const memoryInventory = memoryInventoryPersistence.getCurrentInventory();
    const sqliteInventory = sqliteInventoryPersistence.getCurrentInventory();
    assert.deepEqual(memoryInventory.stackable_items, sqliteInventory.stackable_items);
  }, results);

  runTest("movement_out_of_threatened_range_triggers_opportunity_attack", () => {
    const playerId = "player-combat-move-oa-001";
    const combatId = "combat-move-oa-001";
    const manager = createCombatReadyForMove(combatId, playerId);

    const out = processCombatMoveRequest({
      context: createMoveRequestContext(manager),
      player_id: playerId,
      combat_id: combatId,
      payload: {
        target_x: 0,
        target_y: 1
      }
    });

    assert.equal(out.ok, true);
    assert.equal(Array.isArray(out.payload.reactions.opportunity_attacks), true);
    assert.equal(out.payload.reactions.opportunity_attacks.length, 1);
    assert.equal(out.payload.reactions.opportunity_attacks[0].reactor_participant_id, "enemy-reactor-001");
    assert.equal(out.payload.progression.ai_turns.length, 2);

    const loaded = manager.getCombatById(combatId);
    const reactor = loaded.payload.combat.participants.find((entry) => entry.participant_id === "enemy-reactor-001");
    const mover = loaded.payload.combat.participants.find((entry) => entry.participant_id === playerId);
    assert.equal(reactor.reaction_available, true);
    assert.equal(mover.current_hp, 7);
  }, results);

  runTest("invalid_movement_does_not_trigger_opportunity_attack", () => {
    const playerId = "player-combat-move-invalid-001";
    const combatId = "combat-move-invalid-001";
    const manager = createCombatReadyForMove(combatId, playerId);

    const out = processCombatMoveRequest({
      context: createMoveRequestContext(manager),
      player_id: playerId,
      combat_id: combatId,
      payload: {
        target_x: 2,
        target_y: 1
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "target tile is occupied");

    const loaded = manager.getCombatById(combatId);
    const reactor = loaded.payload.combat.participants.find((entry) => entry.participant_id === "enemy-reactor-001");
    assert.equal(reactor.reaction_available, true);
  }, results);

  runTest("no_opportunity_attack_if_reactor_has_no_reaction", () => {
    const playerId = "player-combat-move-no-reaction-001";
    const combatId = "combat-move-no-reaction-001";
    const manager = createCombatReadyForMove(combatId, playerId, {
      reactor_reaction_available: false
    });

    const out = processCombatMoveRequest({
      context: createMoveRequestContext(manager),
      player_id: playerId,
      combat_id: combatId,
      payload: {
        target_x: 0,
        target_y: 1
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.reactions.opportunity_attacks.length, 0);
  }, results);

  runTest("targeted_opportunity_attack_immunity_blocks_only_the_marked_reactor", () => {
    const playerId = "player-combat-move-mobile-001";
    const combatId = "combat-move-mobile-001";
    const manager = createCombatReadyForMove(combatId, playerId, {
      conditions: [
        {
          condition_id: "condition-mobile-001",
          condition_type: "opportunity_attack_immunity",
          source_actor_id: playerId,
          target_actor_id: playerId,
          expiration_trigger: "start_of_turn",
          metadata: {
            source: "mobile_feat",
            blocked_reactor_id: "enemy-reactor-001"
          }
        }
      ]
    });

    const out = processCombatMoveRequest({
      context: createMoveRequestContext(manager),
      player_id: playerId,
      combat_id: combatId,
      payload: {
        target_x: 0,
        target_y: 1
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.reactions.opportunity_attacks.length, 0);
  }, results);

  runTest("war_caster_can_replace_opportunity_attack_with_single_target_spell", () => {
    const playerId = "player-combat-move-war-caster-001";
    const combatId = "combat-move-war-caster-001";
    const manager = createCombatReadyForMove(combatId, playerId);
    const loaded = manager.getCombatById(combatId);
    const combat = loaded.payload.combat;
    const reactor = combat.participants.find((entry) => entry.participant_id === "enemy-reactor-001");
    reactor.spellbook = {
      known_spell_ids: ["shocking_grasp"]
    };
    reactor.spellcasting_ability = "charisma";
    reactor.spell_attack_bonus = 5;
    reactor.feat_flags = {
      war_caster: true
    };
    reactor.stats = {
      charisma: 16
    };
    manager.combats.set(combatId, combat);

    const out = processCombatMoveRequest({
      context: createMoveRequestContext(manager, {
        loadContentBundle: createSpellProvider([{
          spell_id: "shocking_grasp",
          name: "Shocking Grasp",
          casting_time: "1 action",
          range: "5 feet",
          targeting: { type: "single_target" },
          attack_or_save: { type: "spell_attack" },
          damage: { dice: "1d8", damage_type: "lightning" },
          effect: { status_hint: "no_reaction_until_next_turn" }
        }]),
        warCasterOpportunitySpellSelector() {
          return "shocking_grasp";
        },
        spellAttackRollFn: () => ({ final_total: 18 }),
        opportunityAttackDamageRollFn: () => 0
      }),
      player_id: playerId,
      combat_id: combatId,
      payload: {
        target_x: 0,
        target_y: 1
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.reactions.opportunity_attacks.length, 1);
    assert.equal(out.payload.reactions.opportunity_attacks[0].resolution_kind, "spell");
    assert.equal(out.payload.reactions.opportunity_attacks[0].spell_id, "shocking_grasp");

    const updated = manager.getCombatById(combatId).payload.combat;
    const updatedReactor = updated.participants.find((entry) => entry.participant_id === "enemy-reactor-001");
    const mover = updated.participants.find((entry) => entry.participant_id === playerId);
    assert.equal(updatedReactor.reaction_available, true);
    assert.equal(mover.current_hp, 9);
    assert.equal(updated.event_log.some((entry) => entry.event_type === "cast_spell_action" && entry.war_caster_reaction === true), true);
  }, results);

  runTest("no_opportunity_attack_from_dead_or_stunned_reactor", () => {
    const playerId = "player-combat-move-dead-reactor-001";
    const combatId = "combat-move-dead-reactor-001";
    const manager = createCombatReadyForMove(combatId, playerId, {
      reactor_hp: 0,
      conditions: [
        {
          condition_id: "condition-reactor-stunned-001",
          condition_type: "stunned",
          target_actor_id: "enemy-reactor-001",
          expiration_trigger: "manual"
        }
      ]
    });

    const out = processCombatMoveRequest({
      context: createMoveRequestContext(manager),
      player_id: playerId,
      combat_id: combatId,
      payload: {
        target_x: 0,
        target_y: 1
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.reactions.opportunity_attacks.length, 0);
  }, results);

  runTest("no_duplicate_opportunity_attacks_from_same_trigger_path", () => {
    const playerId = "player-combat-move-duplicate-001";
    const combatId = "combat-move-duplicate-001";
    const manager = createCombatReadyForMove(combatId, playerId);

    const out = processCombatMoveRequest({
      context: createMoveRequestContext(manager),
      player_id: playerId,
      combat_id: combatId,
      payload: {
        target_x: 0,
        target_y: 1
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.reactions.opportunity_attacks.length, 1);
    const opportunityEvents = out.payload.move.combat.event_log.filter((entry) => entry.event_type === "opportunity_attack");
    assert.equal(opportunityEvents.length, 1);
  }, results);

  runTest("ended_combat_rejects_new_opportunity_attack_processing", () => {
    const playerId = "player-combat-move-ended-001";
    const combatId = "combat-move-ended-001";
    const manager = createCombatReadyForMove(combatId, playerId, {
      status: "pending"
    });
    const loaded = manager.getCombatById(combatId);
    const combat = loaded.payload.combat;
    combat.status = "complete";
    manager.combats.set(combatId, combat);

    const out = processCombatMoveRequest({
      context: createMoveRequestContext(manager),
      player_id: playerId,
      combat_id: combatId,
      payload: {
        target_x: 0,
        target_y: 1
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "combat is not active");
  }, results);

  runTest("player_attack_request_advances_turn_and_runs_enemy_ai", () => {
    const playerId = "player-combat-attack-ai-001";
    const combatId = "combat-attack-ai-001";
    const manager = new CombatManager();
    manager.createCombat({
      combat_id: combatId,
      status: "pending"
    });
    manager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: playerId,
        name: "Hero",
        team: "heroes",
        armor_class: 12,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 4,
        damage: 2,
        position: { x: 0, y: 0 },
        metadata: { owner_player_id: playerId }
      }
    });
    manager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "monster-attack-ai-001",
        name: "Monster",
        team: "monsters",
        armor_class: 10,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 3,
        damage: 3,
        position: { x: 1, y: 0 }
      }
    });
    startCombat({
      combatManager: manager,
      combat_id: combatId,
      roll_function: (participant) => (participant.participant_id === playerId ? 20 : 1)
    });

    const out = processCombatAttackRequest({
      context: {
        combatManager: manager,
        aiMonsterAttackRollFn: () => 18,
        aiMonsterDamageRollFn: () => 3
      },
      player_id: playerId,
      combat_id: combatId,
      payload: {
        target_id: "monster-attack-ai-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.progression.ai_turns.length, 1);
    const loaded = manager.getCombatById(combatId);
    const combat = loaded.payload.combat;
    assert.equal(combat.initiative_order[combat.turn_index], playerId);
    const hero = combat.participants.find((entry) => entry.participant_id === playerId);
    assert.equal(hero.current_hp, 7);
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
  const summary = runProcessCombatActionRequestTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runProcessCombatActionRequestTests
};
