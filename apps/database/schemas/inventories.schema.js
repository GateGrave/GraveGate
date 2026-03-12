"use strict";

// Inventories are persistent ownership records for items/currencies.
// This is persistent data owned by World State.
const inventoriesSchema = {
  table: "inventories",
  description: "Persistent inventory slots, item stacks, and currency balances.",
  primaryKey: "inventory_entry_id",
  columns: {
    inventory_entry_id: "string",
    character_id: "string",
    item_id: "string",
    quantity: "number",
    location: "string",
    created_at: "datetime",
    updated_at: "datetime"
  }
};

module.exports = {
  inventoriesSchema
};