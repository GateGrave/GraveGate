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
    vendor_id: "vendor-ownership-001",
    vendor_name: "Ownership Vendor",
    stock_items: ["item-potion"],
    price_map: { "item-potion": 10 },
    quantity_map: { "item-potion": 10 },
    infinite_stock_items: [],
    shop_active: true
  });

  currencyManager.createCurrencyAccount({
    player_id: "player-owner-001",
    gold_balance: 0
  });
  currencyManager.createCurrencyAccount({
    player_id: "player-other-001",
    gold_balance: 0
  });

  return {
    npcShopManager,
    currencyManager,
    transactionManager,
    inventoryService
  };
}

function runNpcShopSellOwnershipTests() {
  const results = [];

  runTest("owned_item_can_be_sold_by_correct_owner", () => {
    const ctx = createContext();
    ctx.inventoryService.saveInventory(
      createInventoryRecord({
        inventory_id: "inv-ownership-001",
        owner_type: "player",
        owner_id: "player-owner-001",
        stackable_items: [
          {
            item_id: "item-potion",
            quantity: 2,
            owner_player_id: "player-owner-001",
            stackable: true
          }
        ]
      })
    );

    const out = processNpcShopSell({
      player_id: "player-owner-001",
      vendor_id: "vendor-ownership-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-ownership-001",
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

  runTest("owned_item_cannot_be_sold_by_wrong_owner", () => {
    const ctx = createContext();
    ctx.inventoryService.saveInventory(
      createInventoryRecord({
        inventory_id: "inv-ownership-002",
        owner_type: "player",
        owner_id: "player-owner-001",
        stackable_items: [
          {
            item_id: "item-potion",
            quantity: 2,
            owner_player_id: "player-owner-001",
            stackable: true
          }
        ]
      })
    );

    const out = processNpcShopSell({
      player_id: "player-other-001",
      vendor_id: "vendor-ownership-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-ownership-002",
      inventoryService: ctx.inventoryService,
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
    assert.equal(out.payload.remove_result.reason, "item_not_owned");
  }, results);

  runTest("missing_owner_player_id_fails_safely", () => {
    const ctx = createContext();
    ctx.inventoryService.saveInventory(
      createInventoryRecord({
        inventory_id: "inv-ownership-003",
        owner_type: "player",
        owner_id: "player-owner-001",
        stackable_items: [
          {
            item_id: "item-potion",
            quantity: 2,
            stackable: true
          }
        ]
      })
    );

    const out = processNpcShopSell({
      player_id: "player-owner-001",
      vendor_id: "vendor-ownership-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-ownership-003",
      inventoryService: ctx.inventoryService,
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
    assert.equal(out.payload.remove_result.reason, "ownership_unknown");
  }, results);

  runTest("explicitly_shared_or_unowned_item_can_be_sold_when_marked", () => {
    const ctx = createContext();
    ctx.inventoryService.saveInventory(
      createInventoryRecord({
        inventory_id: "inv-ownership-004",
        owner_type: "player",
        owner_id: "player-owner-001",
        stackable_items: [
          {
            item_id: "item-potion",
            quantity: 2,
            stackable: true,
            ownership_type: "shared"
          }
        ]
      })
    );

    const out = processNpcShopSell({
      player_id: "player-owner-001",
      vendor_id: "vendor-ownership-001",
      item_id: "item-potion",
      quantity: 1,
      inventory_id: "inv-ownership-004",
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
  const summary = runNpcShopSellOwnershipTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runNpcShopSellOwnershipTests
};
