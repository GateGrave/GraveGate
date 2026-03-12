"use strict";

const { createTransactionRecord } = require("./transaction.schema");

class InMemoryTransactionStore {
  constructor() {
    this.transactions = new Map();
  }

  save(transaction) {
    this.transactions.set(transaction.transaction_id, transaction);
    return transaction;
  }

  load(transactionId) {
    if (!transactionId) return null;
    return this.transactions.get(String(transactionId)) || null;
  }

  list() {
    return Array.from(this.transactions.values());
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class TransactionManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryTransactionStore();
  }

  createTransaction(input) {
    const record = createTransactionRecord(input);
    this.store.save(record);
    return clone(record);
  }

  getTransaction(transaction_id) {
    const loaded = this.store.load(transaction_id);
    return loaded ? clone(loaded) : null;
  }

  updateTransaction(transaction_id, updater) {
    const current = this.store.load(transaction_id);
    if (!current) return null;

    let next;
    if (typeof updater === "function") {
      next = updater(clone(current));
    } else {
      next = updater || {};
    }

    if (next && Object.prototype.hasOwnProperty.call(next, "quantity")) {
      const quantity = Number.isFinite(next.quantity) ? Math.floor(next.quantity) : NaN;
      if (!Number.isFinite(quantity) || quantity < 0) {
        throw new Error("updateTransaction requires non-negative quantity");
      }
    }

    if (next && Object.prototype.hasOwnProperty.call(next, "gold_amount")) {
      const goldAmount = Number.isFinite(next.gold_amount) ? Math.floor(next.gold_amount) : NaN;
      if (!Number.isFinite(goldAmount) || goldAmount < 0) {
        throw new Error("updateTransaction requires non-negative gold_amount");
      }
    }

    const finalRecord = {
      ...current,
      ...next,
      transaction_id: current.transaction_id,
      created_at: current.created_at
    };

    this.store.save(finalRecord);
    return clone(finalRecord);
  }

  listTransactionsByPlayer(player_id) {
    if (!player_id || String(player_id).trim() === "") return [];
    const id = String(player_id);

    return this.store
      .list()
      .filter(
        (x) =>
          x.source_player_id === id ||
          x.target_player_id === id
      )
      .map(clone);
  }

  listTransactionsByType(transaction_type) {
    if (!transaction_type || String(transaction_type).trim() === "") return [];
    const type = String(transaction_type);
    return this.store
      .list()
      .filter((x) => x.transaction_type === type)
      .map(clone);
  }
}

module.exports = {
  InMemoryTransactionStore,
  TransactionManager
};

