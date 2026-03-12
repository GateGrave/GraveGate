"use strict";

class ProcessedGuildStorageWithdrawalStore {
  constructor() {
    this.processed = new Set();
  }

  has(withdrawalKey) {
    if (!withdrawalKey) return false;
    return this.processed.has(String(withdrawalKey));
  }

  add(withdrawalKey) {
    if (!withdrawalKey) return;
    this.processed.add(String(withdrawalKey));
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFailure(eventType, reason, extra) {
  return {
    ok: false,
    event_type: eventType,
    payload: {
      reason,
      ...(extra || {})
    }
  };
}

function createSuccess(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {}
  };
}

function isLeader(guild, playerId) {
  return String(guild.leader_id) === String(playerId);
}

function isOfficer(guild, playerId) {
  return Array.isArray(guild.officer_ids) && guild.officer_ids.includes(String(playerId));
}

function isMember(guild, playerId) {
  return Array.isArray(guild.member_ids) && guild.member_ids.includes(String(playerId));
}

function removeItemFromEntries(entries, itemId, quantity) {
  const working = clone(Array.isArray(entries) ? entries : []);
  let remaining = quantity;

  for (const row of working) {
    if (row.item_id !== itemId) continue;
    if (remaining <= 0) break;

    const rowQty = Number.isFinite(row.quantity) ? Math.max(0, Math.floor(row.quantity)) : 1;
    if (rowQty <= remaining) {
      row.quantity = 0;
      remaining -= rowQty;
    } else {
      row.quantity = rowQty - remaining;
      remaining = 0;
    }
  }

  return {
    ok: remaining === 0,
    entries: working.filter((row) => {
      const qty = Number.isFinite(row.quantity) ? Math.floor(row.quantity) : 1;
      return qty > 0;
    })
  };
}

function countInEntries(entries, itemId) {
  return (Array.isArray(entries) ? entries : [])
    .filter((row) => row.item_id === itemId)
    .reduce((sum, row) => {
      const qty = Number.isFinite(row.quantity) ? Math.floor(row.quantity) : 1;
      return sum + Math.max(0, qty);
    }, 0);
}

function addToEntries(entries, itemId, quantity) {
  const working = clone(Array.isArray(entries) ? entries : []);
  const existing = working.find((row) => row.item_id === itemId);
  if (existing) {
    existing.quantity = Math.floor(existing.quantity) + quantity;
    return working;
  }
  working.push({
    item_id: itemId,
    quantity
  });
  return working;
}

function resolveGuildAndPermission(data, actionName) {
  const guildManager = data.guildManager;
  const guild_id = data.guild_id;
  const acting_player_id = String(data.acting_player_id || "");
  if (!guildManager) return { error: createFailure(actionName, "guild_manager_required") };
  if (!guild_id) return { error: createFailure(actionName, "guild_id_required") };
  if (!acting_player_id) return { error: createFailure(actionName, "acting_player_id_required") };

  const guild = guildManager.getGuild(guild_id);
  if (!guild) return { error: createFailure(actionName, "guild_not_found") };
  if (!isMember(guild, acting_player_id)) {
    return { error: createFailure(actionName, "not_guild_member") };
  }
  return { guild, acting_player_id };
}

function depositItemToGuildStorage(input) {
  const data = input || {};
  const actionName = "guild_storage_deposit_failed";
  const resolved = resolveGuildAndPermission(data, actionName);
  if (resolved.error) return resolved.error;

  const guildStorageManager = data.guildStorageManager;
  const inventoryStore = data.inventoryStore;
  if (!guildStorageManager) return createFailure(actionName, "guild_storage_manager_required");
  if (!inventoryStore) return createFailure(actionName, "inventory_store_required");

  const guild = resolved.guild;
  const acting_player_id = resolved.acting_player_id;
  const item_id = String(data.item_id || "");
  const quantity = Math.floor(Number(data.quantity));

  if (!item_id) return createFailure(actionName, "item_id_required");
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return createFailure(actionName, "invalid_quantity", { quantity_requested: data.quantity });
  }

  const requireOfficerOrLeader = Boolean(data.require_officer_or_leader_for_deposit);
  if (requireOfficerOrLeader && !(isLeader(guild, acting_player_id) || isOfficer(guild, acting_player_id))) {
    return createFailure(actionName, "insufficient_permissions");
  }

  const inventory_id = data.inventory_id || `inv-${acting_player_id}`;
  const inventory = inventoryStore.loadInventory(inventory_id);
  if (!inventory) return createFailure(actionName, "inventory_not_found", { inventory_id });

  const ownedQty = countInEntries(inventory.item_entries, item_id);
  if (ownedQty < quantity) {
    return createFailure(actionName, "insufficient_quantity_in_inventory", {
      item_id,
      quantity_requested: quantity,
      quantity_owned: ownedQty
    });
  }

  const storageBefore = guildStorageManager.ensureGuildStorage(guild.guild_id);
  const inventoryBefore = clone(inventory);

  const removal = removeItemFromEntries(inventory.item_entries, item_id, quantity);
  if (!removal.ok) {
    return createFailure(actionName, "insufficient_quantity_in_inventory", {
      item_id,
      quantity_requested: quantity,
      quantity_owned: ownedQty
    });
  }

  try {
    inventoryStore.saveInventory({
      ...inventory,
      item_entries: removal.entries
    });
  } catch (error) {
    return createFailure(actionName, "inventory_write_failed", { message: error.message });
  }

  try {
    const nextStorage = {
      ...storageBefore,
      storage_items: addToEntries(storageBefore.storage_items, item_id, quantity),
      updated_at: new Date().toISOString()
    };
    guildStorageManager.saveGuildStorage(nextStorage);
  } catch (error) {
    // rollback player inventory if storage write fails
    try {
      inventoryStore.saveInventory(inventoryBefore);
    } catch (rollbackError) {
      return createFailure(actionName, "storage_write_failed_and_inventory_rollback_failed", {
        message: error.message,
        rollback_error: rollbackError.message
      });
    }
    return createFailure(actionName, "storage_write_failed", { message: error.message });
  }

  const storageAfter = guildStorageManager.getGuildStorage(guild.guild_id);
  return createSuccess("guild_storage_item_deposited", {
    guild_id: guild.guild_id,
    acting_player_id,
    item_id,
    quantity,
    inventory_id,
    storage_quantity_after: countInEntries(storageAfter.storage_items, item_id)
  });
}

function withdrawItemFromGuildStorage(input) {
  const data = input || {};
  const actionName = "guild_storage_withdraw_failed";
  const resolved = resolveGuildAndPermission(data, actionName);
  if (resolved.error) return resolved.error;

  const guildStorageManager = data.guildStorageManager;
  const inventoryStore = data.inventoryStore;
  if (!guildStorageManager) return createFailure(actionName, "guild_storage_manager_required");
  if (!inventoryStore) return createFailure(actionName, "inventory_store_required");

  const guild = resolved.guild;
  const acting_player_id = resolved.acting_player_id;
  const item_id = String(data.item_id || "");
  const quantity = Math.floor(Number(data.quantity));
  if (!item_id) return createFailure(actionName, "item_id_required");
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return createFailure(actionName, "invalid_quantity", { quantity_requested: data.quantity });
  }

  const withdrawalStore = data.processedWithdrawalStore || null;
  const withdrawalKey =
    data.withdrawal_key ||
    data.event_id ||
    `${guild.guild_id}:${acting_player_id}:${item_id}:${quantity}`;
  if (withdrawalStore && typeof withdrawalStore.has === "function") {
    if (withdrawalStore.has(withdrawalKey)) {
      return createSuccess("guild_storage_withdraw_skipped", {
        reason: "duplicate_withdrawal",
        withdrawal_key: withdrawalKey
      });
    }
  }

  const allowMemberWithdraw = Boolean(data.allow_member_withdrawal);
  const canWithdraw =
    allowMemberWithdraw || isLeader(guild, acting_player_id) || isOfficer(guild, acting_player_id);
  if (!canWithdraw) return createFailure(actionName, "insufficient_permissions");

  const storage = guildStorageManager.ensureGuildStorage(guild.guild_id);
  const available = countInEntries(storage.storage_items, item_id);
  if (available < quantity) {
    return createFailure(actionName, "insufficient_quantity_in_storage", {
      item_id,
      quantity_requested: quantity,
      quantity_available: available
    });
  }

  const storageBefore = clone(storage);
  const storageRemoval = removeItemFromEntries(storage.storage_items, item_id, quantity);
  if (!storageRemoval.ok) {
    return createFailure(actionName, "insufficient_quantity_in_storage", {
      item_id,
      quantity_requested: quantity,
      quantity_available: available
    });
  }

  try {
    guildStorageManager.saveGuildStorage({
      ...storage,
      storage_items: storageRemoval.entries,
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    return createFailure(actionName, "storage_write_failed", { message: error.message });
  }

  const inventory_id = data.inventory_id || `inv-${acting_player_id}`;
  const inventoryBefore = clone(
    inventoryStore.loadInventory(inventory_id) || {
      inventory_id,
      owner_character_id: acting_player_id,
      item_entries: []
    }
  );

  try {
    const nextEntries = addToEntries(inventoryBefore.item_entries, item_id, quantity).map((row, index) => ({
      entry_id: row.entry_id || `entry-${index}-${row.item_id}`,
      item_id: row.item_id,
      quantity: row.quantity,
      entry_type: row.entry_type || "stackable"
    }));

    inventoryStore.saveInventory({
      ...inventoryBefore,
      item_entries: nextEntries
    });
  } catch (error) {
    // rollback storage if inventory write fails
    try {
      guildStorageManager.saveGuildStorage(storageBefore);
    } catch (rollbackError) {
      return createFailure(actionName, "inventory_write_failed_and_storage_rollback_failed", {
        message: error.message,
        rollback_error: rollbackError.message
      });
    }
    return createFailure(actionName, "inventory_write_failed", { message: error.message });
  }

  if (withdrawalStore && typeof withdrawalStore.add === "function") {
    withdrawalStore.add(withdrawalKey);
  }

  const storageAfter = guildStorageManager.getGuildStorage(guild.guild_id);
  return createSuccess("guild_storage_item_withdrawn", {
    guild_id: guild.guild_id,
    acting_player_id,
    item_id,
    quantity,
    inventory_id,
    storage_quantity_after: countInEntries(storageAfter.storage_items, item_id),
    withdrawal_key: withdrawalKey
  });
}

function listGuildStorageContents(input) {
  const data = input || {};
  const actionName = "guild_storage_list_failed";
  const resolved = resolveGuildAndPermission(data, actionName);
  if (resolved.error) return resolved.error;

  if (!data.guildStorageManager) return createFailure(actionName, "guild_storage_manager_required");
  const storage = data.guildStorageManager.ensureGuildStorage(resolved.guild.guild_id);
  return createSuccess("guild_storage_listed", {
    guild_id: resolved.guild.guild_id,
    storage_items: clone(storage.storage_items || [])
  });
}

module.exports = {
  ProcessedGuildStorageWithdrawalStore,
  depositItemToGuildStorage,
  withdrawItemFromGuildStorage,
  listGuildStorageContents
};

