"use strict";

const { EVENT_TYPES } = require("../../../../packages/shared-types");
const { handleWorldEventByType } = require("../../../world-system/src");
const { createGatewayResponseEvent, createRuntimeDispatchEvent } = require("./shared");

function loadCharactersForStart(context) {
  if (context.characterPersistence && typeof context.characterPersistence.listCharacters === "function") {
    const listed = context.characterPersistence.listCharacters();
    if (!listed.ok) {
      return { ok: false, error: listed.error || "failed to list characters through persistence bridge" };
    }

    const persistenceCharacters = Array.isArray(listed.payload.characters) ? listed.payload.characters : [];
    if (persistenceCharacters.length > 0) {
      return {
        ok: true,
        characters: persistenceCharacters,
        source: "characterPersistence"
      };
    }
  }

  if (context.characterRepository && typeof context.characterRepository.listStoredCharacters === "function") {
    const listed = context.characterRepository.listStoredCharacters();
    return listed.ok
      ? { ok: true, characters: listed.payload.characters || [], source: "characterRepository" }
      : { ok: false, error: listed.error || "failed to list characters through repository" };
  }

  return { ok: false, error: "character persistence/repository is not available in controller context" };
}

function handleWorldEvent(event, context) {
  if (event.event_type === EVENT_TYPES.PLAYER_START_REQUESTED) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED, "world_system")];
  }
  if (event.event_type === EVENT_TYPES.PLAYER_ADMIN_REQUESTED) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED, "world_system")];
  }
  if (event.event_type === EVENT_TYPES.PLAYER_EQUIP_REQUESTED) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED, "world_system")];
  }
  if (event.event_type === EVENT_TYPES.PLAYER_UNEQUIP_REQUESTED) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED, "world_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_PROFILE_REQUESTED) {
    const loadedCharacters = loadCharactersForStart(context);
    if (!loadedCharacters.ok) {
      return [createGatewayResponseEvent(event, "profile", {}, false, loadedCharacters.error)];
    }

    const playerId = event.player_id;
    const characters = loadedCharacters.characters;
    const found = characters.find((character) => String(character.player_id || "") === String(playerId || ""));

    if (!found) {
      return [
        createGatewayResponseEvent(event, "profile", {
          profile_found: false
        }, true, null)
      ];
    }

    return [
      createGatewayResponseEvent(event, "profile", {
        profile_found: true,
        character: {
          character_id: found.character_id || null,
          player_id: found.player_id || null,
          name: found.name || null,
          race: found.race || null,
          class: found.class || null,
          level: found.level || 1
        }
      }, true, null)
    ];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_INVENTORY_REQUESTED) {
    const inventoryPersistence = context.inventoryPersistence;
    if (!inventoryPersistence || typeof inventoryPersistence.listInventories !== "function") {
      return [
        createGatewayResponseEvent(
          event,
          "inventory",
          {},
          false,
          "inventoryPersistence is not available in controller context"
        )
      ];
    }

    const listed = inventoryPersistence.listInventories();
    if (!listed.ok) {
      return [createGatewayResponseEvent(event, "inventory", {}, false, listed.error || "failed to list inventories")];
    }

    const playerId = event.player_id;
    const inventories = Array.isArray(listed.payload.inventories) ? listed.payload.inventories : [];
    const found = inventories.find((inventory) => String(inventory.owner_id || "") === String(playerId || ""));

    if (!found) {
      return [
        createGatewayResponseEvent(event, "inventory", {
          inventory_found: false
        }, true, null)
      ];
    }

    return [
      createGatewayResponseEvent(event, "inventory", {
        inventory_found: true,
        inventory: {
          inventory_id: found.inventory_id || null,
          owner_id: found.owner_id || null,
          currency: found.currency || {},
          stackable_count: Array.isArray(found.stackable_items) ? found.stackable_items.length : 0,
          equipment_count: Array.isArray(found.equipment_items) ? found.equipment_items.length : 0,
          quest_count: Array.isArray(found.quest_items) ? found.quest_items.length : 0
        }
      }, true, null)
    ];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_USE_ITEM) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED, "world_system")];
  }

  return handleWorldEventByType(event, context);
}

module.exports = {
  handleWorldEvent
};
