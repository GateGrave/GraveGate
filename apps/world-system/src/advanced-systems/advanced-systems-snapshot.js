"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function listFromManagerStore(manager, mapKey) {
  const store = manager?.store;
  if (!store) return [];

  if (typeof store.list === "function") {
    return clone(store.list());
  }

  const map = store[mapKey];
  if (map instanceof Map) {
    return Array.from(map.values()).map(clone);
  }

  return [];
}

function clearManagerStore(manager, mapKey) {
  const store = manager?.store;
  if (!store) return;

  const map = store[mapKey];
  if (map instanceof Map) {
    map.clear();
  }
}

function saveListToManagerStore(manager, list) {
  const store = manager?.store;
  if (!store || typeof store.save !== "function") return;

  for (const row of list) {
    store.save(clone(row));
  }
}

function createAdvancedSystemsSnapshot(input) {
  const data = input || {};
  const guildManager = data.guildManager;
  const guildStorageManager = data.guildStorageManager;
  const raidManager = data.raidManager;
  const worldEventManager = data.worldEventManager;
  const contractManager = data.contractManager;
  const hunterAssociationManager = data.hunterAssociationManager || null;
  const rankingManager = data.rankingManager || null;

  if (!guildManager || !guildStorageManager || !raidManager || !worldEventManager || !contractManager) {
    return {
      ok: false,
      event_type: "advanced_systems_snapshot_failed",
      payload: {
        reason: "guild_guild_storage_raid_world_event_and_contract_managers_required"
      }
    };
  }

  const guildState = listFromManagerStore(guildManager, "guilds");
  const guildStorageState = listFromManagerStore(guildStorageManager, "storages");
  const raidInstanceState = listFromManagerStore(raidManager, "raids");
  const worldEventState = listFromManagerStore(worldEventManager, "events");
  const contractState = listFromManagerStore(contractManager, "contracts");
  const hunterAssociationState = hunterAssociationManager
    ? listFromManagerStore(hunterAssociationManager, "associations")
    : [];
  const rankingState = rankingManager
    ? listFromManagerStore(rankingManager, "rankings")
    : [];

  return {
    ok: true,
    event_type: "advanced_systems_snapshot_created",
    payload: {
      snapshot_id: `advanced-snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      created_at: new Date().toISOString(),
      guild_state: guildState,
      guild_storage_state: guildStorageState,
      raid_instance_state: raidInstanceState,
      world_event_state: worldEventState,
      contract_state: contractState,
      hunter_association_state: hunterAssociationState,
      ranking_state: rankingState
    }
  };
}

function restoreAdvancedSystemsSnapshot(input) {
  const data = input || {};
  const snapshot = data.snapshot;
  const guildManager = data.guildManager;
  const guildStorageManager = data.guildStorageManager;
  const raidManager = data.raidManager;
  const worldEventManager = data.worldEventManager;
  const contractManager = data.contractManager;
  const hunterAssociationManager = data.hunterAssociationManager || null;
  const rankingManager = data.rankingManager || null;

  if (!snapshot || typeof snapshot !== "object") {
    return {
      ok: false,
      event_type: "advanced_systems_snapshot_restore_failed",
      payload: {
        reason: "snapshot_object_required"
      }
    };
  }

  const requiredKeys = [
    "guild_state",
    "guild_storage_state",
    "raid_instance_state",
    "world_event_state",
    "contract_state"
  ];
  const hasRequiredArrays = requiredKeys.every((key) => Array.isArray(snapshot[key]));
  if (!hasRequiredArrays) {
    return {
      ok: false,
      event_type: "advanced_systems_snapshot_restore_failed",
      payload: {
        reason: "snapshot_missing_required_arrays"
      }
    };
  }

  if (!guildManager || !guildStorageManager || !raidManager || !worldEventManager || !contractManager) {
    return {
      ok: false,
      event_type: "advanced_systems_snapshot_restore_failed",
      payload: {
        reason: "guild_guild_storage_raid_world_event_and_contract_managers_required"
      }
    };
  }

  clearManagerStore(guildManager, "guilds");
  clearManagerStore(guildStorageManager, "storages");
  clearManagerStore(raidManager, "raids");
  clearManagerStore(worldEventManager, "events");
  clearManagerStore(contractManager, "contracts");
  if (hunterAssociationManager) {
    clearManagerStore(hunterAssociationManager, "associations");
  }
  if (rankingManager) {
    clearManagerStore(rankingManager, "rankings");
  }

  saveListToManagerStore(guildManager, snapshot.guild_state);
  saveListToManagerStore(guildStorageManager, snapshot.guild_storage_state);
  saveListToManagerStore(raidManager, snapshot.raid_instance_state);
  saveListToManagerStore(worldEventManager, snapshot.world_event_state);
  saveListToManagerStore(contractManager, snapshot.contract_state);
  if (hunterAssociationManager && Array.isArray(snapshot.hunter_association_state)) {
    saveListToManagerStore(hunterAssociationManager, snapshot.hunter_association_state);
  }
  if (rankingManager && Array.isArray(snapshot.ranking_state)) {
    saveListToManagerStore(rankingManager, snapshot.ranking_state);
  }

  return {
    ok: true,
    event_type: "advanced_systems_snapshot_restored",
    payload: {
      restored_at: new Date().toISOString(),
      counts: {
        guild_state: snapshot.guild_state.length,
        guild_storage_state: snapshot.guild_storage_state.length,
        raid_instance_state: snapshot.raid_instance_state.length,
        world_event_state: snapshot.world_event_state.length,
        contract_state: snapshot.contract_state.length,
        hunter_association_state: Array.isArray(snapshot.hunter_association_state)
          ? snapshot.hunter_association_state.length
          : 0,
        ranking_state: Array.isArray(snapshot.ranking_state)
          ? snapshot.ranking_state.length
          : 0
      }
    }
  };
}

module.exports = {
  createAdvancedSystemsSnapshot,
  restoreAdvancedSystemsSnapshot
};
