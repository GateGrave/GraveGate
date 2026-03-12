"use strict";

// Inventory model for persistent World State.
// Stores references to owned items and inventory metadata.
const inventoryModel = {
  inventory_id: "string",
  owner_character_id: "string",
  max_slots: "number",
  used_slots: "number",
  currency: {
    gp: "number",
    sp: "number",
    cp: "number"
  },
  item_entries: [
    {
      entry_id: "string",
      item_id: "string",
      quantity: "number",
      location: "backpack | equipped | stash"
    }
  ],
  updated_at: "ISO-8601 string"
};

const exampleInventory = {
  inventory_id: "inv-char-001",
  owner_character_id: "char-001",
  max_slots: 40,
  used_slots: 6,
  currency: { gp: 52, sp: 14, cp: 0 },
  item_entries: [
    { entry_id: "entry-001", item_id: "item-001", quantity: 1, location: "equipped" },
    { entry_id: "entry-002", item_id: "item-002", quantity: 3, location: "backpack" }
  ],
  updated_at: "2026-03-07T00:00:00.000Z"
};

module.exports = {
  inventoryModel,
  exampleInventory
};
