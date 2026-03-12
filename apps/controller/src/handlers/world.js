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

function summarizeInventory(found, character) {
  const stackableItems = Array.isArray(found.stackable_items) ? found.stackable_items : [];
  const equipmentItems = Array.isArray(found.equipment_items) ? found.equipment_items : [];
  const questItems = Array.isArray(found.quest_items) ? found.quest_items : [];
  const attunedItems = character && character.attunement && Array.isArray(character.attunement.attuned_items)
    ? character.attunement.attuned_items
    : [];
  const unidentifiedCount = equipmentItems.filter((entry) => String(entry && entry.item_type || "").toLowerCase() === "unidentified").length;
  const magicalCount = equipmentItems.filter((entry) => {
    const metadata = entry && entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
    return metadata.magical === true || metadata.requires_attunement === true;
  }).length;
  const attunedCount = attunedItems.length;
  const tradeableItems = stackableItems
    .filter((entry) => Number.isFinite(Number(entry && entry.quantity)) && Number(entry.quantity) > 0)
    .slice(0, 25)
    .map((entry) => cleanItemSummary(entry));
  return {
    inventory_id: found.inventory_id || null,
    owner_id: found.owner_id || null,
    currency: found.currency || {},
    stackable_count: stackableItems.length,
    equipment_count: equipmentItems.length,
    quest_count: questItems.length,
    magical_count: magicalCount,
    unidentified_count: unidentifiedCount,
    attuned_count: attunedCount,
    attunement_slots: character && character.attunement && Number.isFinite(Number(character.attunement.attunement_slots))
      ? Number(character.attunement.attunement_slots)
      : 3,
    stackable_preview: stackableItems.slice(0, 5).map((entry) => cleanItemSummary(entry)),
    equipment_preview: equipmentItems.slice(0, 5).map((entry) => cleanItemSummary(entry)),
    quest_preview: questItems.slice(0, 5).map((entry) => cleanItemSummary(entry)),
    magical_preview: equipmentItems
      .filter((entry) => {
        const metadata = entry && entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
        return metadata.magical === true || metadata.requires_attunement === true;
      })
      .slice(0, 5)
      .map((entry) => cleanItemSummary(entry)),
    unidentified_preview: equipmentItems
      .filter((entry) => String(entry && entry.item_type || "").toLowerCase() === "unidentified")
      .slice(0, 5)
      .map((entry) => cleanItemSummary(entry)),
    tradeable_items: tradeableItems,
    attuned_items: attunedItems.slice(0, 5).map((entry) => String(entry || ""))
  };
}

function cleanItemSummary(entry) {
  const safe = entry && typeof entry === "object" ? entry : {};
  const metadata = safe.metadata && typeof safe.metadata === "object" ? safe.metadata : {};
  const equipmentProfile = metadata.equipment_profile && typeof metadata.equipment_profile === "object"
    ? metadata.equipment_profile
    : {};
  return {
    item_id: safe.item_id || null,
    item_name: safe.item_name || safe.item_id || null,
    item_type: safe.item_type || null,
    quantity: Number.isFinite(Number(safe.quantity)) ? Number(safe.quantity) : null,
    magical: metadata.magical === true || metadata.requires_attunement === true,
    unidentified: String(safe.item_type || "").toLowerCase() === "unidentified",
    attuned: metadata.is_attuned === true,
    requires_attunement: metadata.requires_attunement === true,
    equipped: metadata.equipped === true,
    equipped_slot: metadata.equipped_slot || null,
    equip_slot: safe.equip_slot || equipmentProfile.equip_slot || null
  };
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
  if (event.event_type === EVENT_TYPES.PLAYER_IDENTIFY_ITEM_REQUESTED) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED, "world_system")];
  }
  if (event.event_type === EVENT_TYPES.PLAYER_ATTUNE_ITEM_REQUESTED) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED, "world_system")];
  }
  if (event.event_type === EVENT_TYPES.PLAYER_UNATTUNE_ITEM_REQUESTED) {
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
          background: found.background || null,
          level: found.level || 1,
          xp: Number.isFinite(Number(found.xp)) ? Number(found.xp) : 0,
          proficiency_bonus: Number.isFinite(Number(found.proficiency_bonus)) ? Number(found.proficiency_bonus) : 2,
          race_id: found.race_id || null,
          class_id: found.class_id || null,
          secondary_class_id:
            found.gestalt_progression && found.gestalt_progression.track_b_class_key
              ? found.gestalt_progression.track_b_class_key
              : null,
          class_option_id: found.class_option_id || null,
          secondary_class_option_id:
            found.gestalt_progression && found.gestalt_progression.track_b_option_id
              ? found.gestalt_progression.track_b_option_id
              : null,
          inventory_id: found.inventory_id || null,
          base_stats: found.base_stats || null,
          stats: found.stats || {},
          hp_summary: found.hp_summary || {
            current: Number.isFinite(Number(found.current_hitpoints)) ? Number(found.current_hitpoints) : 10,
            max: Number.isFinite(Number(found.hitpoint_max)) ? Number(found.hitpoint_max) : 10,
            temporary: Number.isFinite(Number(found.temporary_hitpoints)) ? Number(found.temporary_hitpoints) : 0
          },
          armor_class: Number.isFinite(Number(found.armor_class)) ? Number(found.armor_class) : 10,
          initiative: Number.isFinite(Number(found.initiative)) ? Number(found.initiative) : 0,
          speed: Number.isFinite(Number(found.speed)) ? Number(found.speed) : 30,
          spellcasting_ability: found.spellcasting_ability || null,
          spellsave_dc: Number.isFinite(Number(found.spellsave_dc)) ? Number(found.spellsave_dc) : null,
          saving_throws: found.saving_throws || {},
          skills: found.skills || {},
          attunement: found.attunement || { attunement_slots: 3, slots_used: 0, attuned_items: [] },
          spellbook: found.spellbook || {}
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
    const loadedCharacters = loadCharactersForStart(context);
    const playerCharacter = loadedCharacters.ok
      ? loadedCharacters.characters.find((character) => String(character.player_id || "") === String(playerId || ""))
      : null;

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
          inventory: summarizeInventory(found, playerCharacter)
        }, true, null)
      ];
    }

  if (event.event_type === EVENT_TYPES.PLAYER_SHOP_REQUESTED) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED, "world_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_CRAFT_REQUESTED) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED, "world_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_TRADE_REQUESTED) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED, "world_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_USE_ITEM) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED, "world_system")];
  }

  return handleWorldEventByType(event, context);
}

module.exports = {
  handleWorldEvent
};
