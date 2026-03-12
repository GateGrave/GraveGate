"use strict";

const assert = require("assert");
const { processPlayerTrade } = require("../player-trade.flow");
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
    stackable_items: (input.stackable_items || []).map(function mapItem(item) {
      return {
        item_id: item.item_id,
        quantity: item.quantity,
        stackable: true,
        owner_player_id: input.owner_id,
        metadata: {}
      };
    }),
    equipment_items: [],
    quest_items: [],
    currency: { gold: 0, silver: 0, copper: 0 },
    metadata: {}
  };
}

function getItemQuantity(inventory, itemId) {
  return (inventory.stackable_items || [])
    .filter(function onlyItem(entry) {
      return entry.item_id === itemId;
    })
    .reduce(function sum(total, entry) {
      return total + (Number.isFinite(entry.quantity) ? entry.quantity : 0);
    }, 0);
}

function runPlayerTradeFlowTests() {
  const results = [];

  runTest("player_trade_transaction_validation_success", () => {
    const seller = buildInventory({
      inventory_id: "inv-seller-001",
      owner_id: "player-seller-001",
      stackable_items: [{ item_id: "item_herb", quantity: 5 }]
    });
    const buyer = buildInventory({
      inventory_id: "inv-buyer-001",
      owner_id: "player-buyer-001",
      stackable_items: [{ item_id: "item_ore", quantity: 4 }]
    });

    const out = processPlayerTrade({
      seller_player_id: "player-seller-001",
      buyer_player_id: "player-buyer-001",
      seller_inventory: seller,
      buyer_inventory: buyer,
      offered_item_id: "item_herb",
      offered_quantity: 2,
      requested_item_id: "item_ore",
      requested_quantity: 1
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "player_trade_completed");
    assert.equal(getItemQuantity(out.payload.seller_inventory, "item_herb"), 3);
    assert.equal(getItemQuantity(out.payload.seller_inventory, "item_ore"), 1);
    assert.equal(getItemQuantity(out.payload.buyer_inventory, "item_herb"), 2);
    assert.equal(getItemQuantity(out.payload.buyer_inventory, "item_ore"), 3);
  }, results);

  runTest("player_trade_supports_gold_currency_exchange", () => {
    const seller = buildInventory({
      inventory_id: "inv-seller-currency-001",
      owner_id: "player-seller-currency-001",
      stackable_items: [{ item_id: "item_herb", quantity: 1 }]
    });
    seller.currency.gold = 75;
    const buyer = buildInventory({
      inventory_id: "inv-buyer-currency-001",
      owner_id: "player-buyer-currency-001",
      stackable_items: [{ item_id: "item_ore", quantity: 1 }]
    });
    buyer.currency.gold = 20;

    const out = processPlayerTrade({
      seller_player_id: "player-seller-currency-001",
      buyer_player_id: "player-buyer-currency-001",
      seller_inventory: seller,
      buyer_inventory: buyer,
      offered_item_id: "item_herb",
      offered_quantity: 1,
      requested_currency: 15
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.seller_inventory.currency.gold, 90);
    assert.equal(out.payload.buyer_inventory.currency.gold, 5);
    assert.equal(getItemQuantity(out.payload.buyer_inventory, "item_herb"), 1);
  }, results);

  runTest("player_trade_fails_on_invalid_ownership_or_quantity", () => {
    const seller = buildInventory({
      inventory_id: "inv-seller-002",
      owner_id: "player-seller-002",
      stackable_items: [{ item_id: "item_herb", quantity: 1 }]
    });
    const buyer = buildInventory({
      inventory_id: "inv-buyer-002",
      owner_id: "player-buyer-002",
      stackable_items: [{ item_id: "item_ore", quantity: 1 }]
    });

    const out = processPlayerTrade({
      seller_player_id: "player-seller-002",
      buyer_player_id: "player-buyer-002",
      seller_inventory: seller,
      buyer_inventory: buyer,
      offered_item_id: "item_herb",
      offered_quantity: 3
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "player_trade_failed");
    assert.equal(out.error, "insufficient_item_quantity");
  }, results);

  runTest("player_trade_persistence_survival", () => {
    const persistence = new InventoryPersistenceBridge({ adapter: createInMemoryAdapter() });

    const seller = buildInventory({
      inventory_id: "inv-seller-003",
      owner_id: "player-seller-003",
      stackable_items: [{ item_id: "item_herb", quantity: 4 }]
    });
    const buyer = buildInventory({
      inventory_id: "inv-buyer-003",
      owner_id: "player-buyer-003",
      stackable_items: [{ item_id: "item_ore", quantity: 2 }]
    });

    persistence.saveInventory(seller);
    persistence.saveInventory(buyer);

    const out = processPlayerTrade({
      seller_player_id: "player-seller-003",
      buyer_player_id: "player-buyer-003",
      seller_inventory: seller,
      buyer_inventory: buyer,
      offered_item_id: "item_herb",
      offered_quantity: 1,
      requested_item_id: "item_ore",
      requested_quantity: 1,
      inventoryPersistence: persistence
    });
    assert.equal(out.ok, true);

    const loadedSeller = persistence.loadInventoryById("inv-seller-003");
    const loadedBuyer = persistence.loadInventoryById("inv-buyer-003");
    assert.equal(loadedSeller.ok, true);
    assert.equal(loadedBuyer.ok, true);
    assert.equal(getItemQuantity(loadedSeller.payload.inventory, "item_herb"), 3);
    assert.equal(getItemQuantity(loadedSeller.payload.inventory, "item_ore"), 1);
    assert.equal(getItemQuantity(loadedBuyer.payload.inventory, "item_herb"), 1);
  }, results);

  runTest("player_trade_fails_cleanly_on_invalid_targets", () => {
    const seller = buildInventory({
      inventory_id: "inv-seller-004",
      owner_id: "player-seller-004",
      stackable_items: [{ item_id: "item_herb", quantity: 2 }]
    });
    const buyer = buildInventory({
      inventory_id: "inv-buyer-004",
      owner_id: "player-buyer-004",
      stackable_items: [{ item_id: "item_ore", quantity: 2 }]
    });

    const out = processPlayerTrade({
      seller_player_id: "player-seller-004",
      buyer_player_id: "player-buyer-404",
      seller_inventory: seller,
      buyer_inventory: buyer,
      offered_item_id: "item_herb",
      offered_quantity: 1,
      validatePlayerExists: function validatePlayerExists(playerId) {
        return { ok: playerId !== "player-buyer-404" };
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "player_trade_failed");
    assert.equal(out.error, "buyer player not found");
  }, results);

  runTest("player_trade_fails_when_currency_is_not_owned", () => {
    const seller = buildInventory({
      inventory_id: "inv-seller-currency-002",
      owner_id: "player-seller-currency-002",
      stackable_items: [{ item_id: "item_herb", quantity: 1 }]
    });
    const buyer = buildInventory({
      inventory_id: "inv-buyer-currency-002",
      owner_id: "player-buyer-currency-002",
      stackable_items: []
    });
    buyer.currency.gold = 3;

    const out = processPlayerTrade({
      seller_player_id: "player-seller-currency-002",
      buyer_player_id: "player-buyer-currency-002",
      seller_inventory: seller,
      buyer_inventory: buyer,
      offered_item_id: "item_herb",
      offered_quantity: 1,
      requested_currency: 5
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "insufficient_gold_currency");
  }, results);

  runTest("valid_trade_executes_atomically_with_persistence_failure_rollback", () => {
    const persistence = new InventoryPersistenceBridge({ adapter: createInMemoryAdapter() });

    const seller = buildInventory({
      inventory_id: "inv-seller-005",
      owner_id: "player-seller-005",
      stackable_items: [{ item_id: "item_herb", quantity: 5 }]
    });
    const buyer = buildInventory({
      inventory_id: "inv-buyer-005",
      owner_id: "player-buyer-005",
      stackable_items: [{ item_id: "item_ore", quantity: 3 }]
    });
    persistence.saveInventory(seller);
    persistence.saveInventory(buyer);

    const originalSaveInventory = persistence.saveInventory.bind(persistence);
    let saveCount = 0;
    persistence.saveInventory = function wrappedSave(inventory) {
      saveCount += 1;
      if (saveCount === 2) {
        return {
          ok: false,
          event_type: "inventory_persistence_save_failed",
          payload: {},
          error: "forced_buyer_save_failure"
        };
      }
      return originalSaveInventory(inventory);
    };

    const out = processPlayerTrade({
      seller_player_id: "player-seller-005",
      buyer_player_id: "player-buyer-005",
      seller_inventory: seller,
      buyer_inventory: buyer,
      offered_item_id: "item_herb",
      offered_quantity: 2,
      requested_item_id: "item_ore",
      requested_quantity: 1,
      inventoryPersistence: persistence
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "failed to persist buyer inventory");

    persistence.saveInventory = originalSaveInventory;
    const sellerReload = persistence.loadInventoryById("inv-seller-005");
    const buyerReload = persistence.loadInventoryById("inv-buyer-005");
    assert.equal(sellerReload.ok, true);
    assert.equal(buyerReload.ok, true);
    assert.equal(getItemQuantity(sellerReload.payload.inventory, "item_herb"), 5);
    assert.equal(getItemQuantity(sellerReload.payload.inventory, "item_ore"), 0);
    assert.equal(getItemQuantity(buyerReload.payload.inventory, "item_ore"), 3);
    assert.equal(getItemQuantity(buyerReload.payload.inventory, "item_herb"), 0);
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
  const summary = runPlayerTradeFlowTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runPlayerTradeFlowTests
};
