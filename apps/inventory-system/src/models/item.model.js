"use strict";

// Base item model.
// This is the shared shape all item types can extend in World State.
const itemModel = {
  item_id: "string",
  item_key: "string",
  name: "string",
  category: "equipment | consumable | magical | misc",
  rarity: "common | uncommon | rare | very_rare | legendary | artifact",
  weight: "number",
  value_gp: "number",
  tags: ["string"]
};

const exampleItem = {
  item_id: "item-001",
  item_key: "longsword_iron",
  name: "Iron Longsword",
  category: "equipment",
  rarity: "common",
  weight: 3,
  value_gp: 15,
  tags: ["weapon", "martial", "slashing"]
};

module.exports = {
  itemModel,
  exampleItem
};
