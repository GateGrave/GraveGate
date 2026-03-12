"use strict";

// Unidentified item model.
// Allows hidden item details until identification is complete.
const unidentifiedItemModel = {
  item_id: "string",
  is_identified: "boolean",
  public_label: "string",
  hidden_item_ref: "string",
  identified_at: "ISO-8601 string | null"
};

const exampleUnidentifiedItem = {
  item_id: "item-004",
  is_identified: false,
  public_label: "Mysterious Silver Ring",
  hidden_item_ref: "ring_of_spell_storing_ref",
  identified_at: null
};

module.exports = {
  unidentifiedItemModel,
  exampleUnidentifiedItem
};
