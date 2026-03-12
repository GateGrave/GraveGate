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
    vendor_id: "vendor-align-001",
    vendor_name: "Alignment Vendor",
    stock_items: ["item-potion", "item-sword"],
    price_map: { "item-potion": 10, "item-sword": 30 },
    quantity_map: { "item-potion": 10, "item-sword": 10 },
    infinite_stock_items: [],
    shop_active: true
  });

  currencyManager.createCurrencyAccount({
    player_id: "player-align-001",
    gold_balance: 200
  });

  return {
    npcShopManager,
    currencyManager,
    transactionManager,
    inventoryService
  };
}

function runEconomyInventoryAlignmentTests() {
  const results = [];

  runTest("npc_purchase_into_canonical_inventory", () => {
    const ctx = createContext();

    const out = processNpcShopPurchase({
      player_id: "player-align-001",
      vendor_id: "vendor-align-001",
      item_id: "item-potion",
      quantity: 2,
      inventory_id: "inv-align-001",
      inventoryService: ctx.inventoryService,
      npcShopManager: ctx.npcShopManager,
      currencyManager: ctx.currencyManager,
      transactionManager: ctx.transactionManager
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "npc_shop_purchase_success");

    const inv = ctx.inventoryService.getInventory("inv-align-001").payload.inventory;
    assert.equal(Array.isArray(inv.stackable_items), true);
    assert.equal(Array.isArray(inv.equipment_items), true);
    assert.equal(Array.isArray(inv.quest_items), true);
    assert.equal(inv.stackable_items.length, 1);
    assert.equal(inv.stackable_items[0].item_id, "item-potion");
    assert.equal(inv.stackable_items[0].quantity, 2);
    assert.equal(ctx.currencyManager.getCurrencyAccount("player-align-001").gold_balance, 180);
  }, results);

  runTest("npc_sell_from_canonical_inventory", () => {
    const ctx = createContext();

    ctx.inventoryService.saveInventory(
      createInventoryRecord({
        inventory_id: "inv-align-002",
        owner_type: "player",
        owner_id: "player-align-001",
        stackable_items: [
          {
            item_id: "item-potion",
            quantity: 3,
            owner_player_id: "player-align-001",
            stackable: true
          }
        ]
      })
    );

    const out = processNpcShopSell({
      player_id: "player-align-001",
      vendor_id: "vendor-align-001",
      item_id: "item-potion",
      quantity: 2,
      inventory_id: "inv-align-002",
      inventoryService: ctx.inventoryService,
      // Provide explicit sellability metadata for canonical inventory path.
      resolve_item_metadata: function resolveItemMetadata() {
        return { item_id: "item-potion", sellable: true };
      },
      npcShopManager: ctx.npcShopManager,
      currencyManager: ctx.currencyManager,
      transactionManager: ctx.transactionManager
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "npc_shop_sell_success");

    const inv = ctx.inventoryService.getInventory("inv-align-002").payload.inventory;
    assert.equal(inv.stackable_items.length, 1);
    assert.equal(inv.stackable_items[0].quantity, 1);
    assert.equal(ctx.currencyManager.getCurrencyAccount("player-align-001").gold_balance, 210);
  }, results);

  runTest("failure_on_invalid_inventory_service_input", () => {
    const ctx = createContext();

    const out = processNpcShopPurchase({
      player_id: "player-align-001",
      vendor_id: "vendor-align-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-align-003",
      inventoryService: {},
      npcShopManager: ctx.npcShopManager,
      currencyManager: ctx.currencyManager,
      transactionManager: ctx.transactionManager
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "npc_shop_purchase_failed");
    assert.equal(out.payload.reason, "invalid_inventory_service");
  }, results);

  runTest("failure_on_insufficient_item_quantity_when_selling", () => {
    const ctx = createContext();

    ctx.inventoryService.saveInventory(
      createInventoryRecord({
        inventory_id: "inv-align-004",
        owner_type: "player",
        owner_id: "player-align-001",
        stackable_items: [
          {
            item_id: "item-potion",
            quantity: 1,
            owner_player_id: "player-align-001",
            stackable: true
          }
        ]
      })
    );

    const out = processNpcShopSell({
      player_id: "player-align-001",
      vendor_id: "vendor-align-001",
      item_id: "item-potion",
      quantity: 2,
      inventory_id: "inv-align-004",
      inventoryService: ctx.inventoryService,
      // Provide explicit sellability metadata so this test validates quantity failure path.
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
  const summary = runEconomyInventoryAlignmentTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runEconomyInventoryAlignmentTests
};
