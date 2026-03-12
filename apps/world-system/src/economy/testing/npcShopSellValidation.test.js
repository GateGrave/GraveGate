"use strict";

const assert = require("assert");
const {
  NpcShopManager,
  InMemoryNpcShopStore,
  TransactionManager,
  InMemoryTransactionStore,
  processNpcShopSell
} = require("../../economy");
const {
  CurrencyAccountManager,
  InMemoryCurrencyAccountStore
} = require("../../currency");
const { createInventoryRecord } = require("../../../../inventory-system/src/inventory.schema");

class InMemoryCanonicalInventoryService {
  constructor() {
    this.byId = new Map();
  }

  getInventory(inventory_id) {
    const inv = this.byId.get(String(inventory_id)) || null;
    if (!inv) return { ok: false, payload: { inventory: null }, error: "inventory not found" };
    return { ok: true, payload: { inventory: JSON.parse(JSON.stringify(inv)) }, error: null };
  }

  saveInventory(inventory) {
    if (!inventory || !inventory.inventory_id) {
      return { ok: false, error: "inventory.inventory_id is required" };
    }
    this.byId.set(String(inventory.inventory_id), JSON.parse(JSON.stringify(inventory)));
    return { ok: true, payload: { inventory }, error: null };
  }
}

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
  const inventoryService = new InMemoryCanonicalInventoryService();

  npcShopManager.createNpcShop({
    vendor_id: "vendor-sell-validation-001",
    vendor_name: "Sell Validator",
    stock_items: ["item-potion"],
    price_map: { "item-potion": 10 },
    quantity_map: { "item-potion": 10 },
    infinite_stock_items: [],
    shop_active: true
  });

  currencyManager.createCurrencyAccount({
    player_id: "player-sell-validation-001",
    gold_balance: 0
  });

  inventoryService.saveInventory(
    createInventoryRecord({
      inventory_id: "inv-sell-validation-001",
      owner_type: "player",
      owner_id: "player-sell-validation-001",
      stackable_items: [
        {
          item_id: "item-potion",
          quantity: 3,
          owner_player_id: "player-sell-validation-001",
          stackable: true
        }
      ]
    })
  );

  return {
    npcShopManager,
    currencyManager,
    transactionManager,
    inventoryService
  };
}

function runNpcShopSellValidationTests() {
  const results = [];

  runTest("sellable_item_succeeds", () => {
    const ctx = createContext();
    const out = processNpcShopSell({
      player_id: "player-sell-validation-001",
      vendor_id: "vendor-sell-validation-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-sell-validation-001",
      inventoryService: ctx.inventoryService,
      resolve_item_metadata: function resolveItemMetadata() {
        return { item_id: "item-potion", sellable: true };
      },
      npcShopManager: ctx.npcShopManager,
      currencyManager: ctx.currencyManager,
      transactionManager: ctx.transactionManager
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "npc_shop_sell_success");
  }, results);

  runTest("explicitly_unsellable_item_fails", () => {
    const ctx = createContext();
    const out = processNpcShopSell({
      player_id: "player-sell-validation-001",
      vendor_id: "vendor-sell-validation-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-sell-validation-001",
      inventoryService: ctx.inventoryService,
      resolve_item_metadata: function resolveItemMetadata() {
        return { item_id: "item-potion", sellable: false };
      },
      npcShopManager: ctx.npcShopManager,
      currencyManager: ctx.currencyManager,
      transactionManager: ctx.transactionManager
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "npc_shop_sell_failed");
    assert.equal(out.payload.reason, "item_unsellable");
  }, results);

  runTest("missing_item_metadata_fails_safely", () => {
    const ctx = createContext();
    const out = processNpcShopSell({
      player_id: "player-sell-validation-001",
      vendor_id: "vendor-sell-validation-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-sell-validation-001",
      inventoryService: ctx.inventoryService,
      resolve_item_metadata: function resolveItemMetadata() {
        return null;
      },
      npcShopManager: ctx.npcShopManager,
      currencyManager: ctx.currencyManager,
      transactionManager: ctx.transactionManager
    });

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "item_sellability_unknown");
  }, results);

  runTest("canonical_inventory_service_callers_cannot_bypass_unsellable_checks", () => {
    const ctx = createContext();
    const out = processNpcShopSell({
      player_id: "player-sell-validation-001",
      vendor_id: "vendor-sell-validation-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-sell-validation-001",
      inventoryService: ctx.inventoryService,
      // No item metadata source on purpose.
      npcShopManager: ctx.npcShopManager,
      currencyManager: ctx.currencyManager,
      transactionManager: ctx.transactionManager
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "npc_shop_sell_failed");
    assert.equal(out.payload.reason, "item_sellability_unknown");
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
  const summary = runNpcShopSellValidationTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runNpcShopSellValidationTests
};
