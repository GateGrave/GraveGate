"use strict";

const { createInventoryRecord } = require("../../../../inventory-system/src/inventory.schema");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {},
    error: null
  };
}

function failure(eventType, message, payload) {
  return {
    ok: false,
    event_type: eventType,
    payload: payload || {},
    error: message
  };
}

function createCharacterInventory(input) {
  const data = input || {};
  const inventoryStore = data.inventory_store;
  const characterId = data.character_id;

  if (!inventoryStore || typeof inventoryStore.saveInventory !== "function") {
    return failure("character_inventory_create_failed", "inventory_store.saveInventory is required");
  }
  if (!characterId || String(characterId).trim() === "") {
    return failure("character_inventory_create_failed", "character_id is required");
  }

  const inventory = createInventoryRecord({
    inventory_id: data.inventory_id || `inv-${String(characterId)}`,
    owner_type: data.owner_type || "character",
    owner_id: data.owner_id || String(characterId),
    metadata: data.metadata || {}
  });

  try {
    const saved = inventoryStore.saveInventory(inventory);
    return success("character_inventory_created", {
      character_id: String(characterId),
      inventory: clone(saved)
    });
  } catch (error) {
    return failure("character_inventory_create_failed", error.message);
  }
}

function attachInventoryToCharacter(input) {
  const data = input || {};
  const characterService = data.character_service;
  const inventoryStore = data.inventory_store;
  const characterId = data.character_id;
  const inventoryId = data.inventory_id;

  if (!characterService || typeof characterService.getCharacterById !== "function") {
    return failure("character_inventory_link_failed", "character_service.getCharacterById is required");
  }
  if (!characterId || String(characterId).trim() === "") {
    return failure("character_inventory_link_failed", "character_id is required");
  }
  if (!inventoryId || String(inventoryId).trim() === "") {
    return failure("character_inventory_link_failed", "inventory_id is required");
  }
  if (!inventoryStore || typeof inventoryStore.loadInventory !== "function") {
    return failure("character_inventory_link_failed", "inventory_store.loadInventory is required");
  }

  const inventory = inventoryStore.loadInventory(String(inventoryId));
  if (!inventory) {
    return failure("character_inventory_link_failed", "linked inventory not found", {
      character_id: String(characterId),
      inventory_id: String(inventoryId)
    });
  }

  const found = characterService.getCharacterById(String(characterId));
  if (!found.ok) {
    return failure("character_inventory_link_failed", found.error, {
      character_id: String(characterId)
    });
  }

  const updated = characterService.updateCharacter({
    character_id: String(characterId),
    patch: {
      // Prefer canonical linkage by inventory_id.
      inventory_id: String(inventoryId),
      // Keep backward compatibility with ref-style usage.
      inventory_ref: data.inventory_ref || `inventory:${String(inventoryId)}`
    }
  });

  if (!updated.ok) {
    return failure("character_inventory_link_failed", updated.error, {
      character_id: String(characterId),
      inventory_id: String(inventoryId)
    });
  }

  return success("character_inventory_linked", {
    character: clone(updated.payload.character)
  });
}

function loadCharacterWithInventoryContext(input) {
  const data = input || {};
  const characterService = data.character_service;
  const inventoryStore = data.inventory_store;
  const characterId = data.character_id;

  if (!characterService || typeof characterService.getCharacterById !== "function") {
    return failure("character_inventory_context_load_failed", "character_service.getCharacterById is required");
  }
  if (!inventoryStore || typeof inventoryStore.loadInventory !== "function") {
    return failure("character_inventory_context_load_failed", "inventory_store.loadInventory is required");
  }
  if (!characterId || String(characterId).trim() === "") {
    return failure("character_inventory_context_load_failed", "character_id is required");
  }

  const found = characterService.getCharacterById(String(characterId));
  if (!found.ok) {
    return failure("character_inventory_context_load_failed", found.error, {
      character_id: String(characterId)
    });
  }

  const character = found.payload.character;
  if (!character.inventory_id) {
    return failure("character_inventory_context_load_failed", "character has no inventory_id link", {
      character_id: String(characterId)
    });
  }

  const inventory = inventoryStore.loadInventory(String(character.inventory_id));
  if (!inventory) {
    return failure("character_inventory_context_load_failed", "linked inventory not found", {
      character_id: String(characterId),
      inventory_id: String(character.inventory_id)
    });
  }

  return success("character_inventory_context_loaded", {
    character: clone(character),
    inventory: clone(inventory),
    linkage: {
      style: "inventory_id",
      inventory_id: String(character.inventory_id),
      inventory_ref: character.inventory_ref || null
    }
  });
}

module.exports = {
  createCharacterInventory,
  attachInventoryToCharacter,
  loadCharacterWithInventoryContext
};
