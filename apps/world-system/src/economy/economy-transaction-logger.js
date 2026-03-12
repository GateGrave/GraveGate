"use strict";

/**
 * Economy transaction logger.
 * This module stores structured log records only.
 * It does not mutate gameplay state (shops, inventories, or currency).
 */
class EconomyTransactionLogger {
  constructor() {
    this.records = [];
  }

  log(record) {
    const data = record && typeof record === "object" ? record : {};
    const entry = {
      timestamp: new Date().toISOString(),
      transaction_id: data.transaction_id ? String(data.transaction_id) : null,
      transaction_type: data.transaction_type ? String(data.transaction_type) : "unknown",
      source_player_id: data.source_player_id ? String(data.source_player_id) : null,
      target_player_id: data.target_player_id ? String(data.target_player_id) : null,
      vendor_id: data.vendor_id ? String(data.vendor_id) : null,
      item_id: data.item_id ? String(data.item_id) : null,
      quantity: Number.isFinite(data.quantity) ? Math.floor(data.quantity) : null,
      gold_amount: Number.isFinite(data.gold_amount) ? Math.floor(data.gold_amount) : null,
      result: data.result ? String(data.result) : "unknown"
    };

    this.records.push(entry);
    return JSON.parse(JSON.stringify(entry));
  }

  logNpcPurchase(input) {
    const payload = input?.payload || input || {};
    return this.log({
      transaction_id: payload.transaction_id,
      transaction_type: "npc_purchase",
      source_player_id: payload.player_id || payload.source_player_id,
      target_player_id: null,
      vendor_id: payload.vendor_id || payload.npc_vendor_id,
      item_id: payload.item_id,
      quantity: payload.quantity,
      gold_amount: payload.gold_amount || payload.gold_spent,
      result: payload.result || "success"
    });
  }

  logNpcSale(input) {
    const payload = input?.payload || input || {};
    return this.log({
      transaction_id: payload.transaction_id,
      transaction_type: "npc_sale",
      source_player_id: payload.player_id || payload.source_player_id,
      target_player_id: null,
      vendor_id: payload.vendor_id || payload.npc_vendor_id,
      item_id: payload.item_id,
      quantity: payload.quantity,
      gold_amount: payload.gold_amount || payload.gold_earned,
      result: payload.result || "success"
    });
  }

  logPlayerListingCreated(input) {
    const payload = input?.payload || input || {};
    return this.log({
      transaction_id: payload.transaction_id,
      transaction_type: "player_listing_created",
      source_player_id: payload.owner_player_id || payload.source_player_id,
      target_player_id: null,
      vendor_id: null,
      item_id: payload.item_id,
      quantity: payload.quantity,
      gold_amount: payload.price_gold || payload.gold_amount,
      result: payload.result || "success"
    });
  }

  logPlayerPurchase(input) {
    const payload = input?.payload || input || {};
    return this.log({
      transaction_id: payload.transaction_id,
      transaction_type: "player_purchase",
      source_player_id: payload.buyer_player_id || payload.source_player_id,
      target_player_id: payload.seller_player_id || payload.target_player_id,
      vendor_id: null,
      item_id: payload.item_id,
      quantity: payload.quantity,
      gold_amount: payload.gold_amount || payload.gold_spent,
      result: payload.result || "success"
    });
  }

  logRefund(input) {
    const payload = input?.payload || input || {};
    return this.log({
      transaction_id: payload.transaction_id,
      transaction_type: "refund",
      source_player_id: payload.source_player_id || payload.player_id,
      target_player_id: payload.target_player_id || null,
      vendor_id: payload.vendor_id || null,
      item_id: payload.item_id || null,
      quantity: payload.quantity,
      gold_amount: payload.gold_amount || payload.refund_amount,
      result: payload.result || "success"
    });
  }

  logFailedTransaction(input) {
    const payload = input?.payload || input || {};
    return this.log({
      transaction_id: payload.transaction_id || null,
      transaction_type: "failed_transaction",
      source_player_id: payload.source_player_id || payload.player_id || null,
      target_player_id: payload.target_player_id || null,
      vendor_id: payload.vendor_id || payload.npc_vendor_id || null,
      item_id: payload.item_id || null,
      quantity: payload.quantity,
      gold_amount: payload.gold_amount,
      result: payload.result || payload.reason || "failed"
    });
  }

  listLogs() {
    return JSON.parse(JSON.stringify(this.records));
  }

  clearLogs() {
    this.records = [];
  }
}

module.exports = {
  EconomyTransactionLogger
};

