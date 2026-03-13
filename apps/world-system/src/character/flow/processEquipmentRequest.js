"use strict";

const { CharacterService } = require("../character.service");
const { CharacterManager, InMemoryCharacterStore } = require("../character.manager");
const { updateCharacterEquipment } = require("./updateCharacterEquipment");
const { normalizeInventoryShape } = require("../../../../inventory-system/src/mutationHelpers");
const {
  getStarterItemRule,
  isConsumableRule,
  isEquippableRule,
  validateEquipSlot,
  buildEquippedItemProfile
} = require("../rules/itemEquipmentRules");
const { applyResolvedItemEffectState } = require("../rules/magicalItemRules");

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

function loadCharacters(context) {
  if (context.characterPersistence && typeof context.characterPersistence.listCharacters === "function") {
    const listed = context.characterPersistence.listCharacters();
    if (!listed.ok) {
      return failure("equipment_request_failed", listed.error || "failed to load characters from persistence");
    }
    return success("equipment_characters_loaded", {
      characters: Array.isArray(listed.payload.characters) ? listed.payload.characters : []
    });
  }

  if (context.characterRepository && typeof context.characterRepository.listStoredCharacters === "function") {
    const listed = context.characterRepository.listStoredCharacters();
    if (!listed.ok) {
      return failure("equipment_request_failed", listed.error || "failed to load characters from repository");
    }
    return success("equipment_characters_loaded", {
      characters: Array.isArray(listed.payload.characters) ? listed.payload.characters : []
    });
  }

  return failure("equipment_request_failed", "character persistence/repository is not available");
}

function saveCharacter(context, character) {
  if (context.characterPersistence && typeof context.characterPersistence.saveCharacter === "function") {
    return context.characterPersistence.saveCharacter(character);
  }

  if (context.characterRepository && typeof context.characterRepository.saveCharacter === "function") {
    return context.characterRepository.saveCharacter(character);
  }

  return {
    ok: false,
    error: "character persistence/repository is not available"
  };
}

function loadInventoryById(context, inventoryId) {
  if (!context.inventoryPersistence || typeof context.inventoryPersistence.loadInventoryById !== "function") {
    return failure("equipment_request_failed", "inventoryPersistence.loadInventoryById is required");
  }

  return context.inventoryPersistence.loadInventoryById(String(inventoryId));
}

function saveInventory(context, inventory) {
  if (!context.inventoryPersistence || typeof context.inventoryPersistence.saveInventory !== "function") {
    return {
      ok: false,
      error: "inventoryPersistence.saveInventory is required"
    };
  }

  return context.inventoryPersistence.saveInventory(inventory);
}

function rollbackInventory(context, originalInventory) {
  if (!originalInventory || typeof originalInventory !== "object") {
    return {
      ok: false,
      error: "original inventory snapshot is required for rollback"
    };
  }
  return saveInventory(context, clone(originalInventory));
}

function rollbackCharacter(context, originalCharacter) {
  if (!originalCharacter || typeof originalCharacter !== "object") {
    return {
      ok: false,
      error: "original character snapshot is required for rollback"
    };
  }
  return saveCharacter(context, clone(originalCharacter));
}

function persistEquipWriteSet(input) {
  const data = input || {};
  const context = data.context || {};
  const failureEventType = data.failure_event_type || "equipment_request_failed";
  const nextInventory = data.next_inventory;
  const nextCharacter = data.next_character;
  const originalInventory = data.original_inventory;
  const originalCharacter = data.original_character;

  const inventorySaved = saveInventory(context, nextInventory);
  if (!inventorySaved.ok) {
    return failure(failureEventType, inventorySaved.error || "failed to save inventory state");
  }

  const characterSaved = saveCharacter(context, nextCharacter);
  if (characterSaved.ok) {
    return success("equipment_write_set_persisted", {
      inventory: clone(inventorySaved.payload.inventory),
      character: clone(characterSaved.payload.character)
    });
  }

  const inventoryRollback = rollbackInventory(context, originalInventory);
  if (inventoryRollback.ok) {
    return failure(failureEventType, characterSaved.error || "failed to save character equipment state");
  }

  // Best effort safety: keep durable entities aligned when inventory rollback fails.
  const characterRollback = rollbackCharacter(context, originalCharacter);
  if (!characterRollback.ok) {
    return failure(
      failureEventType,
      "failed to save character equipment state and rollback failed",
      {
        character_error: characterSaved.error || "failed to save character equipment state",
        inventory_rollback_error: inventoryRollback.error || "inventory rollback failed",
        character_rollback_error: characterRollback.error || "character rollback failed",
        partial_commit: true
      }
    );
  }

  return failure(
    failureEventType,
    "failed to save character equipment state and inventory rollback failed",
    {
      character_error: characterSaved.error || "failed to save character equipment state",
      inventory_rollback_error: inventoryRollback.error || "inventory rollback failed",
      partial_commit: true
    }
  );
}

function buildTransientCharacterService(character) {
  const store = new InMemoryCharacterStore();
  const manager = new CharacterManager({ store });
  const service = new CharacterService({ manager });
  store.save(character);
  return service;
}

function findInventoryEntry(inventory, itemId) {
  const buckets = ["stackable_items", "equipment_items", "quest_items"];
  for (const bucket of buckets) {
    const entries = Array.isArray(inventory[bucket]) ? inventory[bucket] : [];
    const entry = entries.find((candidate) => candidate && String(candidate.item_id || "") === String(itemId));
    if (entry) {
      return {
        bucket,
        entry
      };
    }
  }

  return null;
}

function validateOwnership(entry, inventory, playerId) {
  const ownerOnEntry = entry.owner_player_id ? String(entry.owner_player_id) : null;
  if (ownerOnEntry) {
    return ownerOnEntry === String(playerId);
  }

  const ownerOnInventory = inventory.owner_id ? String(inventory.owner_id) : null;
  if (ownerOnInventory) {
    return ownerOnInventory === String(playerId);
  }

  return false;
}

function processEquipRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const playerId = data.player_id;
  const itemId = data.item_id;
  const slot = data.slot;

  if (!playerId || String(playerId).trim() === "") {
    return failure("player_equip_failed", "player_id is required");
  }
  if (!itemId || String(itemId).trim() === "") {
    return failure("player_equip_failed", "item_id is required");
  }
  if (!slot || String(slot).trim() === "") {
    return failure("player_equip_failed", "slot is required");
  }

  const loadedCharacters = loadCharacters(context);
  if (!loadedCharacters.ok) {
    return failure("player_equip_failed", loadedCharacters.error);
  }

  const character = loadedCharacters.payload.characters.find((candidate) => {
    return String(candidate.player_id || "") === String(playerId);
  });
  if (!character) {
    return failure("player_equip_failed", "character not found for player", {
      player_id: String(playerId)
    });
  }
  if (!character.inventory_id) {
    return failure("player_equip_failed", "character has no linked inventory", {
      character_id: character.character_id || null
    });
  }

  const inventoryOut = loadInventoryById(context, character.inventory_id);
  if (!inventoryOut.ok) {
    return failure("player_equip_failed", inventoryOut.error || "failed to load linked inventory");
  }

  const normalizedInventoryOut = normalizeInventoryShape(inventoryOut.payload.inventory);
  if (!normalizedInventoryOut.ok) {
    return failure("player_equip_failed", normalizedInventoryOut.error || "inventory shape is invalid");
  }
  const inventory = normalizedInventoryOut.payload.inventory;
  const originalInventory = clone(inventory);
  const originalCharacter = clone(character);
  const found = findInventoryEntry(inventory, itemId);
  if (!found) {
    return failure("player_equip_failed", "item_id not found in linked inventory", {
      item_id: String(itemId)
    });
  }

  if (!validateOwnership(found.entry, inventory, playerId)) {
    return failure("player_equip_failed", "ownership validation failed for equip request", {
      item_id: String(itemId),
      player_id: String(playerId)
    });
  }

  const starterItemRule = getStarterItemRule(itemId);
  const starterItem = starterItemRule.ok ? starterItemRule.payload.item : null;

  const entryType = String(found.entry.item_type || "").toLowerCase();
  if ((starterItem && isConsumableRule(starterItem)) || entryType === "consumable") {
    return failure("player_equip_failed", "consumable items cannot be equipped", {
      item_id: String(itemId)
    });
  }

  if (starterItem && !isEquippableRule(starterItem)) {
    return failure("player_equip_failed", "item is not equippable", {
      item_id: String(itemId)
    });
  }

  if (starterItem) {
    const slotValidation = validateEquipSlot(starterItem, slot);
    if (!slotValidation.ok) {
      return failure("player_equip_failed", slotValidation.error, slotValidation.payload);
    }
  }

  const currentEquipment = character.equipment && typeof character.equipment === "object" ? character.equipment : {};
  const currentAtSlot = currentEquipment[String(slot)];
  if (currentAtSlot && String(currentAtSlot) !== String(itemId)) {
    return failure("player_equip_failed", "slot already occupied by another item", {
      slot: String(slot),
      equipped_item_id: String(currentAtSlot)
    });
  }

  if (!found.entry.metadata || typeof found.entry.metadata !== "object") {
    found.entry.metadata = {};
  }
  found.entry.metadata.equipped = true;
  found.entry.metadata.equipped_slot = String(slot);
  found.entry.owner_player_id = found.entry.owner_player_id || String(playerId);
  if (starterItem) {
    found.entry.metadata.equipment_profile = buildEquippedItemProfile(starterItem);
  }

  const transientService = buildTransientCharacterService(character);
  const equipmentOut = updateCharacterEquipment({
    character_service: transientService,
    character_id: character.character_id,
    equipment_patch: {
      [String(slot)]: String(itemId)
    }
  });
  if (!equipmentOut.ok) {
    return failure("player_equip_failed", equipmentOut.error || "failed to update character equipment");
  }

  const updatedCharacter = clone(equipmentOut.payload.character);
  const existingProfiles =
    updatedCharacter.equipped_item_profiles && typeof updatedCharacter.equipped_item_profiles === "object"
      ? updatedCharacter.equipped_item_profiles
      : {};
  const nextProfiles = {
    ...existingProfiles
  };
  if (starterItem) {
    nextProfiles[String(slot)] = buildEquippedItemProfile(starterItem);
  }
  updatedCharacter.equipped_item_profiles = nextProfiles;

  const resolvedCharacter = applyResolvedItemEffectState(updatedCharacter, inventory);
  const persisted = persistEquipWriteSet({
    context,
    failure_event_type: "player_equip_failed",
    next_inventory: inventory,
    next_character: resolvedCharacter,
    original_inventory: originalInventory,
    original_character: originalCharacter
  });
  if (!persisted.ok) {
    return persisted;
  }

  return success("player_equip_processed", {
    character: clone(persisted.payload.character),
    inventory: clone(persisted.payload.inventory),
    equipped: {
      item_id: String(itemId),
      slot: String(slot)
    }
  });
}

function processUnequipRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const playerId = data.player_id;
  const slot = data.slot;
  const requestedItemId = data.item_id || null;

  if (!playerId || String(playerId).trim() === "") {
    return failure("player_unequip_failed", "player_id is required");
  }
  if (!slot || String(slot).trim() === "") {
    return failure("player_unequip_failed", "slot is required");
  }

  const loadedCharacters = loadCharacters(context);
  if (!loadedCharacters.ok) {
    return failure("player_unequip_failed", loadedCharacters.error);
  }

  const character = loadedCharacters.payload.characters.find((candidate) => {
    return String(candidate.player_id || "") === String(playerId);
  });
  if (!character) {
    return failure("player_unequip_failed", "character not found for player", {
      player_id: String(playerId)
    });
  }
  if (!character.inventory_id) {
    return failure("player_unequip_failed", "character has no linked inventory", {
      character_id: character.character_id || null
    });
  }

  const currentEquipment = character.equipment && typeof character.equipment === "object" ? character.equipment : {};
  const equippedItemId = currentEquipment[String(slot)];
  if (!equippedItemId) {
    return failure("player_unequip_failed", "no item equipped in slot", {
      slot: String(slot)
    });
  }
  if (requestedItemId && String(requestedItemId) !== String(equippedItemId)) {
    return failure("player_unequip_failed", "item_id does not match equipped item in slot", {
      slot: String(slot),
      equipped_item_id: String(equippedItemId),
      requested_item_id: String(requestedItemId)
    });
  }

  const inventoryOut = loadInventoryById(context, character.inventory_id);
  if (!inventoryOut.ok) {
    return failure("player_unequip_failed", inventoryOut.error || "failed to load linked inventory");
  }

  const normalizedInventoryOut = normalizeInventoryShape(inventoryOut.payload.inventory);
  if (!normalizedInventoryOut.ok) {
    return failure("player_unequip_failed", normalizedInventoryOut.error || "inventory shape is invalid");
  }
  const inventory = normalizedInventoryOut.payload.inventory;
  const originalInventory = clone(inventory);
  const originalCharacter = clone(character);
  const found = findInventoryEntry(inventory, equippedItemId);
  if (!found) {
    return failure("player_unequip_failed", "equipped item not found in linked inventory", {
      item_id: String(equippedItemId)
    });
  }

  if (!validateOwnership(found.entry, inventory, playerId)) {
    return failure("player_unequip_failed", "ownership validation failed for unequip request", {
      item_id: String(equippedItemId),
      player_id: String(playerId)
    });
  }

  if (!found.entry.metadata || typeof found.entry.metadata !== "object") {
    found.entry.metadata = {};
  }
  found.entry.metadata.equipped = false;
  delete found.entry.metadata.equipped_slot;
  delete found.entry.metadata.equipment_profile;

  const transientService = buildTransientCharacterService(character);
  const equipmentOut = updateCharacterEquipment({
    character_service: transientService,
    character_id: character.character_id,
    equipment_patch: {
      [String(slot)]: null
    }
  });
  if (!equipmentOut.ok) {
    return failure("player_unequip_failed", equipmentOut.error || "failed to update character equipment");
  }

  const updatedCharacter = clone(equipmentOut.payload.character);
  const existingProfiles =
    updatedCharacter.equipped_item_profiles && typeof updatedCharacter.equipped_item_profiles === "object"
      ? updatedCharacter.equipped_item_profiles
      : {};
  const nextProfiles = {
    ...existingProfiles
  };
  delete nextProfiles[String(slot)];
  updatedCharacter.equipped_item_profiles = nextProfiles;

  const resolvedCharacter = applyResolvedItemEffectState(updatedCharacter, inventory);
  const persisted = persistEquipWriteSet({
    context,
    failure_event_type: "player_unequip_failed",
    next_inventory: inventory,
    next_character: resolvedCharacter,
    original_inventory: originalInventory,
    original_character: originalCharacter
  });
  if (!persisted.ok) {
    return persisted;
  }

  return success("player_unequip_processed", {
    character: clone(persisted.payload.character),
    inventory: clone(persisted.payload.inventory),
    unequipped: {
      item_id: String(equippedItemId),
      slot: String(slot)
    }
  });
}

module.exports = {
  processEquipRequest,
  processUnequipRequest
};
