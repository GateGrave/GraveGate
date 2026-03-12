"use strict";

// Items World State storage (in-memory placeholder).
// This keeps item catalog and item instances in one simple store for now.
// In a real database stage, this module should map to dedicated item tables
// or collections.
class InMemoryItemStore {
  constructor() {
    this.itemsById = new Map();
  }

  /**
   * Save or replace one item document.
   * @param {object} item
   * @returns {object}
   */
  saveItem(item) {
    if (!item || !item.item_id) {
      throw new Error("saveItem requires item.item_id");
    }

    this.itemsById.set(item.item_id, item);
    return item;
  }

  /**
   * Load one item by id.
   * @param {string} itemId
   * @returns {object|null}
   */
  loadItem(itemId) {
    return this.itemsById.get(itemId) || null;
  }
}

function mockItemSaveLoadExample() {
  const store = new InMemoryItemStore();
  store.saveItem({
    item_id: "item-001",
    name: "Iron Longsword",
    category: "equipment"
  });
  return store.loadItem("item-001");
}

module.exports = {
  InMemoryItemStore,
  mockItemSaveLoadExample
};
