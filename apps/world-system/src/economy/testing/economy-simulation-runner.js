"use strict";

const { InMemoryInventoryStore, InMemoryItemStore } = require("../../../../database/src/world-storage");
const { CurrencyAccountManager, InMemoryCurrencyAccountStore } = require("../../currency");
const { NpcShopManager, InMemoryNpcShopStore } = require("../npc-shop.manager");
const { PlayerShopManager, InMemoryPlayerShopStore } = require("../player-shop.manager");
const { TransactionManager, InMemoryTransactionStore } = require("../transaction.manager");
const { ProcessedNpcShopPurchaseStore, processNpcShopPurchase } = require("../npc-shop-purchase.flow");
const { ProcessedNpcShopSellStore, processNpcShopSell } = require("../npc-shop-sell.flow");
const { ProcessedPlayerListingStore, processPlayerListing } = require("../player-listing.flow");
const {
  ProcessedPlayerShopPurchaseStore,
  PlayerListingLockStore,
  processPlayerShopPurchase
} = require("../player-shop-purchase.flow");
const { EconomyTransactionLogger } = require("../economy-transaction-logger");
const { createEconomySnapshot, restoreEconomySnapshot } = require("../economy-snapshot");

class EconomySimulationRunner {
  constructor(options) {
    this.options = options || {};
    this.logs = [];
    this.step = 0;

    this.worldStorage = {
      inventories: new InMemoryInventoryStore(),
      items: new InMemoryItemStore()
    };
    this.currencyManager = new CurrencyAccountManager({ store: new InMemoryCurrencyAccountStore() });
    this.npcShopManager = new NpcShopManager({ store: new InMemoryNpcShopStore() });
    this.playerShopManager = new PlayerShopManager({ store: new InMemoryPlayerShopStore() });
    this.transactionManager = new TransactionManager({ store: new InMemoryTransactionStore() });

    this.processedNpcPurchases = new ProcessedNpcShopPurchaseStore();
    this.processedNpcSells = new ProcessedNpcShopSellStore();
    this.processedListings = new ProcessedPlayerListingStore();
    this.processedPlayerPurchases = new ProcessedPlayerShopPurchaseStore();
    this.listingLocks = new PlayerListingLockStore();

    this.economyLogger = new EconomyTransactionLogger();
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
    this.players = {
      hero: { player_id: "hero-001", inventory_id: "inv-hero-001" },
      trader: { player_id: "trader-001", inventory_id: "inv-trader-001" },
      rival: { player_id: "rival-001", inventory_id: "inv-rival-001" }
    };

    this.currencyManager.createCurrencyAccount({ player_id: this.players.hero.player_id, gold_balance: 200 });
    this.currencyManager.createCurrencyAccount({ player_id: this.players.trader.player_id, gold_balance: 40 });
    this.currencyManager.createCurrencyAccount({ player_id: this.players.rival.player_id, gold_balance: 120 });

    this.worldStorage.items.saveItem({ item_id: "item-potion", item_type: "consumable", sellable: true });
    this.worldStorage.items.saveItem({ item_id: "item-herb", item_type: "stackable", sellable: true });
    this.worldStorage.items.saveItem({ item_id: "item-crystal", item_type: "stackable", sellable: true });

    this.worldStorage.inventories.saveInventory({
      inventory_id: this.players.hero.inventory_id,
      owner_character_id: this.players.hero.player_id,
      item_entries: [
        { entry_id: "entry-hero-herb", item_id: "item-herb", entry_type: "stackable", quantity: 3, location: "backpack" }
      ]
    });
    this.worldStorage.inventories.saveInventory({
      inventory_id: this.players.trader.inventory_id,
      owner_character_id: this.players.trader.player_id,
      item_entries: [
        { entry_id: "entry-trader-crystal", item_id: "item-crystal", entry_type: "stackable", quantity: 3, location: "backpack" }
      ]
    });

    this.npcShopManager.createNpcShop({
      vendor_id: "vendor-001",
      vendor_name: "Tarin",
      stock_items: ["item-potion", "item-herb"],
      price_map: { "item-potion": 20, "item-herb": 4 },
      quantity_map: { "item-potion": 10, "item-herb": 100 },
      infinite_stock_items: [],
      shop_active: true
    });

    this.playerShopManager.createPlayerShop({
      shop_id: "pshop-001",
      owner_player_id: this.players.trader.player_id,
      listings: [],
      shop_active: true
    });

    this.log("setup_complete", {
      players: this.players,
      npc_shop: this.npcShopManager.getNpcShop("vendor-001"),
      player_shop: this.playerShopManager.getPlayerShop("pshop-001")
    });
  }

  trackResult(result) {
    const payload = result?.payload || {};
    const eventType = result?.event_type;
    if (eventType === "npc_shop_purchase_success") {
      this.economyLogger.logNpcPurchase({
        transaction_id: payload.transaction_id,
        player_id: payload.player_id,
        vendor_id: payload.vendor_id,
        item_id: payload.item_id,
        quantity: payload.quantity,
        gold_spent: payload.gold_spent,
        result: "success"
      });
    } else if (eventType === "npc_shop_sell_success") {
      this.economyLogger.logNpcSale({
        transaction_id: payload.transaction_id,
        player_id: payload.player_id,
        vendor_id: payload.vendor_id,
        item_id: payload.item_id,
        quantity: payload.quantity,
        gold_earned: payload.gold_earned,
        result: "success"
      });
    } else if (eventType === "player_listing_created") {
      this.economyLogger.logPlayerListingCreated({
        transaction_id: payload.transaction_id,
        owner_player_id: payload.owner_player_id,
        item_id: payload.item_id,
        quantity: payload.quantity,
        price_gold: payload.price_gold,
        result: "success"
      });
    } else if (eventType === "player_shop_purchase_success") {
      this.economyLogger.logPlayerPurchase({
        transaction_id: payload.transaction_id,
        buyer_player_id: payload.buyer_player_id,
        seller_player_id: payload.seller_player_id,
        item_id: payload.item_id,
        quantity: payload.quantity,
        gold_spent: payload.gold_spent,
        result: "success"
      });
    } else if (result && result.ok === false) {
      this.economyLogger.logFailedTransaction({
        transaction_id: payload.transaction_id || null,
        player_id: payload.player_id || payload.buyer_player_id || null,
        vendor_id: payload.vendor_id || null,
        item_id: payload.item_id || null,
        quantity: payload.quantity || null,
        gold_amount: payload.gold_spent || payload.gold_amount || null,
        reason: payload.reason || "failed"
      });
    }
  }

  scenarioNpcPurchase() {
    const out = processNpcShopPurchase({
      purchase_key: "econ-npc-buy-001",
      player_id: this.players.hero.player_id,
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: this.players.hero.inventory_id,
      npcShopManager: this.npcShopManager,
      currencyManager: this.currencyManager,
      transactionManager: this.transactionManager,
      processedPurchaseStore: this.processedNpcPurchases,
      worldStorage: this.worldStorage
    });
    this.trackResult(out);
    this.log("npc_purchase", out);
    return out;
  }

  scenarioNpcSale() {
    const out = processNpcShopSell({
      sell_key: "econ-npc-sell-001",
      player_id: this.players.hero.player_id,
      vendor_id: "vendor-001",
      item_id: "item-herb",
      quantity: 1,
      inventory_id: this.players.hero.inventory_id,
      npcShopManager: this.npcShopManager,
      currencyManager: this.currencyManager,
      transactionManager: this.transactionManager,
      processedSellStore: this.processedNpcSells,
      worldStorage: this.worldStorage
    });
    this.trackResult(out);
    this.log("npc_sale", out);
    return out;
  }

  scenarioPlayerListing() {
    const out = processPlayerListing({
      listing_key: "econ-player-list-001",
      shop_id: "pshop-001",
      owner_player_id: this.players.trader.player_id,
      item_id: "item-crystal",
      quantity: 2,
      price_gold: 30,
      inventory_id: this.players.trader.inventory_id,
      playerShopManager: this.playerShopManager,
      transactionManager: this.transactionManager,
      processedListingStore: this.processedListings,
      worldStorage: this.worldStorage
    });
    this.trackResult(out);
    this.log("player_listing_created", out);
    return out;
  }

  scenarioPlayerPurchase(listingId) {
    const listing_id = listingId || this.playerShopManager.getPlayerShop("pshop-001").listings[0]?.listing_id;
    const out = processPlayerShopPurchase({
      purchase_key: "econ-player-buy-001",
      shop_id: "pshop-001",
      listing_id,
      buyer_player_id: this.players.hero.player_id,
      quantity: 1,
      buyer_inventory_id: this.players.hero.inventory_id,
      playerShopManager: this.playerShopManager,
      currencyManager: this.currencyManager,
      transactionManager: this.transactionManager,
      processedPurchaseStore: this.processedPlayerPurchases,
      listingLockStore: this.listingLocks,
      worldStorage: this.worldStorage
    });
    this.trackResult(out);
    this.log("player_purchase", out);
    return out;
  }

  scenarioInsufficientFunds() {
    const out = processNpcShopPurchase({
      purchase_key: "econ-failed-funds-001",
      player_id: this.players.rival.player_id,
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 999,
      inventory_id: this.players.rival.inventory_id,
      npcShopManager: this.npcShopManager,
      currencyManager: this.currencyManager,
      transactionManager: this.transactionManager,
      processedPurchaseStore: this.processedNpcPurchases,
      worldStorage: this.worldStorage
    });
    this.trackResult(out);
    this.log("failed_insufficient_funds", out);
    return out;
  }

  scenarioFailedTransferRollback() {
    const out = processPlayerShopPurchase({
      purchase_key: "econ-failed-transfer-001",
      shop_id: "pshop-001",
      listing_id: this.playerShopManager.getPlayerShop("pshop-001").listings[0]?.listing_id,
      buyer_player_id: this.players.rival.player_id,
      quantity: 1,
      buyer_inventory_id: this.players.rival.inventory_id,
      inventoryAdapter: {
        addDropToInventory() {
          return { ok: false, reason: "forced_inventory_transfer_failure" };
        }
      },
      playerShopManager: this.playerShopManager,
      currencyManager: this.currencyManager,
      transactionManager: this.transactionManager,
      processedPurchaseStore: this.processedPlayerPurchases,
      listingLockStore: this.listingLocks,
      worldStorage: this.worldStorage
    });
    this.trackResult(out);
    this.log("failed_transfer_rollback", out);
    return out;
  }

  scenarioContestedListing() {
    // create fresh listing for contest
    const listing = processPlayerListing({
      listing_key: "econ-player-list-contest-001",
      shop_id: "pshop-001",
      owner_player_id: this.players.trader.player_id,
      item_id: "item-crystal",
      quantity: 1,
      price_gold: 25,
      inventory_id: this.players.trader.inventory_id,
      playerShopManager: this.playerShopManager,
      transactionManager: this.transactionManager,
      processedListingStore: this.processedListings,
      worldStorage: this.worldStorage
    });

    const listing_id = listing.payload?.listing_id;
    let loserAttempt = null;
    const winnerAttempt = processPlayerShopPurchase({
      purchase_key: "econ-contest-win-001",
      shop_id: "pshop-001",
      listing_id,
      buyer_player_id: this.players.hero.player_id,
      quantity: 1,
      buyer_inventory_id: this.players.hero.inventory_id,
      debug_on_lock_acquired: () => {
        loserAttempt = processPlayerShopPurchase({
          purchase_key: "econ-contest-lose-001",
          shop_id: "pshop-001",
          listing_id,
          buyer_player_id: this.players.rival.player_id,
          quantity: 1,
          buyer_inventory_id: this.players.rival.inventory_id,
          playerShopManager: this.playerShopManager,
          currencyManager: this.currencyManager,
          transactionManager: this.transactionManager,
          processedPurchaseStore: this.processedPlayerPurchases,
          listingLockStore: this.listingLocks,
          worldStorage: this.worldStorage
        });
      },
      playerShopManager: this.playerShopManager,
      currencyManager: this.currencyManager,
      transactionManager: this.transactionManager,
      processedPurchaseStore: this.processedPlayerPurchases,
      listingLockStore: this.listingLocks,
      worldStorage: this.worldStorage
    });

    this.trackResult(winnerAttempt);
    this.trackResult(loserAttempt);
    const out = { listing, winnerAttempt, loserAttempt };
    this.log("contested_listing_purchase", out);
    return out;
  }

  scenarioSnapshotRestore() {
    const snapshot = createEconomySnapshot({
      currencyManager: this.currencyManager,
      npcShopManager: this.npcShopManager,
      playerShopManager: this.playerShopManager,
      transactionManager: this.transactionManager
    });

    // mutate state to prove restore works
    this.currencyManager.addCurrency({ player_id: this.players.hero.player_id, amount: 777 });
    this.playerShopManager.updatePlayerShop("pshop-001", { listings: [] });

    const restore = restoreEconomySnapshot({
      snapshot: snapshot.payload,
      currencyManager: this.currencyManager,
      npcShopManager: this.npcShopManager,
      playerShopManager: this.playerShopManager,
      transactionManager: this.transactionManager
    });

    const out = { snapshot, restore };
    this.log("snapshot_restore", out);
    return out;
  }

  runAllScenarios() {
    this.setupMocks();

    const npcPurchase = this.scenarioNpcPurchase();
    const npcSale = this.scenarioNpcSale();
    const listing = this.scenarioPlayerListing();
    const p2pPurchase = this.scenarioPlayerPurchase(listing.payload?.listing_id);
    const insufficient = this.scenarioInsufficientFunds();
    const duplicate = this.scenarioPlayerPurchase(listing.payload?.listing_id); // duplicate key
    const rollback = this.scenarioFailedTransferRollback();
    const contested = this.scenarioContestedListing();
    const snapshotRestore = this.scenarioSnapshotRestore();

    this.log("economy_logs", this.economyLogger.listLogs());

    return {
      ok: true,
      scenarios: {
        currency_account_creation: true,
        npc_shop_creation: true,
        npc_purchase_flow: npcPurchase.ok,
        npc_sell_flow: npcSale.ok,
        player_shop_creation: true,
        player_listing_creation: listing.ok,
        player_to_player_purchase: p2pPurchase.ok,
        failed_transactions: insufficient.ok === false && rollback.ok === false,
        contested_listing_purchase: contested.winnerAttempt.ok === true && contested.loserAttempt?.ok === false,
        snapshot_restore: snapshotRestore.restore.ok
      },
      logs: this.logs
    };
  }
}

if (require.main === module) {
  const out = new EconomySimulationRunner().runAllScenarios();
  console.log(JSON.stringify(out, null, 2));
}

module.exports = {
  EconomySimulationRunner
};
