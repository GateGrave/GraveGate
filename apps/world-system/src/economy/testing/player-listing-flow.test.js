"use strict";

const assert = require("assert");
const {
  PlayerShopManager,
  InMemoryPlayerShopStore,
  TransactionManager,
  InMemoryTransactionStore,
  ProcessedPlayerListingStore,
  processPlayerListing
} = require("../../index");
const {
  InMemoryInventoryStore,
  InMemoryItemStore
} = require("../../../../database/src/world-storage");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createContext() {
  const playerShopManager = new PlayerShopManager({ store: new InMemoryPlayerShopStore() });
  const transactionManager = new TransactionManager({ store: new InMemoryTransactionStore() });
  const processedListingStore = new ProcessedPlayerListingStore();
  const worldStorage = {
    inventories: new InMemoryInventoryStore(),
    items: new InMemoryItemStore()
  };

  playerShopManager.createPlayerShop({
    shop_id: "pshop-001",
    owner_player_id: "player-001",
    listings: [],
    shop_active: true
  });

  worldStorage.items.saveItem({
    item_id: "item-potion",
    item_type: "consumable",
    sellable: true
  });
  worldStorage.items.saveItem({
    item_id: "item-bound",
    item_type: "equipment",
    sellable: false,
    listing_blocked: true
  });

  worldStorage.inventories.saveInventory({
    inventory_id: "inv-player-001",
    owner_character_id: "player-001",
    item_entries: [
      { entry_id: "entry-p1", item_id: "item-potion", quantity: 4, entry_type: "consumable" },
      { entry_id: "entry-b1", item_id: "item-bound", quantity: 1, entry_type: "equipment" }
    ]
  });

  return {
    playerShopManager,
    transactionManager,
    processedListingStore,
    worldStorage
  };
}

function runPlayerListingFlowTests() {
  const results = [];

  runTest("successful_listing_creation", () => {
    const ctx = createContext();
    const out = processPlayerListing({
      listing_key: "list-success-001",
      shop_id: "pshop-001",
      owner_player_id: "player-001",
      item_id: "item-potion",
      quantity: 2,
      price_gold: 50,
      inventory_id: "inv-player-001",
      ...ctx
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "player_listing_created");
    assert.equal(out.payload.listing_model, "removed_from_inventory_escrow");
    assert.equal(ctx.transactionManager.listTransactionsByType("player_listing_created").length, 1);

    const inv = ctx.worldStorage.inventories.loadInventory("inv-player-001");
    const potionEntry = inv.item_entries.find((x) => x.item_id === "item-potion");
    assert.equal(potionEntry.quantity, 2);

    const listings = ctx.playerShopManager.listPlayerShopListings("pshop-001");
    assert.equal(listings.length, 1);
    assert.equal(listings[0].price_gold, 50);
  }, results);

  runTest("insufficient_owned_quantity", () => {
    const ctx = createContext();
    const out = processPlayerListing({
      listing_key: "list-insufficient-001",
      shop_id: "pshop-001",
      owner_player_id: "player-001",
      item_id: "item-potion",
      quantity: 99,
      price_gold: 50,
      inventory_id: "inv-player-001",
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "inventory_reserve_failed");
  }, results);

  runTest("invalid_price", () => {
    const ctx = createContext();
    const out = processPlayerListing({
      listing_key: "list-bad-price-001",
      shop_id: "pshop-001",
      owner_player_id: "player-001",
      item_id: "item-potion",
      quantity: 1,
      price_gold: 0,
      inventory_id: "inv-player-001",
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "invalid_price");
  }, results);

  runTest("unsellable_listing_blocked_item", () => {
    const ctx = createContext();
    const out = processPlayerListing({
      listing_key: "list-blocked-001",
      shop_id: "pshop-001",
      owner_player_id: "player-001",
      item_id: "item-bound",
      quantity: 1,
      price_gold: 999,
      inventory_id: "inv-player-001",
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "item_listing_blocked");
  }, results);

  runTest("malformed_listing_request", () => {
    const ctx = createContext();
    const out = processPlayerListing({
      listing_key: "list-malformed-001",
      shop_id: "",
      owner_player_id: "player-001",
      item_id: "item-potion",
      quantity: 1,
      price_gold: 10,
      inventory_id: "inv-player-001",
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "shop_id_required");
  }, results);

  runTest("duplicate_listing_behavior", () => {
    const ctx = createContext();
    const first = processPlayerListing({
      listing_key: "list-duplicate-001",
      shop_id: "pshop-001",
      owner_player_id: "player-001",
      item_id: "item-potion",
      quantity: 1,
      price_gold: 20,
      inventory_id: "inv-player-001",
      ...ctx
    });
    const second = processPlayerListing({
      listing_key: "list-duplicate-001",
      shop_id: "pshop-001",
      owner_player_id: "player-001",
      item_id: "item-potion",
      quantity: 1,
      price_gold: 20,
      inventory_id: "inv-player-001",
      ...ctx
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.event_type, "player_listing_skipped");

    const listings = ctx.playerShopManager.listPlayerShopListings("pshop-001");
    assert.equal(listings.length, 1);
  }, results);

  runTest("failed_listing_creation_does_not_remove_item", () => {
    const ctx = createContext();
    const failingPlayerShopManager = {
      getPlayerShop: ctx.playerShopManager.getPlayerShop.bind(ctx.playerShopManager),
      updatePlayerShop() {
        return null;
      }
    };

    const beforeInv = JSON.stringify(ctx.worldStorage.inventories.loadInventory("inv-player-001"));
    const out = processPlayerListing({
      listing_key: "list-fail-shop-update-001",
      shop_id: "pshop-001",
      owner_player_id: "player-001",
      item_id: "item-potion",
      quantity: 2,
      price_gold: 25,
      inventory_id: "inv-player-001",
      playerShopManager: failingPlayerShopManager,
      transactionManager: ctx.transactionManager,
      processedListingStore: ctx.processedListingStore,
      worldStorage: ctx.worldStorage
    });
    const afterInv = JSON.stringify(ctx.worldStorage.inventories.loadInventory("inv-player-001"));

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "listing_creation_failed");
    assert.equal(afterInv, beforeInv);
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
  const summary = runPlayerListingFlowTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runPlayerListingFlowTests
};

