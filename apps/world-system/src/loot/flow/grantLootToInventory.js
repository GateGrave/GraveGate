"use strict";

const { createInventoryRecord } = require("../../../../inventory-system/src/inventory.schema");
const {
  addItemToInventory: canonicalAddItemToInventory,
  normalizeInventoryShape: canonicalNormalizeInventoryShape
} = require("../../../../inventory-system/src/mutationHelpers");
const { updateCharacterProgress } = require("../../character/flow/updateCharacterProgress");

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

function isStackable(entry) {
  if (entry && entry.stackable === false) {
    return false;
  }
  if (entry && entry.metadata && entry.metadata.stackable === false) {
    return false;
  }
  return true;
}

function resolveMutationHelpers(input) {
  const injected = input && input.mutation_helpers && typeof input.mutation_helpers === "object"
    ? input.mutation_helpers
    : null;

  return {
    addItemToInventory:
      injected && typeof injected.addItemToInventory === "function"
        ? injected.addItemToInventory
        : canonicalAddItemToInventory,
    normalizeInventoryShape:
      injected && typeof injected.normalizeInventoryShape === "function"
        ? injected.normalizeInventoryShape
        : canonicalNormalizeInventoryShape
  };
}

function getInventoryFromResult(result) {
  if (!result) return null;
  if (result.ok === true && result.payload && result.payload.inventory) {
    return result.payload.inventory;
  }
  if (result.ok === false) return null;
  if (typeof result === "object") return result;
  return null;
}

function ensureLegacyInventoryShape(inventory) {
  if (!Array.isArray(inventory.items)) {
    inventory.items = [];
  }

  if (!inventory.inventory_id) {
    inventory.inventory_id = "inventory-" + Date.now();
  }

  if (!inventory.currency || typeof inventory.currency !== "object" || Array.isArray(inventory.currency)) {
    inventory.currency = { gold: 0, silver: 0, copper: 0 };
  }
  if (!inventory.metadata || typeof inventory.metadata !== "object" || Array.isArray(inventory.metadata)) {
    inventory.metadata = {};
  }
}

function ensureCanonicalInventoryShape(inventory) {
  if (!inventory.inventory_id) {
    inventory.inventory_id = "inventory-" + Date.now();
  }
  if (!inventory.owner_type) {
    inventory.owner_type = "player";
  }
  if (!("owner_id" in inventory)) {
    inventory.owner_id = null;
  }
  if (!inventory.currency || typeof inventory.currency !== "object" || Array.isArray(inventory.currency)) {
    inventory.currency = { gold: 0, silver: 0, copper: 0 };
  }
  if (!Array.isArray(inventory.stackable_items)) {
    inventory.stackable_items = [];
  }
  if (!Array.isArray(inventory.equipment_items)) {
    inventory.equipment_items = [];
  }
  if (!Array.isArray(inventory.quest_items)) {
    inventory.quest_items = [];
  }
  if (!inventory.metadata || typeof inventory.metadata !== "object" || Array.isArray(inventory.metadata)) {
    inventory.metadata = {};
  }
}

function isCanonicalInventory(inventory) {
  return Boolean(
    inventory &&
      (Array.isArray(inventory.stackable_items) ||
        Array.isArray(inventory.equipment_items) ||
        Array.isArray(inventory.quest_items) ||
        "owner_type" in inventory ||
        "owner_id" in inventory)
  );
}

function normalizeRewardUpdate(input, lootBundle) {
  const direct = input && input.reward_update && typeof input.reward_update === "object"
    ? input.reward_update
    : {};
  const bundleMeta = lootBundle && lootBundle.metadata && typeof lootBundle.metadata === "object"
    ? lootBundle.metadata
    : {};
  const bundled = bundleMeta.reward_update && typeof bundleMeta.reward_update === "object"
    ? bundleMeta.reward_update
    : {};

  const merged = {
    ...bundled,
    ...direct
  };
  if (!Object.prototype.hasOwnProperty.call(merged, "reward_key") && bundleMeta.reward_key) {
    merged.reward_key = String(bundleMeta.reward_key);
  }

  const normalized = {};
  if (merged.reward_key) {
    normalized.reward_key = String(merged.reward_key);
  }
  if (Number.isFinite(merged.gold)) {
    normalized.gold = Math.max(0, Math.floor(Number(merged.gold)));
  }
  if (Number.isFinite(merged.silver)) {
    normalized.silver = Math.max(0, Math.floor(Number(merged.silver)));
  }
  if (Number.isFinite(merged.copper)) {
    normalized.copper = Math.max(0, Math.floor(Number(merged.copper)));
  }
  if (Number.isFinite(merged.xp)) {
    normalized.xp = Math.max(0, Math.floor(Number(merged.xp)));
  }

  return normalized;
}

function validateLootEntries(entries) {
  const invalidEntries = [];
  const safeEntries = Array.isArray(entries) ? entries : [];

  for (let index = 0; index < safeEntries.length; index += 1) {
    const entry = safeEntries[index];
    const quantity = Number.isFinite(entry && entry.quantity) ? Math.floor(Number(entry.quantity)) : 1;

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      invalidEntries.push({
        index,
        reason: "entry must be an object"
      });
      continue;
    }

    if (!entry.item_id || String(entry.item_id).trim() === "") {
      invalidEntries.push({
        index,
        reason: "item_id is required"
      });
      continue;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      invalidEntries.push({
        index,
        item_id: String(entry.item_id || ""),
        reason: "quantity must be a positive number"
      });
    }
  }

  return invalidEntries;
}

function computeGrantKey(input, lootBundle, inventory, rewardUpdate) {
  if (input && input.grant_key) {
    return String(input.grant_key);
  }
  if (rewardUpdate && rewardUpdate.reward_key) {
    return String(rewardUpdate.reward_key);
  }
  if (lootBundle && lootBundle.drop_id) {
    return String(lootBundle.drop_id);
  }

  const sourceType = lootBundle && lootBundle.source_type ? String(lootBundle.source_type) : "unknown";
  const sourceId = lootBundle && lootBundle.source_id ? String(lootBundle.source_id) : "unknown";
  const inventoryId = inventory && inventory.inventory_id ? String(inventory.inventory_id) : "inventory-unknown";
  return sourceType + ":" + sourceId + ":" + inventoryId;
}

function isDuplicateGrant(inventory, grantKey, processedGrantStore) {
  const metadata = inventory && inventory.metadata && typeof inventory.metadata === "object"
    ? inventory.metadata
    : {};
  const keys = Array.isArray(metadata.processed_reward_keys) ? metadata.processed_reward_keys : [];
  if (keys.includes(grantKey)) {
    return true;
  }
  if (processedGrantStore && typeof processedGrantStore.has === "function") {
    return processedGrantStore.has(grantKey);
  }
  return false;
}

function recordGrantKey(inventory, grantKey, processedGrantStore) {
  inventory.metadata = inventory.metadata && typeof inventory.metadata === "object" ? inventory.metadata : {};
  inventory.metadata.processed_reward_keys = Array.isArray(inventory.metadata.processed_reward_keys)
    ? inventory.metadata.processed_reward_keys
    : [];
  inventory.metadata.processed_reward_keys.push(String(grantKey));
  if (inventory.metadata.processed_reward_keys.length > 200) {
    inventory.metadata.processed_reward_keys = inventory.metadata.processed_reward_keys.slice(-200);
  }
  if (processedGrantStore && typeof processedGrantStore.add === "function") {
    processedGrantStore.add(grantKey);
  }
}

function applyCurrencyReward(inventory, rewardUpdate) {
  if (!rewardUpdate) return;
  const gold = Number.isFinite(rewardUpdate.gold) ? Math.max(0, Math.floor(Number(rewardUpdate.gold))) : 0;
  const silver = Number.isFinite(rewardUpdate.silver) ? Math.max(0, Math.floor(Number(rewardUpdate.silver))) : 0;
  const copper = Number.isFinite(rewardUpdate.copper) ? Math.max(0, Math.floor(Number(rewardUpdate.copper))) : 0;
  inventory.currency = inventory.currency && typeof inventory.currency === "object" ? inventory.currency : { gold: 0, silver: 0, copper: 0 };
  inventory.currency.gold = Math.max(0, Math.floor(Number(inventory.currency.gold || 0))) + gold;
  inventory.currency.silver = Math.max(0, Math.floor(Number(inventory.currency.silver || 0))) + silver;
  inventory.currency.copper = Math.max(0, Math.floor(Number(inventory.currency.copper || 0))) + copper;
}

function resolveRewardCharacterId(input, ownerId) {
  if (input && input.character_id) {
    return String(input.character_id);
  }
  if (input && typeof input.resolve_character_id_fn === "function") {
    const resolved = input.resolve_character_id_fn(ownerId);
    if (resolved) {
      return String(resolved);
    }
  }
  if (input && input.characterPersistence && typeof input.characterPersistence.listCharacters === "function") {
    const listed = input.characterPersistence.listCharacters();
    if (listed.ok) {
      const rows = Array.isArray(listed.payload.characters) ? listed.payload.characters : [];
      const owned = rows.filter((entry) => String(entry.player_id || "") === String(ownerId || ""));
      if (owned.length > 0) {
        owned.sort((a, b) => {
          return String(a.created_at || "").localeCompare(String(b.created_at || ""));
        });
        return String(owned[0].character_id);
      }
    }
  }
  return null;
}

function createPersistenceBackedCharacterService(characterPersistence) {
  return {
    getCharacterById(characterId) {
      return characterPersistence.loadCharacterById(characterId);
    },
    updateCharacter(input) {
      const data = input || {};
      if (!data.character_id) {
        return failure("character_update_failed", "character_id is required");
      }
      const loaded = characterPersistence.loadCharacterById(String(data.character_id));
      if (!loaded.ok) {
        return failure("character_update_failed", loaded.error || "character not found");
      }
      const current = loaded.payload.character;
      const patch = data.patch && typeof data.patch === "object" ? data.patch : {};
      const next = {
        ...current,
        ...patch,
        updated_at: new Date().toISOString()
      };
      const saved = characterPersistence.saveCharacter(next);
      if (!saved.ok) {
        return failure("character_update_failed", saved.error || "failed to save character");
      }
      return success("character_updated", {
        character: clone(saved.payload.character)
      });
    }
  };
}

function applyXpReward(input, ownerId, rewardUpdate) {
  const xpDelta = rewardUpdate && Number.isFinite(rewardUpdate.xp)
    ? Math.max(0, Math.floor(Number(rewardUpdate.xp)))
    : 0;
  if (xpDelta <= 0) {
    return success("character_progress_not_updated", {
      reason: "xp_delta_not_provided",
      xp_delta: 0
    });
  }

  const characterId = resolveRewardCharacterId(input, ownerId);
  if (!characterId) {
    return failure("loot_grant_failed", "xp reward target character could not be resolved", {
      owner_id: ownerId || null
    });
  }

  const characterService =
    input && input.character_service && typeof input.character_service.getCharacterById === "function"
      ? input.character_service
      : input && input.characterPersistence
        ? createPersistenceBackedCharacterService(input.characterPersistence)
        : null;

  if (!characterService) {
    return failure("loot_grant_failed", "character service/persistence is required for xp rewards", {
      character_id: characterId
    });
  }

  return updateCharacterProgress({
    character_service: characterService,
    character_id: characterId,
    xp_delta: xpDelta
  });
}

function findLegacyStackTarget(items, entry, ownerPlayerId) {
  return items.find((item) => {
    return (
      item &&
      item.item_id === entry.item_id &&
      isStackable(item) &&
      isStackable(entry) &&
      String(item.owner_player_id || "") === String(ownerPlayerId || "")
    );
  });
}

function findCanonicalStackTarget(items, entry, ownerPlayerId) {
  return items.find((item) => {
    return (
      item &&
      item.item_id === entry.item_id &&
      isStackable(item) &&
      isStackable(entry) &&
      String(item.owner_player_id || "") === String(ownerPlayerId || "")
    );
  });
}

function getCanonicalBucket(entry) {
  const itemType = entry.item_type ? String(entry.item_type).toLowerCase() : "";
  const category = entry.metadata && entry.metadata.category ? String(entry.metadata.category).toLowerCase() : "";

  if (itemType === "quest" || category === "quest") {
    return "quest_items";
  }

  if (isStackable(entry)) {
    return "stackable_items";
  }

  return "equipment_items";
}

function toCanonicalMutationItem(entry, ownerPlayerId) {
  const metadata =
    entry && entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
      ? clone(entry.metadata)
      : {};

  if (entry && entry.source_type) metadata.source_type = String(entry.source_type);
  if (entry && entry.source_id) metadata.source_id = String(entry.source_id);
  metadata.granted_at = new Date().toISOString();

  const itemType =
    entry && entry.item_type
      ? String(entry.item_type)
      : getCanonicalBucket(entry) === "quest_items"
        ? "quest"
        : getCanonicalBucket(entry) === "stackable_items"
          ? "stackable"
          : "equipment";

  return {
    item_id: String(entry.item_id),
    item_name: entry.item_name ? String(entry.item_name) : "Unknown Item",
    item_type: itemType,
    rarity: entry.rarity ? String(entry.rarity) : "common",
    quantity: Number.isFinite(entry.quantity) ? Math.max(1, Math.floor(Number(entry.quantity))) : 1,
    stackable: isStackable(entry),
    owner_player_id: ownerPlayerId,
    metadata
  };
}

function resolveInventory(input) {
  const data = input || {};

  if (data.inventory && typeof data.inventory === "object") {
    return {
      ok: true,
      mode: "direct",
      inventory: data.inventory,
      inventory_service: null
    };
  }

  if (data.inventory_ref && typeof data.resolve_inventory_fn === "function") {
    const resolved = data.resolve_inventory_fn(data.inventory_ref);
    if (resolved && typeof resolved === "object") {
      return {
        ok: true,
        mode: "resolver",
        inventory: resolved,
        inventory_service: null
      };
    }
    return {
      ok: false,
      error: "resolve_inventory_fn did not return an inventory object"
    };
  }

  if (data.inventory_service) {
    const service = data.inventory_service;
    if (
      typeof service.getInventory !== "function" ||
      typeof service.saveInventory !== "function"
    ) {
      return {
        ok: false,
        error: "inventory_service must expose getInventory and saveInventory functions"
      };
    }

    if (!data.inventory_id) {
      return {
        ok: false,
        error: "inventory_id is required when using inventory_service"
      };
    }

    const loadedResult = service.getInventory(String(data.inventory_id));
    let inventory = getInventoryFromResult(loadedResult);

    if (!inventory) {
      // Create canonical inventory if the service has no record yet.
      inventory = createInventoryRecord({
        inventory_id: String(data.inventory_id),
        owner_type: data.owner_type || "player",
        owner_id: data.owner_id || data.owner_player_id || null
      });
    }

    return {
      ok: true,
      mode: "service",
      inventory,
      inventory_service: service
    };
  }

  return {
    ok: false,
    error: "inventory is required"
  };
}

function grantLootToInventory(input) {
  const data = input || {};
  const lootBundle = data.loot_bundle;
  const resolvedInventory = resolveInventory(data);
  const mutationHelpers = resolveMutationHelpers(data);
  const processedGrantStore = data.processed_grant_store || null;

  if (!lootBundle || typeof lootBundle !== "object") {
    return failure("loot_grant_failed", "loot_bundle is required");
  }
  if (!Array.isArray(lootBundle.entries)) {
    return failure("loot_grant_failed", "loot_bundle.entries must be an array");
  }
  const invalidEntries = validateLootEntries(lootBundle.entries);
  if (invalidEntries.length > 0) {
    return failure("loot_grant_failed", "loot_bundle contains invalid entries", {
      invalid_entries: invalidEntries
    });
  }
  if (!resolvedInventory.ok) {
    return failure("loot_grant_failed", resolvedInventory.error);
  }

  const inventory = resolvedInventory.inventory;
  const originalInventory = clone(inventory);
  const canonical = isCanonicalInventory(inventory);
  if (canonical) {
    const normalized = mutationHelpers.normalizeInventoryShape(inventory);
    if (!normalized || normalized.ok !== true || !normalized.payload || !normalized.payload.inventory) {
      return failure("loot_grant_failed", normalized?.error || "failed to normalize canonical inventory");
    }
    Object.assign(inventory, normalized.payload.inventory);
  } else {
    ensureLegacyInventoryShape(inventory);
  }

  const rewardUpdate = normalizeRewardUpdate(data, lootBundle);
  const grantKey = computeGrantKey(data, lootBundle, inventory, rewardUpdate);
  if (isDuplicateGrant(inventory, grantKey, processedGrantStore)) {
    return success("loot_grant_skipped", {
      inventory: clone(inventory),
      granted_items: [],
      totals: {
        granted_entry_count: 0,
        inventory_item_count: canonical
          ? inventory.stackable_items.length + inventory.equipment_items.length + inventory.quest_items.length
          : inventory.items.length
      },
      metadata: {
        event_type: "loot_grant_skipped",
        reason: "duplicate_grant_attempt",
        grant_key: grantKey
      }
    });
  }

  const granted = [];
  const stackEvents = [];

  for (const entry of lootBundle.entries) {
    const ownerPlayerId =
      entry.target_player_id || inventory.owner_player_id || inventory.owner_id || null;
    const quantity = Number.isFinite(entry.quantity) ? Math.max(1, Math.floor(Number(entry.quantity))) : 1;

    if (canonical) {
      const mutationItem = toCanonicalMutationItem(entry, ownerPlayerId);
      const mutationResult = mutationHelpers.addItemToInventory(inventory, mutationItem);
      if (!mutationResult || mutationResult.ok !== true || !mutationResult.payload || !mutationResult.payload.inventory) {
        return failure("loot_grant_failed", mutationResult?.error || "failed to add loot entry to canonical inventory", {
          item_id: entry.item_id
        });
      }

      Object.assign(inventory, mutationResult.payload.inventory);

      const bucket = mutationResult.payload.added?.bucket || getCanonicalBucket(entry);
      const stacked = mutationResult.payload.added?.stacked === true;
      let newQuantity = null;
      if (bucket === "stackable_items" && Array.isArray(inventory.stackable_items)) {
        const stackedEntry = inventory.stackable_items.find((x) => x && x.item_id === String(entry.item_id));
        if (stackedEntry) {
          newQuantity = Number(stackedEntry.quantity || 0);
        }
      }

      stackEvents.push({
        action: stacked ? "stacked" : "added",
        item_id: entry.item_id,
        quantity_added: quantity,
        new_quantity: newQuantity,
        owner_player_id: ownerPlayerId,
        bucket,
        mutation_helper_used: true
      });

      granted.push({
        item_id: String(entry.item_id),
        quantity,
        owner_player_id: ownerPlayerId,
        stacked
      });
      continue;
    }

    const targetStack = findLegacyStackTarget(inventory.items, entry, ownerPlayerId);

    if (targetStack) {
      targetStack.quantity = Number(targetStack.quantity || 0) + quantity;
      targetStack.last_granted_at = new Date().toISOString();
      stackEvents.push({
        action: "stacked",
        item_id: entry.item_id,
        quantity_added: quantity,
        new_quantity: targetStack.quantity,
        owner_player_id: ownerPlayerId
      });

      granted.push({
        item_id: entry.item_id,
        quantity,
        owner_player_id: ownerPlayerId,
        stacked: true
      });
      continue;
    }

    const itemRecord = {
      item_id: String(entry.item_id),
      item_name: entry.item_name ? String(entry.item_name) : "Unknown Item",
      rarity: entry.rarity ? String(entry.rarity) : "common",
      quantity,
      owner_player_id: ownerPlayerId,
      stackable: isStackable(entry),
      source_type: entry.source_type ? String(entry.source_type) : "unknown",
      source_id: entry.source_id ? String(entry.source_id) : "unknown",
      metadata: entry.metadata && typeof entry.metadata === "object" ? clone(entry.metadata) : {},
      granted_at: new Date().toISOString()
    };

    inventory.items.push(itemRecord);

    stackEvents.push({
      action: "added",
      item_id: itemRecord.item_id,
      quantity_added: quantity,
      owner_player_id: ownerPlayerId
    });

    granted.push({
      item_id: itemRecord.item_id,
      quantity,
      owner_player_id: ownerPlayerId,
      stacked: false
    });
  }

  applyCurrencyReward(inventory, rewardUpdate);

  if (resolvedInventory.mode === "service" && resolvedInventory.inventory_service) {
    const saveResult = resolvedInventory.inventory_service.saveInventory(inventory);
    if (saveResult && saveResult.ok === false) {
      return failure("loot_grant_failed", saveResult.error || "failed to save inventory through inventory_service");
    }
  }

  const ownerId = data.owner_id || data.owner_player_id || inventory.owner_id || inventory.owner_player_id || null;
  const progressionOut = applyXpReward(data, ownerId, rewardUpdate);
  if (!progressionOut.ok) {
    if (resolvedInventory.mode === "service" && resolvedInventory.inventory_service) {
      const rollbackResult = resolvedInventory.inventory_service.saveInventory(originalInventory);
      if (rollbackResult && rollbackResult.ok === false) {
        return failure("loot_grant_failed", "xp reward apply failed and inventory rollback failed", {
          progression_error: progressionOut.error || "failed to apply xp reward",
          rollback_error: rollbackResult.error || "failed to rollback inventory",
          partial_commit: true
        });
      }
    } else {
      Object.keys(inventory).forEach((key) => delete inventory[key]);
      Object.assign(inventory, clone(originalInventory));
    }
    return failure("loot_grant_failed", progressionOut.error || "failed to apply xp reward");
  }

  recordGrantKey(inventory, grantKey, processedGrantStore);
  if (resolvedInventory.mode === "service" && resolvedInventory.inventory_service) {
    // Persist idempotency key + any currency adjustments once after all side effects are valid.
    const saveResult = resolvedInventory.inventory_service.saveInventory(inventory);
    if (saveResult && saveResult.ok === false) {
      return failure("loot_grant_failed", saveResult.error || "failed to save reward idempotency state");
    }
  }

  const metadata = {
    event_type: "loot_granted_to_inventory",
    granted_at: new Date().toISOString(),
    drop_id: lootBundle.drop_id || null,
    grant_key: grantKey,
    source_type: lootBundle.source_type || null,
    source_id: lootBundle.source_id || null,
    reward_update: clone(rewardUpdate),
    progression: progressionOut && progressionOut.payload ? clone(progressionOut.payload) : null,
    mutation_helpers_used: canonical,
    grant_events: stackEvents
  };

  return success("loot_granted_to_inventory", {
    inventory: clone(inventory),
    granted_items: granted,
    totals: {
      granted_entry_count: granted.length,
      inventory_item_count: canonical
        ? inventory.stackable_items.length + inventory.equipment_items.length + inventory.quest_items.length
        : inventory.items.length
    },
    metadata
  });
}

module.exports = {
  grantLootToInventory
};
