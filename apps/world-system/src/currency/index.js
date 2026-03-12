"use strict";

const {
  CURRENCY_ACCOUNT_SCHEMA,
  createCurrencyAccountRecord
} = require("./currency-account.schema");
const {
  InMemoryCurrencyAccountStore,
  CurrencyAccountManager
} = require("./currency-account.manager");

// Default in-memory manager for scaffolding usage.
const defaultCurrencyAccountManager = new CurrencyAccountManager();

function createCurrencyAccount(input) {
  return defaultCurrencyAccountManager.createCurrencyAccount(input);
}

function getCurrencyAccount(player_id) {
  return defaultCurrencyAccountManager.getCurrencyAccount(player_id);
}

function addCurrency(input) {
  return defaultCurrencyAccountManager.addCurrency(input);
}

function subtractCurrency(input) {
  return defaultCurrencyAccountManager.subtractCurrency(input);
}

function hasSufficientFunds(input) {
  return defaultCurrencyAccountManager.hasSufficientFunds(input);
}

module.exports = {
  CURRENCY_ACCOUNT_SCHEMA,
  createCurrencyAccountRecord,
  InMemoryCurrencyAccountStore,
  CurrencyAccountManager,
  defaultCurrencyAccountManager,
  createCurrencyAccount,
  getCurrencyAccount,
  addCurrency,
  subtractCurrency,
  hasSufficientFunds
};

