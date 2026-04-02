"use strict";

const { EVENT_TYPES } = require("../../../../packages/shared-types");
const { handleWorldEventByType } = require("../../../world-system/src");
const { resolveActiveCharacterForPlayer } = require("../../../world-system/src/account/resolveActiveCharacter");
const { getRemainingFeatSlots, isFeatSlotAvailable } = require("../../../world-system/src/character/rules/featRules");
const { deriveSavingThrowState } = require("../../../world-system/src/character/rules/saveRules");
const { createGatewayResponseEvent, createRuntimeDispatchEvent } = require("./shared");

function loadCharactersForStart(context) {
  if (context.characterPersistence && typeof context.characterPersistence.listCharacters === "function") {
    const listed = context.characterPersistence.listCharacters();
    if (!listed.ok) {
      return { ok: false, error: listed.error || "failed to list characters through persistence bridge" };
    }

    const persistenceCharacters = Array.isArray(listed.payload.characters) ? listed.payload.characters : [];
    return {
      ok: true,
      characters: persistenceCharacters,
      source: "characterPersistence"
    };
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
  const effectSummary = [];
  if (String(safe.item_type || "").toLowerCase() !== "unidentified") {
    if (Number.isFinite(Number(metadata.armor_class_bonus)) && Number(metadata.armor_class_bonus) !== 0) {
      effectSummary.push(`AC +${Number(metadata.armor_class_bonus)}`);
    }
    const saveBonus = Number.isFinite(Number(metadata.saving_throw_bonus))
      ? Number(metadata.saving_throw_bonus)
      : Number.isFinite(Number(metadata.all_saves_bonus))
        ? Number(metadata.all_saves_bonus)
        : 0;
    if (saveBonus !== 0) {
      effectSummary.push(`Saves +${saveBonus}`);
    }
    if (Number.isFinite(Number(metadata.speed_bonus)) && Number(metadata.speed_bonus) !== 0) {
      effectSummary.push(`Speed +${Number(metadata.speed_bonus)} ft`);
    }
    if (Array.isArray(metadata.resistances) && metadata.resistances.length > 0) {
      effectSummary.push(`Resist ${metadata.resistances.map((entry) => String(entry)).join(", ")}`);
    }
  }
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
    equip_slot: safe.equip_slot || equipmentProfile.equip_slot || null,
    effect_summary: effectSummary
  };
}

function resolveFeatIndex(context) {
  if (!context || typeof context.loadContentBundle !== "function") {
    return {};
  }
  const loaded = context.loadContentBundle();
  if (!loaded || loaded.ok !== true) {
    return {};
  }
  const content = loaded.payload && loaded.payload.content ? loaded.payload.content : {};
  const feats = Array.isArray(content.feats) ? content.feats : [];
  return feats.reduce((index, entry) => {
    const featId = String(entry && entry.feat_id || "").trim().toLowerCase();
    if (featId) {
      index[featId] = entry;
    }
    return index;
  }, {});
}

function summarizeCharacterFeats(context, character) {
  const featIds = Array.isArray(character && character.feats) ? character.feats : [];
  const featIndex = resolveFeatIndex(context);
  return featIds
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean)
    .map((featId) => {
      const feat = featIndex[featId] || null;
      return {
        feat_id: featId,
        name: feat && feat.name ? String(feat.name) : featId,
        description: feat && feat.description ? String(feat.description) : null
      };
    });
}

function resolveCharacterSavingThrows(character) {
  const savingThrows = character && character.saving_throws && typeof character.saving_throws === "object"
    ? character.saving_throws
    : {};
  const itemEffects = resolveCharacterItemEffects(character);
  const itemSaveBonus = Number.isFinite(Number(itemEffects.saving_throw_bonus))
    ? Number(itemEffects.saving_throw_bonus)
    : 0;
  const hasNumericSummary = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]
    .some((key) => Number.isFinite(Number(savingThrows[key])));
  if (hasNumericSummary) {
    if (itemSaveBonus === 0) {
      return savingThrows;
    }
    return ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"].reduce((acc, key) => {
      const base = Number(savingThrows[key]);
      acc[key] = Number.isFinite(base) ? base + itemSaveBonus : itemSaveBonus;
      return acc;
    }, {});
  }
  return deriveSavingThrowState(character).saving_throws;
}

function resolveCharacterItemEffects(character) {
  return character && character.item_effects && typeof character.item_effects === "object"
    ? character.item_effects
    : {};
}

function resolveEffectiveCharacterArmorClass(character) {
  const itemEffects = resolveCharacterItemEffects(character);
  const base = Number.isFinite(Number(character && character.armor_class)) ? Number(character.armor_class) : 10;
  const bonus = Number.isFinite(Number(itemEffects.armor_class_bonus)) ? Number(itemEffects.armor_class_bonus) : 0;
  return Number.isFinite(Number(character && character.effective_armor_class))
    ? Number(character.effective_armor_class)
    : base + bonus;
}

function resolveEffectiveCharacterSpeed(character) {
  const itemEffects = resolveCharacterItemEffects(character);
  const base = Number.isFinite(Number(character && character.speed)) ? Number(character.speed) : 30;
  const bonus = Number.isFinite(Number(itemEffects.speed_bonus)) ? Number(itemEffects.speed_bonus) : 0;
  return Number.isFinite(Number(character && character.effective_speed))
    ? Number(character.effective_speed)
    : base + bonus;
}

function resolveEffectiveSpellSaveDc(character) {
  const itemEffects = resolveCharacterItemEffects(character);
  const base = Number.isFinite(Number(character && character.spellsave_dc)) ? Number(character.spellsave_dc) : null;
  if (base === null) {
    return null;
  }
  return base + (Number.isFinite(Number(itemEffects.spell_save_dc_bonus)) ? Number(itemEffects.spell_save_dc_bonus) : 0);
}

function resolveActivePlayerCharacter(context, playerId) {
  const resolved = resolveActiveCharacterForPlayer(context, playerId);
  if (!resolved.ok) {
    return null;
  }
  return resolved.payload && resolved.payload.character ? resolved.payload.character : null;
}

function summarizeCharacterRoster(context, playerId, activeCharacterId) {
  const safePlayerId = String(playerId || "").trim();
  const safeActiveCharacterId = String(activeCharacterId || "").trim();
  const accountService = context && context.accountService;
  let characters = [];

  if (accountService && typeof accountService.getAccountByDiscordUserId === "function" && typeof accountService.listCharactersForAccount === "function") {
    const accountOut = accountService.getAccountByDiscordUserId(safePlayerId);
    if (accountOut.ok && accountOut.payload && accountOut.payload.account && accountOut.payload.account.account_id) {
      const listed = accountService.listCharactersForAccount(String(accountOut.payload.account.account_id));
      if (listed.ok) {
        characters = Array.isArray(listed.payload && listed.payload.characters) ? listed.payload.characters : [];
      }
    }
  }

  if (characters.length === 0) {
    const loaded = loadCharactersForStart(context);
    if (loaded.ok) {
      const all = Array.isArray(loaded.characters) ? loaded.characters : [];
      characters = all.filter((entry) => String(entry && entry.player_id || "") === safePlayerId);
    }
  }

  return characters
    .map((entry) => ({
      character_id: entry && entry.character_id ? String(entry.character_id) : null,
      name: entry && entry.name ? String(entry.name) : (entry && entry.character_id ? String(entry.character_id) : "Unknown"),
      race: entry && entry.race ? String(entry.race) : null,
      class: entry && entry.class ? String(entry.class) : null,
      level: Number.isFinite(Number(entry && entry.level)) ? Number(entry.level) : 1,
      is_active: String(entry && entry.character_id || "") === safeActiveCharacterId
    }))
    .filter((entry) => entry.character_id);
}

function summarizeCharacterSlotStatus(context, playerId) {
  const safePlayerId = String(playerId || "").trim();
  const accountService = context && context.accountService;
  let characterCount = 0;
  let maxSlots = 3;

  if (accountService && typeof accountService.getAccountByDiscordUserId === "function" && typeof accountService.listCharactersForAccount === "function") {
    const accountOut = accountService.getAccountByDiscordUserId(safePlayerId);
    if (accountOut.ok && accountOut.payload && accountOut.payload.account && accountOut.payload.account.account_id) {
      const account = accountOut.payload.account;
      maxSlots = Number.isFinite(Number(account.max_character_slots)) ? Number(account.max_character_slots) : 3;
      const listed = accountService.listCharactersForAccount(String(account.account_id));
      if (listed.ok) {
        characterCount = Array.isArray(listed.payload && listed.payload.characters) ? listed.payload.characters.length : 0;
      }
    }
  }

  return {
    used_slots: characterCount,
    remaining_slots: Math.max(0, maxSlots - characterCount),
    max_character_slots: maxSlots
  };
}

function handleWorldEvent(event, context) {
  if (event.event_type === EVENT_TYPES.PLAYER_START_REQUESTED) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED, "world_system")];
  }
  if (event.event_type === EVENT_TYPES.PLAYER_SET_ACTIVE_CHARACTER_REQUESTED) {
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
  if (event.event_type === EVENT_TYPES.PLAYER_FEAT_REQUESTED) {
    return [createRuntimeDispatchEvent(event, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED, "world_system")];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_PROFILE_REQUESTED) {
    const loadedCharacters = loadCharactersForStart(context);
    if (!loadedCharacters.ok) {
      return [createGatewayResponseEvent(event, "profile", {}, false, loadedCharacters.error)];
    }

    const playerId = event.player_id;
    const found = resolveActivePlayerCharacter(context, playerId);

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
        active_character_id: found.character_id || null,
        character_roster: summarizeCharacterRoster(context, playerId, found.character_id || null),
        slot_status: summarizeCharacterSlotStatus(context, playerId),
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
          armor_class: resolveEffectiveCharacterArmorClass(found),
          initiative: Number.isFinite(Number(found.initiative)) ? Number(found.initiative) : 0,
          speed: resolveEffectiveCharacterSpeed(found),
          spellcasting_ability: found.spellcasting_ability || null,
          spellsave_dc: resolveEffectiveSpellSaveDc(found),
          saving_throws: resolveCharacterSavingThrows(found),
          skills: found.skills || {},
          feats: summarizeCharacterFeats(context, found),
          feat_slots: getRemainingFeatSlots(found),
          feat_available: isFeatSlotAvailable(found),
          attunement: found.attunement || { attunement_slots: 3, slots_used: 0, attuned_items: [] },
          item_effects: resolveCharacterItemEffects(found),
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
    const playerCharacter = resolveActivePlayerCharacter(context, playerId);
    const found = playerCharacter && playerCharacter.inventory_id
      ? inventories.find((inventory) => String(inventory.inventory_id || "") === String(playerCharacter.inventory_id || ""))
      : inventories.find((inventory) => String(inventory.owner_id || "") === String(playerId || ""));

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
          active_character_id: playerCharacter && playerCharacter.character_id ? playerCharacter.character_id : null,
          character_roster: summarizeCharacterRoster(
            context,
            playerId,
            playerCharacter && playerCharacter.character_id ? playerCharacter.character_id : null
          ),
          slot_status: summarizeCharacterSlotStatus(context, playerId),
          character: playerCharacter ? {
            character_id: playerCharacter.character_id || null,
            name: playerCharacter.name || null,
            level: Number.isFinite(Number(playerCharacter.level)) ? Number(playerCharacter.level) : 1
          } : null,
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
