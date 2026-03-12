"use strict";

const { loadMonsterContent, loadStarterContentBundle } = require("../content");
const { readRankingBoard } = require("../ranking");
const { addItemToInventory } = require("../../../inventory-system/src/mutationHelpers");

const XP_THRESHOLDS = [
  { level: 1, min_xp: 0 },
  { level: 2, min_xp: 300 },
  { level: 3, min_xp: 900 },
  { level: 4, min_xp: 2700 },
  { level: 5, min_xp: 6500 },
  { level: 6, min_xp: 14000 },
  { level: 7, min_xp: 23000 },
  { level: 8, min_xp: 34000 },
  { level: 9, min_xp: 48000 },
  { level: 10, min_xp: 64000 },
  { level: 11, min_xp: 85000 },
  { level: 12, min_xp: 100000 },
  { level: 13, min_xp: 120000 },
  { level: 14, min_xp: 140000 },
  { level: 15, min_xp: 165000 },
  { level: 16, min_xp: 195000 },
  { level: 17, min_xp: 225000 },
  { level: 18, min_xp: 265000 },
  { level: 19, min_xp: 305000 },
  { level: 20, min_xp: 355000 }
];

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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const MUTATING_ADMIN_ACTIONS = new Set([
  "grant_item",
  "grant_xp",
  "set_active_character",
  "reset_session",
  "set_reward_multiplier",
  "activate_world_event",
  "deactivate_world_event",
  "refresh_content",
  "spawn_monster"
]);

function getAdminMutationReplayStore(context) {
  if (context.adminMutationReplayStore && typeof context.adminMutationReplayStore.has === "function" && typeof context.adminMutationReplayStore.add === "function") {
    return context.adminMutationReplayStore;
  }

  const seen = new Set();
  const order = [];
  context.adminMutationReplayStore = {
    has(replayKey) {
      return seen.has(String(replayKey || ""));
    },
    add(replayKey) {
      const key = String(replayKey || "");
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      order.push(key);
      if (order.length > 1000) {
        const expired = order.shift();
        seen.delete(expired);
      }
    }
  };
  return context.adminMutationReplayStore;
}

function resolveAdminReplayKey(playerId, action, payload) {
  if (!isPlainObject(payload)) {
    return null;
  }
  const provided = payload.request_id || payload.action_id || payload.idempotency_key || null;
  if (!provided) {
    return null;
  }
  const normalized = String(provided).trim();
  if (!normalized) {
    return null;
  }
  return String(playerId) + ":" + String(action) + ":" + normalized;
}

function getLevelForXp(xp) {
  const safeXp = Math.max(0, Math.floor(Number(xp || 0)));
  let level = 1;
  for (let i = 0; i < XP_THRESHOLDS.length; i += 1) {
    if (safeXp >= XP_THRESHOLDS[i].min_xp) {
      level = XP_THRESHOLDS[i].level;
    }
  }
  return level;
}

function getProficiencyBonus(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level || 1)));
  return 2 + Math.floor((safeLevel - 1) / 4);
}

function loadAccountByDiscordUserId(context, discordUserId) {
  if (!context.accountService || typeof context.accountService.getAccountByDiscordUserId !== "function") {
    return failure("admin_action_failed", "accountService is required");
  }
  return context.accountService.getAccountByDiscordUserId(discordUserId);
}

function isAuthorizedAdmin(context, playerId) {
  const accessControl = context.adminAccessControl;
  if (!accessControl || typeof accessControl.isAdminPlayerId !== "function") {
    return false;
  }
  return Boolean(accessControl.isAdminPlayerId(playerId));
}

function listAccountCharacters(context, accountId) {
  if (!context.accountService || typeof context.accountService.listCharactersForAccount !== "function") {
    return failure("admin_action_failed", "accountService listCharactersForAccount is required");
  }
  return context.accountService.listCharactersForAccount(accountId);
}

function resolveOwnedCharacter(context, account, payload) {
  const listOut = listAccountCharacters(context, account.account_id);
  if (!listOut.ok) {
    return failure("admin_action_failed", listOut.error || "failed listing account characters");
  }

  const characters = Array.isArray(listOut.payload.characters) ? listOut.payload.characters : [];
  const requestedCharacterId = payload && payload.character_id ? String(payload.character_id) : "";
  if (requestedCharacterId) {
    const found = characters.find((entry) => String(entry.character_id || "") === requestedCharacterId);
    if (!found) {
      return failure("admin_action_failed", "character is not owned by account", {
        account_id: String(account.account_id),
        character_id: requestedCharacterId
      });
    }
    return success("admin_character_resolved", {
      character: clone(found),
      characters: clone(characters)
    });
  }

  const activeCharacterId = account.active_character_id ? String(account.active_character_id) : "";
  if (!activeCharacterId) {
    return failure("admin_action_failed", "account has no active character");
  }

  const active = characters.find((entry) => String(entry.character_id || "") === activeCharacterId);
  if (!active) {
    return failure("admin_action_failed", "active character is not owned by account", {
      account_id: String(account.account_id),
      active_character_id: activeCharacterId
    });
  }

  return success("admin_character_resolved", {
    character: clone(active),
    characters: clone(characters)
  });
}

function inspectAccountCharacter(context, payload, account) {
  const activeOut = resolveOwnedCharacter(context, account, payload || {});
  if (!activeOut.ok) {
    return activeOut;
  }

  const character = activeOut.payload.character;
  const inventoryId = character.inventory_id ? String(character.inventory_id) : "";
  let inventorySummary = null;

  if (inventoryId && context.inventoryPersistence && typeof context.inventoryPersistence.loadInventoryById === "function") {
    const inventoryOut = context.inventoryPersistence.loadInventoryById(inventoryId);
    if (inventoryOut.ok) {
      const inventory = inventoryOut.payload.inventory;
      inventorySummary = {
        inventory_id: inventory.inventory_id || null,
        owner_id: inventory.owner_id || null,
        stackable_count: Array.isArray(inventory.stackable_items) ? inventory.stackable_items.length : 0,
        equipment_count: Array.isArray(inventory.equipment_items) ? inventory.equipment_items.length : 0,
        quest_count: Array.isArray(inventory.quest_items) ? inventory.quest_items.length : 0
      };
    }
  }

  return success("admin_inspect_account_character_succeeded", {
    account: clone(account),
    character: clone(character),
    inventory_summary: inventorySummary,
    character_count: activeOut.payload.characters.length
  });
}

function grantItem(context, payload, account) {
  const characterOut = resolveOwnedCharacter(context, account, payload || {});
  if (!characterOut.ok) {
    return characterOut;
  }

  const character = characterOut.payload.character;
  if (!payload.item_id || String(payload.item_id).trim() === "") {
    return failure("admin_action_failed", "grant_item requires item_id");
  }

  const inventoryId = character.inventory_id ? String(character.inventory_id) : "";
  if (!inventoryId) {
    return failure("admin_action_failed", "character has no linked inventory_id", {
      character_id: String(character.character_id)
    });
  }

  const inventoryOut = context.inventoryPersistence.loadInventoryById(inventoryId);
  if (!inventoryOut.ok) {
    return failure("admin_action_failed", inventoryOut.error || "failed to load inventory", {
      inventory_id: inventoryId
    });
  }

  const quantity = Number.isFinite(payload.quantity) ? Math.max(1, Math.floor(Number(payload.quantity))) : 1;
  const mutateOut = addItemToInventory(inventoryOut.payload.inventory, {
    item_id: String(payload.item_id),
    item_name: String(payload.item_id),
    item_type: "stackable",
    stackable: true,
    quantity,
    owner_player_id: String(account.discord_user_id)
  });
  if (!mutateOut.ok) {
    return failure("admin_action_failed", mutateOut.error || "failed to apply item grant");
  }

  const saveOut = context.inventoryPersistence.saveInventory(mutateOut.payload.inventory);
  if (!saveOut.ok) {
    return failure("admin_action_failed", saveOut.error || "failed to persist granted item inventory");
  }

  return success("admin_grant_item_succeeded", {
    character_id: String(character.character_id),
    inventory_id: inventoryId,
    item_id: String(payload.item_id),
    quantity,
    inventory: clone(saveOut.payload.inventory)
  });
}

function grantXp(context, payload, account) {
  const characterOut = resolveOwnedCharacter(context, account, payload || {});
  if (!characterOut.ok) {
    return characterOut;
  }

  const character = characterOut.payload.character;
  const xpDelta = Number.isFinite(payload.xp_delta) ? Math.floor(Number(payload.xp_delta)) : NaN;
  if (!Number.isFinite(xpDelta) || xpDelta === 0) {
    return failure("admin_action_failed", "grant_xp requires non-zero xp_delta");
  }

  const previousXp = Number.isFinite(character.xp) ? Math.floor(Number(character.xp)) : 0;
  const previousLevel = Number.isFinite(character.level) ? Math.floor(Number(character.level)) : 1;
  let nextXp = previousXp + xpDelta;
  if (nextXp < 0) {
    nextXp = 0;
  }
  const nextLevel = getLevelForXp(nextXp);

  const updated = {
    ...character,
    xp: nextXp,
    level: nextLevel,
    proficiency_bonus: getProficiencyBonus(nextLevel),
    updated_at: new Date().toISOString()
  };

  const saveOut = context.characterPersistence.saveCharacter(updated);
  if (!saveOut.ok) {
    return failure("admin_action_failed", saveOut.error || "failed to persist xp grant");
  }

  return success("admin_grant_xp_succeeded", {
    character_id: String(character.character_id),
    previous_xp: previousXp,
    current_xp: nextXp,
    previous_level: previousLevel,
    current_level: nextLevel
  });
}

function setActiveCharacter(context, payload, account) {
  const characterId = payload && payload.character_id ? String(payload.character_id) : "";
  if (!characterId) {
    return failure("admin_action_failed", "set_active_character requires character_id");
  }

  const setOut = context.accountService.setActiveCharacter(String(account.account_id), characterId);
  if (!setOut.ok) {
    return failure("admin_action_failed", setOut.error || "failed to set active character", {
      account_id: String(account.account_id),
      character_id: characterId
    });
  }

  return success("admin_set_active_character_succeeded", {
    account: clone(setOut.payload.account),
    active_character_id: String(setOut.payload.active_character_id || characterId)
  });
}

function findSessionForInspect(context, payload, playerId) {
  if (!context.sessionPersistence || typeof context.sessionPersistence.listSessions !== "function") {
    return failure("admin_action_failed", "sessionPersistence is required");
  }

  const listed = context.sessionPersistence.listSessions();
  if (!listed.ok) {
    return failure("admin_action_failed", listed.error || "failed to list sessions");
  }
  const sessions = Array.isArray(listed.payload.sessions) ? listed.payload.sessions : [];
  const requestedSessionId = payload && payload.session_id ? String(payload.session_id) : "";
  let found = null;

  if (requestedSessionId) {
    found = sessions.find((entry) => String(entry.session_id || "") === requestedSessionId) || null;
  } else {
    found = sessions.find((entry) => {
      const leaderId = entry && entry.party && entry.party.leader_id ? String(entry.party.leader_id) : "";
      return leaderId === String(playerId);
    }) || null;
  }

  if (!found) {
    return failure("admin_action_failed", "session not found", {
      session_id: requestedSessionId || null
    });
  }

  return success("admin_session_found", {
    session: clone(found)
  });
}

function inspectSession(context, payload, playerId) {
  const found = findSessionForInspect(context, payload, playerId);
  if (!found.ok) {
    return found;
  }

  const session = found.payload.session;
  return success("admin_inspect_session_succeeded", {
    session_summary: {
      session_id: session.session_id || null,
      dungeon_id: session.dungeon_id || null,
      status: session.status || null,
      current_room_id: session.current_room_id || null,
      party_id: session.party && session.party.party_id ? session.party.party_id : null
    },
    session
  });
}

function resetSession(context, payload, playerId) {
  const found = findSessionForInspect(context, payload, playerId);
  if (!found.ok) {
    return found;
  }

  const session = found.payload.session;
  const deleteOut = context.sessionPersistence.deleteSession(String(session.session_id));
  if (!deleteOut.ok) {
    return failure("admin_action_failed", deleteOut.error || "failed to delete session");
  }

  if (context.sessionManager && context.sessionManager.sessions && typeof context.sessionManager.sessions.delete === "function") {
    context.sessionManager.sessions.delete(String(session.session_id));
  }

  return success("admin_reset_session_succeeded", {
    session_id: String(session.session_id),
    deleted: Boolean(deleteOut.payload.deleted)
  });
}

function inspectCombat(context, payload) {
  const combatId = payload && payload.combat_id ? String(payload.combat_id) : "";
  if (!combatId) {
    return failure("admin_action_failed", "inspect_combat requires combat_id");
  }

  let combat = null;
  if (context.combatManager && typeof context.combatManager.getCombatById === "function") {
    const out = context.combatManager.getCombatById(combatId);
    if (out.ok) {
      combat = out.payload.combat;
    }
  }

  let snapshots = [];
  if (context.combatPersistence && typeof context.combatPersistence.listCombatSnapshots === "function") {
    const listed = context.combatPersistence.listCombatSnapshots();
    if (listed.ok) {
      const all = Array.isArray(listed.payload.snapshots) ? listed.payload.snapshots : [];
      snapshots = all.filter((entry) => String(entry.combat_id || "") === combatId);
    }
  }

  if (!combat && snapshots.length === 0) {
    return failure("admin_action_failed", "combat not found", { combat_id: combatId });
  }

  return success("admin_inspect_combat_succeeded", {
    combat_id: combatId,
    combat_state: combat ? clone(combat) : null,
    snapshot_count: snapshots.length,
    latest_snapshot: snapshots.length > 0 ? clone(snapshots[snapshots.length - 1]) : null
  });
}

function inspectInventory(context, payload) {
  const inventoryId = payload && payload.inventory_id ? String(payload.inventory_id) : "";
  if (!inventoryId) {
    return failure("admin_action_failed", "inspect_inventory requires inventory_id");
  }
  if (!context.inventoryPersistence || typeof context.inventoryPersistence.loadInventoryById !== "function") {
    return failure("admin_action_failed", "inventoryPersistence is required");
  }

  const loaded = context.inventoryPersistence.loadInventoryById(inventoryId);
  if (!loaded.ok) {
    return failure("admin_action_failed", loaded.error || "inventory not found", {
      inventory_id: inventoryId
    });
  }

  const inventory = loaded.payload.inventory;
  return success("admin_inspect_inventory_succeeded", {
    inventory: clone(inventory),
    inventory_summary: {
      inventory_id: inventory.inventory_id || null,
      owner_id: inventory.owner_id || null,
      owner_type: inventory.owner_type || null,
      stackable_count: Array.isArray(inventory.stackable_items) ? inventory.stackable_items.length : 0,
      equipment_count: Array.isArray(inventory.equipment_items) ? inventory.equipment_items.length : 0,
      quest_count: Array.isArray(inventory.quest_items) ? inventory.quest_items.length : 0,
      currency: clone(inventory.currency || {})
    }
  });
}

function inspectParty(context, payload) {
  const partyId = payload && payload.party_id ? String(payload.party_id) : "";
  if (!partyId) {
    return failure("admin_action_failed", "inspect_party requires party_id");
  }
  if (!context.partyPersistence || typeof context.partyPersistence.loadPartyById !== "function") {
    return failure("admin_action_failed", "partyPersistence is required");
  }

  const loaded = context.partyPersistence.loadPartyById(partyId);
  if (!loaded.ok) {
    return failure("admin_action_failed", loaded.error || "party not found", {
      party_id: partyId
    });
  }

  return success("admin_inspect_party_succeeded", {
    party: clone(loaded.payload.party),
    member_count: Array.isArray(loaded.payload.party.member_player_ids)
      ? loaded.payload.party.member_player_ids.length
      : 0
  });
}

function inspectGuild(context, payload) {
  const guildId = payload && payload.guild_id ? String(payload.guild_id) : "";
  if (!guildId) {
    return failure("admin_action_failed", "inspect_guild requires guild_id");
  }
  if (!context.guildManager || typeof context.guildManager.getGuild !== "function") {
    return failure("admin_action_failed", "guildManager is required");
  }

  const guild = context.guildManager.getGuild(guildId);
  if (!guild) {
    return failure("admin_action_failed", "guild not found", {
      guild_id: guildId
    });
  }

  return success("admin_inspect_guild_succeeded", {
    guild: clone(guild),
    member_count: Array.isArray(guild.member_ids) ? guild.member_ids.length : 0
  });
}

function inspectWorldEvent(context, payload) {
  const eventId = payload && payload.world_event_id ? String(payload.world_event_id) : "";
  if (!eventId) {
    return failure("admin_action_failed", "inspect_world_event requires world_event_id");
  }
  if (!context.worldEventManager || typeof context.worldEventManager.getWorldEvent !== "function") {
    return failure("admin_action_failed", "worldEventManager is required");
  }

  const event = context.worldEventManager.getWorldEvent(eventId);
  if (!event) {
    return failure("admin_action_failed", "world event not found", {
      world_event_id: eventId
    });
  }

  return success("admin_inspect_world_event_succeeded", {
    world_event: clone(event)
  });
}

function inspectRankings(payload) {
  const rankingType = payload && payload.ranking_type ? String(payload.ranking_type) : "";
  const limit = Number.isFinite(payload && payload.limit) ? Number(payload.limit) : 10;
  if (!rankingType) {
    return failure("admin_action_failed", "inspect_rankings requires ranking_type");
  }

  const board = readRankingBoard({
    ranking_type: rankingType,
    limit
  });
  if (!board.ok) {
    return failure("admin_action_failed", board.error || "failed to read rankings", {
      ranking_type: rankingType
    });
  }

  return success("admin_inspect_rankings_succeeded", {
    ranking_type: rankingType,
    rankings: clone(board.payload.rankings || [])
  });
}

function getAdminTuningStore(context) {
  if (!context.adminTuningStore || typeof context.adminTuningStore !== "object") {
    context.adminTuningStore = {
      reward_multiplier: 1
    };
  }
  return context.adminTuningStore;
}

function inspectTuning(context) {
  return success("admin_inspect_tuning_succeeded", {
    tuning: clone(getAdminTuningStore(context))
  });
}

function setRewardMultiplier(context, payload) {
  const multiplier = Number(payload && payload.reward_multiplier);
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 100) {
    return failure("admin_action_failed", "set_reward_multiplier requires reward_multiplier between 0 and 100");
  }
  const store = getAdminTuningStore(context);
  store.reward_multiplier = multiplier;
  return success("admin_set_reward_multiplier_succeeded", {
    tuning: clone(store)
  });
}

function inspectWorldSummary(context) {
  let sessionCount = null;
  let combatCount = null;
  let activeWorldEventCount = null;

  if (context.sessionPersistence && typeof context.sessionPersistence.listSessions === "function") {
    const sessions = context.sessionPersistence.listSessions();
    if (sessions.ok) {
      const rows = Array.isArray(sessions.payload.sessions) ? sessions.payload.sessions : [];
      sessionCount = rows.length;
    }
  }

  if (context.combatPersistence && typeof context.combatPersistence.listCombatSnapshots === "function") {
    const combats = context.combatPersistence.listCombatSnapshots();
    if (combats.ok) {
      const rows = Array.isArray(combats.payload.snapshots) ? combats.payload.snapshots : [];
      combatCount = rows.length;
    }
  }

  if (context.worldEventManager && typeof context.worldEventManager.listActiveWorldEvents === "function") {
    const active = context.worldEventManager.listActiveWorldEvents();
    activeWorldEventCount = Array.isArray(active) ? active.length : 0;
  }

  return success("admin_inspect_world_summary_succeeded", {
    sessions: { active_count: sessionCount },
    combats: { snapshot_count: combatCount },
    world_events: { active_count: activeWorldEventCount }
  });
}

function activateWorldEvent(context, payload) {
  const eventId = payload && payload.world_event_id ? String(payload.world_event_id) : "";
  if (!eventId) {
    return failure("admin_action_failed", "activate_world_event requires world_event_id");
  }
  if (!context.worldEventManager || typeof context.worldEventManager.updateWorldEvent !== "function") {
    return failure("admin_action_failed", "worldEventManager is required");
  }

  const updated = context.worldEventManager.updateWorldEvent(eventId, {
    active_flag: true,
    event_state: {
      status: "active"
    }
  });
  if (!updated) {
    return failure("admin_action_failed", "world event not found", {
      world_event_id: eventId
    });
  }

  return success("admin_activate_world_event_succeeded", {
    world_event: clone(updated)
  });
}

function deactivateWorldEvent(context, payload) {
  const eventId = payload && payload.world_event_id ? String(payload.world_event_id) : "";
  if (!eventId) {
    return failure("admin_action_failed", "deactivate_world_event requires world_event_id");
  }
  if (!context.worldEventManager || typeof context.worldEventManager.closeWorldEvent !== "function") {
    return failure("admin_action_failed", "worldEventManager is required");
  }

  const closed = context.worldEventManager.closeWorldEvent(eventId, { status: "admin_closed" });
  if (!closed) {
    return failure("admin_action_failed", "world event not found", {
      world_event_id: eventId
    });
  }

  return success("admin_deactivate_world_event_succeeded", {
    world_event: clone(closed)
  });
}

function refreshContent(context) {
  const loader = typeof context.loadContentBundle === "function" ? context.loadContentBundle : loadStarterContentBundle;
  const loaded = loader();
  if (!loaded || loaded.ok !== true) {
    return failure("admin_action_failed", loaded && loaded.error ? loaded.error : "content refresh failed");
  }

  const bundle = loaded.payload && loaded.payload.bundle ? loaded.payload.bundle : {};
  const summary = Object.keys(bundle).reduce((acc, key) => {
    const rows = Array.isArray(bundle[key]) ? bundle[key] : [];
    acc[key] = rows.length;
    return acc;
  }, {});

  return success("admin_content_refresh_succeeded", {
    content_summary: summary
  });
}

function spawnMonster(context, payload) {
  const combatId = payload && payload.combat_id ? String(payload.combat_id) : "";
  const monsterId = payload && payload.monster_id ? String(payload.monster_id) : "";
  if (!combatId || !monsterId) {
    return failure("admin_action_failed", "spawn_monster requires combat_id and monster_id");
  }
  if (!context.combatManager || typeof context.combatManager.addParticipant !== "function") {
    return failure("admin_action_failed", "combatManager is required");
  }
  if (typeof context.combatManager.getCombatById !== "function") {
    return failure("admin_action_failed", "combatManager.getCombatById is required");
  }

  const loadedCombat = context.combatManager.getCombatById(combatId);
  if (!loadedCombat.ok) {
    return failure("admin_action_failed", loadedCombat.error || "combat not found", {
      combat_id: combatId
    });
  }
  const combatState = loadedCombat.payload && loadedCombat.payload.combat ? loadedCombat.payload.combat : {};
  const combatStatus = combatState.status ? String(combatState.status) : "";
  if (combatStatus && combatStatus !== "pending" && combatStatus !== "active") {
    return failure("admin_action_failed", "combat is not mutable", {
      combat_id: combatId,
      combat_status: combatStatus
    });
  }

  const contentOut = loadMonsterContent();
  if (!contentOut.ok) {
    return failure("admin_action_failed", contentOut.error || "failed to load monster content");
  }
  const monster = contentOut.payload.entries.find((entry) => String(entry.monster_id || "") === monsterId);
  if (!monster) {
    return failure("admin_action_failed", "monster_id not found in content", { monster_id: monsterId });
  }

  const participantId = "monster-" + monsterId + "-" + String(Date.now());
  const addOut = context.combatManager.addParticipant({
    combat_id: combatId,
    participant: {
      participant_id: participantId,
      name: String(monster.name || monsterId),
      team: "monsters",
      armor_class: Number(monster.armor_class || 10),
      current_hp: Number(monster.max_hp || 1),
      max_hp: Number(monster.max_hp || 1),
      attack_bonus: Number(monster.attack_bonus || 0),
      damage: Number(monster.damage || 1),
      position: { x: 0, y: 0 },
      metadata: {
        monster_id: monsterId
      }
    }
  });
  if (!addOut.ok) {
    return failure("admin_action_failed", addOut.error || "failed to spawn monster", {
      combat_id: combatId,
      monster_id: monsterId
    });
  }

  if (context.combatPersistence && typeof context.combatManager.getCombatById === "function") {
    const combatOut = context.combatManager.getCombatById(combatId);
    if (combatOut.ok && typeof context.combatPersistence.saveCombatSnapshot === "function") {
      const saveSnapshot = context.combatPersistence.saveCombatSnapshot({
        combat_state: combatOut.payload.combat
      });
      if (!saveSnapshot.ok) {
        if (typeof context.combatManager.removeParticipant === "function") {
          context.combatManager.removeParticipant({
            combat_id: combatId,
            participant_id: participantId
          });
        }
        return failure("admin_action_failed", saveSnapshot.error || "spawned but failed to persist combat snapshot");
      }
    }
  }

  return success("admin_spawn_monster_succeeded", {
    combat_id: combatId,
    monster_id: monsterId,
    participant_id: participantId
  });
}

function processAdminActionRequest(input) {
  const data = input || {};
  const event = data.event || {};
  const context = data.context || {};
  const payload = event.payload;
  const action = payload.action ? String(payload.action) : "";
  const playerId = event.player_id ? String(event.player_id) : "";

  if (!playerId) {
    return failure("admin_action_failed", "player_id is required");
  }
  if (!isPlainObject(payload)) {
    return failure("admin_action_failed", "admin payload must be an object");
  }
  if (!action) {
    return failure("admin_action_failed", "admin action is required");
  }
  if (!isAuthorizedAdmin(context, playerId)) {
    return failure("admin_action_failed", "unauthorized admin action", {
      player_id: playerId,
      action
    });
  }

  const accountOut = loadAccountByDiscordUserId(context, playerId);
  if (!accountOut.ok) {
    return failure("admin_action_failed", accountOut.error || "failed to resolve account", {
      player_id: playerId
    });
  }
  const account = accountOut.payload.account;
  const replayKey = MUTATING_ADMIN_ACTIONS.has(action) ? resolveAdminReplayKey(playerId, action, payload) : null;
  if (replayKey) {
    const replayStore = getAdminMutationReplayStore(context);
    if (replayStore.has(replayKey)) {
      return failure("admin_action_failed", "duplicate admin action request", {
        player_id: playerId,
        action,
        request_id: payload.request_id || payload.action_id || payload.idempotency_key || null
      });
    }
  }

  let out = null;

  if (action === "inspect_account_character") {
    out = inspectAccountCharacter(context, payload, account);
  }
  if (!out && action === "grant_item") {
    out = grantItem(context, payload, account);
  }
  if (!out && action === "grant_xp") {
    out = grantXp(context, payload, account);
  }
  if (!out && action === "set_active_character") {
    out = setActiveCharacter(context, payload, account);
  }
  if (!out && action === "inspect_session") {
    out = inspectSession(context, payload, playerId);
  }
  if (!out && action === "reset_session") {
    out = resetSession(context, payload, playerId);
  }
  if (!out && action === "inspect_combat") {
    out = inspectCombat(context, payload);
  }
  if (!out && action === "inspect_inventory") {
    out = inspectInventory(context, payload);
  }
  if (!out && action === "inspect_party") {
    out = inspectParty(context, payload);
  }
  if (!out && action === "inspect_guild") {
    out = inspectGuild(context, payload);
  }
  if (!out && action === "inspect_world_event") {
    out = inspectWorldEvent(context, payload);
  }
  if (!out && action === "inspect_rankings") {
    out = inspectRankings(payload);
  }
  if (!out && action === "inspect_tuning") {
    out = inspectTuning(context);
  }
  if (!out && action === "set_reward_multiplier") {
    out = setRewardMultiplier(context, payload);
  }
  if (!out && action === "inspect_world_summary") {
    out = inspectWorldSummary(context);
  }
  if (!out && action === "activate_world_event") {
    out = activateWorldEvent(context, payload);
  }
  if (!out && action === "deactivate_world_event") {
    out = deactivateWorldEvent(context, payload);
  }
  if (!out && action === "refresh_content") {
    out = refreshContent(context);
  }
  if (!out && action === "spawn_monster") {
    out = spawnMonster(context, payload);
  }
  if (!out) {
    out = failure("admin_action_failed", "unsupported admin action", {
      action
    });
  }

  if (out.ok && replayKey) {
    getAdminMutationReplayStore(context).add(replayKey);
  }

  return out;
}

module.exports = {
  processAdminActionRequest
};
