"use strict";

const assert = require("assert");
const {
  NpcShopManager,
  InMemoryNpcShopStore,
  TransactionManager,
  InMemoryTransactionStore,
  ProcessedNpcShopSellStore,
  processNpcShopSell
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
  const processedSellStore = new ProcessedNpcShopSellStore();
  const worldStorage = {
    inventories: new InMemoryInventoryStore(),
    items: new InMemoryItemStore()
  };

  npcShopManager.createNpcShop({
    vendor_id: "vendor-001",
    vendor_name: "Tarin",
    stock_items: ["item-potion"],
    price_map: { "item-potion": 10 },
    quantity_map: { "item-potion": 1 },
    infinite_stock_items: [],
    shop_active: true
  });

  worldStorage.items.saveItem({
    item_id: "item-potion",
    item_type: "consumable",
    rarity: "common",
    sellable: true
  });
  worldStorage.items.saveItem({
    item_id: "item-quest",
    item_type: "misc",
    rarity: "rare",
    sellable: false
  });

  worldStorage.inventories.saveInventory({
    inventory_id: "inv-player-001",
    owner_character_id: "player-001",
    item_entries: [
      {
        entry_id: "entry-001",
        item_id: "item-potion",
        entry_type: "consumable",
        quantity: 3,
        rarity: "common",
        location: "backpack"
      },
      {
        entry_id: "entry-quest",
        item_id: "item-quest",
        entry_type: "misc",
        quantity: 1,
        rarity: "rare",
        location: "backpack"
      }
    ]
  });

  currencyManager.createCurrencyAccount({
    player_id: "player-001",
    gold_balance: 10
  });

  return {
    npcShopManager,
    currencyManager,
    transactionManager,
    processedSellStore,
    worldStorage
  };
}

function runNpcShopSellFlowTests() {
  const results = [];

  runTest("successful_item_sale", () => {
    const ctx = createContext();
    const out = processNpcShopSell({
      sell_key: "sell-success-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 2,
      inventory_id: "inv-player-001",
      ...ctx
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "npc_shop_sell_success");
    assert.equal(out.payload.gold_earned, 10); // price 10 * 0.5 * qty 2
    assert.equal(ctx.currencyManager.getCurrencyAccount("player-001").gold_balance, 20);
    assert.equal(ctx.transactionManager.listTransactionsByType("npc_shop_sell").length, 1);

    const inv = ctx.worldStorage.inventories.loadInventory("inv-player-001");
    const potionEntry = inv.item_entries.find((x) => x.item_id === "item-potion");
    assert.equal(potionEntry.quantity, 1);
  }, results);

  runTest("attempting_to_sell_missing_item", () => {
    const ctx = createContext();
    // Keep sellability known so this test targets inventory ownership failure.
    ctx.worldStorage.items.saveItem({
      item_id: "item-not-owned",
      item_type: "consumable",
      rarity: "common",
      sellable: true
    });

    const out = processNpcShopSell({
      sell_key: "sell-missing-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-not-owned",
      quantity: 1,
      inventory_id: "inv-player-001",
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "inventory_removal_failed");
    assert.equal(ctx.currencyManager.getCurrencyAccount("player-001").gold_balance, 10);
  }, results);

  runTest("invalid_quantity", () => {
    const ctx = createContext();
    const out = processNpcShopSell({
      sell_key: "sell-invalid-qty-001",
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

  runTest("unsellable_item", () => {
    const ctx = createContext();
    const out = processNpcShopSell({
      sell_key: "sell-unsellable-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-quest",
      quantity: 1,
      inventory_id: "inv-player-001",
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "item_unsellable");
  }, results);

  runTest("inactive_vendor", () => {
    const ctx = createContext();
    ctx.npcShopManager.updateNpcShop("vendor-001", { shop_active: false });

    const out = processNpcShopSell({
      sell_key: "sell-inactive-001",
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

  runTest("failed_inventory_removal_does_not_grant_gold", () => {
    const ctx = createContext();
    const beforeGold = ctx.currencyManager.getCurrencyAccount("player-001").gold_balance;

    const out = processNpcShopSell({
      sell_key: "sell-remove-fail-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-player-001",
      removeItemFromInventory() {
        return { ok: false, reason: "forced_remove_failure" };
      },
      ...ctx
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "inventory_removal_failed");
    assert.equal(ctx.currencyManager.getCurrencyAccount("player-001").gold_balance, beforeGold);
  }, results);

  runTest("failed_gold_payout_does_not_remove_item", () => {
    const ctx = createContext();
    const failingCurrencyManager = {
      addCurrency() {
        return { ok: false, reason: "forced_payout_failure" };
      },
      getCurrencyAccount() {
        return { gold_balance: 10 };
      }
    };

    const beforeInv = JSON.stringify(ctx.worldStorage.inventories.loadInventory("inv-player-001"));
    const out = processNpcShopSell({
      sell_key: "sell-payout-fail-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-player-001",
      currencyManager: failingCurrencyManager,
      npcShopManager: ctx.npcShopManager,
      transactionManager: ctx.transactionManager,
      processedSellStore: ctx.processedSellStore,
      worldStorage: ctx.worldStorage
    });

    const afterInv = JSON.stringify(ctx.worldStorage.inventories.loadInventory("inv-player-001"));
    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "currency_payout_failed");
    assert.equal(afterInv, beforeInv);
    assert.equal(ctx.transactionManager.listTransactionsByType("npc_shop_sell").length, 0);
  }, results);

  runTest("repeat_sell_attempts_do_not_duplicate_payout", () => {
    const ctx = createContext();
    const first = processNpcShopSell({
      sell_key: "sell-duplicate-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-player-001",
      ...ctx
    });
    const second = processNpcShopSell({
      sell_key: "sell-duplicate-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-player-001",
      ...ctx
    });

    const account = ctx.currencyManager.getCurrencyAccount("player-001");
    const inv = ctx.worldStorage.inventories.loadInventory("inv-player-001");
    const potionEntry = inv.item_entries.find((x) => x.item_id === "item-potion");

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.event_type, "npc_shop_sell_skipped");
    assert.equal(account.gold_balance, 15);
    assert.equal(potionEntry.quantity, 2);
    assert.equal(ctx.transactionManager.listTransactionsByType("npc_shop_sell").length, 1);
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
  const summary = runNpcShopSellFlowTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runNpcShopSellFlowTests
};
