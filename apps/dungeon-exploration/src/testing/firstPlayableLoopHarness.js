"use strict";

const { DungeonSessionManagerCore } = require("../core/dungeonSessionManager");
const { createRoomObject } = require("../rooms/roomModel");
const { moveParty } = require("../flow/moveParty");
const { resolveRoomEntry } = require("../flow/resolveRoomEntry");
const { prepareRewardHook } = require("../flow/prepareRewardHook");
const { CharacterService } = require("../../../world-system/src/character/character.service");
const { CharacterRepository } = require("../../../world-system/src/character/character.repository");
const { updateCharacterProgress } = require("../../../world-system/src/character/flow/updateCharacterProgress");
const { toCombatParticipant } = require("../../../world-system/src/character/adapters/toCombatParticipant");
const { toDungeonPartyMember } = require("../../../world-system/src/character/adapters/toDungeonPartyMember");
const { createLootTableObject } = require("../../../world-system/src/loot/tables/lootTableModel");
const { consumeRewardHook } = require("../../../world-system/src/loot/flow/consumeRewardHook");
const { rollLoot } = require("../../../world-system/src/loot/flow/rollLoot");
const { grantLootToInventory } = require("../../../world-system/src/loot/flow/grantLootToInventory");

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

function runFirstPlayableLoopHarness(input) {
  const data = input || {};
  const sessionManager = new DungeonSessionManagerCore();
  const sessionPersistence = data.session_persistence || null;
  const characterService = data.character_service || new CharacterService();
  const characterRepository = data.character_repository || new CharacterRepository();
  const log = [];

  const requestedCharacterId = data.character_id || "character-loop-001";

  // Step 1: create or load a real character record.
  let characterRecord = null;
  let characterSource = "loaded";

  const loadedCharacter = characterRepository.loadCharacterById(requestedCharacterId);
  log.push({ step: "load_character", result: clone(loadedCharacter) });

  if (loadedCharacter.ok) {
    characterRecord = loadedCharacter.payload.character;
  } else {
    characterSource = "created";
    const createdCharacter = characterService.createCharacter({
      character_id: requestedCharacterId,
      player_id: data.player_id || "player-loop-001",
      name: data.character_name || "Loop Tester",
      race: data.race || "human",
      class: data.class || "fighter",
      background: data.background || "soldier",
      level: Number.isFinite(data.level) ? Math.max(1, Math.floor(Number(data.level))) : 1,
      xp: Number.isFinite(data.xp) ? Math.max(0, Math.floor(Number(data.xp))) : 0,
      inventory_id: data.inventory_id || "inventory-loop-001",
      armor_class: 12,
      current_hitpoints: 12,
      hitpoint_max: 12
    });
    log.push({ step: "create_character", result: clone(createdCharacter) });
    if (!createdCharacter.ok) {
      return failure("first_playable_loop_failed", "failed to create character", { log });
    }

    const savedCharacter = characterRepository.saveCharacter(createdCharacter.payload.character);
    log.push({ step: "save_character", result: clone(savedCharacter) });
    if (!savedCharacter.ok) {
      return failure("first_playable_loop_failed", "failed to save character", { log });
    }

    const reloadedCharacter = characterRepository.loadCharacterById(requestedCharacterId);
    log.push({ step: "reload_character", result: clone(reloadedCharacter) });
    if (!reloadedCharacter.ok) {
      return failure("first_playable_loop_failed", "failed to reload character", { log });
    }

    characterRecord = reloadedCharacter.payload.character;
  }

  // Ensure character service can update this character even when loaded from repository.
  const hydrateService = characterService.createCharacter(characterRecord);
  log.push({ step: "hydrate_character_service", result: clone(hydrateService) });
  if (!hydrateService.ok) {
    return failure("first_playable_loop_failed", "failed to hydrate character service", { log });
  }

  // Step 2: update progress fields (xp / level) for this loop run.
  const progressedCharacter = updateCharacterProgress({
    character_service: characterService,
    character_id: requestedCharacterId,
    xp_delta: Number.isFinite(data.xp_delta) ? Math.floor(Number(data.xp_delta)) : 100,
    level: Number.isFinite(data.level_after_progress)
      ? Math.max(1, Math.floor(Number(data.level_after_progress)))
      : Math.max(1, Number(characterRecord.level || 1))
  });
  log.push({ step: "update_character_progress", result: clone(progressedCharacter) });
  if (!progressedCharacter.ok) {
    return failure("first_playable_loop_failed", "failed to update character progress", { log });
  }

  characterRecord = progressedCharacter.payload.character;

  const savedProgressedCharacter = characterRepository.saveCharacter(characterRecord);
  log.push({ step: "save_progressed_character", result: clone(savedProgressedCharacter) });
  if (!savedProgressedCharacter.ok) {
    return failure("first_playable_loop_failed", "failed to save progressed character", { log });
  }

  // Step 3: adapt character into subsystem-specific shapes.
  const partyMemberOut = toDungeonPartyMember({
    character: characterRecord,
    player_id: characterRecord.player_id
  });
  log.push({ step: "to_dungeon_party_member", result: clone(partyMemberOut) });
  if (!partyMemberOut.ok) {
    return failure("first_playable_loop_failed", "failed to convert character to dungeon member", { log });
  }

  const combatParticipantOut = toCombatParticipant({
    character: characterRecord,
    team: data.team || "team_a"
  });
  log.push({ step: "to_combat_participant", result: clone(combatParticipantOut) });
  if (!combatParticipantOut.ok) {
    return failure("first_playable_loop_failed", "failed to convert character to combat participant", { log });
  }

  // Step 4: create or connect inventory.
  const inventory = {
    inventory_id: characterRecord.inventory_id || data.inventory_id || "inventory-loop-001",
    owner_player_id: partyMemberOut.payload.party_member.player_id,
    items: []
  };

  const sessionId = data.session_id || "session-loop-001";

  const createdSession = sessionManager.createSession({
    session_id: sessionId,
    dungeon_id: "dungeon-loop-001",
    status: "active"
  });
  log.push({ step: "create_session", result: clone(createdSession) });
  if (!createdSession.ok) {
    return failure("first_playable_loop_failed", "failed to create session", { log });
  }

  if (sessionPersistence && typeof sessionPersistence.saveSession === "function") {
    const persistedCreatedSession = sessionPersistence.saveSession(createdSession.payload.session);
    log.push({ step: "persist_session_after_create", result: clone(persistedCreatedSession) });
    if (!persistedCreatedSession.ok) {
      return failure("first_playable_loop_failed", "failed to persist created session", { log });
    }
  }

  const assignedParty = sessionManager.setParty({
    session_id: sessionId,
    party: {
      party_id: "party-loop-001",
      leader_id: partyMemberOut.payload.party_member.player_id,
      members: [partyMemberOut.payload.party_member.player_id]
    }
  });
  log.push({ step: "assign_party", result: clone(assignedParty) });
  if (!assignedParty.ok) {
    return failure("first_playable_loop_failed", "failed to assign party", { log });
  }

  const addedRooms = sessionManager.addMultipleRoomsToSession({
    session_id: sessionId,
    rooms: [
      createRoomObject({
        room_id: "room-L1",
        name: "Entrance",
        room_type: "empty",
        exits: [{ direction: "east", to_room_id: "room-L2" }]
      }),
      createRoomObject({
        room_id: "room-L2",
        name: "Goblin Cache",
        room_type: "encounter",
        encounter: {
          encounter_id: "enc-loop-001",
          encounter_type: "normal"
        },
        exits: [{ direction: "west", to_room_id: "room-L1" }]
      }),
      createRoomObject({
        room_id: "room-L3",
        name: "Quiet End",
        room_type: "rest",
        exits: []
      })
    ]
  });
  log.push({ step: "add_rooms", result: clone(addedRooms) });
  if (!addedRooms.ok) {
    return failure("first_playable_loop_failed", "failed to add rooms", { log });
  }

  const setStart = sessionManager.setStartRoom({
    session_id: sessionId,
    room_id: "room-L1"
  });
  log.push({ step: "set_start_room", result: clone(setStart) });
  if (!setStart.ok) {
    return failure("first_playable_loop_failed", "failed to set start room", { log });
  }

  const moved = moveParty({
    manager: sessionManager,
    session_id: sessionId,
    target_room_id: "room-L2"
  });
  log.push({ step: "move_party", result: clone(moved) });
  if (!moved.ok) {
    return failure("first_playable_loop_failed", "failed to move party", { log });
  }

  if (sessionPersistence && typeof sessionPersistence.saveSession === "function") {
    const latestForPersistence = sessionManager.getSessionById(sessionId);
    log.push({ step: "load_session_for_persist_after_move", result: clone(latestForPersistence) });
    if (!latestForPersistence.ok) {
      return failure("first_playable_loop_failed", "failed to fetch session for persistence", { log });
    }

    const persistedMovedSession = sessionPersistence.saveSession(latestForPersistence.payload.session);
    log.push({ step: "persist_session_after_move", result: clone(persistedMovedSession) });
    if (!persistedMovedSession.ok) {
      return failure("first_playable_loop_failed", "failed to persist moved session", { log });
    }
  }

  const roomEntry = resolveRoomEntry({
    manager: sessionManager,
    session_id: sessionId
  });
  log.push({ step: "resolve_room_entry", result: clone(roomEntry) });
  if (!roomEntry.ok) {
    return failure("first_playable_loop_failed", "failed to resolve room entry", { log });
  }

  const rewardPrepared = prepareRewardHook({
    manager: sessionManager,
    session_id: sessionId,
    reward_context: "encounter_clear"
  });
  log.push({ step: "prepare_reward_hook", result: clone(rewardPrepared) });
  if (!rewardPrepared.ok) {
    return failure("first_playable_loop_failed", "failed to prepare reward hook", { log });
  }

  const rewardHookPayload = {
    ...rewardPrepared.payload.reward_event.payload,
    target_player_id: partyMemberOut.payload.party_member.player_id,
    loot_table_id: "loot-table-loop-001"
  };

  const lootTable = createLootTableObject({
    loot_table_id: "loot-table-loop-001",
    name: "Loop Test Table",
    guaranteed_entries: [
      {
        item_id: "item-gold-coin",
        item_name: "Gold Coin",
        rarity: "common",
        quantity: 10
      }
    ],
    weighted_entries: [
      {
        item_id: "item-healing-potion",
        item_name: "Healing Potion",
        rarity: "common",
        weight: 100,
        quantity: 1
      }
    ]
  });

  const consumedReward = consumeRewardHook({
    reward_hook: rewardHookPayload,
    loot_table: lootTable
  });
  log.push({ step: "consume_reward_hook", result: clone(consumedReward) });
  if (!consumedReward.ok) {
    return failure("first_playable_loop_failed", "failed to consume reward hook", { log });
  }

  const rolledLoot = rollLoot({
    ...consumedReward.payload.next_step.roll_input,
    random_fn: () => 0
  });
  log.push({ step: "roll_loot", result: clone(rolledLoot) });
  if (!rolledLoot.ok) {
    return failure("first_playable_loop_failed", "failed to roll loot", { log });
  }

  const grantedLoot = grantLootToInventory({
    inventory,
    loot_bundle: rolledLoot.payload.loot_bundle
  });
  log.push({ step: "grant_loot", result: clone(grantedLoot) });
  if (!grantedLoot.ok) {
    return failure("first_playable_loop_failed", "failed to grant loot", { log });
  }

  let reloadedPersistedSession = null;
  if (sessionPersistence && typeof sessionPersistence.loadSessionById === "function") {
    const reloadedSession = sessionPersistence.loadSessionById(sessionId);
    log.push({ step: "reload_persisted_session", result: clone(reloadedSession) });
    if (!reloadedSession.ok) {
      return failure("first_playable_loop_failed", "failed to reload persisted session", { log });
    }
    reloadedPersistedSession = clone(reloadedSession.payload.session);
  }

  return success("first_playable_loop_completed", {
    character_source: characterSource,
    character_summary: {
      character_id: characterRecord.character_id,
      player_id: characterRecord.player_id,
      name: characterRecord.name,
      level: characterRecord.level,
      xp: characterRecord.xp,
      inventory_id: characterRecord.inventory_id
    },
    dungeon_party_member: clone(partyMemberOut.payload.party_member),
    combat_participant: clone(combatParticipantOut.payload.participant),
    final_inventory: clone(grantedLoot.payload.inventory),
    loot_grant_summary: clone(grantedLoot.payload.totals),
    persisted_session: reloadedPersistedSession,
    loop_steps: log
  });
}

if (require.main === module) {
  const out = runFirstPlayableLoopHarness();
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runFirstPlayableLoopHarness
};
