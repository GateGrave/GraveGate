"use strict";

const assert = require("assert");
const {
  PlayerShopManager,
  InMemoryPlayerShopStore,
  TransactionManager,
  InMemoryTransactionStore,
  ProcessedPlayerShopPurchaseStore,
  PlayerListingLockStore,
  processPlayerShopPurchase
} = require("../../index");
const {
  CurrencyAccountManager,
  InMemoryCurrencyAccountStore
} = require("../../currency");
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
  const processedPurchaseStore = new ProcessedPlayerShopPurchaseStore();
  const listingLockStore = new PlayerListingLockStore();
  const currencyManager = new CurrencyAccountManager({ store: new InMemoryCurrencyAccountStore() });
  const worldStorage = {
    inventories: new InMemoryInventoryStore(),
    items: new InMemoryItemStore()
  };

  worldStorage.items.saveItem({
    item_id: "item-potion",
    item_type: "consumable",
    rarity: "common"
  });

  playerShopManager.createPlayerShop({
    shop_id: "pshop-001",
    owner_player_id: "seller-001",
    listings: [
      {
        listing_id: "listing-001",
        item_id: "item-potion",
        quantity: 2,
        price_gold: 40,
        listing_active: true,
        seller_player_id: "seller-001"
      }
    ],
    shop_active: true
  });

  currencyManager.createCurrencyAccount({ player_id: "seller-001", gold_balance: 10 });
  currencyManager.createCurrencyAccount({ player_id: "buyer-001", gold_balance: 100 });
  currencyManager.createCurrencyAccount({ player_id: "buyer-002", gold_balance: 100 });

  return {
    playerShopManager,
    transactionManager,
    processedPurchaseStore,
    listingLockStore,
    currencyManager,
    worldStorage
  };
}

function runPlayerShopPurchaseFlowTests() {
  const results = [];

  runTest("successful_player_to_player_purchase", () => {
    const ctx = createContext();
    const out = processPlayerShopPurchase({
      purchase_key: "ppurchase-success-001",
      shop_id: "pshop-001",
      listing_id: "listing-001",
      buyer_player_id: "buyer-001",
      quantity: 1,
      buyer_inventory_id: "inv-buyer-001",
      ...ctx
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "player_shop_purchase_success");
    assert.equal(ctx.currencyManager.getCurrencyAccount("buyer-001").gold_balance, 60);
    assert.equal(ctx.currencyManager.getCurrencyAccount("seller-001").gold_balance, 50);

    const inv = ctx.worldStorage.inventories.loadInventory("inv-buyer-001");
    const potion = inv.item_entries.find((x) => x.item_id === "item-potion");
    assert.ok(potion);
    assert.equal(potion.quantity, 1);

    const shop = ctx.playerShopManager.getPlayerShop("pshop-001");
    const listing = shop.listings.find((x) => x.listing_id === "listing-001");
    assert.equal(listing.quantity, 1);
    assert.equal(listing.listing_active, true);
    assert.equal(ctx.transactionManager.listTransactionsByType("player_shop_purchase").length, 1);
  }, results);

  runTest("insufficient_buyer_funds", () => {
    const ctx = createContext();
    ctx.currencyManager.subtractCurrency({ player_id: "buyer-001", amount: 95 });

    const out = processPlayerShopPurchase({
      purchase_key: "ppurchase-no-funds-001",
      shop_id: "pshop-001",
      listing_id: "listing-001",
      buyer_player_id: "buyer-001",
      quantity: 1,
      buyer_inventory_id: "inv-buyer-001",
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "insufficient_buyer_funds");
  }, results);

  runTest("inactive_listing", () => {
    const ctx = createContext();
    ctx.playerShopManager.updatePlayerShop("pshop-001", (shop) => ({
      listings: shop.listings.map((x) => (x.listing_id === "listing-001" ? { ...x, listing_active: false } : x))
    }));

    const out = processPlayerShopPurchase({
      purchase_key: "ppurchase-inactive-001",
      shop_id: "pshop-001",
      listing_id: "listing-001",
      buyer_player_id: "buyer-001",
      quantity: 1,
      buyer_inventory_id: "inv-buyer-001",
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "listing_inactive_or_missing");
  }, results);

  runTest("buyer_attempts_to_buy_own_listing_if_disallowed", () => {
    const ctx = createContext();
    const out = processPlayerShopPurchase({
      purchase_key: "ppurchase-self-001",
      shop_id: "pshop-001",
      listing_id: "listing-001",
      buyer_player_id: "seller-001",
      quantity: 1,
      buyer_inventory_id: "inv-seller-001",
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "self_purchase_not_allowed");
  }, results);

  runTest("listing_quantity_exhausted", () => {
    const ctx = createContext();
    const out = processPlayerShopPurchase({
      purchase_key: "ppurchase-oos-001",
      shop_id: "pshop-001",
      listing_id: "listing-001",
      buyer_player_id: "buyer-001",
      quantity: 9,
      buyer_inventory_id: "inv-buyer-001",
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "listing_quantity_unavailable");
  }, results);

  runTest("failed_inventory_transfer_does_not_move_gold", () => {
    const ctx = createContext();
    const failingInventoryAdapter = {
      addDropToInventory() {
        return { ok: false, reason: "forced_inventory_failure" };
      }
    };

    const out = processPlayerShopPurchase({
      purchase_key: "ppurchase-inventory-fail-001",
      shop_id: "pshop-001",
      listing_id: "listing-001",
      buyer_player_id: "buyer-001",
      quantity: 1,
      buyer_inventory_id: "inv-buyer-001",
      inventoryAdapter: failingInventoryAdapter,
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "item_transfer_failed");
    assert.equal(ctx.currencyManager.getCurrencyAccount("buyer-001").gold_balance, 100);
    assert.equal(ctx.currencyManager.getCurrencyAccount("seller-001").gold_balance, 10);
  }, results);

  runTest("failed_gold_transfer_does_not_move_item", () => {
    const ctx = createContext();
    const failingCurrencyManager = {
      hasSufficientFunds() {
        return true;
      },
      subtractCurrency(input) {
        if (input.player_id === "buyer-001") {
          return { ok: true };
        }
        return { ok: false, reason: "forced_seller_credit_failure" };
      },
      addCurrency(input) {
        if (input.player_id === "seller-001") {
          return { ok: false, reason: "forced_seller_credit_failure" };
        }
        return { ok: true };
      },
      getCurrencyAccount() {
        return { gold_balance: 0 };
      }
    };

    const out = processPlayerShopPurchase({
      purchase_key: "ppurchase-gold-fail-001",
      shop_id: "pshop-001",
      listing_id: "listing-001",
      buyer_player_id: "buyer-001",
      quantity: 1,
      buyer_inventory_id: "inv-buyer-001",
      currencyManager: failingCurrencyManager,
      playerShopManager: ctx.playerShopManager,
      transactionManager: ctx.transactionManager,
      processedPurchaseStore: ctx.processedPurchaseStore,
      listingLockStore: ctx.listingLockStore,
      worldStorage: ctx.worldStorage
    });

    const inv = ctx.worldStorage.inventories.loadInventory("inv-buyer-001");
    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "seller_gold_payout_failed");
    assert.equal(inv, null);
  }, results);

  runTest("two_buyers_competing_for_same_listing_does_not_duplicate_item", () => {
    const ctx = createContext();
    // quantity 2 listing. Buyer-001 tries to buy 2 and while lock is held buyer-002 attempts 1.
    let secondResult = null;
    const first = processPlayerShopPurchase({
      purchase_key: "ppurchase-race-001",
      shop_id: "pshop-001",
      listing_id: "listing-001",
      buyer_player_id: "buyer-001",
      quantity: 2,
      buyer_inventory_id: "inv-buyer-001",
      debug_on_lock_acquired() {
        secondResult = processPlayerShopPurchase({
          purchase_key: "ppurchase-race-002",
          shop_id: "pshop-001",
          listing_id: "listing-001",
          buyer_player_id: "buyer-002",
          quantity: 1,
          buyer_inventory_id: "inv-buyer-002",
          ...ctx
        });
      },
      ...ctx
    });

    assert.equal(first.ok, true);
    assert.ok(secondResult);
    assert.equal(secondResult.ok, false);
    assert.equal(secondResult.payload.reason, "listing_locked");

    const buyer1Inv = ctx.worldStorage.inventories.loadInventory("inv-buyer-001");
    const buyer2Inv = ctx.worldStorage.inventories.loadInventory("inv-buyer-002");
    const buyer1Entry = buyer1Inv.item_entries.find((x) => x.item_id === "item-potion");

    assert.equal(buyer1Entry.quantity, 2);
    assert.equal(buyer2Inv, null);
  }, results);

  runTest("repeat_purchase_attempts_do_not_reconsume_sold_listings", () => {
    const ctx = createContext();
    const first = processPlayerShopPurchase({
      purchase_key: "ppurchase-repeat-001",
      shop_id: "pshop-001",
      listing_id: "listing-001",
      buyer_player_id: "buyer-001",
      quantity: 2,
      buyer_inventory_id: "inv-buyer-001",
      ...ctx
    });
    const second = processPlayerShopPurchase({
      purchase_key: "ppurchase-repeat-001",
      shop_id: "pshop-001",
      listing_id: "listing-001",
      buyer_player_id: "buyer-001",
      quantity: 2,
      buyer_inventory_id: "inv-buyer-001",
      ...ctx
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.event_type, "player_shop_purchase_skipped");
    assert.equal(ctx.transactionManager.listTransactionsByType("player_shop_purchase").length, 1);
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
  const summary = runPlayerShopPurchaseFlowTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runPlayerShopPurchaseFlowTests
};

