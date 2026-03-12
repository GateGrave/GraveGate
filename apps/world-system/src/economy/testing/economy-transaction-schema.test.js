"use strict";

const assert = require("assert");
const {
  TransactionManager,
  InMemoryTransactionStore
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
  return new TransactionManager({
    store: new InMemoryTransactionStore()
  });
}

function runEconomyTransactionSchemaTests() {
  const results = [];

  runTest("transaction_creation", () => {
    const manager = createManager();
    const out = manager.createTransaction({
      transaction_id: "txn-001",
      transaction_type: "player_trade",
      source_player_id: "player-a",
      target_player_id: "player-b",
      item_id: "item-potion",
      quantity: 2,
      gold_amount: 50,
      result: "success"
    });

    assert.equal(out.transaction_id, "txn-001");
    assert.equal(out.transaction_type, "player_trade");
    assert.equal(out.quantity, 2);
    assert.equal(out.gold_amount, 50);
  }, results);

  runTest("fetch_transaction", () => {
    const manager = createManager();
    manager.createTransaction({
      transaction_id: "txn-002",
      transaction_type: "vendor_buy",
      source_player_id: "player-a",
      npc_vendor_id: "vendor-001",
      item_id: "item-sword",
      quantity: 1,
      gold_amount: 25,
      result: "pending"
    });

    const loaded = manager.getTransaction("txn-002");
    assert.equal(loaded.transaction_id, "txn-002");
    assert.equal(loaded.npc_vendor_id, "vendor-001");
  }, results);

  runTest("update_result_state", () => {
    const manager = createManager();
    manager.createTransaction({
      transaction_id: "txn-003",
      transaction_type: "vendor_sell",
      source_player_id: "player-a",
      npc_vendor_id: "vendor-002",
      item_id: "item-junk",
      quantity: 1,
      gold_amount: 3,
      result: "pending"
    });

    const updated = manager.updateTransaction("txn-003", {
      result: "success"
    });
    assert.equal(updated.result, "success");
  }, results);

  runTest("list_by_player", () => {
    const manager = createManager();
    manager.createTransaction({
      transaction_id: "txn-004",
      transaction_type: "player_trade",
      source_player_id: "player-a",
      target_player_id: "player-b",
      item_id: "item-1",
      quantity: 1,
      gold_amount: 10,
      result: "success"
    });
    manager.createTransaction({
      transaction_id: "txn-005",
      transaction_type: "player_trade",
      source_player_id: "player-c",
      target_player_id: "player-a",
      item_id: "item-2",
      quantity: 1,
      gold_amount: 15,
      result: "success"
    });
    manager.createTransaction({
      transaction_id: "txn-006",
      transaction_type: "vendor_buy",
      source_player_id: "player-z",
      npc_vendor_id: "vendor-1",
      item_id: "item-3",
      quantity: 1,
      gold_amount: 5,
      result: "success"
    });

    const playerATransactions = manager.listTransactionsByPlayer("player-a");
    assert.equal(playerATransactions.length, 2);
  }, results);

  runTest("list_by_type", () => {
    const manager = createManager();
    manager.createTransaction({
      transaction_id: "txn-007",
      transaction_type: "vendor_buy",
      source_player_id: "player-a",
      npc_vendor_id: "vendor-1",
      item_id: "item-3",
      quantity: 1,
      gold_amount: 5,
      result: "success"
    });
    manager.createTransaction({
      transaction_id: "txn-008",
      transaction_type: "vendor_buy",
      source_player_id: "player-a",
      npc_vendor_id: "vendor-1",
      item_id: "item-4",
      quantity: 1,
      gold_amount: 8,
      result: "success"
    });
    manager.createTransaction({
      transaction_id: "txn-009",
      transaction_type: "player_trade",
      source_player_id: "player-a",
      target_player_id: "player-b",
      item_id: "item-5",
      quantity: 1,
      gold_amount: 9,
      result: "success"
    });

    const vendorBuys = manager.listTransactionsByType("vendor_buy");
    assert.equal(vendorBuys.length, 2);
  }, results);

  runTest("malformed_transaction_rejection", () => {
    const manager = createManager();

    assert.throws(
      () =>
        manager.createTransaction({
          transaction_id: "txn-010",
          transaction_type: "player_trade",
          source_player_id: "player-a",
          quantity: -1,
          gold_amount: 10,
          result: "pending"
        }),
      /non-negative quantity/
    );

    assert.throws(
      () =>
        manager.createTransaction({
          transaction_id: "txn-011",
          transaction_type: "player_trade",
          source_player_id: "player-a",
          quantity: 1,
          gold_amount: -10,
          result: "pending"
        }),
      /non-negative gold_amount/
    );
  }, results);

  runTest("missing_field_handling", () => {
    const manager = createManager();

    assert.throws(
      () =>
        manager.createTransaction({
          transaction_type: "player_trade",
          source_player_id: "player-a",
          quantity: 1,
          gold_amount: 10,
          result: "pending"
        }),
      /transaction_id/
    );

    assert.throws(
      () =>
        manager.createTransaction({
          transaction_id: "txn-012",
          source_player_id: "player-a",
          quantity: 1,
          gold_amount: 10,
          result: "pending"
        }),
      /transaction_type/
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
  const summary = runEconomyTransactionSchemaTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runEconomyTransactionSchemaTests
};

