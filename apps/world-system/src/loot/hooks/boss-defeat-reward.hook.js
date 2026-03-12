"use strict";

const { resolveLootRoll } = require("../loot-roll.resolver");

function buildFailure(reason, event, extra) {
  return {
    ok: false,
    event_type: "boss_loot_generation_failed",
    payload: {
      reason,
      source_event_type: event?.event_type || null,
      source_event_id: event?.event_id || null,
      ...(extra || {})
    }
  };
}

/**
 * Process a boss_defeated event and generate boss loot payload:
 * - guaranteed drops always roll
 * - weighted bonus drops roll only when configured
 */
function processBossDefeatedRewardHook(input) {
  const data = input || {};
  const event = data.event;
  const lootTableManager = data.lootTableManager;

  if (!event || event.event_type !== "boss_defeated") {
    return buildFailure("invalid_event_type", event);
  }
  if (!lootTableManager || typeof lootTableManager.getLootTable !== "function") {
    return buildFailure("loot_table_manager_required", event);
  }

  const bossId = event.payload?.boss_id;
  if (!bossId) {
    return buildFailure("boss_id_required", event);
  }

  const explicitTableId = event.payload?.loot_table_id || null;
  const table =
    (explicitTableId && lootTableManager.getLootTable(explicitTableId)) ||
    (typeof lootTableManager.getLootTableBySource === "function"
      ? lootTableManager.getLootTableBySource("boss", String(bossId))
      : null);

  if (!table) {
    return buildFailure("loot_table_not_found_for_boss", event, {
      source_type: "boss",
      source_id: String(bossId),
      loot_table_id: explicitTableId
    });
  }

  // Boss loot tables must define at least one guaranteed drop.
  if (!Array.isArray(table.guaranteed_drops) || table.guaranteed_drops.length === 0) {
    return buildFailure("boss_guaranteed_drop_required", event, {
      source_type: "boss",
      source_id: String(bossId),
      loot_table_id: table.table_id
    });
  }

  // Bonus weighted drops are optional:
  // - event payload can force true/false
  // - otherwise table rarity_rules controls default behavior
  const includeWeighted =
    typeof event.payload?.include_bonus_weighted === "boolean"
      ? event.payload.include_bonus_weighted
      : Boolean(table.rarity_rules?.boss_bonus);

  const rollCount = includeWeighted
    ? Number.isInteger(event.payload?.bonus_roll_count) && event.payload.bonus_roll_count >= 0
      ? event.payload.bonus_roll_count
      : Number.isInteger(table.rarity_rules?.default_roll_count) && table.rarity_rules.default_roll_count > 0
        ? table.rarity_rules.default_roll_count
        : 1
    : 0;

  const resolved = resolveLootRoll({
    source_type: "boss",
    source_id: String(bossId),
    loot_table_id: table.table_id,
    context: {
      session_id: event.session_id || null,
      party_id: event.party_id || null,
      player_id: event.player_id || null,
      combat_id: event.combat_id || null,
      source_event_id: event.event_id || null
    },
    include_weighted: includeWeighted,
    roll_count: rollCount,
    rng: data.rng,
    lootTableManager
  });

  if (!resolved.ok) {
    return buildFailure("boss_loot_roll_resolution_failed", event, {
      source_type: "boss",
      source_id: String(bossId),
      loot_table_id: table.table_id,
      resolver_error: resolved.reason || "unknown"
    });
  }

  return {
    ok: true,
    event_type: "boss_loot_generated",
    payload: {
      source_type: "boss",
      source_id: String(bossId),
      loot_table_id: table.table_id,
      generated_from_event_id: event.event_id || null,
      generated_from_event_type: event.event_type,
      guaranteed_drop_count: resolved.payload.guaranteed_drops.length,
      bonus_weighted_enabled: includeWeighted,
      bonus_weighted_roll_count: rollCount,
      loot_result: resolved.payload,
      grant_status: "not_granted",
      generated_at: new Date().toISOString()
    }
  };
}

module.exports = {
  processBossDefeatedRewardHook
};
