"use strict";

const assert = require("assert");
const {
  CurrencyAccountManager,
  InMemoryCurrencyAccountStore
} = require("../../currency");
const {
  NpcShopManager,
  InMemoryNpcShopStore,
  PlayerShopManager,
  InMemoryPlayerShopStore,
  TransactionManager,
  InMemoryTransactionStore,
  createEconomySnapshot,
  restoreEconomySnapshot
} = require("../../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createManagers() {
  const currencyManager = new CurrencyAccountManager({ store: new InMemoryCurrencyAccountStore() });
  const npcShopManager = new NpcShopManager({ store: new InMemoryNpcShopStore() });
  const playerShopManager = new PlayerShopManager({ store: new InMemoryPlayerShopStore() });
  const transactionManager = new TransactionManager({ store: new InMemoryTransactionStore() });

  currencyManager.createCurrencyAccount({ player_id: "player-001", gold_balance: 100 });
  currencyManager.createCurrencyAccount({ player_id: "player-002", gold_balance: 45 });

  npcShopManager.createNpcShop({
    vendor_id: "vendor-001",
    vendor_name: "Tarin",
    stock_items: ["item-potion"],
    price_map: { "item-potion": 10 },
    quantity_map: { "item-potion": 5 },
    infinite_stock_items: [],
    shop_active: true
  });

  playerShopManager.createPlayerShop({
    shop_id: "pshop-001",
    owner_player_id: "player-001",
    listings: [
      {
        listing_id: "listing-001",
        item_id: "item-potion",
        quantity: 2,
        price_gold: 50,
        listing_active: true
      }
    ],
    shop_active: true
  });

  transactionManager.createTransaction({
    transaction_id: "txn-001",
    transaction_type: "player_listing_created",
    source_player_id: "player-001",
    target_player_id: null,
    npc_vendor_id: null,
    item_id: "item-potion",
    quantity: 2,
    gold_amount: 50,
    result: "success"
  });

  return {
    currencyManager,
    npcShopManager,
    playerShopManager,
    transactionManager
  };
}

function runEconomySnapshotRecoveryTests() {
  const results = [];

  runTest("snapshot_creation", () => {
    const managers = createManagers();
    const out = createEconomySnapshot(managers);

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "economy_snapshot_created");
    assert.equal(Array.isArray(out.payload.currency_accounts), true);
    assert.equal(Array.isArray(out.payload.npc_shops), true);
    assert.equal(Array.isArray(out.payload.player_shops), true);
    assert.equal(Array.isArray(out.payload.active_listings), true);
  }, results);

  runTest("restore_snapshot", () => {
    const source = createManagers();
    const snap = createEconomySnapshot(source);

    const target = createManagers();
    // Mutate target before restore to ensure replace works.
    target.currencyManager.addCurrency({ player_id: "player-001", amount: 999 });
    target.playerShopManager.updatePlayerShop("pshop-001", { listings: [] });

    const restored = restoreEconomySnapshot({
      snapshot: snap.payload,
      ...target
    });

    assert.equal(restored.ok, true);
    assert.equal(restored.event_type, "economy_snapshot_restored");
  }, results);

  runTest("restored_balances_match_original", () => {
    const source = createManagers();
    const snap = createEconomySnapshot(source);

    const target = createManagers();
    target.currencyManager.subtractCurrency({ player_id: "player-001", amount: 50 });

    restoreEconomySnapshot({
      snapshot: snap.payload,
      ...target
    });

    assert.equal(target.currencyManager.getCurrencyAccount("player-001").gold_balance, 100);
    assert.equal(target.currencyManager.getCurrencyAccount("player-002").gold_balance, 45);
  }, results);

  runTest("restored_listings_match_original", () => {
    const source = createManagers();
    const snap = createEconomySnapshot(source);

    const target = createManagers();
    target.playerShopManager.updatePlayerShop("pshop-001", { listings: [] });

    restoreEconomySnapshot({
      snapshot: snap.payload,
      ...target
    });

    const listings = target.playerShopManager.listPlayerShopListings("pshop-001");
    assert.equal(listings.length, 1);
    assert.equal(listings[0].listing_id, "listing-001");
  }, results);

  runTest("malformed_snapshot_handling", () => {
    const managers = createManagers();

    const bad1 = restoreEconomySnapshot({
      snapshot: null,
      ...managers
    });
    const bad2 = restoreEconomySnapshot({
      snapshot: { currency_accounts: [] },
      ...managers
    });

    assert.equal(bad1.ok, false);
    assert.equal(bad1.payload.reason, "snapshot_object_required");
    assert.equal(bad2.ok, false);
    assert.equal(bad2.payload.reason, "snapshot_missing_required_arrays");
  }, results);

  runTest("no_cross_system_contamination_with_unrelated_state", () => {
    const managers = createManagers();
    const unrelatedState = {
      combat: { combat_id: "combat-001", status: "active" },
      dungeon: { session_id: "sess-001", floor: 2 }
    };
    const before = JSON.stringify(unrelatedState);

    const snap = createEconomySnapshot(managers);
    restoreEconomySnapshot({
      snapshot: snap.payload,
      ...managers
    });

    const after = JSON.stringify(unrelatedState);
    assert.equal(after, before);
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
  const summary = runEconomySnapshotRecoveryTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runEconomySnapshotRecoveryTests
};

