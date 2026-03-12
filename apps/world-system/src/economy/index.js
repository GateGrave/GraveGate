"use strict";

const {
  ECONOMY_TRANSACTION_SCHEMA,
  createTransactionRecord
} = require("./transaction.schema");
const {
  InMemoryTransactionStore,
  TransactionManager
} = require("./transaction.manager");
const {
  NPC_SHOP_SCHEMA,
  createNpcShopRecord
} = require("./npc-shop.schema");
const {
  InMemoryNpcShopStore,
  NpcShopManager
} = require("./npc-shop.manager");
const {
  PLAYER_SHOP_SCHEMA,
  createPlayerShopRecord
} = require("./player-shop.schema");
const {
  InMemoryPlayerShopStore,
  PlayerShopManager
} = require("./player-shop.manager");
const {
  ProcessedNpcShopPurchaseStore,
  processNpcShopPurchase
} = require("./npc-shop-purchase.flow");
const {
  ProcessedNpcShopSellStore,
  processNpcShopSell,
  defaultRemoveItemFromInventory
} = require("./npc-shop-sell.flow");
const {
  ProcessedPlayerListingStore,
  processPlayerListing
} = require("./player-listing.flow");
const {
  ProcessedPlayerShopPurchaseStore,
  PlayerListingLockStore,
  processPlayerShopPurchase
} = require("./player-shop-purchase.flow");
const { processPlayerTrade } = require("./player-trade.flow");
const { VALID_TRADE_STATES, createPlayerTradeRecord } = require("./player-trade.schema");
const { InMemoryPlayerTradeStore, PlayerTradeManager } = require("./player-trade.manager");
const { PlayerTradePersistenceBridge } = require("./player-trade.persistence");
const { EconomyTransactionLogger } = require("./economy-transaction-logger");
const {
  createEconomySnapshot,
  restoreEconomySnapshot
} = require("./economy-snapshot");
const { EconomySimulationRunner } = require("./testing/economy-simulation-runner");

// Default in-memory manager for scaffolding usage.
const defaultTransactionManager = new TransactionManager();
const defaultNpcShopManager = new NpcShopManager();
const defaultPlayerShopManager = new PlayerShopManager();
const defaultPlayerTradeManager = new PlayerTradeManager();

function createTransaction(input) {
  return defaultTransactionManager.createTransaction(input);
}

function getTransaction(transaction_id) {
  return defaultTransactionManager.getTransaction(transaction_id);
}

function updateTransaction(transaction_id, updater) {
  return defaultTransactionManager.updateTransaction(transaction_id, updater);
}

function listTransactionsByPlayer(player_id) {
  return defaultTransactionManager.listTransactionsByPlayer(player_id);
}

function listTransactionsByType(transaction_type) {
  return defaultTransactionManager.listTransactionsByType(transaction_type);
}

function createNpcShop(input) {
  return defaultNpcShopManager.createNpcShop(input);
}

function getNpcShop(vendor_id) {
  return defaultNpcShopManager.getNpcShop(vendor_id);
}

function updateNpcShop(vendor_id, updater) {
  return defaultNpcShopManager.updateNpcShop(vendor_id, updater);
}

function listNpcShopItems(vendor_id) {
  return defaultNpcShopManager.listNpcShopItems(vendor_id);
}

function isItemAvailableInNpcShop(input) {
  return defaultNpcShopManager.isItemAvailableInNpcShop(input);
}

function createPlayerShop(input) {
  return defaultPlayerShopManager.createPlayerShop(input);
}

function getPlayerShop(shop_id) {
  return defaultPlayerShopManager.getPlayerShop(shop_id);
}

function updatePlayerShop(shop_id, updater) {
  return defaultPlayerShopManager.updatePlayerShop(shop_id, updater);
}

function listPlayerShopListings(shop_id) {
  return defaultPlayerShopManager.listPlayerShopListings(shop_id);
}

function deactivatePlayerShop(shop_id) {
  return defaultPlayerShopManager.deactivatePlayerShop(shop_id);
}

function proposePlayerTrade(input) {
  return defaultPlayerTradeManager.proposeTrade(input);
}

function acceptPlayerTrade(input) {
  return defaultPlayerTradeManager.acceptTrade(input);
}

function declinePlayerTrade(input) {
  return defaultPlayerTradeManager.declineTrade(input);
}

function cancelPlayerTrade(input) {
  return defaultPlayerTradeManager.cancelTrade(input);
}

function getPlayerTrade(trade_id) {
  return defaultPlayerTradeManager.getTrade(trade_id);
}

module.exports = {
  ECONOMY_TRANSACTION_SCHEMA,
  createTransactionRecord,
  InMemoryTransactionStore,
  TransactionManager,
  defaultTransactionManager,
  createTransaction,
  getTransaction,
  updateTransaction,
  listTransactionsByPlayer,
  listTransactionsByType,
  NPC_SHOP_SCHEMA,
  createNpcShopRecord,
  InMemoryNpcShopStore,
  NpcShopManager,
  defaultNpcShopManager,
  createNpcShop,
  getNpcShop,
  updateNpcShop,
  listNpcShopItems,
  isItemAvailableInNpcShop,
  PLAYER_SHOP_SCHEMA,
  createPlayerShopRecord,
  InMemoryPlayerShopStore,
  PlayerShopManager,
  defaultPlayerShopManager,
  createPlayerShop,
  getPlayerShop,
  updatePlayerShop,
  listPlayerShopListings,
  deactivatePlayerShop,
  ProcessedNpcShopPurchaseStore,
  processNpcShopPurchase,
  ProcessedNpcShopSellStore,
  processNpcShopSell,
  defaultRemoveItemFromInventory,
  ProcessedPlayerListingStore,
  processPlayerListing,
  ProcessedPlayerShopPurchaseStore,
  PlayerListingLockStore,
  processPlayerShopPurchase,
  processPlayerTrade,
  VALID_TRADE_STATES,
  createPlayerTradeRecord,
  InMemoryPlayerTradeStore,
  PlayerTradeManager,
  PlayerTradePersistenceBridge,
  defaultPlayerTradeManager,
  proposePlayerTrade,
  acceptPlayerTrade,
  declinePlayerTrade,
  cancelPlayerTrade,
  getPlayerTrade,
  EconomyTransactionLogger,
  createEconomySnapshot,
  restoreEconomySnapshot,
  EconomySimulationRunner
};
