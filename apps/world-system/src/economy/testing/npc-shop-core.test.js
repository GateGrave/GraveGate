"use strict";

const assert = require("assert");
const {
  NpcShopManager,
  InMemoryNpcShopStore
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
  return new NpcShopManager({
    store: new InMemoryNpcShopStore()
  });
}

function createSampleShop(manager, overrides) {
  return manager.createNpcShop({
    vendor_id: "vendor-001",
    vendor_name: "Tarin",
    stock_items: ["item-potion", "item-scroll", "item-arrow"],
    price_map: {
      "item-potion": 25,
      "item-scroll": 80,
      "item-arrow": 1
    },
    quantity_map: {
      "item-potion": 3,
      "item-scroll": 1,
      "item-arrow": 0
    },
    infinite_stock_items: ["item-arrow"],
    shop_active: true,
    ...(overrides || {})
  });
}

function runNpcShopCoreTests() {
  const results = [];

  runTest("shop_creation", () => {
    const manager = createManager();
    const shop = createSampleShop(manager);
    assert.equal(shop.vendor_id, "vendor-001");
    assert.equal(shop.vendor_name, "Tarin");
    assert.equal(Array.isArray(shop.stock_items), true);
    assert.equal(Array.isArray(shop.infinite_stock_items), true);
  }, results);

  runTest("listing_stock", () => {
    const manager = createManager();
    createSampleShop(manager);
    const items = manager.listNpcShopItems("vendor-001");
    assert.equal(items.length, 3);
    const potion = items.find((x) => x.item_id === "item-potion");
    assert.equal(potion.price_gold, 25);
  }, results);

  runTest("limited_stock_item_availability", () => {
    const manager = createManager();
    createSampleShop(manager);

    const potion = manager.isItemAvailableInNpcShop({
      vendor_id: "vendor-001",
      item_id: "item-potion"
    });
    const scroll = manager.isItemAvailableInNpcShop({
      vendor_id: "vendor-001",
      item_id: "item-scroll"
    });

    assert.equal(potion.ok, true);
    assert.equal(potion.item_available, true);
    assert.equal(potion.infinite_stock, false);
    assert.equal(scroll.item_available, true);
  }, results);

  runTest("infinite_stock_item_availability", () => {
    const manager = createManager();
    createSampleShop(manager);
    const arrow = manager.isItemAvailableInNpcShop({
      vendor_id: "vendor-001",
      item_id: "item-arrow"
    });
    assert.equal(arrow.ok, true);
    assert.equal(arrow.item_available, true);
    assert.equal(arrow.infinite_stock, true);
    assert.equal(arrow.quantity_available, null);
  }, results);

  runTest("inactive_shop_behavior", () => {
    const manager = createManager();
    createSampleShop(manager, { shop_active: false });

    const items = manager.listNpcShopItems("vendor-001");
    const potion = manager.isItemAvailableInNpcShop({
      vendor_id: "vendor-001",
      item_id: "item-potion"
    });

    assert.equal(items.length, 0);
    assert.equal(potion.ok, true);
    assert.equal(potion.item_available, false);
    assert.equal(potion.reason, "shop_inactive");
  }, results);

  runTest("invalid_vendor_id_handling", () => {
    const manager = createManager();
    assert.throws(() => createSampleShop(manager, { vendor_id: "" }), /vendor_id/);

    const out = manager.isItemAvailableInNpcShop({
      vendor_id: "",
      item_id: "item-potion"
    });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "vendor_id_required");
  }, results);

  runTest("missing_item_lookup_handling", () => {
    const manager = createManager();
    createSampleShop(manager);

    const missing = manager.isItemAvailableInNpcShop({
      vendor_id: "vendor-001",
      item_id: "item-does-not-exist"
    });

    assert.equal(missing.ok, true);
    assert.equal(missing.item_available, false);
    assert.equal(missing.reason, "item_not_stocked");
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
  const summary = runNpcShopCoreTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runNpcShopCoreTests
};

