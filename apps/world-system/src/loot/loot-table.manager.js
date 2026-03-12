"use strict";

const { createLootTableRecord } = require("./loot-table.schema");

class InMemoryLootTableStore {
  constructor() {
    this.tables = new Map();
  }

  save(table) {
    this.tables.set(table.table_id, table);
    return table;
  }

  load(tableId) {
    return this.tables.get(tableId) || null;
  }

  remove(tableId) {
    if (!tableId) return false;
    return this.tables.delete(tableId);
  }

  list() {
    return Array.from(this.tables.values());
  }
}

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

function normalizeDrop(drop) {
  return {
    item_id: String(drop.item_id),
    quantity: Number.isFinite(drop.quantity) ? drop.quantity : 1,
    rarity: String(drop.rarity || "common")
  };
}

class LootTableManager {
  constructor(options) {
    const config = options || {};
    this.store = config.store || new InMemoryLootTableStore();
  }

  createLootTable(input) {
    const table = createLootTableRecord(input);
    this.store.save(table);
    return table;
  }

  getLootTable(table_id) {
    return this.store.load(table_id);
  }

  updateLootTable(table_id, updater) {
    const current = this.getLootTable(table_id);
    if (!current) return null;

    let next;
    if (typeof updater === "function") {
      next = updater(current);
    } else {
      next = { ...current, ...(updater || {}) };
    }

    const finalTable = {
      ...current,
      ...next,
      table_id: current.table_id
    };

    this.store.save(finalTable);
    return finalTable;
  }

  deleteLootTable(table_id) {
    return this.store.remove(table_id);
  }

  getLootTableBySource(source_type, source_id) {
    return (
      this.store
        .list()
        .find((table) => table.source_type === source_type && table.source_id === source_id) || null
    );
  }

  /**
   * Weighted roll:
   * - Always includes guaranteed_drops
   * - Adds weighted random drops from possible_drops
   * - Returns drop candidates only (no inventory grant)
   */
  rollFromLootTable(table_id, options) {
    const table = this.getLootTable(table_id);
    if (!table) {
      return {
        ok: false,
        reason: "loot_table_not_found",
        table_id
      };
    }

    const cfg = options || {};
    const rollCount =
      Number.isInteger(cfg.roll_count) && cfg.roll_count > 0
        ? cfg.roll_count
        : Number.isInteger(table.rarity_rules?.default_roll_count) && table.rarity_rules.default_roll_count > 0
          ? table.rarity_rules.default_roll_count
          : 1;

    const guaranteed = table.guaranteed_drops.map(normalizeDrop);
    const rolled = [];
    for (let i = 0; i < rollCount; i += 1) {
      const selected = weightedChoice(table.possible_drops, table.drop_weights, cfg.rng);
      if (selected) rolled.push(normalizeDrop(selected));
    }

    return {
      ok: true,
      event_type: "loot_table_rolled",
      payload: {
        table_id: table.table_id,
        source_type: table.source_type,
        source_id: table.source_id,
        roll_count: rollCount,
        guaranteed_drops: guaranteed,
        rolled_drops: rolled,
        // Keep generation and inventory application separate.
        grant_status: "not_granted",
        rolled_at: new Date().toISOString()
      }
    };
  }
}

function createExampleLootTables() {
  return {
    normal_enemy: {
      table_id: "table-enemy-goblin-001",
      source_type: "enemy",
      source_id: "goblin",
      possible_drops: [
        { item_id: "item-rusted-dagger", quantity: 1, rarity: "common" },
        { item_id: "item-torn-cloak", quantity: 1, rarity: "common" },
        { item_id: "item-small-gem", quantity: 1, rarity: "uncommon" }
      ],
      drop_weights: {
        "item-rusted-dagger": 50,
        "item-torn-cloak": 35,
        "item-small-gem": 15
      },
      guaranteed_drops: [{ item_id: "item-copper-coin", quantity: 5, rarity: "common" }],
      rarity_rules: { default_roll_count: 1 }
    },
    boss: {
      table_id: "table-boss-lich-001",
      source_type: "boss",
      source_id: "lich-king",
      possible_drops: [
        { item_id: "item-arcane-staff", quantity: 1, rarity: "epic" },
        { item_id: "item-necrotic-ring", quantity: 1, rarity: "rare" },
        { item_id: "item-ancient-scroll", quantity: 2, rarity: "rare" }
      ],
      drop_weights: {
        "item-arcane-staff": 20,
        "item-necrotic-ring": 35,
        "item-ancient-scroll": 45
      },
      guaranteed_drops: [{ item_id: "item-gold-coin", quantity: 120, rarity: "common" }],
      rarity_rules: { default_roll_count: 2, boss_bonus: true }
    },
    future_chest: {
      table_id: "table-chest-ornate-001",
      source_type: "chest",
      source_id: "ornate-chest",
      possible_drops: [
        { item_id: "item-healing-potion", quantity: 2, rarity: "common" },
        { item_id: "item-sapphire-shard", quantity: 1, rarity: "uncommon" },
        { item_id: "item-enchanted-key", quantity: 1, rarity: "rare" }
      ],
      drop_weights: {
        "item-healing-potion": 60,
        "item-sapphire-shard": 30,
        "item-enchanted-key": 10
      },
      guaranteed_drops: [],
      rarity_rules: { default_roll_count: 1, chest_tier: "future-expansion" }
    }
  };
}

module.exports = {
  InMemoryLootTableStore,
  LootTableManager,
  createExampleLootTables
};
