"use strict";

const { loadItemContent } = require("../../content/contentLoader");
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
  if (!context.characterPersistence || typeof context.characterPersistence.listCharacters !== "function") {
    return failure("magical_item_request_failed", "characterPersistence.listCharacters is required");
  }
  const listed = context.characterPersistence.listCharacters();
  if (!listed.ok) {
    return failure("magical_item_request_failed", listed.error || "failed to load characters");
  }
  return success("magical_item_characters_loaded", {
    characters: Array.isArray(listed.payload.characters) ? listed.payload.characters : []
  });
}

function saveCharacter(context, character) {
  if (!context.characterPersistence || typeof context.characterPersistence.saveCharacter !== "function") {
    return { ok: false, error: "characterPersistence.saveCharacter is required" };
  }
  return context.characterPersistence.saveCharacter(character);
}

function loadInventory(context, inventoryId) {
  if (!context.inventoryPersistence || typeof context.inventoryPersistence.loadInventoryById !== "function") {
    return failure("magical_item_request_failed", "inventoryPersistence.loadInventoryById is required");
  }
  const loaded = context.inventoryPersistence.loadInventoryById(String(inventoryId || ""));
  if (!loaded.ok) {
    return failure("magical_item_request_failed", loaded.error || "failed to load inventory");
  }
  return success("magical_item_inventory_loaded", {
    inventory: clone(loaded.payload.inventory)
  });
}

function saveInventory(context, inventory) {
  if (!context.inventoryPersistence || typeof context.inventoryPersistence.saveInventory !== "function") {
    return { ok: false, error: "inventoryPersistence.saveInventory is required" };
  }
  return context.inventoryPersistence.saveInventory(inventory);
}

function resolveItemContentIndex(context) {
  if (context && typeof context.loadContentBundle === "function") {
    const loaded = context.loadContentBundle();
    if (loaded && loaded.ok === true) {
      const content = loaded.payload && loaded.payload.content ? loaded.payload.content : {};
      const items = Array.isArray(content.items) ? content.items : [];
      return items.reduce((index, item) => {
        const itemId = String(item && item.item_id || "").trim();
        if (itemId) {
          index[itemId] = clone(item);
        }
        return index;
      }, {});
    }
  }

  const loaded = loadItemContent();
  if (!loaded.ok) {
    return {};
  }
  return loaded.payload.entries.reduce((index, item) => {
    const itemId = String(item && item.item_id || "").trim();
    if (itemId) {
      index[itemId] = clone(item);
    }
    return index;
  }, {});
}

function findOwnedInventoryEntry(inventory, itemId, playerId) {
  const buckets = ["equipment_items", "stackable_items", "quest_items"];
  for (const bucket of buckets) {
    const list = Array.isArray(inventory[bucket]) ? inventory[bucket] : [];
    const index = list.findIndex((entry) => String(entry && entry.item_id || "") === String(itemId || ""));
    if (index === -1) {
      continue;
    }
    const entry = list[index];
    const entryOwner = entry && entry.owner_player_id ? String(entry.owner_player_id) : null;
    const inventoryOwner = inventory && inventory.owner_id ? String(inventory.owner_id) : null;
    const isOwned = entryOwner
      ? entryOwner === String(playerId || "")
      : inventoryOwner === String(playerId || "");
    if (!isOwned) {
      return null;
    }
    return {
      bucket,
      index,
      entry
    };
  }
  return null;
}

function normalizeAttunementState(character) {
  const base = character && character.attunement && typeof character.attunement === "object"
    ? clone(character.attunement)
    : {};
  const maxSlots = Number.isFinite(base.attunement_slots) ? Math.max(1, Math.floor(Number(base.attunement_slots))) : 3;
  const attunedItems = Array.isArray(base.attuned_items) ? base.attuned_items.map((entry) => String(entry)) : [];
  return {
    ...base,
    attunement_slots: maxSlots,
    attuned_items: attunedItems,
    slots_used: attunedItems.length
  };
}

function persistWriteSet(context, nextCharacter, nextInventory, originalCharacter, originalInventory, failureEventType) {
  const inventorySaved = saveInventory(context, nextInventory);
  if (!inventorySaved.ok) {
    return failure(failureEventType, inventorySaved.error || "failed to save inventory");
  }

  const characterSaved = saveCharacter(context, nextCharacter);
  if (characterSaved.ok) {
    return success("magical_item_write_set_saved", {
      character: clone(characterSaved.payload.character),
      inventory: clone(inventorySaved.payload.inventory)
    });
  }

  const rollbackInventory = saveInventory(context, originalInventory);
  if (rollbackInventory.ok) {
    return failure(failureEventType, characterSaved.error || "failed to save character state");
  }

  const rollbackCharacter = saveCharacter(context, originalCharacter);
  return failure(failureEventType, "failed to save character state and inventory rollback failed", {
    character_error: characterSaved.error || "failed to save character state",
    inventory_rollback_error: rollbackInventory.error || "inventory rollback failed",
    character_rollback_ok: rollbackCharacter.ok === true,
    partial_commit: true
  });
}

function processIdentifyItemRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const playerId = String(data.player_id || "").trim();
  const itemId = String(data.item_id || "").trim();

  if (!playerId) {
    return failure("player_identify_failed", "player_id is required");
  }
  if (!itemId) {
    return failure("player_identify_failed", "item_id is required");
  }

  const loadedCharacters = loadCharacters(context);
  if (!loadedCharacters.ok) {
    return failure("player_identify_failed", loadedCharacters.error);
  }
  const character = loadedCharacters.payload.characters.find((entry) => String(entry.player_id || "") === playerId);
  if (!character) {
    return failure("player_identify_failed", "character not found for player", {
      player_id: playerId
    });
  }

  const inventoryOut = loadInventory(context, character.inventory_id);
  if (!inventoryOut.ok) {
    return failure("player_identify_failed", inventoryOut.error);
  }

  const inventory = inventoryOut.payload.inventory;
  const originalInventory = clone(inventory);
  const originalCharacter = clone(character);
  const found = findOwnedInventoryEntry(inventory, itemId, playerId);
  if (!found) {
    return failure("player_identify_failed", "item not found in linked inventory", {
      item_id: itemId
    });
  }

  const entry = found.entry;
  const metadata = entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
  const hiddenItemRef = metadata.hidden_item_ref ? String(metadata.hidden_item_ref) : "";
  if (String(entry.item_type || "").toLowerCase() !== "unidentified" || !hiddenItemRef) {
    return failure("player_identify_failed", "item is not an unidentified item", {
      item_id: itemId
    });
  }

  const itemIndex = resolveItemContentIndex(context);
  const revealedItem = itemIndex[hiddenItemRef];
  if (!revealedItem) {
    return failure("player_identify_failed", "hidden item definition not found", {
      item_id: itemId,
      hidden_item_ref: hiddenItemRef
    });
  }

  entry.item_id = String(revealedItem.item_id);
  entry.item_name = String(revealedItem.name || revealedItem.item_id);
  entry.item_type = String(revealedItem.item_type || "equipment");
  entry.stackable = revealedItem.stackable === true;
  entry.metadata = {
    ...(revealedItem.metadata && typeof revealedItem.metadata === "object" ? clone(revealedItem.metadata) : {}),
    ...(metadata || {}),
    is_identified: true,
    identified_at: new Date().toISOString(),
    identified_from_item_id: itemId,
    public_label: metadata.public_label || entry.item_name,
    hidden_item_ref: hiddenItemRef,
    magical: Boolean(
      (revealedItem.metadata && revealedItem.metadata.magical === true) ||
      String(revealedItem.item_type || "").toLowerCase() === "magical"
    ),
    requires_attunement: Boolean(revealedItem.metadata && revealedItem.metadata.requires_attunement === true)
  };

  const nextCharacter = applyResolvedItemEffectState(character, inventory);
  const persisted = persistWriteSet(context, nextCharacter, inventory, originalCharacter, originalInventory, "player_identify_failed");
  if (!persisted.ok) {
    return persisted;
  }

  return success("player_identify_processed", {
    character: persisted.payload.character,
    inventory: persisted.payload.inventory,
    item: {
      item_id: entry.item_id,
      item_name: entry.item_name,
      item_type: entry.item_type,
      magical: Boolean(entry.metadata && entry.metadata.magical),
      requires_attunement: Boolean(entry.metadata && entry.metadata.requires_attunement)
    }
  });
}

function processAttunementRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const playerId = String(data.player_id || "").trim();
  const itemId = String(data.item_id || "").trim();
  const mode = data.mode === "unattune" ? "unattune" : "attune";
  const failureType = mode === "attune" ? "player_attune_failed" : "player_unattune_failed";
  const successType = mode === "attune" ? "player_attune_processed" : "player_unattune_processed";

  if (!playerId) {
    return failure(failureType, "player_id is required");
  }
  if (!itemId) {
    return failure(failureType, "item_id is required");
  }

  const loadedCharacters = loadCharacters(context);
  if (!loadedCharacters.ok) {
    return failure(failureType, loadedCharacters.error);
  }
  const character = loadedCharacters.payload.characters.find((entry) => String(entry.player_id || "") === playerId);
  if (!character) {
    return failure(failureType, "character not found for player", {
      player_id: playerId
    });
  }

  const inventoryOut = loadInventory(context, character.inventory_id);
  if (!inventoryOut.ok) {
    return failure(failureType, inventoryOut.error);
  }

  const inventory = inventoryOut.payload.inventory;
  const originalInventory = clone(inventory);
  const originalCharacter = clone(character);
  const found = findOwnedInventoryEntry(inventory, itemId, playerId);
  if (!found) {
    return failure(failureType, "item not found in linked inventory", {
      item_id: itemId
    });
  }

  const entry = found.entry;
  const metadata = entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
  if (String(entry.item_type || "").toLowerCase() === "unidentified") {
    return failure(failureType, "unidentified items cannot be attuned", {
      item_id: itemId
    });
  }

  const requiresAttunement = Boolean(metadata.requires_attunement === true);
  if (!requiresAttunement) {
    return failure(failureType, "item does not require attunement", {
      item_id: itemId
    });
  }

  const nextCharacter = clone(character);
  const attunement = normalizeAttunementState(nextCharacter);
  const attunedItems = new Set(attunement.attuned_items);
  const isAlreadyAttuned = attunedItems.has(itemId);

  if (mode === "attune") {
    if (isAlreadyAttuned || metadata.is_attuned === true) {
      return failure(failureType, "item is already attuned", {
        item_id: itemId
      });
    }
    if (attunedItems.size >= attunement.attunement_slots) {
      return failure(failureType, "no attunement slots available", {
        item_id: itemId,
        attunement_slots: attunement.attunement_slots
      });
    }
    attunedItems.add(itemId);
    entry.metadata = {
      ...metadata,
      is_attuned: true,
      attuned_character_id: nextCharacter.character_id,
      attuned_at: new Date().toISOString()
    };
  } else {
    if (!isAlreadyAttuned && metadata.is_attuned !== true) {
      return failure(failureType, "item is not currently attuned", {
        item_id: itemId
      });
    }
    attunedItems.delete(itemId);
    entry.metadata = {
      ...metadata,
      is_attuned: false,
      unattuned_at: new Date().toISOString()
    };
    delete entry.metadata.attuned_character_id;
  }

  nextCharacter.attunement = {
    ...attunement,
    attuned_items: Array.from(attunedItems),
    slots_used: attunedItems.size
  };
  const resolvedCharacter = applyResolvedItemEffectState(nextCharacter, inventory);

  const persisted = persistWriteSet(context, resolvedCharacter, inventory, originalCharacter, originalInventory, failureType);
  if (!persisted.ok) {
    return persisted;
  }

  return success(successType, {
    character: persisted.payload.character,
    inventory: persisted.payload.inventory,
    item: {
      item_id: entry.item_id,
      item_name: entry.item_name || entry.item_id,
      is_attuned: entry.metadata && entry.metadata.is_attuned === true
    }
  });
}

module.exports = {
  processIdentifyItemRequest,
  processAttunementRequest
};
