"use strict";

const { createLootBundleObject } = require("../core/lootModel");

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

const SUPPORTED_SOURCE_CONTEXTS = ["encounter_clear", "boss_clear", "dungeon_complete", "chest_opened"];

function normalizeSourceContext(value) {
  return value ? String(value).trim().toLowerCase() : "";
}

function normalizeRewardCurve(metadata) {
  const curve = metadata && typeof metadata === "object" && metadata.reward_curve && typeof metadata.reward_curve === "object"
    ? metadata.reward_curve
    : {};

  const quantityMultiplier = Number.isFinite(curve.quantity_multiplier)
    ? Math.max(0.1, Number(curve.quantity_multiplier))
    : 1;
  const guaranteedQuantityBonus = Number.isFinite(curve.guaranteed_quantity_bonus)
    ? Math.max(0, Math.floor(Number(curve.guaranteed_quantity_bonus)))
    : 0;
  const weightedBonusRolls = Number.isFinite(curve.weighted_bonus_rolls)
    ? Math.max(0, Math.min(3, Math.floor(Number(curve.weighted_bonus_rolls))))
    : 0;
  const xpMultiplier = Number.isFinite(curve.xp_multiplier)
    ? Math.max(0.1, Number(curve.xp_multiplier))
    : 1;

  return {
    quantity_multiplier: quantityMultiplier,
    guaranteed_quantity_bonus: guaranteedQuantityBonus,
    weighted_bonus_rolls: weightedBonusRolls,
    xp_multiplier: xpMultiplier
  };
}

function normalizeRewardUpdate(metadata, rewardCurve) {
  const raw = metadata && typeof metadata === "object" && metadata.reward_update && typeof metadata.reward_update === "object"
    ? metadata.reward_update
    : {};

  const out = {};
  if (Number.isFinite(raw.gold)) {
    out.gold = Math.max(0, Math.floor(Number(raw.gold)));
  }
  if (Number.isFinite(raw.silver)) {
    out.silver = Math.max(0, Math.floor(Number(raw.silver)));
  }
  if (Number.isFinite(raw.copper)) {
    out.copper = Math.max(0, Math.floor(Number(raw.copper)));
  }
  if (Number.isFinite(raw.xp)) {
    const baseXp = Math.max(0, Math.floor(Number(raw.xp)));
    out.xp = Math.max(0, Math.floor(baseXp * Number(rewardCurve.xp_multiplier || 1)));
  }
  if (raw.reward_key) {
    out.reward_key = String(raw.reward_key);
  }

  return out;
}

function resolveQuantity(entry, randomFn) {
  if (Number.isFinite(entry.quantity)) {
    return Math.max(1, Math.floor(Number(entry.quantity)));
  }

  const min = Number.isFinite(entry.quantity_min) ? Math.max(1, Math.floor(Number(entry.quantity_min))) : 1;
  const max = Number.isFinite(entry.quantity_max) ? Math.max(1, Math.floor(Number(entry.quantity_max))) : min;
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);

  if (safeMax === safeMin) {
    return safeMin;
  }

  const roll = randomFn();
  const boundedRoll = Math.min(Math.max(roll, 0), 0.9999999999);
  const span = safeMax - safeMin + 1;
  return safeMin + Math.floor(boundedRoll * span);
}

function selectWeightedEntry(weightedEntries, randomFn) {
  const entries = Array.isArray(weightedEntries) ? weightedEntries : [];
  if (entries.length === 0) {
    return null;
  }

  const normalized = entries.map((entry) => {
    const weight = Number.isFinite(entry.weight) ? Math.max(0, Number(entry.weight)) : 0;
    return {
      entry,
      weight
    };
  });

  const totalWeight = normalized.reduce((sum, current) => sum + current.weight, 0);
  if (totalWeight <= 0) {
    return normalized[0].entry;
  }

  let roll = randomFn() * totalWeight;
  for (const current of normalized) {
    roll -= current.weight;
    if (roll <= 0) {
      return current.entry;
    }
  }

  return normalized[normalized.length - 1].entry;
}

function toLootEntry(entry, sourceContext, targetPlayerId, randomFn, options) {
  const opts = options && typeof options === "object" ? options : {};
  const curve = opts.reward_curve && typeof opts.reward_curve === "object"
    ? opts.reward_curve
    : normalizeRewardCurve({});
  const baseQuantity = resolveQuantity(entry, randomFn);
  const scaledQuantity = Math.max(1, Math.floor(baseQuantity * Number(curve.quantity_multiplier || 1)));
  const finalQuantity = Math.max(
    1,
    scaledQuantity + (opts.is_guaranteed ? Number(curve.guaranteed_quantity_bonus || 0) : 0)
  );

  return {
    item_id: String(entry.item_id),
    item_name: entry.item_name ? String(entry.item_name) : "Unknown Item",
    rarity: entry.rarity ? String(entry.rarity) : "common",
    quantity: finalQuantity,
    source_type: sourceContext,
    source_id: entry.item_id,
    target_player_id: targetPlayerId || null,
    metadata: {
      rolled_from_table: true
    }
  };
}

function rollLoot(input) {
  const data = input || {};
  const lootTable = data.loot_table;
  const sourceContext = normalizeSourceContext(data.source_context);
  const randomFn = typeof data.random_fn === "function" ? data.random_fn : Math.random;
  const targetPlayerId = data.target_player_id ? String(data.target_player_id) : null;
  const rewardCurve = normalizeRewardCurve(data.metadata);
  const rewardUpdate = normalizeRewardUpdate(data.metadata, rewardCurve);

  if (!lootTable || typeof lootTable !== "object") {
    return failure("loot_roll_failed", "loot_table is required");
  }
  if (!lootTable.loot_table_id || String(lootTable.loot_table_id).trim() === "") {
    return failure("loot_roll_failed", "loot_table.loot_table_id is required");
  }
  if (!SUPPORTED_SOURCE_CONTEXTS.includes(sourceContext)) {
    return failure("loot_roll_failed", "unsupported source_context", {
      source_context: sourceContext,
      supported_source_contexts: clone(SUPPORTED_SOURCE_CONTEXTS)
    });
  }

  const weightedEntries = Array.isArray(lootTable.weighted_entries) ? lootTable.weighted_entries : [];
  const guaranteedEntries = Array.isArray(lootTable.guaranteed_entries) ? lootTable.guaranteed_entries : [];

  const outputEntries = [];

  // Guaranteed drops are always included.
  for (const guaranteedEntry of guaranteedEntries) {
    outputEntries.push(toLootEntry(guaranteedEntry, sourceContext, targetPlayerId, randomFn, {
      reward_curve: rewardCurve,
      is_guaranteed: true
    }));
  }

  const weightedRollCount = 1 + Number(rewardCurve.weighted_bonus_rolls || 0);
  for (let i = 0; i < weightedRollCount; i += 1) {
    const selectedWeighted = selectWeightedEntry(weightedEntries, randomFn);
    if (selectedWeighted) {
      outputEntries.push(toLootEntry(selectedWeighted, sourceContext, targetPlayerId, randomFn, {
        reward_curve: rewardCurve,
        is_guaranteed: false
      }));
    }
  }

  const bundle = createLootBundleObject({
    source_type: sourceContext,
    source_id: String(lootTable.loot_table_id),
    entries: outputEntries,
    metadata: {
      reward_curve: clone(rewardCurve),
      reward_update: clone(rewardUpdate),
      reward_key:
        rewardUpdate.reward_key ||
        (data.metadata && data.metadata.reward_key ? String(data.metadata.reward_key) : null),
      source_context: sourceContext,
      target_player_id: targetPlayerId
    }
  });

  return success("loot_rolled", {
    source_context: sourceContext,
    loot_table_id: String(lootTable.loot_table_id),
    target_player_id: targetPlayerId,
    reward_curve: clone(rewardCurve),
    loot_bundle: bundle
  });
}

module.exports = {
  SUPPORTED_SOURCE_CONTEXTS,
  rollLoot
};
