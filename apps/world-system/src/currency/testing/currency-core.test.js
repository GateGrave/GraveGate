"use strict";

const assert = require("assert");
const {
  CurrencyAccountManager,
  InMemoryCurrencyAccountStore
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
  return new CurrencyAccountManager({
    store: new InMemoryCurrencyAccountStore()
  });
}

function runCurrencyCoreTests() {
  const results = [];

  runTest("account_creation", () => {
    const manager = createManager();
    const account = manager.createCurrencyAccount({
      player_id: "player-001"
    });

    assert.equal(account.player_id, "player-001");
    assert.equal(account.gold_balance, 0);
    assert.equal(account.balances.gold, 0);
    assert.equal(typeof account.updated_at, "string");
  }, results);

  runTest("add_currency", () => {
    const manager = createManager();
    manager.createCurrencyAccount({ player_id: "player-001" });
    const out = manager.addCurrency({
      player_id: "player-001",
      amount: 25
    });

    const account = manager.getCurrencyAccount("player-001");
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "currency_added");
    assert.equal(account.gold_balance, 25);
  }, results);

  runTest("subtract_currency", () => {
    const manager = createManager();
    manager.createCurrencyAccount({ player_id: "player-001", gold_balance: 50 });
    const out = manager.subtractCurrency({
      player_id: "player-001",
      amount: 20
    });

    const account = manager.getCurrencyAccount("player-001");
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "currency_subtracted");
    assert.equal(account.gold_balance, 30);
  }, results);

  runTest("sufficient_funds_validation", () => {
    const manager = createManager();
    manager.createCurrencyAccount({ player_id: "player-001", gold_balance: 100 });

    const hasFunds = manager.hasSufficientFunds({
      player_id: "player-001",
      amount: 75
    });
    assert.equal(hasFunds, true);
  }, results);

  runTest("insufficient_funds_rejection", () => {
    const manager = createManager();
    manager.createCurrencyAccount({ player_id: "player-001", gold_balance: 10 });
    const out = manager.subtractCurrency({
      player_id: "player-001",
      amount: 999
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "currency_subtract_rejected");
    assert.equal(out.payload.reason, "insufficient_funds");
  }, results);

  runTest("invalid_player_id_handling", () => {
    const manager = createManager();

    assert.throws(() => manager.createCurrencyAccount({}), /player_id/);

    const addFail = manager.addCurrency({ player_id: "", amount: 1 });
    const subtractFail = manager.subtractCurrency({ player_id: null, amount: 1 });
    const hasFunds = manager.hasSufficientFunds({ player_id: "", amount: 1 });

    assert.equal(addFail.ok, false);
    assert.equal(addFail.payload.reason, "player_id_required");
    assert.equal(subtractFail.ok, false);
    assert.equal(subtractFail.payload.reason, "player_id_required");
    assert.equal(hasFunds, false);
  }, results);

  runTest("negative_balance_prevention", () => {
    const manager = createManager();
    manager.createCurrencyAccount({ player_id: "player-001", gold_balance: 5 });

    const out = manager.subtractCurrency({
      player_id: "player-001",
      amount: 6
    });
    const account = manager.getCurrencyAccount("player-001");

    assert.equal(out.ok, false);
    assert.equal(account.gold_balance, 5);
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
  const summary = runCurrencyCoreTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCurrencyCoreTests
};

