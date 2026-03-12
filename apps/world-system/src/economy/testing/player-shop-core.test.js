"use strict";

const assert = require("assert");
const {
  PlayerShopManager,
  InMemoryPlayerShopStore
} = require("../../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createManager() {
  return new PlayerShopManager({
    store: new InMemoryPlayerShopStore()
  });
}

function sampleShop() {
  return {
    shop_id: "pshop-001",
    owner_player_id: "player-001",
    listings: [
      { listing_id: "list-1", item_id: "item-potion", quantity: 2, price_gold: 30, listing_active: true },
      { listing_id: "list-2", item_id: "item-scroll", quantity: 1, price_gold: 120, listing_active: true }
    ],
    shop_active: true
  };
}

function runPlayerShopCoreTests() {
  const results = [];

  runTest("shop_creation", () => {
    const manager = createManager();
    const created = manager.createPlayerShop(sampleShop());
    assert.equal(created.shop_id, "pshop-001");
    assert.equal(created.owner_player_id, "player-001");
    assert.equal(created.shop_active, true);
    assert.equal(Array.isArray(created.listings), true);
  }, results);

  runTest("listing_retrieval", () => {
    const manager = createManager();
    manager.createPlayerShop(sampleShop());
    const listings = manager.listPlayerShopListings("pshop-001");
    assert.equal(listings.length, 2);
    assert.equal(listings[0].item_id, "item-potion");
  }, results);

  runTest("inactive_shop_behavior", () => {
    const manager = createManager();
    manager.createPlayerShop(sampleShop());
    manager.updatePlayerShop("pshop-001", { shop_active: false });

    const listings = manager.listPlayerShopListings("pshop-001");
    assert.equal(listings.length, 0);
  }, results);

  runTest("invalid_owner_handling", () => {
    const manager = createManager();
    assert.throws(
      () =>
        manager.createPlayerShop({
          shop_id: "pshop-bad-001",
          owner_player_id: "",
          listings: []
        }),
      /owner_player_id/
    );
  }, results);

  runTest("deactivate_shop", () => {
    const manager = createManager();
    manager.createPlayerShop(sampleShop());
    const updated = manager.deactivatePlayerShop("pshop-001");

    assert.equal(updated.shop_active, false);
    assert.equal(manager.getPlayerShop("pshop-001").shop_active, false);
  }, results);

  runTest("malformed_shop_data_rejection", () => {
    const manager = createManager();

    assert.throws(
      () =>
        manager.createPlayerShop({
          owner_player_id: "player-001",
          listings: []
        }),
      /shop_id/
    );

    assert.throws(
      () =>
        manager.createPlayerShop({
          shop_id: "pshop-bad-002",
          owner_player_id: "player-001",
          listings: "not-an-array"
        }),
      /listings to be an array/
    );
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
  const summary = runPlayerShopCoreTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runPlayerShopCoreTests
};
