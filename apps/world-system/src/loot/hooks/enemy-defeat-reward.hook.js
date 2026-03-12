"use strict";

const { resolveLootRoll } = require("../loot-roll.resolver");

class ProcessedEnemyDefeatStore {
  constructor() {
    this.processed = new Set();
  }

  has(eventId) {
    if (!eventId) return false;
    return this.processed.has(eventId);
  }

  add(eventId) {
    if (!eventId) return;
    this.processed.add(eventId);
  }
}

function buildFailure(reason, event, extra) {
  return {
    ok: false,
    event_type: "loot_generation_failed",
    payload: {
      reason,
      source_event_type: event?.event_type || null,
      source_event_id: event?.event_id || null,
      ...(extra || {})
    }
  };
}

/**
 * Process one enemy_defeated event and trigger loot resolution if a loot table exists.
 * This hook is intentionally decoupled from combat internals and only consumes event payloads.
 *
 * Expected event shape:
 * {
 *   event_id: "evt-...",
 *   event_type: "enemy_defeated",
 *   session_id: "...",
 *   party_id: "...",
 *   player_id: "...",
 *   combat_id: "...",
 *   payload: {
 *     enemy_id: "goblin",
 *     loot_table_id?: "table-enemy-goblin-001"
 *   }
 * }
 */
function processEnemyDefeatedRewardHook(input) {
  const data = input || {};
  const event = data.event;
  const lootTableManager = data.lootTableManager;
  const processedEventStore = data.processedEventStore || null;
  const allowDuplicate = Boolean(data.allow_duplicate_events);

  if (!event || event.event_type !== "enemy_defeated") {
    return buildFailure("invalid_event_type", event);
  }
  if (!lootTableManager || typeof lootTableManager.getLootTable !== "function") {
    return buildFailure("loot_table_manager_required", event);
  }

  const enemyId = event.payload?.enemy_id;
  if (!enemyId) {
    return buildFailure("enemy_id_required", event);
  }

  if (!allowDuplicate && processedEventStore && typeof processedEventStore.has === "function") {
    if (processedEventStore.has(event.event_id)) {
      return {
        ok: true,
        event_type: "loot_not_generated",
        payload: {
          reason: "duplicate_enemy_defeat_event",
          source_event_id: event.event_id || null,
          source_type: "enemy",
          source_id: String(enemyId),
          grant_status: "not_granted"
        }
      };
    }
  }

  const explicitTableId = event.payload?.loot_table_id || null;
  const table =
    (explicitTableId && lootTableManager.getLootTable(explicitTableId)) ||
    (typeof lootTableManager.getLootTableBySource === "function"
      ? lootTableManager.getLootTableBySource("enemy", String(enemyId))
      : null);

  if (!table) {
    return {
      ok: true,
      event_type: "loot_not_generated",
      payload: {
        reason: "loot_table_not_found_for_enemy",
        source_type: "enemy",
        source_id: String(enemyId),
        loot_table_id: explicitTableId,
        generated_from_event_id: event.event_id || null,
        generated_from_event_type: event.event_type,
        grant_status: "not_granted"
      }
    };
  }

  const resolved = resolveLootRoll({
    source_type: "enemy",
    source_id: String(enemyId),
    loot_table_id: table.table_id,
    context: {
      session_id: event.session_id || null,
      party_id: event.party_id || null,
      player_id: event.player_id || null,
      combat_id: event.combat_id || null,
      source_event_id: event.event_id || null
    },
    roll_count: event.payload?.roll_count,
    rng: data.rng,
    lootTableManager
  });

  if (!resolved.ok) {
    return buildFailure("loot_roll_resolution_failed", event, {
      source_type: "enemy",
      source_id: String(enemyId),
      loot_table_id: table.table_id,
      resolver_error: resolved.reason || "unknown"
    });
  }

  if (!allowDuplicate && processedEventStore && typeof processedEventStore.add === "function") {
    processedEventStore.add(event.event_id);
  }

  return {
    ok: true,
    event_type: "loot_generated",
    payload: {
      source_type: "enemy",
      source_id: String(enemyId),
      loot_table_id: table.table_id,
      generated_from_event_id: event.event_id || null,
      generated_from_event_type: event.event_type,
      loot_result: resolved.payload,
      grant_status: "not_granted",
      generated_at: new Date().toISOString()
    }
  };
}

module.exports = {
  ProcessedEnemyDefeatStore,
  processEnemyDefeatedRewardHook
};
