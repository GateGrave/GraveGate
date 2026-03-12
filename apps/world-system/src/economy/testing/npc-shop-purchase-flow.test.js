"use strict";

const assert = require("assert");
const {
  NpcShopManager,
  InMemoryNpcShopStore,
  TransactionManager,
  InMemoryTransactionStore,
  ProcessedNpcShopPurchaseStore,
  processNpcShopPurchase
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
  const npcShopManager = new NpcShopManager({ store: new InMemoryNpcShopStore() });
  const currencyManager = new CurrencyAccountManager({ store: new InMemoryCurrencyAccountStore() });
  const transactionManager = new TransactionManager({ store: new InMemoryTransactionStore() });
  const processedPurchaseStore = new ProcessedNpcShopPurchaseStore();
  const worldStorage = {
    inventories: new InMemoryInventoryStore(),
    items: new InMemoryItemStore()
  };

  worldStorage.items.saveItem({
    item_id: "item-potion",
    item_type: "consumable",
    rarity: "common"
  });

  npcShopManager.createNpcShop({
    vendor_id: "vendor-001",
    vendor_name: "Tarin",
    stock_items: ["item-potion"],
    price_map: { "item-potion": 10 },
    quantity_map: { "item-potion": 5 },
    infinite_stock_items: [],
    shop_active: true
  });

  currencyManager.createCurrencyAccount({
    player_id: "player-001",
    gold_balance: 100
  });

  return {
    npcShopManager,
    currencyManager,
    transactionManager,
    processedPurchaseStore,
    worldStorage
  };
}

function runNpcShopPurchaseFlowTests() {
  const results = [];

  runTest("successful_purchase", () => {
    const ctx = createContext();

    const out = processNpcShopPurchase({
      purchase_key: "purchase-success-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 2,
      inventory_id: "inv-player-001",
      ...ctx
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "npc_shop_purchase_success");
    assert.equal(out.payload.gold_spent, 20);
    assert.equal(ctx.currencyManager.getCurrencyAccount("player-001").gold_balance, 80);
    assert.equal(ctx.npcShopManager.getNpcShop("vendor-001").quantity_map["item-potion"], 3);
    assert.equal(ctx.transactionManager.listTransactionsByType("npc_shop_purchase").length, 1);

    const inventory = ctx.worldStorage.inventories.loadInventory("inv-player-001");
    const entry = inventory.item_entries.find((x) => x.item_id === "item-potion");
    assert.ok(entry);
    assert.equal(entry.quantity, 2);
  }, results);

  runTest("insufficient_gold", () => {
    const ctx = createContext();
    ctx.currencyManager.subtractCurrency({ player_id: "player-001", amount: 95 });

    const out = processNpcShopPurchase({
      purchase_key: "purchase-no-gold-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-player-001",
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "insufficient_gold");
    assert.equal(ctx.currencyManager.getCurrencyAccount("player-001").gold_balance, 5);
    assert.equal(ctx.transactionManager.listTransactionsByType("npc_shop_purchase").length, 0);
  }, results);

  runTest("out_of_stock", () => {
    const ctx = createContext();
    const out = processNpcShopPurchase({
      purchase_key: "purchase-oos-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 6,
      inventory_id: "inv-player-001",
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "out_of_stock");
    assert.equal(ctx.npcShopManager.getNpcShop("vendor-001").quantity_map["item-potion"], 5);
  }, results);

  runTest("inactive_shop", () => {
    const ctx = createContext();
    ctx.npcShopManager.updateNpcShop("vendor-001", { shop_active: false });

    const out = processNpcShopPurchase({
      purchase_key: "purchase-inactive-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-player-001",
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "shop_inactive");
  }, results);

  runTest("invalid_item", () => {
    const ctx = createContext();
    const out = processNpcShopPurchase({
      purchase_key: "purchase-invalid-item-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-unknown",
      quantity: 1,
      inventory_id: "inv-player-001",
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "item_not_stocked");
  }, results);

  runTest("invalid_quantity", () => {
    const ctx = createContext();
    const out = processNpcShopPurchase({
      purchase_key: "purchase-bad-qty-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 0,
      inventory_id: "inv-player-001",
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "invalid_quantity");
  }, results);

  runTest("failed_inventory_grant_does_not_consume_gold", () => {
    const ctx = createContext();
    const beforeGold = ctx.currencyManager.getCurrencyAccount("player-001").gold_balance;

    const failingInventoryAdapter = {
      addDropToInventory() {
        return { ok: false, reason: "forced_inventory_failure" };
      }
    };

    const out = processNpcShopPurchase({
      purchase_key: "purchase-inv-fail-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 2,
      inventory_id: "inv-player-001",
      inventoryAdapter: failingInventoryAdapter,
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "inventory_grant_failed");
    assert.equal(ctx.currencyManager.getCurrencyAccount("player-001").gold_balance, beforeGold);
    assert.equal(ctx.npcShopManager.getNpcShop("vendor-001").quantity_map["item-potion"], 5);
  }, results);

  runTest("failed_currency_deduction_does_not_grant_item", () => {
    const ctx = createContext();
    const failingCurrencyManager = {
      hasSufficientFunds() {
        return true;
      },
      subtractCurrency() {
        return { ok: false, event_type: "currency_update_failed", payload: { reason: "forced_failure" } };
      },
      addCurrency() {
        return { ok: true };
      },
      getCurrencyAccount() {
        return { gold_balance: 100 };
      }
    };

    const out = processNpcShopPurchase({
      purchase_key: "purchase-currency-fail-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-player-001",
      currencyManager: failingCurrencyManager,
      npcShopManager: ctx.npcShopManager,
      transactionManager: ctx.transactionManager,
      processedPurchaseStore: ctx.processedPurchaseStore,
      worldStorage: ctx.worldStorage
    });

    const inventory = ctx.worldStorage.inventories.loadInventory("inv-player-001");
    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "currency_deduction_failed");
    assert.equal(inventory, null);
    assert.equal(ctx.transactionManager.listTransactionsByType("npc_shop_purchase").length, 0);
  }, results);

  runTest("repeated_purchase_does_not_create_duplication", () => {
    const ctx = createContext();

    const first = processNpcShopPurchase({
      purchase_key: "purchase-duplicate-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-player-001",
      ...ctx
    });
    const second = processNpcShopPurchase({
      purchase_key: "purchase-duplicate-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-player-001",
      ...ctx
    });

    const account = ctx.currencyManager.getCurrencyAccount("player-001");
    const inventory = ctx.worldStorage.inventories.loadInventory("inv-player-001");
    const entry = inventory.item_entries.find((x) => x.item_id === "item-potion");

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.event_type, "npc_shop_purchase_skipped");
    assert.equal(account.gold_balance, 90);
    assert.equal(entry.quantity, 1);
    assert.equal(ctx.transactionManager.listTransactionsByType("npc_shop_purchase").length, 1);
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
  const summary = runNpcShopPurchaseFlowTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runNpcShopPurchaseFlowTests
};
