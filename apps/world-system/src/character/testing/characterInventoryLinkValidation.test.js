"use strict";

const assert = require("assert");
const { CharacterService } = require("../character.service");
const { CharacterManager, InMemoryCharacterStore } = require("../character.manager");
const { InMemoryInventoryStore } = require("../../../../database/src/world-storage/inventories.store");
const {
  createCharacterInventory,
  attachInventoryToCharacter,
  loadCharacterWithInventoryContext
} = require("../flow/characterInventoryLink");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createContext() {
  const characterStore = new InMemoryCharacterStore();
  const characterManager = new CharacterManager({ store: characterStore });
  const characterService = new CharacterService({ manager: characterManager });
  const inventoryStore = new InMemoryInventoryStore();

  characterService.createCharacter({
    character_id: "char-link-validation-001",
    player_id: "player-link-validation-001",
    name: "Validation Hero",
    race: "human",
    class: "fighter",
    level: 1
  });

  return { characterService, inventoryStore };
}

function runCharacterInventoryLinkValidationTests() {
  const results = [];

  runTest("linking_existing_inventory_succeeds", () => {
    const ctx = createContext();
    createCharacterInventory({
      inventory_store: ctx.inventoryStore,
      character_id: "char-link-validation-001",
      inventory_id: "inv-link-validation-001"
    });

    const out = attachInventoryToCharacter({
      character_service: ctx.characterService,
      inventory_store: ctx.inventoryStore,
      character_id: "char-link-validation-001",
      inventory_id: "inv-link-validation-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_inventory_linked");
    assert.equal(out.payload.character.inventory_id, "inv-link-validation-001");
  }, results);

  runTest("linking_missing_inventory_fails_safely", () => {
    const ctx = createContext();
    const out = attachInventoryToCharacter({
      character_service: ctx.characterService,
      inventory_store: ctx.inventoryStore,
      character_id: "char-link-validation-001",
      inventory_id: "inv-does-not-exist-001"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "character_inventory_link_failed");
    assert.equal(out.error, "linked inventory not found");
  }, results);

  runTest("loading_linked_character_still_works", () => {
    const ctx = createContext();
    createCharacterInventory({
      inventory_store: ctx.inventoryStore,
      character_id: "char-link-validation-001",
      inventory_id: "inv-link-validation-002"
    });
    const linkOut = attachInventoryToCharacter({
      character_service: ctx.characterService,
      inventory_store: ctx.inventoryStore,
      character_id: "char-link-validation-001",
      inventory_id: "inv-link-validation-002"
    });
    assert.equal(linkOut.ok, true);

    const out = loadCharacterWithInventoryContext({
      character_service: ctx.characterService,
      inventory_store: ctx.inventoryStore,
      character_id: "char-link-validation-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_inventory_context_loaded");
    assert.equal(out.payload.character.character_id, "char-link-validation-001");
    assert.equal(out.payload.inventory.inventory_id, "inv-link-validation-002");
  }, results);

  const passed = results.filter((x) => x.ok).length;
  const failed = results.length - passed;

  return {
    ok: failed === 0,
    totals: {
      total: results.length,
      passed,
      failed
    },
    results
  };
}

if (require.main === module) {
  const summary = runCharacterInventoryLinkValidationTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCharacterInventoryLinkValidationTests
};

