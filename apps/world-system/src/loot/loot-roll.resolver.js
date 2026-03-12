"use strict";

function weightedChoice(possibleDrops, dropWeights, rng) {
  const randomFn = typeof rng === "function" ? rng : Math.random;
  const choices = Array.isArray(possibleDrops) ? possibleDrops : [];
  if (choices.length === 0) return null;

  const weighted = choices.map((drop) => ({
    drop,
    weight: Number(dropWeights?.[drop.item_id] ?? drop.weight ?? 0)
  }));

  const totalWeight = weighted.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (totalWeight <= 0) {
    return weighted[0].drop;
  }

  let roll = randomFn() * totalWeight;
  for (const entry of weighted) {
    roll -= Math.max(0, entry.weight);
    if (roll <= 0) return entry.drop;
  }

  return weighted[weighted.length - 1].drop;
}

function isValidDropShape(drop) {
  if (!drop || typeof drop !== "object") return false;
  if (!drop.item_id || String(drop.item_id).trim() === "") return false;
  return true;
}

function rollQuantity(quantitySpec, rng) {
  const randomFn = typeof rng === "function" ? rng : Math.random;

  if (Number.isFinite(quantitySpec)) {
    return {
      quantity: Math.max(0, Math.floor(quantitySpec)),
      roll: null
    };
  }

  if (quantitySpec && typeof quantitySpec === "object") {
    const min = Number.isFinite(quantitySpec.min) ? Math.floor(quantitySpec.min) : 1;
    const max = Number.isFinite(quantitySpec.max) ? Math.floor(quantitySpec.max) : min;
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    const rolled = low + Math.floor(randomFn() * (high - low + 1));
    return {
      quantity: rolled,
      roll: { min: low, max: high, rolled }
    };
  }

  return {
    quantity: 1,
    roll: null
  };
}

function buildDropResult(drop, dropType, rng) {
  if (!isValidDropShape(drop)) {
    return null;
  }

  const quantityData = rollQuantity(drop.quantity, rng);
  if (quantityData.quantity <= 0) {
    return null;
  }

  return {
    item_id: String(drop.item_id),
    quantity: quantityData.quantity,
    rarity: String(drop.rarity || "common"),
    drop_type: dropType,
    quantity_roll: quantityData.roll
  };
}

function buildRaritySummary(drops) {
  const summary = {};
  for (const drop of drops) {
    const rarity = String(drop.rarity || "common");
    summary[rarity] = (summary[rarity] || 0) + 1;
  }
  return summary;
}

/**
 * Resolve loot rolls from a table in an event-friendly format.
 * Does not grant/apply inventory.
 *
 * input:
 * - source_type
 * - source_id
 * - loot_table_id
 * - context (optional metadata)
 * - roll_count (optional)
 * - rng (optional for deterministic testing)
 * - lootTableManager (required)
 */
function resolveLootRoll(input) {
  const data = input || {};
  const manager = data.lootTableManager;

  if (!manager || typeof manager.getLootTable !== "function") {
    return {
      ok: false,
      event_type: "loot_roll_resolve_failed",
      reason: "loot_table_manager_required"
    };
  }

  if (!data.source_type || !data.source_id || !data.loot_table_id) {
    return {
      ok: false,
      event_type: "loot_roll_resolve_failed",
      reason: "source_type_source_id_and_loot_table_id_required"
    };
  }

  const table = manager.getLootTable(data.loot_table_id);
  if (!table) {
    return {
      ok: false,
      event_type: "loot_roll_resolve_failed",
      reason: "loot_table_not_found",
      payload: {
        loot_table_id: data.loot_table_id
      }
    };
  }

  const sourceTypeMatches = table.source_type === data.source_type;
  const sourceIdMatches = table.source_id === data.source_id;
  if (!sourceTypeMatches || !sourceIdMatches) {
    return {
      ok: false,
      event_type: "loot_roll_resolve_failed",
      reason: "source_table_mismatch",
      payload: {
        requested_source_type: data.source_type,
        requested_source_id: data.source_id,
        table_source_type: table.source_type,
        table_source_id: table.source_id
      }
    };
  }

  const rng = data.rng;
  const includeWeighted = data.include_weighted !== false;
  const rollCount = includeWeighted
    ? Number.isInteger(data.roll_count) && data.roll_count >= 0
      ? data.roll_count
      : Number.isInteger(table.rarity_rules?.default_roll_count) && table.rarity_rules.default_roll_count > 0
        ? table.rarity_rules.default_roll_count
        : 1
    : 0;

  const guaranteedDrops = [];
  let malformedSkipped = 0;
  for (const drop of table.guaranteed_drops || []) {
    const built = buildDropResult(drop, "guaranteed", rng);
    if (!built) {
      malformedSkipped += 1;
      continue;
    }
    guaranteedDrops.push(built);
  }

  const weightedDrops = [];
  for (let i = 0; i < rollCount; i += 1) {
    const selected = weightedChoice(table.possible_drops, table.drop_weights, rng);
    if (selected) {
      const built = buildDropResult(selected, "weighted", rng);
      if (!built) {
        malformedSkipped += 1;
        continue;
      }
      weightedDrops.push(built);
    }
  }

  const allDrops = [...guaranteedDrops, ...weightedDrops];

  return {
    ok: true,
    event_type: "loot_roll_resolved",
    payload: {
      loot_table_id: table.table_id,
      source_type: data.source_type,
      source_id: data.source_id,
      context: data.context || {},
      roll_count: rollCount,
      guaranteed_drops: guaranteedDrops,
      weighted_drops: weightedDrops,
      all_drops: allDrops,
      rarity_result: buildRaritySummary(allDrops),
      validation: {
        malformed_entries_skipped: malformedSkipped
      },
      // Event-driven boundary: generated only, not granted.
      inventory_apply_status: "not_applied",
      next_event_type: "loot_generated",
      resolved_at: new Date().toISOString()
    }
  };
}

module.exports = {
  resolveLootRoll
};
