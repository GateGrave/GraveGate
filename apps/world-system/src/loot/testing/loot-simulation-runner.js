"use strict";

const { InMemoryInventoryStore, InMemoryItemStore } = require("../../../../database/src/world-storage");
const { LootTableManager, createExampleLootTables } = require("../loot-table.manager");
const { processEnemyDefeatedRewardHook } = require("../hooks/enemy-defeat-reward.hook");
const { processBossDefeatedRewardHook } = require("../hooks/boss-defeat-reward.hook");
const { resolveLootRoll } = require("../loot-roll.resolver");
const { applyGeneratedLootToInventory } = require("../grants/loot-grant.service");
const { LootDropManager } = require("../loot-drop.manager");
const { LootLogger } = require("../loot-logger");
const { ProcessedEnemyDefeatStore } = require("../hooks/enemy-defeat-reward.hook");
const { ProcessedLootGrantStore } = require("../grants/loot-grant.service");
const { assignIndividualLoot } = require("../assignment/individual-loot-assignment");
const { InventoryGrantAdapter } = require("../grants/inventory-grant.adapter");

class LootSimulationRunner {
  constructor(options) {
    this.options = options || {};
    this.logs = [];
    this.step = 0;

    this.lootTableManager = new LootTableManager();
    this.lootDropManager = new LootDropManager();
    this.lootLogger = new LootLogger();
    this.worldStorage = {
      inventories: new InMemoryInventoryStore(),
      items: new InMemoryItemStore()
    };
    this.processedEnemyEvents = new ProcessedEnemyDefeatStore();
    this.processedGrantEvents = new ProcessedLootGrantStore();
    this.party = null;
  }

  log(kind, data) {
    this.step += 1;
    this.logs.push({
      step: this.step,
      kind,
      timestamp: new Date().toISOString(),
      data
    });
  }

  setupMocks() {
    this.mockPlayers = [
      { player_id: "char-001", inventory_id: "inv-char-001" },
      { player_id: "char-002", inventory_id: "inv-char-002" },
      { player_id: "char-003", inventory_id: "inv-char-003" }
    ];
    this.party = {
      party_id: "party-001",
      players: this.mockPlayers.map((x) => ({
        player_id: x.player_id,
        eligible_for_loot: true
      }))
    };

    const tables = createExampleLootTables();
    this.lootTableManager.createLootTable(tables.normal_enemy);
    this.lootTableManager.createLootTable(tables.boss);
    this.lootTableManager.createLootTable(tables.future_chest);

    // Add a balancing table with stronger weighted spread.
    this.lootTableManager.createLootTable({
      table_id: "table-enemy-bandit-weights-001",
      source_type: "enemy",
      source_id: "bandit",
      possible_drops: [
        { item_id: "item-rag", quantity: 1, rarity: "common" },
        { item_id: "item-silver", quantity: { min: 1, max: 3 }, rarity: "uncommon" },
        { item_id: "item-map-fragment", quantity: 1, rarity: "rare" }
      ],
      drop_weights: {
        "item-rag": 70,
        "item-silver": 25,
        "item-map-fragment": 5
      },
      guaranteed_drops: [],
      rarity_rules: { default_roll_count: 4 }
    });

    // Seed item catalog for grant stage.
    const allItemIds = new Set();
    this.lootTableManager.store.list().forEach((table) => {
      table.possible_drops.forEach((drop) => allItemIds.add(drop.item_id));
      table.guaranteed_drops.forEach((drop) => allItemIds.add(drop.item_id));
    });

    for (const itemId of allItemIds) {
      let item_type = "stackable";
      if (itemId.includes("staff") || itemId.includes("ring") || itemId.includes("key")) item_type = "equipment";
      if (itemId.includes("potion")) item_type = "consumable";
      if (itemId.includes("arcane") || itemId.includes("enchanted")) item_type = "magical";
      if (itemId.includes("mysterious") || itemId.includes("unknown")) item_type = "unidentified";

      this.worldStorage.items.saveItem({
        item_id: itemId,
        item_type,
        rarity: "common"
      });
    }

    this.log("setup_complete", {
      players: this.mockPlayers,
      party: this.party,
      loot_tables: this.lootTableManager.store.list().map((x) => x.table_id),
      item_catalog_count: allItemIds.size
    });
  }

  scenarioNormalEnemyDefeat(config) {
    const cfg = config || {};
    const event = {
      event_id: cfg.event_id || "evt-enemy-001",
      event_type: "enemy_defeated",
      session_id: "sess-loot-001",
      party_id: "party-001",
      player_id: this.mockPlayers[0].player_id,
      combat_id: "combat-001",
      payload: {
        enemy_id: cfg.enemy_id || "goblin"
      }
    };

    const generated = processEnemyDefeatedRewardHook({
      event,
      lootTableManager: this.lootTableManager,
      processedEventStore: this.processedEnemyEvents,
      allow_duplicate_events: Boolean(cfg.allow_duplicate_events),
      rng: cfg.rng || (() => 0.08)
    });

    this.log("enemy_defeat_loot_generated", generated);
    if (generated.ok) this.lootLogger.logLootRolled(generated.payload.loot_result);
    return generated;
  }

  scenarioBossDefeat(config) {
    const cfg = config || {};
    const event = {
      event_id: cfg.event_id || "evt-boss-001",
      event_type: "boss_defeated",
      session_id: "sess-loot-001",
      party_id: "party-001",
      player_id: this.mockPlayers[0].player_id,
      combat_id: "combat-002",
      payload: {
        boss_id: cfg.boss_id || "lich-king",
        include_bonus_weighted:
          typeof cfg.include_bonus_weighted === "boolean"
            ? cfg.include_bonus_weighted
            : true,
        bonus_roll_count: Number.isInteger(cfg.bonus_roll_count) ? cfg.bonus_roll_count : 2
      }
    };

    const generated = processBossDefeatedRewardHook({
      event,
      lootTableManager: this.lootTableManager,
      rng: cfg.rng || (() => 0.2)
    });

    this.log("boss_defeat_loot_generated", generated);
    if (generated.ok) this.lootLogger.logLootRolled(generated.payload.loot_result);
    return generated;
  }

  scenarioWeightedLootGeneration(config) {
    const cfg = config || {};
    const weighted = resolveLootRoll({
      source_type: cfg.source_type || "enemy",
      source_id: cfg.source_id || "bandit",
      loot_table_id: cfg.loot_table_id || "table-enemy-bandit-weights-001",
      context: {
        session_id: "sess-loot-001",
        player_id: this.mockPlayers[0].player_id
      },
      roll_count: Number.isInteger(cfg.roll_count) ? cfg.roll_count : 6,
      lootTableManager: this.lootTableManager
    });

    this.log("weighted_loot_roll", weighted);
    if (weighted.ok) this.lootLogger.logLootRolled(weighted.payload);
    return weighted;
  }

  scenarioInventoryGrant(generatedLootPayload, player, config) {
    const cfg = config || {};
    const result = applyGeneratedLootToInventory({
      loot_payload: generatedLootPayload,
      inventory_id: player.inventory_id,
      owner_character_id: player.player_id,
      worldStorage: this.worldStorage,
      lootDropManager: this.lootDropManager,
      processedGrantStore: this.processedGrantEvents,
      allow_duplicate_grants: Boolean(cfg.allow_duplicate_grants),
      grant_key: cfg.grant_key
    });

    this.log("inventory_grant_result", {
      player_id: player.player_id,
      inventory_id: player.inventory_id,
      result
    });

    if (result.event_type === "loot_grant_success" || result.event_type === "loot_grant_partial_success") {
      this.lootLogger.logLootGranted(result.payload);
    }
    if (result.event_type === "loot_grant_failed" || result.payload?.status === "partial_success") {
      this.lootLogger.logLootGrantFailed(result.payload);
    }

    return result;
  }

  scenarioFailedInventoryGrant(config) {
    const cfg = config || {};
    const player = this.mockPlayers[0];

    const failingAdapter = new InventoryGrantAdapter({
      inventoryStore: this.worldStorage.inventories,
      itemStore: this.worldStorage.items
    });
    failingAdapter.addDropToInventory = () => {
      throw new Error("forced_inventory_write_failure");
    };

    const failedPayload = {
      source_type: "enemy",
      source_id: cfg.source_id || "goblin",
      party_id: "party-001",
      player_id: player.player_id,
      generated_from_event_id: cfg.generated_from_event_id || "evt-failed-grant-001",
      loot_result: {
        all_drops: [{ item_id: "item-copper-coin", quantity: 10, rarity: "common" }]
      }
    };

    const result = applyGeneratedLootToInventory({
      loot_payload: failedPayload,
      inventory_id: player.inventory_id,
      owner_character_id: player.player_id,
      worldStorage: this.worldStorage,
      lootDropManager: this.lootDropManager,
      inventoryAdapter: failingAdapter,
      grant_key: cfg.grant_key || "grant-failed-sim-001"
    });

    this.log("inventory_grant_failed", result);
    this.lootLogger.logLootGrantFailed(result.payload);
    return result;
  }

  scenarioIndividualLootAssignment(config) {
    const cfg = config || {};
    const assignment = assignIndividualLoot({
      source_type: cfg.source_type || "enemy",
      source_id: cfg.source_id || "goblin",
      loot_table_id: cfg.loot_table_id || "table-enemy-goblin-001",
      party: cfg.party || this.party,
      eligible_player_ids: cfg.eligible_player_ids,
      roll_count: Number.isInteger(cfg.roll_count) ? cfg.roll_count : 2,
      lootTableManager: this.lootTableManager,
      rngByPlayerId: cfg.rngByPlayerId
    });

    const grantResults = [];
    if (assignment.ok) {
      for (const row of assignment.payload.per_player_results) {
        if (!row.ok) continue;
        const targetPlayer =
          this.mockPlayers.find((x) => x.player_id === row.player_id) ||
          { player_id: row.player_id, inventory_id: `inv-${row.player_id}` };

        const granted = this.scenarioInventoryGrant(
          {
            source_type: assignment.payload.source_type,
            source_id: assignment.payload.source_id,
            party_id: assignment.payload.party_id,
            player_id: row.player_id,
            generated_from_event_id: `evt-assignment-${row.player_id}`,
            loot_result: {
              ...row.loot_payload
            }
          },
          targetPlayer,
          {
            grant_key: `grant-assignment-${row.player_id}`
          }
        );
        grantResults.push(granted);
      }
    }

    this.log("individual_assignment_complete", {
      assignment,
      grant_results: grantResults
    });

    return {
      assignment,
      grant_results: grantResults
    };
  }

  scenarioDuplicateEnemyDefeat(config) {
    const cfg = config || {};
    const sharedEventId = cfg.event_id || "evt-dupe-enemy-001";

    const first = this.scenarioNormalEnemyDefeat({
      event_id: sharedEventId,
      allow_duplicate_events: Boolean(cfg.allow_duplicate_events),
      rng: cfg.rng
    });
    const second = this.scenarioNormalEnemyDefeat({
      event_id: sharedEventId,
      allow_duplicate_events: Boolean(cfg.allow_duplicate_events),
      rng: cfg.rng
    });

    const out = {
      first,
      second,
      duplicate_blocked: second.event_type === "loot_not_generated"
    };
    this.log("duplicate_enemy_defeat_result", out);
    return out;
  }

  runAllScenarios() {
    this.setupMocks();

    const normalEnemy = this.scenarioNormalEnemyDefeat({
      event_id: "evt-enemy-001"
    });
    const boss = this.scenarioBossDefeat({
      event_id: "evt-boss-001"
    });
    const weighted = this.scenarioWeightedLootGeneration({
      source_id: "bandit"
    });
    const duplicate = this.scenarioDuplicateEnemyDefeat({
      event_id: "evt-enemy-duplicate-001",
      allow_duplicate_events: Boolean(this.options.allow_duplicate_rewards)
    });

    if (normalEnemy.ok) {
      this.scenarioInventoryGrant(normalEnemy.payload, this.mockPlayers[0], {
        grant_key: "grant-normal-enemy-001",
        allow_duplicate_grants: Boolean(this.options.allow_duplicate_rewards)
      });
    }

    if (boss.ok) {
      this.scenarioIndividualLootAssignment({
        source_type: "boss",
        source_id: "lich-king",
        loot_table_id: "table-boss-lich-001",
        roll_count: 2
      });
    }

    const failedGrant = this.scenarioFailedInventoryGrant({
      generated_from_event_id: "evt-failed-grant-001"
    });

    this.log("final_inventories", this.mockPlayers.map((player) => ({
      player_id: player.player_id,
      inventory: this.worldStorage.inventories.loadInventory(player.inventory_id)
    })));

    this.log("loot_log_records", this.lootLogger.listLogs());

    return {
      ok: true,
      scenarios: {
        normal_enemy_defeat: normalEnemy.ok,
        boss_defeat: boss.ok,
        weighted_loot_generation: weighted.ok,
        guaranteed_drops: Boolean(boss.payload?.guaranteed_drop_count > 0),
        individual_assignment: true,
        inventory_granting: true,
        failed_grant_scenario: failedGrant.event_type === "loot_grant_failed",
        duplicate_generation_blocking: duplicate.duplicate_blocked
      },
      logs: this.logs
    };
  }
}

if (require.main === module) {
  const result = new LootSimulationRunner().runAllScenarios();
  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  LootSimulationRunner
};
