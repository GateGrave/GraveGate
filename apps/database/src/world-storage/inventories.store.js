"use strict";

// Inventories World State storage (in-memory placeholder).
// Later this can be swapped for SQL/NoSQL calls without changing callers.
class InMemoryInventoryStore {
  constructor() {
    this.inventoriesById = new Map();
  }

  /**
   * Save or replace one inventory document.
   * @param {object} inventory
   * @returns {object}
   */
  saveInventory(inventory) {
    if (!inventory || !inventory.inventory_id) {
      throw new Error("saveInventory requires inventory.inventory_id");
    }

    this.inventoriesById.set(inventory.inventory_id, inventory);
    return inventory;
  }

  /**
   * Load one inventory by id.
   * @param {string} inventoryId
   * @returns {object|null}
   */
  loadInventory(inventoryId) {
    return this.inventoriesById.get(inventoryId) || null;
  }
}

function mockInventorySaveLoadExample() {
  const store = new InMemoryInventoryStore();
  store.saveInventory({
    inventory_id: "inv-char-001",
    owner_character_id: "char-001",
    item_entries: []
  });
  return store.loadInventory("inv-char-001");
}

module.exports = {
  InMemoryInventoryStore,
  mockInventorySaveLoadExample
};
