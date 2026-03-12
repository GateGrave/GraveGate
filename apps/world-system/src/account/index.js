"use strict";

const { ACCOUNT_SCHEMA, createAccountRecord } = require("./account.schema");
const { InMemoryAccountStore, AccountManager } = require("./account.manager");
const { AccountRepository } = require("./account.repository");
const { AccountService } = require("./account.service");
const { AccountPersistenceBridge } = require("./account.persistence");

module.exports = {
  ACCOUNT_SCHEMA,
  createAccountRecord,
  InMemoryAccountStore,
  AccountManager,
  AccountRepository,
  AccountService,
  AccountPersistenceBridge
};
