"use strict";

const assert = require("assert");
const { EconomyTransactionLogger } = require("../../index");
const { InMemoryInventoryStore, InMemoryItemStore } = require("../../../../database/src/world-storage");
const { CurrencyAccountManager, InMemoryCurrencyAccountStore } = require("../../currency");
const { NpcShopManager, InMemoryNpcShopStore } = require("../../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runEconomyTransactionLoggingTests() {
  const results = [];

  runTest("log_creation", () => {
    const logger = new EconomyTransactionLogger();
    const entry = logger.log({
      transaction_id: "txn-001",
      transaction_type: "npc_purchase",
      source_player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 2,
      gold_amount: 40,
      result: "success"
    });

    assert.equal(typeof entry.timestamp, "string");
    assert.equal(entry.transaction_id, "txn-001");
    assert.equal(entry.transaction_type, "npc_purchase");
    assert.equal(entry.result, "success");
  }, results);

  runTest("correct_log_type_assignment", () => {
    const logger = new EconomyTransactionLogger();
    logger.logNpcPurchase({
      transaction_id: "txn-a",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 1,
      gold_spent: 10,
      result: "success"
    });
    logger.logNpcSale({
      transaction_id: "txn-b",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 1,
      gold_earned: 5,
      result: "success"
    });
    logger.logPlayerListingCreated({
      transaction_id: "txn-c",
      owner_player_id: "player-001",
      item_id: "item-potion",
      quantity: 1,
      price_gold: 20,
      result: "success"
    });
    logger.logPlayerPurchase({
      transaction_id: "txn-d",
      buyer_player_id: "buyer-001",
      seller_player_id: "seller-001",
      item_id: "item-potion",
      quantity: 1,
      gold_spent: 20,
      result: "success"
    });
    logger.logRefund({
      transaction_id: "txn-e",
      player_id: "player-001",
      refund_amount: 20,
      result: "success"
    });

    const types = logger.listLogs().map((x) => x.transaction_type);
    assert.deepEqual(types, [
      "npc_purchase",
      "npc_sale",
      "player_listing_created",
      "player_purchase",
      "refund"
    ]);
  }, results);

  runTest("failed_transaction_logging", () => {
    const logger = new EconomyTransactionLogger();
    logger.logFailedTransaction({
      transaction_id: "txn-failed-001",
      player_id: "player-001",
      item_id: "item-potion",
      quantity: 1,
      gold_amount: 20,
      reason: "insufficient_funds"
    });

    const logs = logger.listLogs();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].transaction_type, "failed_transaction");
    assert.equal(logs[0].result, "insufficient_funds");
  }, results);

  runTest("malformed_log_payload_handling", () => {
    const logger = new EconomyTransactionLogger();
    const base = logger.log(null);
    const failed = logger.logFailedTransaction(null);

    assert.equal(base.transaction_type, "unknown");
    assert.equal(failed.transaction_type, "failed_transaction");
    assert.ok(logger.listLogs().length >= 2);
  }, results);

  runTest("logs_do_not_mutate_shop_inventory_currency_state", () => {
    const logger = new EconomyTransactionLogger();
    const inventories = new InMemoryInventoryStore();
    const items = new InMemoryItemStore();
    const currency = new CurrencyAccountManager({ store: new InMemoryCurrencyAccountStore() });
    const shops = new NpcShopManager({ store: new InMemoryNpcShopStore() });

    items.saveItem({ item_id: "item-potion", item_type: "consumable" });
    inventories.saveInventory({
      inventory_id: "inv-player-001",
      owner_character_id: "player-001",
      item_entries: [{ entry_id: "entry-1", item_id: "item-potion", quantity: 3 }]
    });
    currency.createCurrencyAccount({ player_id: "player-001", gold_balance: 100 });
    shops.createNpcShop({
      vendor_id: "vendor-001",
      vendor_name: "Tarin",
      stock_items: ["item-potion"],
      price_map: { "item-potion": 10 },
      quantity_map: { "item-potion": 5 },
      infinite_stock_items: [],
      shop_active: true
    });

    const beforeInventory = JSON.stringify(inventories.loadInventory("inv-player-001"));
    const beforeCurrency = JSON.stringify(currency.getCurrencyAccount("player-001"));
    const beforeShop = JSON.stringify(shops.getNpcShop("vendor-001"));

    logger.logNpcPurchase({
      transaction_id: "txn-state-001",
      player_id: "player-001",
      vendor_id: "vendor-001",
      item_id: "item-potion",
      quantity: 1,
      gold_spent: 10,
      result: "success"
    });

    const afterInventory = JSON.stringify(inventories.loadInventory("inv-player-001"));
    const afterCurrency = JSON.stringify(currency.getCurrencyAccount("player-001"));
    const afterShop = JSON.stringify(shops.getNpcShop("vendor-001"));

    assert.equal(afterInventory, beforeInventory);
    assert.equal(afterCurrency, beforeCurrency);
    assert.equal(afterShop, beforeShop);
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
  const summary = runEconomyTransactionLoggingTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runEconomyTransactionLoggingTests
};

