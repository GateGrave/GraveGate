"use strict";

const assert = require("assert");
const { createInMemoryAdapter } = require("../../../../database/src/adapters/inMemoryAdapter");
const { CharacterPersistenceBridge } = require("../character.persistence");
const { createCharacterRecord } = require("../character.schema");
const { InventoryPersistenceBridge } = require("../../../../inventory-system/src/inventory.persistence");
const { createInventoryRecord } = require("../../../../inventory-system/src/inventory.schema");
const {
  processIdentifyItemRequest,
  processAttunementRequest
} = require("../flow/processMagicalItemRequest");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createContext() {
  const adapter = createInMemoryAdapter();
  const characterPersistence = new CharacterPersistenceBridge({ adapter });
  const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
  const character = createCharacterRecord({
    character_id: "char-magical-item-001",
    player_id: "player-magical-item-001",
    name: "Arcane Tester",
    inventory_id: "inv-magical-item-001"
  });
  characterPersistence.saveCharacter(character);
  inventoryPersistence.saveInventory(createInventoryRecord({
    inventory_id: "inv-magical-item-001",
    owner_type: "player",
    owner_id: "player-magical-item-001",
    equipment_items: [{
      item_id: "item_mysterious_ring",
      item_name: "Mysterious Ring",
      item_type: "unidentified",
      quantity: 1,
      owner_player_id: "player-magical-item-001",
      metadata: {
        public_label: "Mysterious Ring",
        hidden_item_ref: "item_ring_of_protection"
      }
    }]
  }));

  return {
    characterPersistence,
    inventoryPersistence,
    loadContentBundle() {
      return {
        ok: true,
        payload: {
          content: {
            items: [{
              item_id: "item_ring_of_protection",
              name: "Ring of Protection",
              item_type: "equipment",
              equip_slot: "ring",
              metadata: {
                magical: true,
                requires_attunement: true,
                rarity: "rare",
                armor_class_bonus: 1,
                saving_throw_bonus: 1
              }
            }]
          }
        }
      };
    }
  };
}

function runProcessMagicalItemRequestTests() {
  const results = [];

  runTest("identify_unidentified_item_reveals_magical_item", () => {
    const context = createContext();
    const out = processIdentifyItemRequest({
      context,
      player_id: "player-magical-item-001",
      item_id: "item_mysterious_ring"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.item.item_id, "item_ring_of_protection");
    assert.equal(out.payload.item.magical, true);
    assert.equal(out.payload.item.requires_attunement, true);

    const reloadedInventory = context.inventoryPersistence.loadInventoryById("inv-magical-item-001");
    const ring = reloadedInventory.payload.inventory.equipment_items.find((entry) => entry.item_id === "item_ring_of_protection");
    assert.equal(Boolean(ring), true);
    assert.equal(ring.metadata.is_identified, true);
  }, results);

  runTest("attune_and_unattune_updates_character_and_inventory", () => {
    const context = createContext();
    processIdentifyItemRequest({
      context,
      player_id: "player-magical-item-001",
      item_id: "item_mysterious_ring"
    });

    const attuneOut = processAttunementRequest({
      context,
      player_id: "player-magical-item-001",
      item_id: "item_ring_of_protection",
      mode: "attune"
    });
    assert.equal(attuneOut.ok, true);
    assert.equal(attuneOut.payload.item.is_attuned, true);
    assert.equal(attuneOut.payload.character.attunement.slots_used, 1);
    assert.equal(attuneOut.payload.character.item_effects.armor_class_bonus, 0);
    assert.equal(attuneOut.payload.character.item_effects.saving_throw_bonus, 0);

    const unattuneOut = processAttunementRequest({
      context,
      player_id: "player-magical-item-001",
      item_id: "item_ring_of_protection",
      mode: "unattune"
    });
    assert.equal(unattuneOut.ok, true);
    assert.equal(unattuneOut.payload.item.is_attuned, false);
    assert.equal(unattuneOut.payload.character.attunement.slots_used, 0);
  }, results);

  runTest("equipped_and_attuned_magical_item_updates_effective_item_effect_state", () => {
    const context = createContext();
    processIdentifyItemRequest({
      context,
      player_id: "player-magical-item-001",
      item_id: "item_mysterious_ring"
    });

    const loadedInventory = context.inventoryPersistence.loadInventoryById("inv-magical-item-001");
    const ring = loadedInventory.payload.inventory.equipment_items.find((entry) => entry.item_id === "item_ring_of_protection");
    ring.metadata.equipped = true;
    ring.metadata.equipped_slot = "ring";
    context.inventoryPersistence.saveInventory(loadedInventory.payload.inventory);

    const attuneOut = processAttunementRequest({
      context,
      player_id: "player-magical-item-001",
      item_id: "item_ring_of_protection",
      mode: "attune"
    });

    assert.equal(attuneOut.ok, true);
    assert.equal(attuneOut.payload.character.item_effects.armor_class_bonus, 1);
    assert.equal(attuneOut.payload.character.item_effects.saving_throw_bonus, 1);
    assert.equal(attuneOut.payload.character.effective_armor_class, 11);
  }, results);

  runTest("cannot_attune_unidentified_item", () => {
    const context = createContext();
    const out = processAttunementRequest({
      context,
      player_id: "player-magical-item-001",
      item_id: "item_mysterious_ring",
      mode: "attune"
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "unidentified items cannot be attuned");
  }, results);

  const passed = results.filter((entry) => entry.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    totals: { total: results.length, passed, failed },
    results
  };
}

if (require.main === module) {
  const summary = runProcessMagicalItemRequestTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runProcessMagicalItemRequestTests
};
