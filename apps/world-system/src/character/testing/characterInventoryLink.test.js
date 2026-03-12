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

  const created = characterService.createCharacter({
    character_id: "char-link-001",
    player_id: "player-link-001",
    name: "Link Tester",
    race: "human",
    class: "fighter",
    level: 2
  });

  return {
    characterService,
    inventoryStore,
    createdCharacter: created.payload.character
  };
}

function runCharacterInventoryLinkTests() {
  const results = [];

  runTest("creating_and_linking_inventory_to_character", () => {
    const ctx = createContext();

    const invOut = createCharacterInventory({
      inventory_store: ctx.inventoryStore,
      character_id: "char-link-001",
      inventory_id: "inv-link-001"
    });
    assert.equal(invOut.ok, true);
    assert.equal(invOut.event_type, "character_inventory_created");

    const linkOut = attachInventoryToCharacter({
      character_service: ctx.characterService,
      inventory_store: ctx.inventoryStore,
      character_id: "char-link-001",
      inventory_id: "inv-link-001"
    });
    assert.equal(linkOut.ok, true);
    assert.equal(linkOut.event_type, "character_inventory_linked");
    assert.equal(linkOut.payload.character.inventory_id, "inv-link-001");
  }, results);

  runTest("loading_character_with_linked_inventory_context", () => {
    const ctx = createContext();
    createCharacterInventory({
      inventory_store: ctx.inventoryStore,
      character_id: "char-link-001",
      inventory_id: "inv-link-002"
    });
    attachInventoryToCharacter({
      character_service: ctx.characterService,
      inventory_store: ctx.inventoryStore,
      character_id: "char-link-001",
      inventory_id: "inv-link-002"
    });

    const out = loadCharacterWithInventoryContext({
      character_service: ctx.characterService,
      inventory_store: ctx.inventoryStore,
      character_id: "char-link-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_inventory_context_loaded");
    assert.equal(out.payload.character.character_id, "char-link-001");
    assert.equal(out.payload.inventory.inventory_id, "inv-link-002");
    assert.equal(out.payload.linkage.style, "inventory_id");
  }, results);

  runTest("preserving_existing_character_identity_fields", () => {
    const ctx = createContext();
    createCharacterInventory({
      inventory_store: ctx.inventoryStore,
      character_id: "char-link-001",
      inventory_id: "inv-link-003"
    });
    attachInventoryToCharacter({
      character_service: ctx.characterService,
      inventory_store: ctx.inventoryStore,
      character_id: "char-link-001",
      inventory_id: "inv-link-003"
    });

    const out = loadCharacterWithInventoryContext({
      character_service: ctx.characterService,
      inventory_store: ctx.inventoryStore,
      character_id: "char-link-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.character.character_id, "char-link-001");
    assert.equal(out.payload.character.player_id, "player-link-001");
    assert.equal(out.payload.character.name, "Link Tester");
  }, results);

  runTest("failure_on_missing_inventory", () => {
    const ctx = createContext();
    // Linking to a missing inventory now fails before a dangling link can be created.
    const linkOut = attachInventoryToCharacter({
      character_service: ctx.characterService,
      inventory_store: ctx.inventoryStore,
      character_id: "char-link-001",
      inventory_id: "inv-missing-001"
    });

    assert.equal(linkOut.ok, false);
    assert.equal(linkOut.event_type, "character_inventory_link_failed");
    assert.equal(linkOut.error, "linked inventory not found");
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
  const summary = runCharacterInventoryLinkTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCharacterInventoryLinkTests
};
