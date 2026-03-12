"use strict";

const assert = require("assert");
const {
  PlayerTradeManager,
  InMemoryPlayerTradeStore
} = require("../index");
const { InventoryPersistenceBridge } = require("../../../../inventory-system/src/inventory.persistence");
const { createInMemoryAdapter } = require("../../../../database/src/adapters/inMemoryAdapter");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function buildInventory(input) {
  return {
    inventory_id: input.inventory_id,
    owner_type: "player",
    owner_id: input.owner_id,
    stackable_items: (input.stackable_items || []).map((item) => ({
      item_id: item.item_id,
      quantity: item.quantity,
      stackable: true,
      owner_player_id: input.owner_id,
      metadata: {}
    })),
    equipment_items: [],
    quest_items: [],
    currency: { gold: 0, silver: 0, copper: 0 },
    metadata: {}
  };
}

function getItemQuantity(inventory, itemId) {
  return (inventory.stackable_items || [])
    .filter((entry) => entry.item_id === itemId)
    .reduce((sum, entry) => sum + (Number.isFinite(entry.quantity) ? entry.quantity : 0), 0);
}

function runPlayerTradeFoundationTests() {
  const results = [];

  runTest("trade_initiation_accept_decline_cancel_flow", () => {
    const manager = new PlayerTradeManager({ store: new InMemoryPlayerTradeStore() });
    const proposed = manager.proposeTrade({
      trade_id: "trade-found-001",
      initiator_player_id: "player-a",
      counterparty_player_id: "player-b",
      offered: { item_id: "item_herb", quantity: 2 },
      requested: { item_id: "item_ore", quantity: 1 }
    });
    assert.equal(proposed.ok, true);

    const declined = manager.declineTrade({
      trade_id: "trade-found-001",
      acting_player_id: "player-b"
    });
    assert.equal(declined.ok, true);
    assert.equal(declined.payload.trade.trade_state, "declined");

    const proposed2 = manager.proposeTrade({
      trade_id: "trade-found-002",
      initiator_player_id: "player-a",
      counterparty_player_id: "player-b",
      offered: { item_id: "item_herb", quantity: 2 },
      requested: { item_id: "item_ore", quantity: 1 }
    });
    assert.equal(proposed2.ok, true);

    const cancelled = manager.cancelTrade({
      trade_id: "trade-found-002",
      acting_player_id: "player-a"
    });
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.payload.trade.trade_state, "cancelled");
  }, results);

  runTest("trade_accept_executes_once_and_is_atomic", () => {
    const manager = new PlayerTradeManager({ store: new InMemoryPlayerTradeStore() });
    const persistence = new InventoryPersistenceBridge({ adapter: createInMemoryAdapter() });

    const seller = buildInventory({
      inventory_id: "inv-trade-seller",
      owner_id: "player-seller",
      stackable_items: [{ item_id: "item_herb", quantity: 3 }]
    });
    const buyer = buildInventory({
      inventory_id: "inv-trade-buyer",
      owner_id: "player-buyer",
      stackable_items: [{ item_id: "item_ore", quantity: 2 }]
    });
    persistence.saveInventory(seller);
    persistence.saveInventory(buyer);

    const proposed = manager.proposeTrade({
      trade_id: "trade-found-003",
      initiator_player_id: "player-seller",
      counterparty_player_id: "player-buyer",
      offered: { item_id: "item_herb", quantity: 2 },
      requested: { item_id: "item_ore", quantity: 1 }
    });
    assert.equal(proposed.ok, true);

    const accepted = manager.acceptTrade({
      trade_id: "trade-found-003",
      acting_player_id: "player-buyer",
      seller_inventory: seller,
      buyer_inventory: buyer,
      inventoryPersistence: persistence
    });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.payload.trade.trade_state, "completed");

    const duplicateAccept = manager.acceptTrade({
      trade_id: "trade-found-003",
      acting_player_id: "player-buyer",
      seller_inventory: seller,
      buyer_inventory: buyer,
      inventoryPersistence: persistence
    });
    assert.equal(duplicateAccept.ok, false);

    const sellerReload = persistence.loadInventoryById("inv-trade-seller");
    const buyerReload = persistence.loadInventoryById("inv-trade-buyer");
    assert.equal(getItemQuantity(sellerReload.payload.inventory, "item_herb"), 1);
    assert.equal(getItemQuantity(sellerReload.payload.inventory, "item_ore"), 1);
    assert.equal(getItemQuantity(buyerReload.payload.inventory, "item_herb"), 2);
    assert.equal(getItemQuantity(buyerReload.payload.inventory, "item_ore"), 1);
  }, results);

  runTest("trade_accept_executes_currency_exchange_once", () => {
    const manager = new PlayerTradeManager({ store: new InMemoryPlayerTradeStore() });

    const seller = buildInventory({
      inventory_id: "inv-trade-seller-currency",
      owner_id: "player-seller-currency",
      stackable_items: [{ item_id: "item_herb", quantity: 1 }]
    });
    seller.currency.gold = 10;
    const buyer = buildInventory({
      inventory_id: "inv-trade-buyer-currency",
      owner_id: "player-buyer-currency",
      stackable_items: []
    });
    buyer.currency.gold = 25;

    const proposed = manager.proposeTrade({
      trade_id: "trade-found-currency-001",
      initiator_player_id: "player-seller-currency",
      counterparty_player_id: "player-buyer-currency",
      offered: { item_id: "item_herb", quantity: 1 },
      requested: { currency: 15 }
    });
    assert.equal(proposed.ok, true);

    const accepted = manager.acceptTrade({
      trade_id: "trade-found-currency-001",
      acting_player_id: "player-buyer-currency",
      seller_inventory: seller,
      buyer_inventory: buyer
    });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.payload.trade.trade_state, "completed");
    assert.equal(accepted.payload.execution_result.seller_inventory.currency.gold, 25);
    assert.equal(accepted.payload.execution_result.buyer_inventory.currency.gold, 10);
  }, results);

  runTest("trade_rejects_unowned_item", () => {
    const manager = new PlayerTradeManager({ store: new InMemoryPlayerTradeStore() });
    const proposed = manager.proposeTrade({
      trade_id: "trade-found-004",
      initiator_player_id: "player-seller",
      counterparty_player_id: "player-buyer",
      offered: { item_id: "item_herb", quantity: 2 },
      requested: {}
    });
    assert.equal(proposed.ok, true);

    const seller = buildInventory({
      inventory_id: "inv-trade-seller-2",
      owner_id: "player-seller",
      stackable_items: [{ item_id: "item_herb", quantity: 1 }]
    });
    const buyer = buildInventory({
      inventory_id: "inv-trade-buyer-2",
      owner_id: "player-buyer",
      stackable_items: []
    });

    const accepted = manager.acceptTrade({
      trade_id: "trade-found-004",
      acting_player_id: "player-buyer",
      seller_inventory: seller,
      buyer_inventory: buyer
    });
    assert.equal(accepted.ok, false);
    assert.equal(accepted.error, "insufficient_item_quantity");
    assert.equal(manager.getTrade("trade-found-004").trade_state, "pending");
  }, results);

  const passed = results.filter((entry) => entry.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    totals: { total: results.length, passed, failed },
    results
  };
}

if (require.main === module) {
  const summary = runPlayerTradeFoundationTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runPlayerTradeFoundationTests
};
