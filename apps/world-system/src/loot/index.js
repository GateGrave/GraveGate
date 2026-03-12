"use strict";

const { LOOT_DROP_SCHEMA, createLootDropRecord } = require("./loot-drop.schema");
const { InMemoryLootDropStore, LootDropManager } = require("./loot-drop.manager");
const { createLootEntryObject, createLootBundleObject } = require("./core/lootModel");
const { LootManager } = require("./core/lootManager");
const { createLootTableObject } = require("./tables/lootTableModel");
const { LootTableCoreManager } = require("./tables/lootTableManager");
const { SUPPORTED_SOURCE_CONTEXTS, rollLoot } = require("./flow/rollLoot");
const { consumeRewardHook } = require("./flow/consumeRewardHook");
const { resolveBossLoot } = require("./flow/resolveBossLoot");
const { grantLootToInventory } = require("./flow/grantLootToInventory");
const { LOOT_TABLE_SCHEMA, createLootTableRecord } = require("./loot-table.schema");
const {
  InMemoryLootTableStore,
  LootTableManager,
  createExampleLootTables
} = require("./loot-table.manager");
const { resolveLootRoll } = require("./loot-roll.resolver");
const {
  ProcessedEnemyDefeatStore,
  processEnemyDefeatedRewardHook
} = require("./hooks/enemy-defeat-reward.hook");
const { processBossDefeatedRewardHook } = require("./hooks/boss-defeat-reward.hook");
const {
  applyGeneratedLootToInventory,
  InventoryGrantAdapter,
  ProcessedLootGrantStore
} = require("./grants/loot-grant.service");
const { LootLogger } = require("./loot-logger");
const { LootSimulationRunner } = require("./testing/loot-simulation-runner");
const { assignIndividualLoot } = require("./assignment/individual-loot-assignment");

// Default in-memory manager for scaffolding usage.
const defaultLootDropManager = new LootDropManager();
const defaultLootTableManager = new LootTableManager();
const defaultLootCoreManager = new LootManager();
const defaultLootTableCoreManager = new LootTableCoreManager();

function createLootDrop(input) {
  return defaultLootDropManager.createLootDrop(input);
}

function createLootEntry(input) {
  return defaultLootCoreManager.createLootEntry(input);
}

function createLootBundle(input) {
  return defaultLootCoreManager.createLootBundle(input);
}

function listBundleEntries(drop_id) {
  return defaultLootCoreManager.listBundleEntries(drop_id);
}

function createLootTableCore(input) {
  return defaultLootTableCoreManager.createLootTable(input);
}

function getLootTableByIdCore(loot_table_id) {
  return defaultLootTableCoreManager.getLootTableById(loot_table_id);
}

function listWeightedEntriesCore(loot_table_id) {
  return defaultLootTableCoreManager.listWeightedEntries(loot_table_id);
}

function listGuaranteedEntriesCore(loot_table_id) {
  return defaultLootTableCoreManager.listGuaranteedEntries(loot_table_id);
}

function getLootDrop(loot_id) {
  return defaultLootDropManager.getLootDrop(loot_id);
}

function updateLootDrop(loot_id, updater) {
  return defaultLootDropManager.updateLootDrop(loot_id, updater);
}

function deleteLootDrop(loot_id) {
  return defaultLootDropManager.deleteLootDrop(loot_id);
}

function listLootDropsBySource(source_type, source_id) {
  return defaultLootDropManager.listLootDropsBySource(source_type, source_id);
}

function createLootTable(input) {
  return defaultLootTableManager.createLootTable(input);
}

function getLootTable(table_id) {
  return defaultLootTableManager.getLootTable(table_id);
}

function updateLootTable(table_id, updater) {
  return defaultLootTableManager.updateLootTable(table_id, updater);
}

function deleteLootTable(table_id) {
  return defaultLootTableManager.deleteLootTable(table_id);
}

function rollFromLootTable(table_id, options) {
  return defaultLootTableManager.rollFromLootTable(table_id, options);
}

module.exports = {
  LOOT_DROP_SCHEMA,
  LOOT_TABLE_SCHEMA,
  createLootEntryObject,
  createLootBundleObject,
  createLootTableObject,
  SUPPORTED_SOURCE_CONTEXTS,
  createLootDropRecord,
  createLootTableRecord,
  InMemoryLootDropStore,
  InMemoryLootTableStore,
  LootManager,
  LootTableCoreManager,
  LootDropManager,
  LootTableManager,
  defaultLootCoreManager,
  defaultLootTableCoreManager,
  defaultLootDropManager,
  defaultLootTableManager,
  createLootEntry,
  createLootBundle,
  listBundleEntries,
  createLootTableCore,
  getLootTableByIdCore,
  listWeightedEntriesCore,
  listGuaranteedEntriesCore,
  rollLoot,
  consumeRewardHook,
  resolveBossLoot,
  grantLootToInventory,
  createLootDrop,
  getLootDrop,
  updateLootDrop,
  deleteLootDrop,
  listLootDropsBySource,
  createLootTable,
  getLootTable,
  updateLootTable,
  deleteLootTable,
  rollFromLootTable,
  createExampleLootTables,
  resolveLootRoll,
  ProcessedEnemyDefeatStore,
  processEnemyDefeatedRewardHook,
  processBossDefeatedRewardHook,
  assignIndividualLoot,
  InventoryGrantAdapter,
  ProcessedLootGrantStore,
  applyGeneratedLootToInventory,
  LootLogger,
  LootSimulationRunner
};
