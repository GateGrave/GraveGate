"use strict";

// Stackable item model.
// Used for items that can exist in quantities greater than 1.
const stackableItemModel = {
  stack_id: "string",
  item_id: "string",
  quantity: "number",
  max_stack_size: "number",
  stack_rules_note: "string"
};

const exampleStackableItem = {
  stack_id: "stack-001",
  item_id: "item-002",
  quantity: 3,
  max_stack_size: 20,
  stack_rules_note: "Phase 2C stores quantities only."
};

module.exports = {
  stackableItemModel,
  exampleStackableItem
};
