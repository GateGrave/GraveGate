"use strict";

// Magical item model.
// Stores references and known state for magical properties.
const magicalItemModel = {
  item_id: "string",
  rarity: "uncommon | rare | very_rare | legendary | artifact",
  magic_property_refs: ["string"],
  charges: "number | null",
  max_charges: "number | null",
  recharges_at: "dawn | dusk | long_rest | null"
};

const exampleMagicalItem = {
  item_id: "item-003",
  rarity: "rare",
  magic_property_refs: ["plus_one_weapon", "glow_on_command"],
  charges: null,
  max_charges: null,
  recharges_at: null
};

module.exports = {
  magicalItemModel,
  exampleMagicalItem
};
