"use strict";

const assert = require("assert");
const {
  NpcShopManager,
  InMemoryNpcShopStore,
  TransactionManager,
  InMemoryTransactionStore,
  processNpcShopPurchase,
  processNpcShopSell
} = require("../../economy");
const {
  CurrencyAccountManager,
  InMemoryCurrencyAccountStore
} = require("../../currency");
const { createInventoryRecord } = require("../../../../inventory-system/src/inventory.schema");
const {
  addItemToInventory,
  removeItemFromInventory,
  normalizeInventoryShape
} = require("../../../../inventory-system/src/mutationHelpers");

class InMemoryCanonicalInventoryService {
  constructor() {
    this.byId = new Map();
  }

  getInventory(inventory_id) {
    const inv = this.byId.get(String(inventory_id)) || null;
    if (!inv) {
      return { ok: false, payload: { inventory: null }, error: "inventory not found" };
    }
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

function createMutationHelpersSpy() {
  const calls = {
    add: 0,
    remove: 0,
    normalize: 0
  };

  return {
    helpers: {
      addItemToInventory(inventory, item) {
        calls.add += 1;
        return addItemToInventory(inventory, item);
      },
      removeItemFromInventory(inventory, item_id, quantity, options) {
        calls.remove += 1;
        return removeItemFromInventory(inventory, item_id, quantity, options);
      },
      normalizeInventoryShape(inventory) {
        calls.normalize += 1;
        return normalizeInventoryShape(inventory);
      }
    },
    calls
  };
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
    vendor_id: "vendor-mut-001",
    vendor_name: "Mutation Vendor",
    stock_items: ["item-potion"],
    price_map: { "item-potion": 10 },
    quantity_map: { "item-potion": 20 },
    infinite_stock_items: [],
    shop_active: true
  });

  currencyManager.createCurrencyAccount({
    player_id: "player-mut-001",
    gold_balance: 200
  });

  return {
    npcShopManager,
    currencyManager,
    transactionManager,
    inventoryService
  };
}

function runEconomyMutationAlignmentTests() {
  const results = [];

  runTest("purchase_adds_item_correctly", () => {
    const ctx = createContext();
    const spy = createMutationHelpersSpy();

    const out = processNpcShopPurchase({
      player_id: "player-mut-001",
      vendor_id: "vendor-mut-001",
      item_id: "item-potion",
      quantity: 2,
      inventory_id: "inv-mut-001",
      inventoryService: ctx.inventoryService,
      mutation_helpers: spy.helpers,
      npcShopManager: ctx.npcShopManager,
      currencyManager: ctx.currencyManager,
      transactionManager: ctx.transactionManager
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "npc_shop_purchase_success");
    assert.equal(spy.calls.add > 0, true);
    assert.equal(spy.calls.normalize > 0, true);

    const inv = ctx.inventoryService.getInventory("inv-mut-001").payload.inventory;
    assert.equal(Array.isArray(inv.stackable_items), true);
    assert.equal(Array.isArray(inv.equipment_items), true);
    assert.equal(Array.isArray(inv.quest_items), true);
    assert.equal(inv.stackable_items[0].item_id, "item-potion");
    assert.equal(inv.stackable_items[0].quantity, 2);
  }, results);

  runTest("selling_removes_item_correctly", () => {
    const ctx = createContext();
    const spy = createMutationHelpersSpy();

    ctx.inventoryService.saveInventory(
      createInventoryRecord({
        inventory_id: "inv-mut-002",
        owner_type: "player",
        owner_id: "player-mut-001",
        stackable_items: [
          {
            item_id: "item-potion",
            quantity: 3,
            owner_player_id: "player-mut-001",
            stackable: true
          }
        ]
      })
    );

    const out = processNpcShopSell({
      player_id: "player-mut-001",
      vendor_id: "vendor-mut-001",
      item_id: "item-potion",
      quantity: 2,
      inventory_id: "inv-mut-002",
      inventoryService: ctx.inventoryService,
      mutation_helpers: spy.helpers,
      resolve_item_metadata: function resolveItemMetadata() {
        return { item_id: "item-potion", sellable: true };
      },
      npcShopManager: ctx.npcShopManager,
      currencyManager: ctx.currencyManager,
      transactionManager: ctx.transactionManager
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "npc_shop_sell_success");
    assert.equal(spy.calls.remove > 0, true);
    assert.equal(spy.calls.normalize > 0, true);

    const inv = ctx.inventoryService.getInventory("inv-mut-002").payload.inventory;
    assert.equal(inv.stackable_items.length, 1);
    assert.equal(inv.stackable_items[0].quantity, 1);
  }, results);

  runTest("selling_too_many_fails_safely", () => {
    const ctx = createContext();
    const spy = createMutationHelpersSpy();

    ctx.inventoryService.saveInventory(
      createInventoryRecord({
        inventory_id: "inv-mut-003",
        owner_type: "player",
        owner_id: "player-mut-001",
        stackable_items: [
          {
            item_id: "item-potion",
            quantity: 1,
            owner_player_id: "player-mut-001",
            stackable: true
          }
        ]
      })
    );

    const out = processNpcShopSell({
      player_id: "player-mut-001",
      vendor_id: "vendor-mut-001",
      item_id: "item-potion",
      quantity: 2,
      inventory_id: "inv-mut-003",
      inventoryService: ctx.inventoryService,
      mutation_helpers: spy.helpers,
      resolve_item_metadata: function resolveItemMetadata() {
        return { item_id: "item-potion", sellable: true };
      },
      npcShopManager: ctx.npcShopManager,
      currencyManager: ctx.currencyManager,
      transactionManager: ctx.transactionManager
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "npc_shop_sell_failed");
    assert.equal(out.payload.reason, "inventory_removal_failed");
    assert.equal(out.payload.remove_result.reason, "insufficient_item_quantity");
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
  const summary = runEconomyMutationAlignmentTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runEconomyMutationAlignmentTests
};

