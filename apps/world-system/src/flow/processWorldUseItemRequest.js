"use strict";

const { normalizeInventoryShape, removeItemFromInventory } = require("../../../inventory-system/src/mutationHelpers");
const { applyResolvedItemEffectState } = require("../character/rules/magicalItemRules");

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

function canConsumeItemForPlayer(entry, inventory, playerId) {
  const entryOwner = entry && entry.owner_player_id ? String(entry.owner_player_id) : null;
  if (entryOwner) {
    return entryOwner === String(playerId || "");
  }

  const inventoryOwner = inventory && inventory.owner_id ? String(inventory.owner_id) : null;
  if (inventoryOwner) {
    return inventoryOwner === String(playerId || "");
  }

  return false;
}

function toNumberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : 0;
}

function loadCharacters(context) {
  if (!context.characterPersistence || typeof context.characterPersistence.listCharacters !== "function") {
    return failure("player_use_item_failed", "characterPersistence is not available in world context");
  }
  const listed = context.characterPersistence.listCharacters();
  if (!listed.ok) {
    return failure("player_use_item_failed", listed.error || "failed to list characters");
  }
  return success("world_use_item_characters_loaded", {
    characters: Array.isArray(listed.payload.characters) ? listed.payload.characters : []
  });
}

function saveCharacter(context, character) {
  if (!context.characterPersistence || typeof context.characterPersistence.saveCharacter !== "function") {
    return {
      ok: false,
      error: "characterPersistence.saveCharacter is required"
    };
  }
  return context.characterPersistence.saveCharacter(character);
}

function findOwnedItemEntry(inventory, itemId, playerId) {
  const buckets = ["stackable_items", "equipment_items", "quest_items"];
  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index];
    const entries = Array.isArray(inventory[bucket]) ? inventory[bucket] : [];
    const entry = entries.find((candidate) => {
      return String(candidate && candidate.item_id || "") === String(itemId || "") &&
        canConsumeItemForPlayer(candidate, inventory, playerId);
    });
    if (entry) {
      return entry;
    }
  }
  return null;
}

function resolveItemUseEffect(entry) {
  const metadata = entry && entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
  const useEffect = metadata.use_effect && typeof metadata.use_effect === "object" ? metadata.use_effect : {};
  const healAmount = toNumberOrZero(metadata.heal_amount !== undefined ? metadata.heal_amount : entry && entry.heal_amount);
  const temporaryHitPoints = toNumberOrZero(
    metadata.temporary_hitpoints !== undefined
      ? metadata.temporary_hitpoints
      : (metadata.temp_hp !== undefined ? metadata.temp_hp : entry && entry.temporary_hitpoints)
  );
  const effectHealAmount = toNumberOrZero(
    useEffect.heal_amount !== undefined ? useEffect.heal_amount : healAmount
  );
  const effectTemporaryHitPoints = toNumberOrZero(
    useEffect.temporary_hitpoints !== undefined
      ? useEffect.temporary_hitpoints
      : (useEffect.temp_hp !== undefined ? useEffect.temp_hp : temporaryHitPoints)
  );
  const hitpointMaxBonus = toNumberOrZero(
    useEffect.hitpoint_max_bonus !== undefined ? useEffect.hitpoint_max_bonus : entry && entry.hitpoint_max_bonus
  );
  return {
    heal_amount: effectHealAmount,
    temporary_hitpoints: effectTemporaryHitPoints,
    hitpoint_max_bonus: hitpointMaxBonus,
    remove_conditions: Array.isArray(useEffect.remove_conditions)
      ? useEffect.remove_conditions.slice()
      : (Array.isArray(metadata.remove_conditions) ? metadata.remove_conditions.slice() : [])
  };
}

function resolveChargeState(entry) {
  const metadata = entry && entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
  const charges = Number(metadata.charges);
  const chargesRemaining = metadata.charges_remaining !== undefined
    ? Number(metadata.charges_remaining)
    : charges;
  const hasCharges = Number.isFinite(charges) && charges > 0;
  return {
    has_charges: hasCharges,
    charges: hasCharges ? Math.floor(charges) : 0,
    charges_remaining: hasCharges && Number.isFinite(chargesRemaining) ? Math.max(0, Math.floor(chargesRemaining)) : 0
  };
}

function consumeInventoryItemUse(inventory, entry, playerId) {
  const chargeState = resolveChargeState(entry);
  if (chargeState.has_charges) {
    if (chargeState.charges_remaining <= 0) {
      return failure("player_use_item_failed", "item has no charges remaining", {
        item_id: String(entry && entry.item_id || "")
      });
    }
    const nextInventory = clone(inventory);
    const buckets = ["stackable_items", "equipment_items", "quest_items"];
    for (let index = 0; index < buckets.length; index += 1) {
      const bucket = buckets[index];
      const entries = Array.isArray(nextInventory[bucket]) ? nextInventory[bucket] : [];
      const targetIndex = entries.findIndex((candidate) => {
        return String(candidate && candidate.item_id || "") === String(entry && entry.item_id || "") &&
          canConsumeItemForPlayer(candidate, inventory, playerId);
      });
      if (targetIndex !== -1) {
        const nextEntry = clone(entries[targetIndex]);
        nextEntry.metadata = nextEntry.metadata && typeof nextEntry.metadata === "object" ? clone(nextEntry.metadata) : {};
        nextEntry.metadata.charges_remaining = chargeState.charges_remaining - 1;
        entries[targetIndex] = nextEntry;
        nextInventory[bucket] = entries;
        return success("player_use_item_charged_activation_consumed", {
          inventory: nextInventory,
          use_status: "charged_activation",
          charges_before: chargeState.charges_remaining,
          charges_after: chargeState.charges_remaining - 1
        });
      }
    }
    return failure("player_use_item_failed", "item not found for charged activation", {
      item_id: String(entry && entry.item_id || "")
    });
  }

  const removed = removeItemFromInventory(inventory, String(entry && entry.item_id || ""), 1, {
    canRemoveEntry(candidate) {
      return canConsumeItemForPlayer(candidate, inventory, playerId);
    }
  });
  if (!removed.ok) {
    return failure("player_use_item_failed", removed.error || "failed to consume item", removed.payload);
  }
  return success("player_use_item_consumed", {
    inventory: removed.payload.inventory,
    use_status: "consumed",
    charges_before: null,
    charges_after: null
  });
}

function applyCharacterItemUseEffect(character, inventory, effect) {
  const nextCharacter = clone(character);
  const hpBefore = Number.isFinite(Number(nextCharacter.current_hitpoints)) ? Number(nextCharacter.current_hitpoints) : 0;
  const hpMax = Number.isFinite(Number(nextCharacter.effective_hitpoint_max))
    ? Number(nextCharacter.effective_hitpoint_max)
    : (Number.isFinite(Number(nextCharacter.hitpoint_max)) ? Number(nextCharacter.hitpoint_max) : hpBefore);
  const hitpointMaxBonus = Math.max(0, toNumberOrZero(effect && effect.hitpoint_max_bonus));
  const tempBefore = Number.isFinite(Number(nextCharacter.temporary_hitpoints)) ? Number(nextCharacter.temporary_hitpoints) : 0;
  const healAmount = Math.max(0, toNumberOrZero(effect && effect.heal_amount));
  const temporaryHitPoints = Math.max(0, toNumberOrZero(effect && effect.temporary_hitpoints));
  const removeConditions = Array.isArray(effect && effect.remove_conditions) ? effect.remove_conditions : [];
  const hpMaxAfter = hpMax + hitpointMaxBonus;
  const hpAfter = healAmount > 0 ? Math.min(hpMaxAfter, hpBefore + healAmount + hitpointMaxBonus) : hpBefore + hitpointMaxBonus;
  const tempAfter = temporaryHitPoints > 0 ? Math.max(tempBefore, temporaryHitPoints) : tempBefore;

  nextCharacter.hitpoint_max = hpMaxAfter;
  nextCharacter.effective_hitpoint_max = hpMaxAfter;
  nextCharacter.current_hitpoints = hpAfter;
  nextCharacter.temporary_hitpoints = tempAfter;
  nextCharacter.hp_summary = {
    current: hpAfter,
    max: hpMaxAfter,
    temporary: tempAfter
  };
  nextCharacter.updated_at = new Date().toISOString();
  const statusFlagsBefore = Array.isArray(character && character.status_flags) ? character.status_flags.slice() : [];
  const removeSet = new Set(
    removeConditions.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
  );
  nextCharacter.status_flags = statusFlagsBefore.filter((entry) => !removeSet.has(String(entry || "").trim().toLowerCase()));
  const removedConditions = statusFlagsBefore.filter((entry) => removeSet.has(String(entry || "").trim().toLowerCase()));

  return {
    character: applyResolvedItemEffectState(nextCharacter, inventory),
    effect_result: {
      hp_before: hpBefore,
      hp_after: hpAfter,
      healed_for: Math.max(0, hpAfter - hpBefore),
      hitpoint_max_bonus: hitpointMaxBonus,
      hitpoint_max_before: hpMax,
      hitpoint_max_after: hpMaxAfter,
      temporary_hp_before: tempBefore,
      temporary_hp_after: tempAfter,
      temporary_hitpoints_granted: temporaryHitPoints,
      removed_conditions: removedConditions
    }
  };
}

function processWorldUseItemRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const playerId = data.player_id;
  const itemId = data.item_id;

  if (!playerId || String(playerId).trim() === "") {
    return failure("player_use_item_failed", "player_id is required");
  }
  if (!itemId || String(itemId).trim() === "") {
    return failure("player_use_item_failed", "item_id is required");
  }

  const inventoryPersistence = context.inventoryPersistence;
  if (!inventoryPersistence || typeof inventoryPersistence.listInventories !== "function") {
    return failure("player_use_item_failed", "inventoryPersistence is not available in world context");
  }

  let listed = null;
  try {
    listed = inventoryPersistence.listInventories();
  } catch (error) {
    return failure("player_use_item_failed", error.message || "failed to list inventories");
  }
  if (!listed.ok) {
    return failure("player_use_item_failed", listed.error || "failed to list inventories");
  }

  const inventories = Array.isArray(listed.payload.inventories) ? listed.payload.inventories : [];
  const foundInventory = inventories.find((inventory) => {
    return String(inventory.owner_id || "") === String(playerId);
  });

  if (!foundInventory) {
    return failure("player_use_item_failed", "inventory not found for player", {
      player_id: String(playerId)
    });
  }

  const normalized = normalizeInventoryShape(foundInventory);
  if (!normalized.ok) {
    return failure("player_use_item_failed", normalized.error || "invalid inventory shape");
  }
  const inventory = normalized.payload.inventory;
  const originalInventory = clone(inventory);
  const itemEntry = findOwnedItemEntry(inventory, String(itemId), playerId);
  if (!itemEntry) {
    return failure("player_use_item_failed", "item not found for player", {
      item_id: String(itemId),
      player_id: String(playerId)
    });
  }

  const loadedCharacters = loadCharacters(context);
  if (!loadedCharacters.ok) {
    return loadedCharacters;
  }
  const character = loadedCharacters.payload.characters.find((entry) => String(entry.player_id || "") === String(playerId || ""));
  if (!character) {
    return failure("player_use_item_failed", "character not found for player", {
      player_id: String(playerId)
    });
  }
  const originalCharacter = clone(character);
  const effect = resolveItemUseEffect(itemEntry);
  if (effect.heal_amount <= 0 && effect.temporary_hitpoints <= 0 && effect.hitpoint_max_bonus <= 0 && effect.remove_conditions.length === 0) {
    return failure("player_use_item_failed", "item has no supported use effect", {
      item_id: String(itemId)
    });
  }

  const consumed = consumeInventoryItemUse(inventory, itemEntry, playerId);
  if (!consumed.ok) {
    return consumed;
  }

  const effectApplied = applyCharacterItemUseEffect(character, consumed.payload.inventory, effect);

  let saved = null;
  try {
    saved = inventoryPersistence.saveInventory(consumed.payload.inventory);
  } catch (error) {
    return failure("player_use_item_failed", error.message || "failed to save inventory");
  }
  if (!saved.ok) {
    return failure("player_use_item_failed", saved.error || "failed to save inventory");
  }

  let savedCharacter = null;
  try {
    savedCharacter = saveCharacter(context, effectApplied.character);
  } catch (error) {
    inventoryPersistence.saveInventory(originalInventory);
    return failure("player_use_item_failed", error.message || "failed to save character after item use");
  }
  if (!savedCharacter.ok) {
    inventoryPersistence.saveInventory(originalInventory);
    return failure("player_use_item_failed", savedCharacter.error || "failed to save character after item use");
  }

  return success("player_use_item_processed", {
    use_status: consumed.payload.use_status || "consumed",
    item_id: String(itemId),
    player_id: String(playerId),
    inventory: clone(saved.payload.inventory),
    character: clone(savedCharacter.payload.character),
    effect_result: Object.assign({}, effectApplied.effect_result, {
      charges_before: consumed.payload.charges_before,
      charges_after: consumed.payload.charges_after
    })
  });
}

module.exports = {
  processWorldUseItemRequest
};
