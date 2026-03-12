"use strict";

const { rollLoot } = require("./rollLoot");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {},
    error: null
  };
}

function failure(eventType, message, payload) {
  return {
    ok: false,
    event_type: eventType,
    payload: payload || {},
    error: message
  };
}

function normalizeContext(value) {
  return value ? String(value).trim().toLowerCase() : "";
}

function resolveBossLoot(input) {
  const data = input || {};
  const lootTable = data.loot_table;
  const rewardContext = normalizeContext(data.reward_context || data.source_context);
  const includeWeightedBonus = data.include_weighted_bonus !== false;
  const targetPlayerId = data.target_player_id ? String(data.target_player_id) : null;

  if (!lootTable || typeof lootTable !== "object") {
    return failure("boss_loot_resolve_failed", "loot_table is required");
  }
  if (!lootTable.loot_table_id || String(lootTable.loot_table_id).trim() === "") {
    return failure("boss_loot_resolve_failed", "loot_table.loot_table_id is required");
  }
  if (rewardContext !== "boss_clear") {
    return failure("boss_loot_resolve_failed", "invalid boss reward context", {
      reward_context: rewardContext
    });
  }

  const tableForRoll = includeWeightedBonus
    ? lootTable
    : {
        ...clone(lootTable),
        weighted_entries: []
      };

  const rolled = rollLoot({
    loot_table: tableForRoll,
    source_context: "boss_clear",
    target_player_id: targetPlayerId,
    random_fn: data.random_fn
  });

  if (!rolled.ok) {
    return failure("boss_loot_resolve_failed", rolled.error || "boss roll failed", {
      roll_result: rolled
    });
  }

  return success("boss_loot_resolved", {
    reward_context: "boss_clear",
    include_weighted_bonus: includeWeightedBonus,
    loot_table_id: String(lootTable.loot_table_id),
    target_player_id: targetPlayerId,
    loot_bundle: rolled.payload.loot_bundle
  });
}

module.exports = {
  resolveBossLoot
};
