"use strict";

// Consumable model.
// Tracks usage-related inventory data without gameplay resolution.
const consumableModel = {
  item_id: "string",
  uses_per_item: "number",
  remaining_uses: "number",
  effect_ref: "string",
  consumed_on_use: "boolean"
};

const exampleConsumable = {
  item_id: "item-002",
  uses_per_item: 1,
  remaining_uses: 1,
  effect_ref: "heal_small_ref",
  consumed_on_use: true
};

module.exports = {
  consumableModel,
  exampleConsumable
};
