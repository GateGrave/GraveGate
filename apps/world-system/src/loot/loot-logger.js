"use strict";

/**
 * Loot logger stores structured records only.
 * It does not mutate gameplay state.
 */
class LootLogger {
  constructor() {
    this.records = [];
  }

  log(record) {
    const data = record && typeof record === "object" ? record : {};
    const entry = {
      timestamp: new Date().toISOString(),
      source_type: data.source_type || null,
      source_id: data.source_id || null,
      player_id: data.player_id || null,
      item_id: data.item_id || null,
      quantity: Number.isFinite(data.quantity) ? data.quantity : null,
      rarity: data.rarity || null,
      result: data.result || "unknown",
      event_kind: data.event_kind || "loot_event",
      metadata:
        data.metadata && typeof data.metadata === "object"
          ? JSON.parse(JSON.stringify(data.metadata))
          : {}
    };

    this.records.push(entry);
    return JSON.parse(JSON.stringify(entry));
  }

  logLootRolled(input) {
    const payload = input?.payload || input || {};
    const sourceType = payload.source_type;
    const sourceId = payload.source_id;
    const playerId = payload.context?.player_id || payload.player_id || null;
    const drops = Array.isArray(payload.all_drops) ? payload.all_drops : [];

    if (drops.length === 0) {
      return [
        this.log({
          event_kind: "loot_rolled",
          source_type: sourceType,
          source_id: sourceId,
          player_id: playerId,
          result: "rolled_no_drops"
        })
      ];
    }

    return drops.map((drop) =>
      this.log({
        event_kind: "loot_rolled",
        source_type: sourceType,
        source_id: sourceId,
        player_id: playerId,
        item_id: drop.item_id,
        quantity: drop.quantity,
        rarity: drop.rarity,
        result: "rolled"
      })
    );
  }

  logLootGranted(input) {
    const payload = input?.payload || input || {};
    const sourceType = payload.source_type;
    const sourceId = payload.source_id;
    const playerId = payload.owner_character_id || payload.player_id || null;
    const results = Array.isArray(payload.drop_results) ? payload.drop_results : [];

    if (results.length === 0) {
      return [
        this.log({
          event_kind: "loot_granted",
          source_type: sourceType,
          source_id: sourceId,
          player_id: playerId,
          result: "granted_no_drop_results"
        })
      ];
    }

    return results
      .filter((x) => x.granted)
      .map((row) =>
        this.log({
          event_kind: "loot_granted",
          source_type: sourceType,
          source_id: sourceId,
          player_id: playerId,
          item_id: row.item_id,
          quantity: row.requested_quantity,
          rarity: row.result?.rarity || null,
          result: "granted",
          metadata: {
            loot_id: row.loot_id,
            inventory_id: row.result?.inventory_id || null
          }
        })
      );
  }

  logLootGrantFailed(input) {
    const payload = input?.payload || input || {};
    const sourceType = payload.source_type;
    const sourceId = payload.source_id;
    const playerId = payload.owner_character_id || payload.player_id || null;
    const results = Array.isArray(payload.drop_results) ? payload.drop_results : [];

    if (results.length === 0) {
      return [
        this.log({
          event_kind: "loot_grant_failed",
          source_type: sourceType,
          source_id: sourceId,
          player_id: playerId,
          result: payload.reason || "grant_failed"
        })
      ];
    }

    return results
      .filter((x) => !x.granted)
      .map((row) =>
        this.log({
          event_kind: "loot_grant_failed",
          source_type: sourceType,
          source_id: sourceId,
          player_id: playerId,
          item_id: row.item_id || null,
          quantity: row.requested_quantity,
          rarity: null,
          result: row.result?.reason || "grant_failed",
          metadata: {
            loot_id: row.loot_id
          }
        })
      );
  }

  listLogs() {
    return JSON.parse(JSON.stringify(this.records));
  }

  clearLogs() {
    this.records = [];
  }
}

module.exports = {
  LootLogger
};
