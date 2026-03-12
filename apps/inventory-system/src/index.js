"use strict";

// Phase 2C inventory scaffolding (World State only).
// Structure-only: no crafting logic and no gameplay calculations.
const { inventoryModel, exampleInventory } = require("./models/inventory.model");
const { INVENTORY_SCHEMA, createInventoryRecord, buildInventory } = require("./inventory.schema");
const { InventoryPersistenceBridge } = require("./inventory.persistence");
const {
  addItemToInventory,
  removeItemFromInventory,
  stackInventoryItem,
  normalizeInventoryShape
} = require("./mutationHelpers");
const { itemModel, exampleItem } = require("./models/item.model");
const { stackableItemModel, exampleStackableItem } = require("./models/stackable-item.model");
const { equipmentModel, exampleEquipment } = require("./models/equipment.model");
const { consumableModel, exampleConsumable } = require("./models/consumable.model");
const { magicalItemModel, exampleMagicalItem } = require("./models/magical-item.model");
const { unidentifiedItemModel, exampleUnidentifiedItem } = require("./models/unidentified-item.model");
const { attunementSlotsModel, exampleAttunementSlots } = require("./models/attunement-slots.model");
const {
  exampleInventoryWorldStateA,
  exampleInventoryWorldStateB
} = require("./models/example-inventories");

module.exports = {
  inventorySchema: INVENTORY_SCHEMA,
  createInventoryRecord,
  buildInventory,
  InventoryPersistenceBridge,
  addItemToInventory,
  removeItemFromInventory,
  stackInventoryItem,
  normalizeInventoryShape,
  models: {
    inventoryModel,
    itemModel,
    stackableItemModel,
    equipmentModel,
    consumableModel,
    magicalItemModel,
    unidentifiedItemModel,
    attunementSlotsModel
  },
  examples: {
    inventory: exampleInventory,
    item: exampleItem,
    stackableItem: exampleStackableItem,
    equipment: exampleEquipment,
    consumable: exampleConsumable,
    magicalItem: exampleMagicalItem,
    unidentifiedItem: exampleUnidentifiedItem,
    attunementSlots: exampleAttunementSlots,
    inventoryWorldStateA: exampleInventoryWorldStateA,
    inventoryWorldStateB: exampleInventoryWorldStateB
  }
};
