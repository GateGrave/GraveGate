"use strict";

/**
 * Clean integration boundary for inventory updates.
 * This adapter writes to world-state inventory/item stores only.
 */
class InventoryGrantAdapter {
  constructor(options) {
    const cfg = options || {};
    this.inventoryStore = cfg.inventoryStore;
    this.itemStore = cfg.itemStore;
  }

  ensureInventory(inventoryId, ownerCharacterId) {
    const existing = this.inventoryStore.loadInventory(inventoryId);
    if (existing) return existing;

    const created = {
      inventory_id: inventoryId,
      owner_character_id: ownerCharacterId || "unknown",
      item_entries: []
    };
    this.inventoryStore.saveInventory(created);
    return created;
  }

  resolveItemType(drop, itemRecord) {
    if (drop.item_type) return String(drop.item_type);
    if (itemRecord?.item_type) return String(itemRecord.item_type);
    if (itemRecord?.category) return String(itemRecord.category);
    return "stackable";
  }

  addDropToInventory(input) {
    const data = input || {};
    const inventory = this.ensureInventory(data.inventory_id, data.owner_character_id);
    const drop = data.drop || {};

    if (!drop.item_id) {
      return {
        ok: false,
        reason: "item_id_required"
      };
    }

    const quantity = Number.isFinite(drop.quantity) ? Math.floor(drop.quantity) : 1;
    if (quantity <= 0) {
      return {
        ok: false,
        reason: "invalid_quantity",
        item_id: drop.item_id
      };
    }

    const itemRecord = this.itemStore.loadItem(drop.item_id) || null;
    const itemType = this.resolveItemType(drop, itemRecord);
    const normalizedType = String(itemType).toLowerCase();

    const stackableTypes = new Set(["stackable", "consumable"]);
    const isStackable = stackableTypes.has(normalizedType);

    const entries = Array.isArray(inventory.item_entries) ? inventory.item_entries : [];
    const createdEntries = [];

    if (isStackable) {
      const existing = entries.find(
        (entry) => entry.item_id === drop.item_id && entry.entry_type === normalizedType
      );

      if (existing) {
        existing.quantity = Number(existing.quantity || 0) + quantity;
      } else {
        const newEntry = {
          entry_id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          item_id: drop.item_id,
          entry_type: normalizedType,
          quantity,
          rarity: drop.rarity || itemRecord?.rarity || "common",
          location: "backpack"
        };
        entries.push(newEntry);
        createdEntries.push(newEntry);
      }
    } else {
      // Equipment, magical, and unidentified items default to per-item entries.
      for (let i = 0; i < quantity; i += 1) {
        const newEntry = {
          entry_id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i}`,
          item_id: drop.item_id,
          entry_type: normalizedType,
          quantity: 1,
          rarity: drop.rarity || itemRecord?.rarity || "common",
          location: "backpack"
        };
        entries.push(newEntry);
        createdEntries.push(newEntry);
      }
    }

    const nextInventory = {
      ...inventory,
      item_entries: entries
    };
    this.inventoryStore.saveInventory(nextInventory);

    return {
      ok: true,
      item_id: drop.item_id,
      item_type: normalizedType,
      quantity_applied: quantity,
      inventory_id: nextInventory.inventory_id,
      created_entries: createdEntries.map((x) => x.entry_id)
    };
  }
}

module.exports = {
  InventoryGrantAdapter
};

