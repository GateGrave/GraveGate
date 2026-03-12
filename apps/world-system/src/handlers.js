"use strict";

const { createEvent, EVENT_TYPES } = require("../../../packages/shared-types");

// World System event handlers (Phase 2E scaffolding).
// Event flow:
// 1) Router sends a world event here.
// 2) Handler updates only world-state storage placeholders.
// 3) Handler emits a result event (no direct calls to other systems).

function handleWorldEventByType(event, context) {
  const handlers = {
    [EVENT_TYPES.CHARACTER_CREATED]: onCharacterCreated,
    [EVENT_TYPES.CHARACTER_UPDATED]: onCharacterUpdated,
    [EVENT_TYPES.LEVEL_UP]: onLevelUp,
    [EVENT_TYPES.ITEM_ADDED]: onItemAdded,
    [EVENT_TYPES.ITEM_REMOVED]: onItemRemoved,
    [EVENT_TYPES.ITEM_EQUIPPED]: onItemEquipped,
    [EVENT_TYPES.ITEM_UNEQUIPPED]: onItemUnequipped,
    [EVENT_TYPES.PLAYER_USE_ITEM]: onPlayerUseItem
  };

  const handler = handlers[event.event_type];
  if (!handler) {
    return [];
  }

  const result = handler(event, context);
  return [createWorldResultEvent(event, result)];
}

function onCharacterCreated(event, context) {
  const characterStore = context.database.worldStorage.characters;
  const character = event.payload.character || {
    character_id: event.player_id || event.payload.character_id,
    character_name: event.payload.character_name || "Unnamed Character"
  };

  characterStore.saveCharacter(character);
  return { ok: true, action: EVENT_TYPES.CHARACTER_CREATED, saved_id: character.character_id };
}

function onCharacterUpdated(event, context) {
  const characterStore = context.database.worldStorage.characters;
  const characterId = event.payload.character_id;
  const existing = characterStore.loadCharacter(characterId) || { character_id: characterId };
  const updated = { ...existing, ...(event.payload.patch || {}) };

  characterStore.saveCharacter(updated);
  return { ok: true, action: EVENT_TYPES.CHARACTER_UPDATED, saved_id: characterId };
}

function onLevelUp(event, context) {
  const characterStore = context.database.worldStorage.characters;
  const characterId = event.payload.character_id || event.player_id;
  const existing = characterStore.loadCharacter(characterId) || { character_id: characterId, level: 1 };
  const nextLevel = event.payload.new_level || existing.level + 1;

  characterStore.saveCharacter({ ...existing, level: nextLevel });
  return { ok: true, action: EVENT_TYPES.LEVEL_UP, saved_id: characterId, new_level: nextLevel };
}

function onItemAdded(event, context) {
  const { inventoryStore, itemStore, inventory } = ensureInventoryContext(event, context);
  const item = event.payload.item || {};
  const itemId = item.item_id || event.payload.item_id;
  const quantity = event.payload.quantity || 1;

  itemStore.saveItem({ ...item, item_id: itemId });
  inventory.item_entries.push({ entry_id: `entry-${Date.now()}`, item_id: itemId, quantity, location: "backpack" });
  inventoryStore.saveInventory(inventory);

  return { ok: true, action: EVENT_TYPES.ITEM_ADDED, inventory_id: inventory.inventory_id, item_id: itemId, quantity };
}

function onItemRemoved(event, context) {
  const { inventoryStore, inventory } = ensureInventoryContext(event, context);
  const itemId = event.payload.item_id;
  const removeQuantity = event.payload.quantity || 1;
  const entry = inventory.item_entries.find((x) => x.item_id === itemId);

  if (!entry) {
    return { ok: false, action: EVENT_TYPES.ITEM_REMOVED, reason: "item_not_found", item_id: itemId };
  }

  entry.quantity -= removeQuantity;
  if (entry.quantity <= 0) {
    inventory.item_entries = inventory.item_entries.filter((x) => x !== entry);
  }

  inventoryStore.saveInventory(inventory);
  return { ok: true, action: EVENT_TYPES.ITEM_REMOVED, inventory_id: inventory.inventory_id, item_id: itemId };
}

function onItemEquipped(event, context) {
  const { inventoryStore, inventory } = ensureInventoryContext(event, context);
  const itemId = event.payload.item_id;
  const entry = inventory.item_entries.find((x) => x.item_id === itemId);

  if (!entry) {
    return { ok: false, action: EVENT_TYPES.ITEM_EQUIPPED, reason: "item_not_found", item_id: itemId };
  }

  entry.location = "equipped";
  inventoryStore.saveInventory(inventory);
  return { ok: true, action: EVENT_TYPES.ITEM_EQUIPPED, inventory_id: inventory.inventory_id, item_id: itemId };
}

function onItemUnequipped(event, context) {
  const { inventoryStore, inventory } = ensureInventoryContext(event, context);
  const itemId = event.payload.item_id;
  const entry = inventory.item_entries.find((x) => x.item_id === itemId);

  if (!entry) {
    return { ok: false, action: EVENT_TYPES.ITEM_UNEQUIPPED, reason: "item_not_found", item_id: itemId };
  }

  entry.location = "backpack";
  inventoryStore.saveInventory(inventory);
  return { ok: true, action: EVENT_TYPES.ITEM_UNEQUIPPED, inventory_id: inventory.inventory_id, item_id: itemId };
}

function onPlayerUseItem(event, context) {
  // Phase 2E placeholder:
  // We only update persistent inventory counts. No gameplay effects are resolved here.
  const { inventoryStore, inventory } = ensureInventoryContext(event, context);
  const itemId = event.payload.item_id;
  const entry = inventory.item_entries.find((x) => x.item_id === itemId);

  if (!entry) {
    return { ok: false, action: EVENT_TYPES.PLAYER_USE_ITEM, reason: "item_not_found", item_id: itemId };
  }

  entry.quantity -= 1;
  if (entry.quantity <= 0) {
    inventory.item_entries = inventory.item_entries.filter((x) => x !== entry);
  }

  inventoryStore.saveInventory(inventory);
  return { ok: true, action: EVENT_TYPES.PLAYER_USE_ITEM, inventory_id: inventory.inventory_id, item_id: itemId };
}

function ensureInventoryContext(event, context) {
  const inventoryStore = context.database.worldStorage.inventories;
  const itemStore = context.database.worldStorage.items;
  const inventoryId = event.payload.inventory_id || `inv-${event.player_id || "unknown"}`;
  const ownerCharacterId = event.player_id || event.payload.owner_character_id || "unknown";

  const inventory =
    inventoryStore.loadInventory(inventoryId) || {
      inventory_id: inventoryId,
      owner_character_id: ownerCharacterId,
      item_entries: []
    };

  return { inventoryStore, itemStore, inventory };
}

function createWorldResultEvent(sourceEvent, resultPayload) {
  return createEvent(EVENT_TYPES.WORLD_ACTION_RESULT, resultPayload, {
    source: "world_system",
    target_system: "session",
    player_id: sourceEvent.player_id,
    session_id: sourceEvent.session_id,
    combat_id: sourceEvent.combat_id
  });
}

module.exports = {
  handleWorldEventByType
};
