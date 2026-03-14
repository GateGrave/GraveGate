"use strict";

const { createEvent, EVENT_TYPES } = require("../../../packages/shared-types");
const { bootstrapPlayerStart } = require("../../world-system/src/character/flow/bootstrapPlayerStart");
const {
  processEquipRequest,
  processUnequipRequest
} = require("../../world-system/src/character/flow/processEquipmentRequest");
const {
  processIdentifyItemRequest,
  processAttunementRequest
} = require("../../world-system/src/character/flow/processMagicalItemRequest");
const { processFeatRequest } = require("../../world-system/src/character/flow/processFeatRequest");
const {
  listNpcShopForPlayer,
  processNpcShopBuyRequest,
  processNpcShopSellRequest
} = require("../../world-system/src/economy/processNpcShopRequest");
const {
  listTradesForPlayer,
  processTradeProposal,
  processTradeAction
} = require("../../world-system/src/economy/processPlayerTradeRequest");
const {
  listCraftRecipesForPlayer,
  processCraftRecipeRequest
} = require("../../world-system/src/crafting/processCraftRequest");
const { processWorldUseItemEvent } = require("../../world-system/src/flow/processWorldUseItemEvent");
const { processAdminActionRequest } = require("../../world-system/src/admin/processAdminActionRequest");
const {
  processEnterDungeonRequest,
  processLeaveSessionRequest
} = require("../../dungeon-exploration/src/flow/processSessionLifecycleRequest");
const {
  processSessionMoveRequest,
  processSessionInteractRequest
} = require("../../dungeon-exploration/src/flow/processActiveSessionAction");
const { prepareRewardHook } = require("../../dungeon-exploration/src/flow/prepareRewardHook");
const { consumeRewardHook } = require("../../world-system/src/loot/flow/consumeRewardHook");
const { rollLoot } = require("../../world-system/src/loot/flow/rollLoot");
const { grantLootToInventory } = require("../../world-system/src/loot/flow/grantLootToInventory");
const {
  processCombatAttackRequest,
  processCombatCastSpellRequest,
  processCombatDodgeRequest,
  processCombatMoveRequest,
  processCombatUseItemRequest
} = require("../../combat-system/src/flow/processCombatActionRequest");
const { getRemainingFeatSlots, isFeatSlotAvailable } = require("../../world-system/src/character/rules/featRules");
const { deriveSavingThrowState } = require("../../world-system/src/character/rules/saveRules");

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

function createGatewayResponseEvent(sourceEvent, responseType, data, ok, errorMessage, sourceSystem) {
  return createEvent(EVENT_TYPES.GATEWAY_RESPONSE_READY, {
    response_type: responseType,
    ok: ok !== false,
    data: data || {},
    error: errorMessage || null,
    request_event_type: sourceEvent.event_type,
    request_event_id: sourceEvent.event_id || null
  }, {
    source: sourceSystem || "runtime",
    target_system: "gateway",
    player_id: sourceEvent.player_id || null,
    session_id: sourceEvent.session_id || null,
    combat_id: sourceEvent.combat_id || null
  });
}

function createInventoryService(inventoryPersistence) {
  return {
    getInventory(inventoryId) {
      return inventoryPersistence.loadInventoryById(inventoryId);
    },
    saveInventory(inventory) {
      return inventoryPersistence.saveInventory(inventory);
    },
    listInventories() {
      return inventoryPersistence.listInventories();
    }
  };
}

function resolvePlayerCharacter(context, playerId) {
  const characterPersistence = context && context.characterPersistence;
  if (!characterPersistence || typeof characterPersistence.listCharacters !== "function") {
    return null;
  }
  const listed = characterPersistence.listCharacters();
  if (!listed.ok) {
    return null;
  }
  const rows = Array.isArray(listed.payload.characters) ? listed.payload.characters : [];
  return rows.find((entry) => String(entry.player_id || "") === String(playerId || "")) || null;
}

function resolveFeatIndexFromContent(context) {
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
      index[featId] = clone(entry);
    }
    return index;
  }, {});
}

function summarizeCharacterFeats(context, character) {
  const featIds = Array.isArray(character && character.feats) ? character.feats : [];
  const featIndex = resolveFeatIndexFromContent(context);
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

function resolveLootTableFromContent(context, lootTableId) {
  if (!lootTableId || !context || typeof context.loadContentBundle !== "function") {
    return null;
  }
  const loaded = context.loadContentBundle();
  if (!loaded || loaded.ok !== true) {
    return null;
  }
  const content = loaded.payload && loaded.payload.content ? loaded.payload.content : {};
  const tables = Array.isArray(content.loot_tables) ? content.loot_tables : [];
  return tables.find((entry) => String(entry.loot_table_id || "") === String(lootTableId)) || null;
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
  const magicalPreview = equipmentItems
    .filter((entry) => {
      const metadata = entry && entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
      return metadata.magical === true || metadata.requires_attunement === true;
    })
    .slice(0, 5)
    .map((entry) => cleanItemSummary(entry));
  const unidentifiedPreview = equipmentItems
    .filter((entry) => String(entry && entry.item_type || "").toLowerCase() === "unidentified")
    .slice(0, 5)
    .map((entry) => cleanItemSummary(entry));
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
    magical_preview: magicalPreview,
    unidentified_preview: unidentifiedPreview,
    tradeable_items: tradeableItems,
    attuned_items: attunedItems.slice(0, 5).map((entry) => String(entry || ""))
  };
}

function cleanItemSummary(entry) {
  const safe = entry && typeof entry === "object" ? entry : {};
  const metadata = safe.metadata && typeof safe.metadata === "object" ? safe.metadata : {};
  const useEffect = metadata.use_effect && typeof metadata.use_effect === "object" ? metadata.use_effect : {};
  const equipmentProfile = metadata.equipment_profile && typeof metadata.equipment_profile === "object"
    ? metadata.equipment_profile
    : {};
  const healAmount = Number.isFinite(Number(useEffect.heal_amount))
    ? Number(useEffect.heal_amount)
    : Number.isFinite(Number(metadata.heal_amount))
      ? Number(metadata.heal_amount)
      : 0;
  const temporaryHitPoints = Number.isFinite(Number(useEffect.temporary_hitpoints))
    ? Number(useEffect.temporary_hitpoints)
    : Number.isFinite(Number(useEffect.temp_hp))
      ? Number(useEffect.temp_hp)
      : Number.isFinite(Number(metadata.temporary_hitpoints))
        ? Number(metadata.temporary_hitpoints)
        : (Number.isFinite(Number(metadata.temp_hp)) ? Number(metadata.temp_hp) : 0);
  const charges = Number.isFinite(Number(metadata.charges)) ? Number(metadata.charges) : null;
  const chargesRemaining = Number.isFinite(Number(metadata.charges_remaining))
    ? Number(metadata.charges_remaining)
    : charges;
  const damageReduction = Number.isFinite(Number(metadata.damage_reduction)) ? Number(metadata.damage_reduction) : 0;
  const useConditions = Array.isArray(useEffect.applied_conditions)
    ? useEffect.applied_conditions
    : (Array.isArray(metadata.applied_conditions) ? metadata.applied_conditions : []);
  const removeConditions = Array.isArray(useEffect.remove_conditions)
    ? useEffect.remove_conditions
    : (Array.isArray(metadata.remove_conditions) ? metadata.remove_conditions : []);
  const hitpointMaxBonus = Number.isFinite(Number(useEffect.hitpoint_max_bonus))
    ? Number(useEffect.hitpoint_max_bonus)
    : Number.isFinite(Number(safe.hitpoint_max_bonus))
      ? Number(safe.hitpoint_max_bonus)
      : 0;
  const isUsable = (
    healAmount > 0 ||
    temporaryHitPoints > 0 ||
    hitpointMaxBonus > 0 ||
    useConditions.length > 0 ||
    removeConditions.length > 0
  ) && (charges === null || Number.isFinite(chargesRemaining) && chargesRemaining > 0);
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
    if (Number.isFinite(Number(metadata.attack_bonus)) && Number(metadata.attack_bonus) !== 0) {
      effectSummary.push(`Attack +${Number(metadata.attack_bonus)}`);
    }
    if (Number.isFinite(Number(metadata.speed_bonus)) && Number(metadata.speed_bonus) !== 0) {
      effectSummary.push(`Speed +${Number(metadata.speed_bonus)} ft`);
    }
    if (String(metadata.bonus_damage_dice || "").trim() && String(metadata.bonus_damage_type || "").trim()) {
      effectSummary.push(`On hit ${String(metadata.bonus_damage_dice).trim()} ${String(metadata.bonus_damage_type).trim()}`);
    }
    if (Array.isArray(metadata.reactive_damage_effects) && metadata.reactive_damage_effects.length > 0) {
      metadata.reactive_damage_effects.forEach((effect) => {
        const safeEffect = effect && typeof effect === "object" ? effect : {};
        const trigger = String(safeEffect.trigger || "").trim().toLowerCase();
        const damageDice = String(safeEffect.damage_dice || "").trim();
        const flatModifier = Number.isFinite(Number(safeEffect.flat_modifier)) ? Number(safeEffect.flat_modifier) : 0;
        const damageType = String(safeEffect.damage_type || "").trim();
        if (trigger === "melee_hit_taken" && (damageDice || flatModifier > 0) && damageType) {
          const damageText = damageDice || String(flatModifier);
          effectSummary.push(`Retaliate ${damageText} ${damageType} on melee hit`);
        }
      });
    }
    if (Array.isArray(metadata.resistances) && metadata.resistances.length > 0) {
      effectSummary.push(`Resist ${metadata.resistances.map((entry) => String(entry)).join(", ")}`);
    }
    if (damageReduction > 0) {
      effectSummary.push(
        Array.isArray(metadata.damage_reduction_types) && metadata.damage_reduction_types.length > 0
          ? `Ward ${damageReduction} vs ${metadata.damage_reduction_types.map((entry) => String(entry)).join(", ")}`
          : `Ward ${damageReduction}`
      );
    }
    if (healAmount > 0) {
      effectSummary.push(`Heal ${healAmount}`);
    }
    if (temporaryHitPoints > 0) {
      effectSummary.push(`Temp HP ${temporaryHitPoints}`);
    }
    if (hitpointMaxBonus > 0) {
      effectSummary.push(`Vitality +${hitpointMaxBonus} HP`);
    }
    if (removeConditions.length > 0) {
      effectSummary.push(`Cleanse ${removeConditions.map((entry) => String(entry)).join(", ")}`);
    }
    const heroismCondition = useConditions.find((entry) => {
      const safeEntry = entry && typeof entry === "object" ? entry : {};
      return String(safeEntry.condition_type || safeEntry.type || "").trim().toLowerCase() === "heroism";
    });
    if (heroismCondition) {
      const metadata = heroismCondition.metadata && typeof heroismCondition.metadata === "object"
        ? heroismCondition.metadata
        : {};
      const turnTempHp = Number.isFinite(Number(metadata.start_of_turn_temporary_hitpoints))
        ? Number(metadata.start_of_turn_temporary_hitpoints)
        : 0;
      if (turnTempHp > 0) {
        effectSummary.push(`Heroism ${turnTempHp} temp HP each turn`);
      } else {
        effectSummary.push("Heroism");
      }
    }
    useConditions.forEach((entry) => {
      const safeEntry = entry && typeof entry === "object" ? entry : {};
      const type = String(safeEntry.condition_type || safeEntry.type || "").trim().toLowerCase();
      const conditionMetadata = safeEntry.metadata && typeof safeEntry.metadata === "object" ? safeEntry.metadata : {};
      if (type === "protection_from_poison") {
        effectSummary.push("Poison ward");
      }
      if (type === "sanctuary" || conditionMetadata.blocks_attack_targeting === true || conditionMetadata.blocks_harmful_spell_targeting === true) {
        const wardDc = Number(conditionMetadata.targeting_save_dc);
        effectSummary.push(Number.isFinite(wardDc) ? `Sanctuary ward DC ${wardDc}` : "Sanctuary ward");
      }
      if (type === "blade_ward") {
        effectSummary.push("Weapon damage resistance");
      }
      const speedBonus = Number.isFinite(Number(conditionMetadata.speed_bonus_feet))
        ? Number(conditionMetadata.speed_bonus_feet)
        : 0;
      if ((type === "longstrider" || speedBonus > 0) && speedBonus > 0) {
        effectSummary.push(`Speed +${speedBonus} ft`);
      }
      const armorClassBonus = Number(conditionMetadata.armor_class_bonus);
      if (Number.isFinite(armorClassBonus) && armorClassBonus !== 0) {
        effectSummary.push(`AC +${armorClassBonus}`);
      }
      const minimumArmorClass = Number(
        conditionMetadata.minimum_armor_class !== undefined
          ? conditionMetadata.minimum_armor_class
          : conditionMetadata.armor_class_minimum
      );
      if (Number.isFinite(minimumArmorClass)) {
        effectSummary.push(`Armor cannot drop below ${minimumArmorClass}`);
      }
      const saveBonusDice = String(conditionMetadata.saving_throw_bonus_dice || "").trim();
      if (saveBonusDice) {
        effectSummary.push(`Saves +${saveBonusDice}`);
      }
      if (type === "blurred" || conditionMetadata.attackers_have_disadvantage === true) {
        effectSummary.push("Attackers roll at disadvantage");
      }
      if (Array.isArray(conditionMetadata.resistances) && conditionMetadata.resistances.length > 0) {
        effectSummary.push(`Grants ${conditionMetadata.resistances.map((value) => String(value)).join(", ")} resistance`);
      }
    });
    if (charges !== null && Number.isFinite(chargesRemaining)) {
      effectSummary.push(`Charges ${chargesRemaining}/${charges}`);
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
    usable: isUsable,
    heal_amount: healAmount,
    temporary_hitpoints: temporaryHitPoints,
    charges,
    charges_remaining: chargesRemaining,
    effect_summary: effectSummary
  };
}

function findSessionRoomById(session, roomId) {
  const rooms = Array.isArray(session && session.rooms) ? session.rooms : [];
  const target = String(roomId || "");
  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index];
    if (String(room && room.room_id || "") === target) {
      return room;
    }
  }
  return null;
}

function summarizeRoomObject(entry) {
  const safe = entry && typeof entry === "object" ? entry : {};
  const metadata = safe.metadata && typeof safe.metadata === "object" ? safe.metadata : {};
  const hidden = safe.is_hidden === true || metadata.hidden === true;
  if (hidden) {
    return null;
  }
  return {
    object_id: safe.object_id || null,
    object_type: safe.object_type || safe.type || null,
    name: safe.name || null,
    hidden: false,
    position:
      safe.position && typeof safe.position === "object"
        ? clone(safe.position)
        : (metadata.position && typeof metadata.position === "object"
          ? clone(metadata.position)
          : (metadata.map_position && typeof metadata.map_position === "object" ? clone(metadata.map_position) : null)),
    state: {
      is_locked: safe.is_locked === true || metadata.locked === true,
      is_opened: safe.is_opened === true,
      is_disarmed: safe.is_disarmed === true,
      is_lit: safe.is_lit === true,
      is_activated: safe.is_activated === true
    }
  };
}

function summarizeDungeonMapState(session, room) {
  const safeRoom = room && typeof room === "object" ? room : null;
  const safeSession = session && typeof session === "object" ? session : {};
  if (!safeRoom) {
    return null;
  }

  const roomMetadata = safeRoom.metadata && typeof safeRoom.metadata === "object" ? safeRoom.metadata : {};
  const sessionMetadata = safeSession.metadata && typeof safeSession.metadata === "object" ? safeSession.metadata : {};
  const base = safeRoom.dungeon_map && typeof safeRoom.dungeon_map === "object"
    ? safeRoom.dungeon_map
    : (roomMetadata.dungeon_map && typeof roomMetadata.dungeon_map === "object"
      ? roomMetadata.dungeon_map
      : (safeSession.dungeon_map && typeof safeSession.dungeon_map === "object"
        ? safeSession.dungeon_map
        : (sessionMetadata.dungeon_map && typeof sessionMetadata.dungeon_map === "object" ? sessionMetadata.dungeon_map : null)));

  if (!base) {
    return null;
  }

  return {
    ...clone(base),
    leader_id: base.leader_id || (safeSession.party && safeSession.party.leader_id ? safeSession.party.leader_id : safeSession.leader_id || null)
  };
}

function summarizeRoomState(session) {
  const currentRoomId = session && session.current_room_id ? String(session.current_room_id) : "";
  if (!currentRoomId) {
    return null;
  }
  const room = findSessionRoomById(session, currentRoomId);
  if (!room) {
    return null;
  }
  const exits = Array.isArray(room.exits) ? room.exits : [];
  const objects = Array.isArray(room.objects) ? room.objects : [];
  return {
    room_id: room.room_id || null,
    name: room.name || null,
    description: room.description || null,
    room_type: room.room_type || null,
    exits: exits.map((entry) => ({
      direction: entry && entry.direction ? String(entry.direction) : null,
      to_room_id: entry && entry.to_room_id ? String(entry.to_room_id) : null,
      locked: entry && entry.locked === true,
      position:
        entry && entry.position && typeof entry.position === "object"
          ? clone(entry.position)
          : (entry && entry.map_position && typeof entry.map_position === "object"
            ? clone(entry.map_position)
            : (entry && entry.metadata && typeof entry.metadata === "object" && entry.metadata.position && typeof entry.metadata.position === "object"
              ? clone(entry.metadata.position)
              : null))
    })),
    visible_objects: objects
      .map((entry) => summarizeRoomObject(entry))
      .filter(Boolean),
    dungeon_map: summarizeDungeonMapState(session, room)
  };
}

function resolveSpellDefinitionFromContent(context, spellId) {
  if (!spellId || !context || typeof context.loadContentBundle !== "function") {
    return null;
  }
  const loaded = context.loadContentBundle();
  if (!loaded || loaded.ok !== true) {
    return null;
  }
  const content = loaded.payload && loaded.payload.content ? loaded.payload.content : {};
  const spells = Array.isArray(content.spells) ? content.spells : [];
  return spells.find((entry) => String(entry.spell_id || entry.id || "") === String(spellId || "")) || null;
}

function resolveUtilitySpellForInteraction(context, playerId, spellId) {
  const normalizedSpellId = spellId ? String(spellId).trim().toLowerCase() : "";
  if (!normalizedSpellId) {
    return success("session_interaction_spell_not_requested", {
      spell: null
    });
  }

  const playerCharacter = resolvePlayerCharacter(context, playerId);
  if (!playerCharacter) {
    return failure("session_interaction_spell_failed", "player character not found for utility spell interaction", {
      player_id: String(playerId || ""),
      spell_id: normalizedSpellId
    });
  }

  const spellbook = playerCharacter.spellbook && typeof playerCharacter.spellbook === "object"
    ? playerCharacter.spellbook
    : {};
  const knownSpellIds = Array.isArray(spellbook.known_spell_ids) ? spellbook.known_spell_ids : [];
  const knowsSpell = knownSpellIds.some((entry) => String(entry || "").trim().toLowerCase() === normalizedSpellId);
  if (!knowsSpell) {
    return failure("session_interaction_spell_failed", "spell is not known by character", {
      player_id: String(playerId || ""),
      spell_id: normalizedSpellId
    });
  }

  const spell = resolveSpellDefinitionFromContent(context, normalizedSpellId);
  if (!spell) {
    return failure("session_interaction_spell_failed", "spell data not found", {
      player_id: String(playerId || ""),
      spell_id: normalizedSpellId
    });
  }

  const utilityRef = spell.effect && spell.effect.utility_ref ? String(spell.effect.utility_ref).trim() : "";
  if (!utilityRef) {
    return failure("session_interaction_spell_failed", "spell is not a supported utility interaction spell", {
      spell_id: normalizedSpellId
    });
  }

  return success("session_interaction_spell_resolved", {
    spell: clone(spell)
  });
}

function resolveInteractionSkillProfile(context, playerId) {
  const playerCharacter = resolvePlayerCharacter(context, playerId);
  if (!playerCharacter) {
    return success("session_interaction_skill_profile_not_found", {
      skill_profile: {}
    });
  }
  return success("session_interaction_skill_profile_resolved", {
    skill_profile:
      playerCharacter.skills && typeof playerCharacter.skills === "object" && !Array.isArray(playerCharacter.skills)
        ? clone(playerCharacter.skills)
        : {}
  });
}

function resolveInteractionToolProfile(context, playerId) {
  const playerCharacter = resolvePlayerCharacter(context, playerId);
  if (!playerCharacter) {
    return success("session_interaction_tool_profile_not_found", {
      tool_profile: []
    });
  }
  const appliedProficiencies = playerCharacter.applied_proficiencies && typeof playerCharacter.applied_proficiencies === "object"
    ? playerCharacter.applied_proficiencies
    : {};
  const classSelection = playerCharacter.class_selection && typeof playerCharacter.class_selection === "object"
    ? playerCharacter.class_selection
    : {};
  const backgroundSelection = playerCharacter.background_selection && typeof playerCharacter.background_selection === "object"
    ? playerCharacter.background_selection
    : {};
  const backgroundMetadata = backgroundSelection.metadata && typeof backgroundSelection.metadata === "object"
    ? backgroundSelection.metadata
    : {};
  const toolRefs = []
    .concat(Array.isArray(appliedProficiencies.tools) ? appliedProficiencies.tools : [])
    .concat(Array.isArray(classSelection.tool_proficiencies) ? classSelection.tool_proficiencies : [])
    .concat(Array.isArray(backgroundMetadata.tool_refs) ? backgroundMetadata.tool_refs : [])
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean);
  return success("session_interaction_tool_profile_resolved", {
    tool_profile: Array.from(new Set(toolRefs))
  });
}

function resolveInteractionItemIndex(context) {
  if (!context || typeof context.loadContentBundle !== "function") {
    return success("session_interaction_item_index_not_available", {
      item_index: {}
    });
  }
  const loaded = context.loadContentBundle();
  if (!loaded || loaded.ok !== true) {
    return success("session_interaction_item_index_not_available", {
      item_index: {}
    });
  }
  const content = loaded.payload && loaded.payload.content ? loaded.payload.content : {};
  const items = Array.isArray(content.items) ? content.items : [];
  const itemIndex = items.reduce((index, item) => {
    const itemId = String(item && item.item_id || "").trim();
    if (itemId) {
      index[itemId] = clone(item);
    }
    return index;
  }, {});
  return success("session_interaction_item_index_resolved", {
    item_index: itemIndex
  });
}

function resolveInteractionCharacterProfile(context, playerId) {
  const playerCharacter = resolvePlayerCharacter(context, playerId);
  if (!playerCharacter) {
    return success("session_interaction_character_profile_not_found", {
      character_profile: {}
    });
  }
  return success("session_interaction_character_profile_resolved", {
    character_profile: {
      stats: playerCharacter.stats && typeof playerCharacter.stats === "object" ? clone(playerCharacter.stats) : {},
      proficiency_bonus: Number.isFinite(Number(playerCharacter.proficiency_bonus)) ? Number(playerCharacter.proficiency_bonus) : 2
    }
  });
}

function resolveObjectRewardForInteraction(context, requestEvent, interactionOut) {
  const rewardHint =
    interactionOut &&
    interactionOut.payload &&
    interactionOut.payload.reward_hint &&
    typeof interactionOut.payload.reward_hint === "object"
      ? interactionOut.payload.reward_hint
      : null;
  const rewardContext = rewardHint && rewardHint.reward_context ? String(rewardHint.reward_context) : "";
  if (!rewardHint || !rewardContext) {
    return success("session_interaction_reward_not_applicable", {
      reward_status: "none"
    });
  }

  const inlineLootTable = rewardHint.loot_table && typeof rewardHint.loot_table === "object"
    ? rewardHint.loot_table
    : null;
  const lootTableId = rewardHint.loot_table_id ? String(rewardHint.loot_table_id) : null;
  const resolvedLootTable = inlineLootTable || resolveLootTableFromContent(context, lootTableId);
  if (!resolvedLootTable) {
    return success("session_interaction_reward_not_configured", {
      reward_status: "none",
      loot_table_id: lootTableId || null
    });
  }

  const prepared = prepareRewardHook({
    manager: context.sessionManager,
    sessionPersistence: context.sessionPersistence || null,
    session_id: interactionOut.payload.session_id,
    reward_context: rewardContext,
    source_override: {
      source_type: interactionOut.payload.object_type || "object",
      source_id: interactionOut.payload.object_id
    },
    reward_key_suffix: interactionOut.payload.object_id
  });
  if (!prepared.ok) {
    return failure("session_interaction_reward_failed", prepared.error || "failed to prepare chest reward");
  }

  const rewardPayload = {
    ...(prepared.payload.reward_event && prepared.payload.reward_event.payload
      ? prepared.payload.reward_event.payload
      : {}),
    target_player_id: requestEvent.player_id,
    loot_table_id: resolvedLootTable.loot_table_id || lootTableId || null,
    metadata: {
      reward_update:
        rewardHint.reward_update && typeof rewardHint.reward_update === "object"
          ? clone(rewardHint.reward_update)
          : {}
    }
  };

  const consumed = consumeRewardHook({
    reward_hook: rewardPayload,
    loot_table: resolvedLootTable
  });
  if (!consumed.ok) {
    return failure("session_interaction_reward_failed", consumed.error || "failed to consume chest reward hook");
  }

  const rollInput = consumed.payload.next_step && consumed.payload.next_step.roll_input
    ? consumed.payload.next_step.roll_input
    : null;
  const rolled = rollInput ? rollLoot(rollInput) : failure("loot_roll_failed", "reward hook did not produce roll input");
  if (!rolled.ok) {
    return failure("session_interaction_reward_failed", rolled.error || "failed to roll chest loot");
  }

  const playerCharacter = resolvePlayerCharacter(context, requestEvent.player_id);
  const inventoryService = context.inventoryPersistence ? createInventoryService(context.inventoryPersistence) : null;
  if (!inventoryService || !playerCharacter || !playerCharacter.inventory_id) {
    return failure("session_interaction_reward_failed", "player inventory is not available for chest reward");
  }

  const granted = grantLootToInventory({
    loot_bundle: rolled.payload.loot_bundle,
    inventory_service: inventoryService,
    inventory_id: playerCharacter.inventory_id,
    owner_id: requestEvent.player_id,
    owner_player_id: requestEvent.player_id,
    character_id: playerCharacter.character_id,
    characterPersistence: context.characterPersistence
  });
  if (!granted.ok) {
    return failure("session_interaction_reward_failed", granted.error || "failed to grant chest reward");
  }

  return success("session_interaction_reward_granted", {
    reward_status: "granted",
    loot_table_id: resolvedLootTable.loot_table_id || lootTableId || null,
    reward_context: rewardContext,
    loot_entries: rolled.payload.loot_bundle && Array.isArray(rolled.payload.loot_bundle.entries)
      ? clone(rolled.payload.loot_bundle.entries)
      : [],
    inventory: granted.payload && granted.payload.inventory ? clone(granted.payload.inventory) : null
  });
}

function getRequestEvent(event) {
  return event && event.payload && event.payload.request_event ? event.payload.request_event : null;
}

function resolveMutationReplayKey(requestEvent) {
  const payload = requestEvent && requestEvent.payload && typeof requestEvent.payload === "object"
    ? requestEvent.payload
    : null;
  if (!payload) {
    return null;
  }
  const requestId = payload.request_id || payload.action_id || payload.idempotency_key || null;
  if (!requestId) {
    return null;
  }
  const normalized = String(requestId).trim();
  if (!normalized) {
    return null;
  }
  return [
    String(requestEvent.player_id || ""),
    String(requestEvent.event_type || ""),
    normalized
  ].join(":");
}

function rejectDuplicateMutationIfNeeded(requestEvent, context, responseType, sourceSystem) {
  const replayStore = context && context.mutationReplayStore;
  const replayKey = resolveMutationReplayKey(requestEvent);
  if (!replayKey || !replayStore || typeof replayStore.has !== "function" || typeof replayStore.add !== "function") {
    return null;
  }
  if (replayStore.has(replayKey)) {
    return createGatewayResponseEvent(
      requestEvent,
      responseType,
      {},
      false,
      "duplicate mutation request",
      sourceSystem
    );
  }
  return {
    replayKey
  };
}

function markMutationReplaySuccess(context, replayState, succeeded) {
  if (!succeeded || !replayState || !replayState.replayKey) {
    return;
  }
  const replayStore = context && context.mutationReplayStore;
  if (replayStore && typeof replayStore.add === "function") {
    replayStore.add(replayState.replayKey);
  }
}

function summarizeCombatProgression(outPayload) {
  const progression = outPayload && outPayload.progression && typeof outPayload.progression === "object"
    ? outPayload.progression
    : {};
  const combat = progression.combat && typeof progression.combat === "object"
    ? progression.combat
    : (outPayload && outPayload.attack && outPayload.attack.combat) ||
      (outPayload && outPayload.cast_spell && outPayload.cast_spell.combat) ||
      (outPayload && outPayload.move && outPayload.move.combat) ||
      (outPayload && outPayload.use_item && outPayload.use_item.combat) ||
      null;
  const aiTurns = Array.isArray(progression.ai_turns) ? progression.ai_turns : [];
  const activeParticipantId =
    progression.active_participant_id ||
    (combat && Array.isArray(combat.initiative_order) && Number.isFinite(combat.turn_index)
      ? combat.initiative_order[combat.turn_index]
      : null);
  let winnerTeam = null;
  if (combat && Array.isArray(combat.event_log)) {
    for (let index = combat.event_log.length - 1; index >= 0; index -= 1) {
      const entry = combat.event_log[index];
      if (entry && entry.event_type === "combat_completed" && entry.details && entry.details.winner_team) {
        winnerTeam = entry.details.winner_team;
        break;
      }
    }
  }
  return {
    progression,
    combat,
    ai_turns: aiTurns,
    ai_turn_count: aiTurns.length,
    active_participant_id: activeParticipantId || null,
    combat_completed: progression.combat_completed === true || (combat && String(combat.status || "") === "complete"),
    winner_team: winnerTeam
  };
}

function normalizeCombatSummaryTeam(value) {
  const safe = String(value || "").trim().toLowerCase();
  if (safe === "heroes" || safe === "players" || safe === "party") {
    return "heroes";
  }
  if (safe === "monsters" || safe === "enemies") {
    return "monsters";
  }
  return safe || "neutral";
}

function getCombatMarkerPrefix(team) {
  const normalized = normalizeCombatSummaryTeam(team);
  if (normalized === "heroes") {
    return "H";
  }
  if (normalized === "monsters") {
    return "M";
  }
  return "N";
}

function getCombatMarkerSortRank(team) {
  const normalized = normalizeCombatSummaryTeam(team);
  if (normalized === "heroes") {
    return 0;
  }
  if (normalized === "monsters") {
    return 1;
  }
  return 2;
}

function buildGatewayCombatParticipantMarkers(participants) {
  const safeParticipants = Array.isArray(participants) ? participants.slice() : [];
  const ordered = safeParticipants
    .filter((entry) => entry && entry.participant_id)
    .sort((left, right) => {
      const leftRank = getCombatMarkerSortRank(left && left.team);
      const rightRank = getCombatMarkerSortRank(right && right.team);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return String(left && left.participant_id || "").localeCompare(String(right && right.participant_id || ""));
    });

  const counts = {
    heroes: 0,
    monsters: 0,
    neutral: 0
  };
  const markers = new Map();

  ordered.forEach((entry) => {
    const participantId = String(entry && entry.participant_id || "");
    if (!participantId) {
      return;
    }
    const team = normalizeCombatSummaryTeam(entry && entry.team);
    counts[team] = (counts[team] || 0) + 1;
    markers.set(participantId, `${getCombatMarkerPrefix(team)}${counts[team]}`);
  });

  return markers;
}

function summarizeParticipantConcentrationForGateway(participant) {
  const concentration = participant && participant.concentration && typeof participant.concentration === "object"
    ? participant.concentration
    : {};
  return {
    is_concentrating: concentration.is_concentrating === true,
    source_spell_id: concentration.source_spell_id ? String(concentration.source_spell_id) : null,
    started_at_round: Number.isFinite(Number(concentration.started_at_round))
      ? Number(concentration.started_at_round)
      : null,
    broken_reason: concentration.broken_reason ? String(concentration.broken_reason) : null
  };
}

function summarizeCombatStateForGateway(combat, activeParticipantId) {
  const safeCombat = combat && typeof combat === "object" ? combat : null;
  if (!safeCombat) {
    return null;
  }
  const participants = Array.isArray(safeCombat.participants) ? safeCombat.participants : [];
  const conditions = Array.isArray(safeCombat.conditions) ? safeCombat.conditions : [];
  const markers = buildGatewayCombatParticipantMarkers(participants);
  const initiativeOrder = Array.isArray(safeCombat.initiative_order)
    ? safeCombat.initiative_order.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  return {
    combat_id: safeCombat.combat_id || null,
    status: safeCombat.status || null,
    round: Number.isFinite(Number(safeCombat.round)) ? Number(safeCombat.round) : 1,
    turn_index: Number.isFinite(Number(safeCombat.turn_index)) ? Number(safeCombat.turn_index) : 0,
    active_participant_id: activeParticipantId || null,
    condition_count: conditions.length,
    initiative_order: clone(initiativeOrder),
    participants: participants.slice(0, 8).map((entry) => {
      const participantId = entry && entry.participant_id ? String(entry.participant_id) : null;
      const participantConditions = conditions
        .filter((condition) => String(condition && condition.target_actor_id || "") === String(participantId || ""))
        .slice(0, 5);

      return {
        participant_id: participantId,
        player_id: entry && entry.player_id ? String(entry.player_id) : null,
        name: entry && entry.name ? String(entry.name) : null,
        map_marker: participantId ? markers.get(participantId) || null : null,
        known_spell_ids:
          entry &&
          entry.spellbook &&
          Array.isArray(entry.spellbook.known_spell_ids)
            ? clone(entry.spellbook.known_spell_ids)
            : [],
        team: entry && entry.team ? String(entry.team) : null,
        current_hp: Number.isFinite(Number(entry && entry.current_hp)) ? Number(entry.current_hp) : null,
        max_hp: Number.isFinite(Number(entry && entry.max_hp)) ? Number(entry.max_hp) : null,
        position: entry && entry.position ? clone(entry.position) : null,
        defeated: Number(entry && entry.current_hp) <= 0,
        action_available: entry && entry.action_available === true,
        bonus_action_available: entry && entry.bonus_action_available === true,
        reaction_available: entry && entry.reaction_available === true,
        movement_remaining: Number.isFinite(Number(entry && entry.movement_remaining))
          ? Number(entry.movement_remaining)
          : null,
        condition_count: participantConditions.length,
        concentration: summarizeParticipantConcentrationForGateway(entry),
        conditions: participantConditions
          .map((condition) => String(condition && condition.condition_type || condition && condition.condition_id || "condition"))
      };
    })
  };
}

function findCombatParticipantForPlayer(combat, playerId) {
  const participants = Array.isArray(combat && combat.participants) ? combat.participants : [];
  const safePlayerId = String(playerId || "");
  return participants.find((entry) => (
    String(entry && entry.player_id || "") === safePlayerId ||
    String(entry && entry.participant_id || "") === safePlayerId
  )) || null;
}

function summarizeCombatSpellsForGateway(context, combat, playerId) {
  const participant = findCombatParticipantForPlayer(combat, playerId);
  const spellbook = participant && participant.spellbook && typeof participant.spellbook === "object"
    ? participant.spellbook
    : {};
  const participantKnownSpellIds = Array.isArray(spellbook.known_spell_ids)
    ? spellbook.known_spell_ids.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const character = resolvePlayerCharacter(context, playerId);
  const characterSpellbook = character && character.spellbook && typeof character.spellbook === "object"
    ? character.spellbook
    : {};
  const characterKnownSpellIds = Array.isArray(characterSpellbook.known_spell_ids)
    ? characterSpellbook.known_spell_ids.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const knownSpellIds = Array.from(new Set(
    participantKnownSpellIds.length > 0
      ? participantKnownSpellIds
      : characterKnownSpellIds
  ));

  return knownSpellIds
    .map((spellId) => resolveSpellDefinitionFromContent(context, spellId))
    .filter(Boolean)
    .map((spell) => clone(spell));
}

function resolveActiveSessionForPlayer(context, playerId) {
  const sessionPersistence = context && context.sessionPersistence;
  if (!sessionPersistence || typeof sessionPersistence.listSessions !== "function") {
    return null;
  }
  const listed = sessionPersistence.listSessions();
  if (!listed.ok) {
    return null;
  }
  const sessions = Array.isArray(listed.payload && listed.payload.sessions) ? listed.payload.sessions : [];
  const normalizedPlayerId = String(playerId || "");
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const session = sessions[index];
    if (!session || String(session.status || "") !== "active") {
      continue;
    }
    const party = session.party && typeof session.party === "object" ? session.party : {};
    const members = Array.isArray(party.members) ? party.members : [];
    const isLeader = String(party.leader_id || "") === normalizedPlayerId;
    const isMember = members.some((member) => {
      if (member && typeof member === "object") {
        return String(member.player_id || "") === normalizedPlayerId;
      }
      return String(member || "") === normalizedPlayerId;
    });
    if (isLeader || isMember) {
      return session;
    }
  }
  return null;
}

function resolveCombatStateForRead(context, requestEvent) {
  const explicitCombatId = requestEvent && requestEvent.combat_id
    ? String(requestEvent.combat_id)
    : (requestEvent && requestEvent.payload && requestEvent.payload.combat_id ? String(requestEvent.payload.combat_id) : "");
  let combatId = explicitCombatId;
  if (!combatId) {
    const activeSession = resolveActiveSessionForPlayer(context, requestEvent && requestEvent.player_id);
    const activeCombatId = activeSession && activeSession.active_combat_id ? String(activeSession.active_combat_id) : "";
    if (activeCombatId) {
      combatId = activeCombatId;
    }
  }

  if (!combatId) {
    return failure("combat_read_failed", "active combat not found for player");
  }

  const combatManager = context && context.combatManager;
  if (combatManager && typeof combatManager.getCombatById === "function") {
    const loadedCombat = combatManager.getCombatById(combatId);
    if (loadedCombat.ok && loadedCombat.payload && loadedCombat.payload.combat) {
      return success("combat_read_resolved", {
        combat_id: combatId,
        combat: loadedCombat.payload.combat
      });
    }
  }

  const combatPersistence = context && context.combatPersistence;
  if (combatPersistence && typeof combatPersistence.listCombatSnapshots === "function") {
    const listedSnapshots = combatPersistence.listCombatSnapshots();
    if (listedSnapshots.ok) {
      const snapshots = Array.isArray(listedSnapshots.payload && listedSnapshots.payload.snapshots)
        ? listedSnapshots.payload.snapshots
        : [];
      const matching = snapshots
        .filter((entry) => String(entry && entry.combat_id || "") === combatId && entry && entry.combat_state)
        .sort((left, right) => String(right && right.snapshot_timestamp || "").localeCompare(String(left && left.snapshot_timestamp || "")));
      if (matching.length > 0) {
        return success("combat_read_resolved", {
          combat_id: combatId,
          combat: clone(matching[0].combat_state)
        });
      }
    }
  }

  return failure("combat_read_failed", "combat not found", {
    combat_id: combatId
  });
}

function loadCharactersForProfile(context) {
  if (context.characterPersistence && typeof context.characterPersistence.listCharacters === "function") {
    const listed = context.characterPersistence.listCharacters();
    if (!listed.ok) {
      return { ok: false, error: listed.error || "failed to list characters through persistence bridge" };
    }

    const persistenceCharacters = Array.isArray(listed.payload.characters) ? listed.payload.characters : [];
    if (persistenceCharacters.length > 0) {
      return {
        ok: true,
        characters: persistenceCharacters
      };
    }
  }

  if (context.characterRepository && typeof context.characterRepository.listStoredCharacters === "function") {
    const listed = context.characterRepository.listStoredCharacters();
    if (!listed.ok) {
      return { ok: false, error: listed.error || "failed to list characters through repository" };
    }
    return {
      ok: true,
      characters: listed.payload.characters || []
    };
  }

  return { ok: false, error: "character persistence/repository is not available in runtime context" };
}

function handleWorldCommandDispatch(event, context) {
  const requestEvent = getRequestEvent(event);
  if (!requestEvent) {
    return [createGatewayResponseEvent(event, "world", {}, false, "runtime world dispatch missing request_event", "world_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_START_REQUESTED) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "start", "world_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const bootstrap = bootstrapPlayerStart({
      player_id: requestEvent.player_id,
      requested_character_name: requestEvent.payload && requestEvent.payload.requested_character_name,
      race_id: requestEvent.payload && requestEvent.payload.race_id,
      race_option_id: requestEvent.payload && requestEvent.payload.race_option_id,
      class_id: requestEvent.payload && requestEvent.payload.class_id,
      class_option_id: requestEvent.payload && requestEvent.payload.class_option_id,
      secondary_class_id: requestEvent.payload && requestEvent.payload.secondary_class_id,
      secondary_class_option_id: requestEvent.payload && requestEvent.payload.secondary_class_option_id,
      stats: requestEvent.payload && requestEvent.payload.stats,
      context
    });
    if (!bootstrap.ok) {
      return [createGatewayResponseEvent(requestEvent, "start", {}, false, bootstrap.error || "start bootstrap failed", "world_system")];
    }
    markMutationReplaySuccess(context, replayState, true);

    const character = bootstrap.payload.character || {};
    const inventory = bootstrap.payload.inventory || {};
    return [createGatewayResponseEvent(requestEvent, "start", {
      bootstrap_status: bootstrap.payload.bootstrap_status || "created",
      character_created: Boolean(bootstrap.payload.character_created),
      inventory_created: Boolean(bootstrap.payload.inventory_created),
      character: {
        character_id: character.character_id || null,
        player_id: character.player_id || null,
        name: character.name || null,
        level: character.level || 1,
        race: character.race || null,
        class: character.class || null,
        race_id: character.race_id || null,
        class_id: character.class_id || null,
        secondary_class_id:
          character.gestalt_progression && character.gestalt_progression.track_b_class_key
            ? character.gestalt_progression.track_b_class_key
            : null,
        class_option_id: character.class_option_id || null,
        secondary_class_option_id:
          character.gestalt_progression && character.gestalt_progression.track_b_option_id
            ? character.gestalt_progression.track_b_option_id
            : null,
        base_stats: character.base_stats || null,
        stats: character.stats || {},
        metadata: character.metadata || {},
        inventory_id: character.inventory_id || null
      },
      point_buy_summary: bootstrap.payload.point_buy_summary || null,
      inventory: {
        inventory_id: inventory.inventory_id || null,
        owner_id: inventory.owner_id || null
      }
    }, true, null, "world_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_EQUIP_REQUESTED) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "equip", "world_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processEquipRequest({
      context,
      player_id: requestEvent.player_id,
      item_id: requestEvent.payload && requestEvent.payload.item_id,
      slot: requestEvent.payload && requestEvent.payload.slot
    });

    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "equip", {}, false, out.error || "equip request failed", "world_system")];
    }
    markMutationReplaySuccess(context, replayState, true);

    const equipped = out.payload.equipped || {};
    const character = out.payload.character || {};
    return [createGatewayResponseEvent(requestEvent, "equip", {
      equipped: {
        item_id: equipped.item_id || null,
        slot: equipped.slot || null
      },
      character: {
        character_id: character.character_id || null,
        player_id: character.player_id || null,
        equipment: character.equipment || {}
      }
    }, true, null, "world_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_UNEQUIP_REQUESTED) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "unequip", "world_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processUnequipRequest({
      context,
      player_id: requestEvent.player_id,
      item_id: requestEvent.payload && requestEvent.payload.item_id,
      slot: requestEvent.payload && requestEvent.payload.slot
    });

    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "unequip", {}, false, out.error || "unequip request failed", "world_system")];
    }
    markMutationReplaySuccess(context, replayState, true);

    const unequipped = out.payload.unequipped || {};
    const character = out.payload.character || {};
    return [createGatewayResponseEvent(requestEvent, "unequip", {
      unequipped: {
        item_id: unequipped.item_id || null,
        slot: unequipped.slot || null
      },
      character: {
        character_id: character.character_id || null,
        player_id: character.player_id || null,
        equipment: character.equipment || {}
      }
    }, true, null, "world_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_IDENTIFY_ITEM_REQUESTED) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "identify", "world_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processIdentifyItemRequest({
      context,
      player_id: requestEvent.player_id,
      item_id: requestEvent.payload && requestEvent.payload.item_id
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "identify", {}, false, out.error || "identify request failed", "world_system")];
    }
    markMutationReplaySuccess(context, replayState, true);
    return [createGatewayResponseEvent(requestEvent, "identify", {
      item: out.payload.item || null,
      character: out.payload.character || null,
      inventory: out.payload.inventory || null
    }, true, null, "world_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_ATTUNE_ITEM_REQUESTED) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "attune", "world_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processAttunementRequest({
      context,
      player_id: requestEvent.player_id,
      item_id: requestEvent.payload && requestEvent.payload.item_id,
      mode: "attune"
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "attune", {}, false, out.error || "attune request failed", "world_system")];
    }
    markMutationReplaySuccess(context, replayState, true);
    return [createGatewayResponseEvent(requestEvent, "attune", {
      item: out.payload.item || null,
      character: out.payload.character || null,
      inventory: out.payload.inventory || null
    }, true, null, "world_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_UNATTUNE_ITEM_REQUESTED) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "unattune", "world_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processAttunementRequest({
      context,
      player_id: requestEvent.player_id,
      item_id: requestEvent.payload && requestEvent.payload.item_id,
      mode: "unattune"
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "unattune", {}, false, out.error || "unattune request failed", "world_system")];
    }
    markMutationReplaySuccess(context, replayState, true);
    return [createGatewayResponseEvent(requestEvent, "unattune", {
      item: out.payload.item || null,
      character: out.payload.character || null,
      inventory: out.payload.inventory || null
    }, true, null, "world_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_FEAT_REQUESTED) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "feat", "world_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processFeatRequest({
      context,
      player_id: requestEvent.player_id,
      action: requestEvent.payload && requestEvent.payload.action,
      feat_id: requestEvent.payload && requestEvent.payload.feat_id,
      ability_id: requestEvent.payload && requestEvent.payload.ability_id
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "feat", {}, false, out.error || "feat request failed", "world_system")];
    }
    if (String(out.payload.action || "").toLowerCase() === "take") {
      markMutationReplaySuccess(context, replayState, true);
    }
    return [createGatewayResponseEvent(requestEvent, "feat", {
      action: out.payload.action || "list",
      feat: out.payload.feat || null,
      feat_choice: out.payload.feat_choice || null,
      feats: Array.isArray(out.payload.feats) ? clone(out.payload.feats) : [],
      feat_slots: out.payload.feat_slots || null,
      taken_feat_ids: Array.isArray(out.payload.taken_feat_ids) ? clone(out.payload.taken_feat_ids) : [],
      applied_effects: Array.isArray(out.payload.applied_effects) ? clone(out.payload.applied_effects) : [],
      character: out.payload.character || null
    }, true, null, "world_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_USE_ITEM) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "use", "world_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const worldUseItemEventProcessor =
      typeof context.worldUseItemEventProcessor === "function"
        ? context.worldUseItemEventProcessor
        : processWorldUseItemEvent;

    const out = worldUseItemEventProcessor({
      event: requestEvent,
      context
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "use", {}, false, out.error || "item use request failed", "world_system")];
    }
    markMutationReplaySuccess(context, replayState, true);

    const responseData = out.payload && out.payload.response_data ? out.payload.response_data : {};
    return [createGatewayResponseEvent(requestEvent, "use", {
      use_status: responseData.use_status || "consumed",
      item_id: responseData.item_id || (requestEvent.payload && requestEvent.payload.item_id) || null,
      inventory_id: responseData.inventory_id || null,
      hp_before: responseData.hp_before,
      hp_after: responseData.hp_after,
      healed_for: responseData.healed_for,
      temporary_hp_before: responseData.temporary_hp_before,
      temporary_hp_after: responseData.temporary_hp_after,
      temporary_hitpoints_granted: responseData.temporary_hitpoints_granted
    }, true, null, "world_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_SHOP_REQUESTED) {
    const action = requestEvent.payload && requestEvent.payload.action ? String(requestEvent.payload.action) : "browse";
    if (action === "browse") {
      const out = listNpcShopForPlayer({
        context,
        player_id: requestEvent.player_id,
        vendor_id: requestEvent.payload && requestEvent.payload.vendor_id
      });
      if (!out.ok) {
        return [createGatewayResponseEvent(requestEvent, "shop", {}, false, out.error || "shop browse failed", "world_system")];
      }
      return [createGatewayResponseEvent(requestEvent, "shop", out.payload || {}, true, null, "world_system")];
    }

    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "shop", "world_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }

    const out = action === "buy"
      ? processNpcShopBuyRequest({
          context,
          event_id: requestEvent.event_id,
          player_id: requestEvent.player_id,
          vendor_id: requestEvent.payload && requestEvent.payload.vendor_id,
          item_id: requestEvent.payload && requestEvent.payload.item_id,
          quantity: requestEvent.payload && requestEvent.payload.quantity
        })
      : processNpcShopSellRequest({
          context,
          event_id: requestEvent.event_id,
          player_id: requestEvent.player_id,
          vendor_id: requestEvent.payload && requestEvent.payload.vendor_id,
          item_id: requestEvent.payload && requestEvent.payload.item_id,
          quantity: requestEvent.payload && requestEvent.payload.quantity
        });

    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "shop", {}, false, out.error || ("shop " + action + " failed"), "world_system")];
    }
    markMutationReplaySuccess(context, replayState, true);
    return [createGatewayResponseEvent(requestEvent, "shop", out.payload || {}, true, null, "world_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_CRAFT_REQUESTED) {
    const action = requestEvent.payload && requestEvent.payload.action ? String(requestEvent.payload.action) : "browse";
    if (action === "browse") {
      const out = listCraftRecipesForPlayer({
        context,
        player_id: requestEvent.player_id
      });
      if (!out.ok) {
        return [createGatewayResponseEvent(requestEvent, "craft", {}, false, out.error || "craft browse failed", "world_system")];
      }
      return [createGatewayResponseEvent(requestEvent, "craft", out.payload || {}, true, null, "world_system")];
    }

    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "craft", "world_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processCraftRecipeRequest({
      context,
      event_id: requestEvent.event_id,
      player_id: requestEvent.player_id,
      recipe_id: requestEvent.payload && requestEvent.payload.recipe_id
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "craft", {}, false, out.error || "craft request failed", "world_system")];
    }
    markMutationReplaySuccess(context, replayState, true);
    return [createGatewayResponseEvent(requestEvent, "craft", out.payload || {}, true, null, "world_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_TRADE_REQUESTED) {
    const action = requestEvent.payload && requestEvent.payload.action ? String(requestEvent.payload.action) : "list";
    if (action === "list") {
      const out = listTradesForPlayer({
        context,
        player_id: requestEvent.player_id
      });
      if (!out.ok) {
        return [createGatewayResponseEvent(requestEvent, "trade", {}, false, out.error || "trade list failed", "world_system")];
      }
      return [createGatewayResponseEvent(requestEvent, "trade", out.payload || {}, true, null, "world_system")];
    }

    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "trade", "world_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }

    const out = action === "propose"
      ? processTradeProposal({
          context,
          player_id: requestEvent.player_id,
          trade_id: requestEvent.payload && requestEvent.payload.trade_id,
          counterparty_player_id: requestEvent.payload && requestEvent.payload.counterparty_player_id,
          offered_item_id: requestEvent.payload && requestEvent.payload.offered_item_id,
          offered_quantity: requestEvent.payload && requestEvent.payload.offered_quantity,
          offered_currency: requestEvent.payload && requestEvent.payload.offered_currency,
          requested_item_id: requestEvent.payload && requestEvent.payload.requested_item_id,
          requested_quantity: requestEvent.payload && requestEvent.payload.requested_quantity,
          requested_currency: requestEvent.payload && requestEvent.payload.requested_currency
        })
      : processTradeAction({
          context,
          player_id: requestEvent.player_id,
          trade_id: requestEvent.payload && requestEvent.payload.trade_id,
          action
        });

    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "trade", {}, false, out.error || ("trade " + action + " failed"), "world_system")];
    }
    markMutationReplaySuccess(context, replayState, true);
    return [createGatewayResponseEvent(requestEvent, "trade", out.payload || {}, true, null, "world_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_ADMIN_REQUESTED) {
    const out = processAdminActionRequest({
      event: requestEvent,
      context
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "admin", {}, false, out.error || "admin action failed", "world_system")];
    }

    return [createGatewayResponseEvent(requestEvent, "admin", {
      admin_event_type: out.event_type,
      result: out.payload || {}
    }, true, null, "world_system")];
  }

  return [createGatewayResponseEvent(requestEvent, "world", {}, false, "unsupported world command dispatch", "world_system")];
}

function handleSessionCommandDispatch(event, context) {
  const requestEvent = getRequestEvent(event);
  if (!requestEvent) {
    return [createGatewayResponseEvent(event, "session", {}, false, "runtime session dispatch missing request_event", "session_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_MOVE) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "move", "session_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processSessionMoveRequest({
      context,
      player_id: requestEvent.player_id,
      session_id: requestEvent.session_id || (requestEvent.payload && requestEvent.payload.session_id) || null,
      payload: requestEvent.payload || {}
    });

    if (!out.ok) {
      return [createGatewayResponseEvent(
        requestEvent,
        "move",
        {},
        false,
        out.error || "session move request failed",
        "session_system"
      )];
    }
    markMutationReplaySuccess(context, replayState, true);

    return [createGatewayResponseEvent(requestEvent, "move", {
      move_status: "completed",
      session_id: out.payload.session && out.payload.session.session_id ? out.payload.session.session_id : null,
      from_room_id: out.payload.from_room_id || null,
      to_room_id: out.payload.to_room_id || null,
      trap_trigger: out.payload.trap_trigger || null,
      room: summarizeRoomState(out.payload.session || null)
    }, true, null, "session_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_ENTER_DUNGEON) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "dungeon_enter", "session_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processEnterDungeonRequest({
      context,
      player_id: requestEvent.player_id,
      dungeon_id: requestEvent.payload && requestEvent.payload.dungeon_id,
      party_id: requestEvent.payload && requestEvent.payload.party_id,
      session_id: requestEvent.session_id
    });

    if (!out.ok) {
      return [createGatewayResponseEvent(
        requestEvent,
        "dungeon_enter",
        {},
        false,
        out.error || "dungeon enter request failed",
        "session_system"
      )];
    }
    markMutationReplaySuccess(context, replayState, true);

    const session = out.payload.session || {};
    return [createGatewayResponseEvent(requestEvent, "dungeon_enter", {
      enter_status: out.payload.enter_status || "created",
      created: Boolean(out.payload.created),
      session: {
        session_id: session.session_id || null,
        status: session.status || null,
        dungeon_id: session.dungeon_id || null,
        leader_id: session.party && session.party.leader_id ? session.party.leader_id : null,
        party_id: session.party && session.party.party_id ? session.party.party_id : null
      },
      room: summarizeRoomState(session)
    }, true, null, "session_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_LEAVE_SESSION) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "leave_session", "session_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processLeaveSessionRequest({
      context,
      player_id: requestEvent.player_id,
      session_id: (requestEvent.payload && requestEvent.payload.session_id) || requestEvent.session_id || null
    });

    if (!out.ok) {
      return [createGatewayResponseEvent(
        requestEvent,
        "leave_session",
        {},
        false,
        out.error || "leave session request failed",
        "session_system"
      )];
    }
    markMutationReplaySuccess(context, replayState, true);

    const session = out.payload.session || {};
    return [createGatewayResponseEvent(requestEvent, "leave_session", {
      leave_status: out.payload.leave_status || "left",
      session_id: out.payload.session_id || null,
      deleted: Boolean(out.payload.deleted),
      previous_session_state: {
        status: session.status || null,
        dungeon_id: session.dungeon_id || null
      }
    }, true, null, "session_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_INTERACT_OBJECT) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "interact", "session_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const utilitySpell = resolveUtilitySpellForInteraction(
      context,
      requestEvent.player_id,
      requestEvent.payload && requestEvent.payload.spell_id
    );
    if (!utilitySpell.ok) {
      return [createGatewayResponseEvent(
        requestEvent,
        "interact",
        {},
        false,
        utilitySpell.error || "failed to resolve utility spell interaction",
        "session_system"
      )];
    }
    const skillProfile = resolveInteractionSkillProfile(context, requestEvent.player_id);
    const toolProfile = resolveInteractionToolProfile(context, requestEvent.player_id);
    const itemIndex = resolveInteractionItemIndex(context);
    const characterProfile = resolveInteractionCharacterProfile(context, requestEvent.player_id);
    const out = processSessionInteractRequest({
      context,
      player_id: requestEvent.player_id,
      session_id: requestEvent.session_id || (requestEvent.payload && requestEvent.payload.session_id) || null,
      payload: Object.assign({}, requestEvent.payload || {}, {
        spell: utilitySpell.payload && utilitySpell.payload.spell ? utilitySpell.payload.spell : null,
        skill_profile: skillProfile.payload && skillProfile.payload.skill_profile ? skillProfile.payload.skill_profile : {},
        tool_profile: toolProfile.payload && Array.isArray(toolProfile.payload.tool_profile) ? toolProfile.payload.tool_profile : [],
        item_index: itemIndex.payload && itemIndex.payload.item_index ? itemIndex.payload.item_index : {},
        character_profile: characterProfile.payload && characterProfile.payload.character_profile ? characterProfile.payload.character_profile : {}
      })
    });

    if (!out.ok) {
      return [createGatewayResponseEvent(
        requestEvent,
        "interact",
        {},
        false,
        out.error || "session interact request failed",
        "session_system"
      )];
    }

    const rewardOut = resolveObjectRewardForInteraction(context, requestEvent, out);
    if (!rewardOut.ok) {
      return [createGatewayResponseEvent(
        requestEvent,
        "interact",
        {},
        false,
        rewardOut.error || "session interaction reward failed",
        "session_system"
      )];
    }

    markMutationReplaySuccess(context, replayState, true);

    return [createGatewayResponseEvent(requestEvent, "interact", {
      interact_status: "resolved",
      session_id: out.payload.session_id || null,
      room_id: out.payload.room_id || null,
      object_id: out.payload.object_id || null,
      object_type: out.payload.object_type || null,
      interaction_action: out.payload.interaction_action || null,
      object_state: out.payload.object_state || null,
      interaction_effects: Array.isArray(out.payload.interaction_effects) ? clone(out.payload.interaction_effects) : [],
      spell_effect: out.payload.spell_effect || null,
      skill_check: out.payload.skill_check || null,
      tool_check: out.payload.tool_check || null,
      ability_check: out.payload.ability_check || null,
      reward_status: rewardOut.payload.reward_status || "none",
      loot_entries: Array.isArray(rewardOut.payload.loot_entries) ? clone(rewardOut.payload.loot_entries) : [],
      next_event: out.payload.next_event || null,
      room: summarizeRoomState(out.payload.session || null)
    }, true, null, "session_system")];
  }

  return [createGatewayResponseEvent(requestEvent, "session", {}, false, "unsupported session command dispatch", "session_system")];
}

function handleCombatCommandDispatch(event, context) {
  const requestEvent = getRequestEvent(event);
  if (!requestEvent) {
    return [createGatewayResponseEvent(event, "combat", {}, false, "runtime combat dispatch missing request_event", "combat_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_COMBAT_REQUESTED) {
    const resolved = resolveCombatStateForRead(context, requestEvent);
    if (!resolved.ok) {
      return [createGatewayResponseEvent(requestEvent, "combat", {}, false, resolved.error || "combat read request failed", "combat_system")];
    }
    const combat = resolved.payload && resolved.payload.combat ? resolved.payload.combat : null;
    const activeParticipantId =
      combat && Array.isArray(combat.initiative_order) && Number.isFinite(Number(combat.turn_index))
        ? combat.initiative_order[combat.turn_index] || null
        : null;
    const actorSpells = summarizeCombatSpellsForGateway(context, combat, requestEvent.player_id);
    return [createGatewayResponseEvent(requestEvent, "combat", {
      combat_summary: summarizeCombatStateForGateway(combat, activeParticipantId),
      actor_spells: actorSpells,
      combat_id: resolved.payload && resolved.payload.combat_id ? resolved.payload.combat_id : null
    }, true, null, "combat_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_ATTACK) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "attack", "combat_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processCombatAttackRequest({
      context,
      player_id: requestEvent.player_id,
      combat_id: requestEvent.combat_id,
      payload: requestEvent.payload || {}
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "attack", {}, false, out.error || "attack request failed", "combat_system")];
    }
    markMutationReplaySuccess(context, replayState, true);

    const attack = out.payload.attack || {};
    const progress = summarizeCombatProgression(out.payload);
    const actorSpells = summarizeCombatSpellsForGateway(context, progress.combat, requestEvent.player_id);
    return [createGatewayResponseEvent(requestEvent, "attack", {
      attack_status: "resolved",
      combat_id: attack.combat_id || requestEvent.combat_id,
      attacker_id: attack.attacker_id || requestEvent.player_id || null,
      target_id: attack.target_id || null,
      hit: Boolean(attack.hit),
      damage_type: attack.damage_type || (attack.damage_result && attack.damage_result.damage_type) || null,
      damage_dealt: attack.damage_dealt || (attack.damage_result && attack.damage_result.final_damage) || 0,
      damage_result: attack.damage_result || null,
      bonus_damage_results: Array.isArray(attack.bonus_damage_results) ? clone(attack.bonus_damage_results) : [],
      reactive_damage_results: Array.isArray(attack.reactive_damage_results) ? clone(attack.reactive_damage_results) : [],
      target_hp_after: attack.target_hp_after,
      concentration_result: attack.concentration_result || null,
      active_participant_id: progress.active_participant_id,
      combat_completed: progress.combat_completed,
      winner_team: progress.winner_team,
      combat_summary: summarizeCombatStateForGateway(progress.combat, progress.active_participant_id),
      actor_spells: actorSpells,
      ai_turn_count: progress.ai_turn_count,
      ai_turns: clone(progress.ai_turns)
    }, true, null, "combat_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_DODGE) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "dodge", "combat_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processCombatDodgeRequest({
      context,
      player_id: requestEvent.player_id,
      combat_id: requestEvent.combat_id,
      payload: requestEvent.payload || {}
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "dodge", {}, false, out.error || "dodge request failed", "combat_system")];
    }
    markMutationReplaySuccess(context, replayState, true);

    const dodge = out.payload.dodge || {};
    const progress = summarizeCombatProgression(out.payload);
    return [createGatewayResponseEvent(requestEvent, "dodge", {
      dodge_status: "resolved",
      combat_id: dodge.combat_id || requestEvent.combat_id,
      participant_id: dodge.participant_id || requestEvent.player_id || null,
      is_dodging: dodge.is_dodging === true,
      active_participant_id: progress.active_participant_id,
      combat_completed: progress.combat_completed,
      winner_team: progress.winner_team,
      combat_summary: summarizeCombatStateForGateway(progress.combat, progress.active_participant_id),
      ai_turn_count: progress.ai_turn_count,
      ai_turns: clone(progress.ai_turns)
    }, true, null, "combat_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_CAST_SPELL) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "cast", "combat_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processCombatCastSpellRequest({
      context,
      player_id: requestEvent.player_id,
      combat_id: requestEvent.combat_id,
      payload: requestEvent.payload || {}
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "cast", {}, false, out.error || "cast request failed", "combat_system")];
    }
    markMutationReplaySuccess(context, replayState, true);

    const castSpell = out.payload.cast_spell || {};
    const progress = summarizeCombatProgression(out.payload);
    const actorSpells = summarizeCombatSpellsForGateway(context, progress.combat, requestEvent.player_id);
    return [createGatewayResponseEvent(requestEvent, "cast", {
      cast_status: "resolved",
      combat_id: castSpell.combat_id || requestEvent.combat_id,
      caster_id: castSpell.caster_id || requestEvent.player_id || null,
      target_id: castSpell.target_id || null,
      target_ids: Array.isArray(castSpell.target_ids) ? clone(castSpell.target_ids) : [],
      spell_id: castSpell.spell_id || null,
      spell_name: castSpell.spell_name || null,
      resolution_type: castSpell.resolution_type || null,
      damage_type: castSpell.damage_type || null,
      hit: castSpell.hit === null ? null : Boolean(castSpell.hit),
      saved: castSpell.saved === null ? null : Boolean(castSpell.saved),
      damage_result: castSpell.damage_result || null,
      healing_result: castSpell.healing_result || null,
      vitality_result: castSpell.vitality_result || null,
      defense_result: castSpell.defense_result || null,
      applied_conditions: Array.isArray(castSpell.applied_conditions) ? clone(castSpell.applied_conditions) : [],
      removed_conditions: Array.isArray(castSpell.removed_conditions) ? clone(castSpell.removed_conditions) : [],
      target_results: Array.isArray(castSpell.target_results) ? clone(castSpell.target_results) : [],
      concentration_required: castSpell.concentration_required === true,
      concentration_result: castSpell.concentration_result || null,
      concentration_started: castSpell.concentration_started || null,
      concentration_replaced: castSpell.concentration_replaced || null,
      active_participant_id: progress.active_participant_id,
      combat_completed: progress.combat_completed,
      winner_team: progress.winner_team,
      combat_summary: summarizeCombatStateForGateway(progress.combat, progress.active_participant_id),
      actor_spells: actorSpells,
      ai_turn_count: progress.ai_turn_count,
      ai_turns: clone(progress.ai_turns)
    }, true, null, "combat_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_MOVE) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "move", "combat_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processCombatMoveRequest({
      context,
      player_id: requestEvent.player_id,
      combat_id: requestEvent.combat_id,
      payload: requestEvent.payload || {}
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "move", {}, false, out.error || "combat move request failed", "combat_system")];
    }
    markMutationReplaySuccess(context, replayState, true);

    const move = out.payload.move || {};
    const reactions = out.payload.reactions && typeof out.payload.reactions === "object" ? out.payload.reactions : {};
    const opportunityAttacks = Array.isArray(reactions.opportunity_attacks) ? reactions.opportunity_attacks : [];
    const progress = summarizeCombatProgression(out.payload);
    const actorSpells = summarizeCombatSpellsForGateway(context, progress.combat, requestEvent.player_id);
    return [createGatewayResponseEvent(requestEvent, "move", {
      move_status: "resolved",
      combat_id: move.combat_id || requestEvent.combat_id,
      participant_id: move.participant_id || requestEvent.player_id || null,
      from_position: move.from_position || null,
      to_position: move.to_position || null,
      opportunity_attack_count: opportunityAttacks.length,
      active_participant_id: progress.active_participant_id,
      combat_completed: progress.combat_completed,
      winner_team: progress.winner_team,
      combat_summary: summarizeCombatStateForGateway(progress.combat, progress.active_participant_id),
      actor_spells: actorSpells,
      ai_turn_count: progress.ai_turn_count,
      ai_turns: clone(progress.ai_turns)
    }, true, null, "combat_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_USE_ITEM) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "use", "combat_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processCombatUseItemRequest({
      context,
      player_id: requestEvent.player_id,
      combat_id: requestEvent.combat_id,
      payload: requestEvent.payload || {}
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "use", {}, false, out.error || "combat item use request failed", "combat_system")];
    }
    markMutationReplaySuccess(context, replayState, true);

    const useItem = out.payload.use_item || {};
    const progress = summarizeCombatProgression(out.payload);
    const actorSpells = summarizeCombatSpellsForGateway(context, progress.combat, requestEvent.player_id);
    return [createGatewayResponseEvent(requestEvent, "use", {
      use_status: "resolved",
      combat_id: useItem.combat_id || requestEvent.combat_id,
      participant_id: useItem.participant_id || requestEvent.player_id || null,
      item_id: useItem.item_id || (requestEvent.payload && requestEvent.payload.item_id) || null,
      use_mode: useItem.use_status || "consumed",
      hp_before: useItem.hp_before,
      hp_after: useItem.hp_after,
      healed_for: useItem.healed_for,
      temporary_hp_before: useItem.temporary_hp_before,
      temporary_hp_after: useItem.temporary_hp_after,
      temporary_hitpoints_granted: useItem.temporary_hitpoints_granted,
      charges_before: useItem.charges_before,
      charges_after: useItem.charges_after,
      applied_conditions: Array.isArray(useItem.applied_conditions) ? clone(useItem.applied_conditions) : [],
      removed_conditions: Array.isArray(useItem.removed_conditions) ? clone(useItem.removed_conditions) : [],
      active_participant_id: progress.active_participant_id,
      combat_completed: progress.combat_completed,
      winner_team: progress.winner_team,
      combat_summary: summarizeCombatStateForGateway(progress.combat, progress.active_participant_id),
      actor_spells: actorSpells,
      ai_turn_count: progress.ai_turn_count,
      ai_turns: clone(progress.ai_turns)
    }, true, null, "combat_system")];
  }

  return [createGatewayResponseEvent(requestEvent, "combat", {}, false, "unsupported combat command dispatch", "combat_system")];
}

function handleWorldReadRequest(event, context) {
  if (event.event_type === EVENT_TYPES.PLAYER_PROFILE_REQUESTED) {
    const loadedCharacters = loadCharactersForProfile(context);
    if (!loadedCharacters.ok) {
      return [createGatewayResponseEvent(event, "profile", {}, false, loadedCharacters.error, "world_system")];
    }

    const playerId = event.player_id;
    const characters = loadedCharacters.characters;
    const found = characters.find((character) => String(character.player_id || "") === String(playerId || ""));

    if (!found) {
      return [
        createGatewayResponseEvent(event, "profile", {
          profile_found: false
        }, true, null, "world_system")
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
          level: found.level || 1,
          xp: Number.isFinite(Number(found.xp)) ? Number(found.xp) : 0,
          proficiency_bonus: Number.isFinite(Number(found.proficiency_bonus)) ? Number(found.proficiency_bonus) : 2,
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
      }, true, null, "world_system")
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
          "inventoryPersistence is not available in runtime context",
          "world_system"
        )
      ];
    }

    const listed = inventoryPersistence.listInventories();
    if (!listed.ok) {
      return [createGatewayResponseEvent(event, "inventory", {}, false, listed.error || "failed to list inventories", "world_system")];
    }

    const playerId = event.player_id;
    const inventories = Array.isArray(listed.payload.inventories) ? listed.payload.inventories : [];
    const found = inventories.find((inventory) => String(inventory.owner_id || "") === String(playerId || ""));
    const playerCharacter = resolvePlayerCharacter(context, playerId);

    if (!found) {
      return [
        createGatewayResponseEvent(event, "inventory", {
          inventory_found: false
        }, true, null, "world_system")
      ];
    }

      return [
        createGatewayResponseEvent(event, "inventory", {
          inventory_found: true,
          inventory: summarizeInventory(found, playerCharacter)
        }, true, null, "world_system")
      ];
  }

  return [];
}

module.exports = {
  handleWorldCommandDispatch,
  handleSessionCommandDispatch,
  handleCombatCommandDispatch,
  handleWorldReadRequest
};


