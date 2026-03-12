"use strict";

// Equipment model.
// Stores equip slot and simple references, without combat effects.
const equipmentModel = {
  item_id: "string",
  equip_slot: "main_hand | off_hand | head | chest | hands | feet | ring_1 | ring_2 | neck",
  equipped_by_character_id: "string | null",
  requires_attunement: "boolean",
  durability: "number | null"
};

const exampleEquipment = {
  item_id: "item-001",
  equip_slot: "main_hand",
  equipped_by_character_id: "char-001",
  requires_attunement: false,
  durability: null
};

module.exports = {
  equipmentModel,
  exampleEquipment
};
