"use strict";

const { exampleInventory } = require("./inventory.model");
const { exampleItem } = require("./item.model");
const { exampleStackableItem } = require("./stackable-item.model");
const { exampleEquipment } = require("./equipment.model");
const { exampleConsumable } = require("./consumable.model");
const { exampleMagicalItem } = require("./magical-item.model");
const { exampleUnidentifiedItem } = require("./unidentified-item.model");
const { exampleAttunementSlots } = require("./attunement-slots.model");

// Example persistent inventory objects for scaffolding and testing.
const exampleInventoryWorldStateA = {
  inventory: exampleInventory,
  items: [
    exampleItem,
    {
      item_id: "item-002",
      item_key: "healing_potion_small",
      name: "Small Healing Potion",
      category: "consumable",
      rarity: "common",
      weight: 0.5,
      value_gp: 50,
      tags: ["potion", "healing"]
    },
    {
      item_id: "item-003",
      item_key: "blade_of_the_dawn",
      name: "Blade of the Dawn",
      category: "magical",
      rarity: "rare",
      weight: 3,
      value_gp: 0,
      tags: ["weapon", "magical", "attunement"]
    }
  ],
  stackable_items: [exampleStackableItem],
  equipment: [exampleEquipment],
  consumables: [exampleConsumable],
  magical_items: [exampleMagicalItem],
  unidentified_items: [exampleUnidentifiedItem],
  attunement_slots: exampleAttunementSlots
};

const exampleInventoryWorldStateB = {
  inventory: {
    inventory_id: "inv-char-002",
    owner_character_id: "char-002",
    max_slots: 35,
    used_slots: 4,
    currency: { gp: 18, sp: 9, cp: 4 },
    item_entries: [
      { entry_id: "entry-101", item_id: "item-101", quantity: 1, location: "equipped" },
      { entry_id: "entry-102", item_id: "item-102", quantity: 8, location: "backpack" }
    ],
    updated_at: "2026-03-07T00:00:00.000Z"
  },
  items: [
    {
      item_id: "item-101",
      item_key: "warhammer_steel",
      name: "Steel Warhammer",
      category: "equipment",
      rarity: "common",
      weight: 2,
      value_gp: 15,
      tags: ["weapon", "martial", "bludgeoning"]
    },
    {
      item_id: "item-102",
      item_key: "torch",
      name: "Torch",
      category: "misc",
      rarity: "common",
      weight: 1,
      value_gp: 0.01,
      tags: ["utility", "light_source"]
    }
  ],
  stackable_items: [
    { stack_id: "stack-102", item_id: "item-102", quantity: 8, max_stack_size: 20, stack_rules_note: "Basic stack." }
  ],
  equipment: [
    { item_id: "item-101", equip_slot: "main_hand", equipped_by_character_id: "char-002", requires_attunement: false, durability: null }
  ],
  consumables: [],
  magical_items: [],
  unidentified_items: [],
  attunement_slots: {
    character_id: "char-002",
    max_slots: 3,
    used_slots: 0,
    attuned_item_ids: [],
    pending_attunement_item_ids: []
  }
};

module.exports = {
  exampleInventoryWorldStateA,
  exampleInventoryWorldStateB
};
