"use strict";

const assert = require("assert");
const { EconomySimulationRunner } = require("../../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runEconomyHarnessTests() {
  const results = [];

  runTest("successful_end_to_end_npc_purchase", () => {
    const runner = new EconomySimulationRunner();
    runner.setupMocks();
    const out = runner.scenarioNpcPurchase();

    const hero = runner.currencyManager.getCurrencyAccount(runner.players.hero.player_id);
    const inv = runner.worldStorage.inventories.loadInventory(runner.players.hero.inventory_id);
    const potion = inv.item_entries.find((x) => x.item_id === "item-potion");

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "npc_shop_purchase_success");
    assert.ok(hero.gold_balance < 200);
    assert.ok(potion);
  }, results);

  runTest("successful_end_to_end_npc_sale", () => {
    const runner = new EconomySimulationRunner();
    runner.setupMocks();
    const before = runner.currencyManager.getCurrencyAccount(runner.players.hero.player_id).gold_balance;
    const out = runner.scenarioNpcSale();
    const after = runner.currencyManager.getCurrencyAccount(runner.players.hero.player_id).gold_balance;

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "npc_shop_sell_success");
    assert.ok(after > before);
  }, results);

  runTest("successful_player_shop_transaction", () => {
    const runner = new EconomySimulationRunner();
    runner.setupMocks();
    const listing = runner.scenarioPlayerListing();
    const out = runner.scenarioPlayerPurchase(listing.payload.listing_id);

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "player_shop_purchase_success");
  }, results);

  runTest("insufficient_funds_scenario", () => {
    const runner = new EconomySimulationRunner();
    runner.setupMocks();
    const out = runner.scenarioInsufficientFunds();

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "insufficient_gold");
  }, results);

  runTest("duplicate_purchase_prevention", () => {
    const runner = new EconomySimulationRunner();
    runner.setupMocks();
    const listing = runner.scenarioPlayerListing();
    const first = runner.scenarioPlayerPurchase(listing.payload.listing_id);
    const second = runner.scenarioPlayerPurchase(listing.payload.listing_id);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.event_type, "player_shop_purchase_skipped");
    assert.equal(runner.transactionManager.listTransactionsByType("player_shop_purchase").length, 1);
  }, results);

  runTest("failed_transfer_rollback_behavior", () => {
    const runner = new EconomySimulationRunner();
    runner.setupMocks();
    const listing = runner.scenarioPlayerListing();
    const listingId = listing.payload.listing_id;
    const beforeBuyerGold = runner.currencyManager.getCurrencyAccount(runner.players.rival.player_id).gold_balance;
    const beforeSellerGold = runner.currencyManager.getCurrencyAccount(runner.players.trader.player_id).gold_balance;
    const beforeListing = runner.playerShopManager
      .getPlayerShop("pshop-001")
      .listings.find((x) => x.listing_id === listingId);

    const out = runner.scenarioFailedTransferRollback();
    const afterBuyerGold = runner.currencyManager.getCurrencyAccount(runner.players.rival.player_id).gold_balance;
    const afterSellerGold = runner.currencyManager.getCurrencyAccount(runner.players.trader.player_id).gold_balance;
    const afterListing = runner.playerShopManager
      .getPlayerShop("pshop-001")
      .listings.find((x) => x.listing_id === listingId);

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "item_transfer_failed");
    assert.equal(afterBuyerGold, beforeBuyerGold);
    assert.equal(afterSellerGold, beforeSellerGold);
    assert.equal(afterListing.quantity, beforeListing.quantity);
  }, results);

  runTest("snapshot_restore_correctness", () => {
    const runner = new EconomySimulationRunner();
    runner.setupMocks();
    runner.scenarioNpcPurchase();
    const out = runner.scenarioSnapshotRestore();

    assert.equal(out.snapshot.ok, true);
    assert.equal(out.restore.ok, true);

    const snapHero = out.snapshot.payload.currency_accounts.find((x) => x.player_id === runner.players.hero.player_id);
    const currentHero = runner.currencyManager.getCurrencyAccount(runner.players.hero.player_id);
    assert.equal(currentHero.gold_balance, snapHero.gold_balance);
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
  const summary = runEconomyHarnessTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runEconomyHarnessTests
};

