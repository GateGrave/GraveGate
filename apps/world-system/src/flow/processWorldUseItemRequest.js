"use strict";

const { normalizeInventoryShape, removeItemFromInventory } = require("../../../inventory-system/src/mutationHelpers");

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

  const removed = removeItemFromInventory(normalized.payload.inventory, String(itemId), 1, {
    canRemoveEntry(entry) {
      return canConsumeItemForPlayer(entry, normalized.payload.inventory, playerId);
    }
  });
  if (!removed.ok) {
    return failure("player_use_item_failed", removed.error || "failed to consume item", removed.payload);
  }

  let saved = null;
  try {
    saved = inventoryPersistence.saveInventory(removed.payload.inventory);
  } catch (error) {
    return failure("player_use_item_failed", error.message || "failed to save inventory");
  }
  if (!saved.ok) {
    return failure("player_use_item_failed", saved.error || "failed to save inventory");
  }

  return success("player_use_item_processed", {
    use_status: "consumed",
    item_id: String(itemId),
    player_id: String(playerId),
    inventory: clone(saved.payload.inventory)
  });
}

module.exports = {
  processWorldUseItemRequest
};
