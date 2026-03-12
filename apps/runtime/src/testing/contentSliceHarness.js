"use strict";

const { mapSlashCommandToGatewayEvent } = require("../../../gateway/src/discord/commandEventMapper");
const { createReadCommandRuntime } = require("../readCommandRuntime");
const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { CharacterPersistenceBridge } = require("../../../world-system/src/character/character.persistence");
const { InventoryPersistenceBridge } = require("../../../inventory-system/src/inventory.persistence");
const { SessionPersistenceBridge } = require("../../../dungeon-exploration/src/session.persistence");
const { CombatPersistenceBridge } = require("../../../combat-system/src/combat.persistence");
const { DungeonSessionManagerCore } = require("../../../dungeon-exploration/src/core/dungeonSessionManager");
const { createRoomObject } = require("../../../dungeon-exploration/src/rooms/roomModel");
const { CombatManager } = require("../../../combat-system/src/core/combatManager");
const { startCombat } = require("../../../combat-system/src/flow/startCombat");
const { processSessionCombatReturnRequest } = require("../../../dungeon-exploration/src/flow/processActiveSessionAction");
const { createLootTableObject } = require("../../../world-system/src/loot/tables/lootTableModel");
const { prepareRewardHook } = require("../../../dungeon-exploration/src/flow/prepareRewardHook");
const { consumeRewardHook } = require("../../../world-system/src/loot/flow/consumeRewardHook");
const { rollLoot } = require("../../../world-system/src/loot/flow/rollLoot");
const { grantLootToInventory } = require("../../../world-system/src/loot/flow/grantLootToInventory");
const { loadStarterContentBundle } = require("../../../world-system/src/content");
const { toCombatParticipant } = require("../../../world-system/src/character/adapters/toCombatParticipant");

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

function createInteraction(commandName, optionsData, playerId) {
  return {
    commandName,
    user: { id: playerId },
    guildId: "guild-content-slice-001",
    channelId: "channel-content-slice-001",
    options: {
      data: Array.isArray(optionsData) ? optionsData : []
    }
  };
}

function mapInteractionOrFailure(interaction) {
  const mapped = mapSlashCommandToGatewayEvent(interaction);
  if (!mapped.ok) {
    return failure("content_slice_command_map_failed", mapped.error || "failed to map slash interaction", {
      interaction
    });
  }
  return success("content_slice_command_mapped", {
    event: mapped.payload.event
  });
}

function findResponseByType(runtimeOut, responseType) {
  const responses = runtimeOut && runtimeOut.payload && Array.isArray(runtimeOut.payload.responses)
    ? runtimeOut.payload.responses
    : [];
  return responses.find((entry) => {
    return entry && entry.payload && entry.payload.response_type === responseType;
  }) || null;
}

function runCommand(runtime, commandName, optionsData, playerId, responseType, log) {
  const interaction = createInteraction(commandName, optionsData, playerId);
  const mapped = mapInteractionOrFailure(interaction);
  log.push({
    step: "map_" + commandName,
    result: clone(mapped)
  });
  if (!mapped.ok) {
    return mapped;
  }

  return runtime.processGatewayReadCommandEvent(mapped.payload.event).then((runtimeOut) => {
    log.push({
      step: "runtime_" + commandName,
      result: clone(runtimeOut)
    });

    if (!runtimeOut.ok) {
      return failure("content_slice_command_runtime_failed", "runtime processing failed for " + commandName, {
        command: commandName
      });
    }

    const response = findResponseByType(runtimeOut, responseType);
    if (!response) {
      return failure("content_slice_command_response_missing", "missing gateway response for " + commandName, {
        command: commandName,
        response_type: responseType
      });
    }

    if (!response.payload || response.payload.ok !== true) {
      return failure("content_slice_command_failed", response.payload && response.payload.error
        ? response.payload.error
        : ("command failed: " + commandName), {
        command: commandName,
        response: response
      });
    }

    return success("content_slice_command_completed", {
      command: commandName,
      response: response
    });
  });
}

function buildCanonicalInventoryService(inventoryPersistence) {
  return {
    getInventory(inventoryId) {
      return inventoryPersistence.loadInventoryById(inventoryId);
    },
    saveInventory(inventory) {
      return inventoryPersistence.saveInventory(inventory);
    }
  };
}

async function runContentSliceHarness(input) {
  const data = input || {};
  const playerId = data.player_id || "player-content-slice-001";
  const characterName = data.character_name || "Content Slice Hero";
  const log = [];

  const contentBundle = loadStarterContentBundle();
  log.push({ step: "load_starter_content_bundle", result: clone(contentBundle) });
  if (!contentBundle.ok) {
    return failure("content_slice_failed", contentBundle.error || "failed to load starter content", { log });
  }

  const content = contentBundle.payload.content;
  const starterRace = content.races[0];
  const starterClass = content.classes[0];
  const starterBackground = content.backgrounds[0];
  const starterDungeon = content.dungeons[0];
  const starterMonsterRef = starterDungeon.rooms.find((room) => room.room_type === "encounter");
  const starterMonster = content.monsters.find((monster) => {
    return starterMonsterRef && starterMonsterRef.encounter && monster.monster_id === starterMonsterRef.encounter.monster_id;
  });
  const trainingSword = content.items.find((item) => item.item_id === "item_training_sword");
  const healPotion = content.items.find((item) => item.item_id === "item_minor_heal_potion");
  const lootMaterial = content.items.find((item) => item.item_id === "item_rat_tail");

  if (!starterRace || !starterClass || !starterBackground || !starterDungeon || !starterMonster || !trainingSword || !healPotion || !lootMaterial) {
    return failure("content_slice_failed", "starter content missing required playable entities", { log });
  }

  const adapter = createInMemoryAdapter();
  const characterPersistence = new CharacterPersistenceBridge({ adapter });
  const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
  const sessionPersistence = new SessionPersistenceBridge({ adapter });
  const combatPersistence = new CombatPersistenceBridge({ adapter });
  const sessionManager = new DungeonSessionManagerCore();
  const combatManager = new CombatManager();
  const runtime = createReadCommandRuntime({
    characterPersistence,
    inventoryPersistence,
    sessionPersistence,
    sessionManager,
    combatManager,
    combatPersistence
  });

  const startOut = await runCommand(
    runtime,
    "start",
    [{ name: "name", value: characterName }],
    playerId,
    "start",
    log
  );
  if (!startOut.ok) {
    return failure("content_slice_failed", startOut.error, { log });
  }

  const listedCharacters = characterPersistence.listCharacters();
  log.push({ step: "list_characters_after_start", result: clone(listedCharacters) });
  if (!listedCharacters.ok) {
    return failure("content_slice_failed", listedCharacters.error || "failed listing characters", { log });
  }

  const character = listedCharacters.payload.characters.find((entry) => String(entry.player_id) === String(playerId));
  if (!character) {
    return failure("content_slice_failed", "character not found after start", { log });
  }

  const characterPatched = {
    ...character,
    race: starterRace.id,
    class: starterClass.id,
    background: starterBackground.id,
    updated_at: new Date().toISOString()
  };
  const savedCharacter = characterPersistence.saveCharacter(characterPatched);
  log.push({ step: "save_character_content_metadata", result: clone(savedCharacter) });
  if (!savedCharacter.ok) {
    return failure("content_slice_failed", savedCharacter.error || "failed saving character metadata", { log });
  }

  const profileOut = await runCommand(runtime, "profile", [], playerId, "profile", log);
  if (!profileOut.ok) {
    return failure("content_slice_failed", profileOut.error, { log });
  }

  const inventoryOut = await runCommand(runtime, "inventory", [], playerId, "inventory", log);
  if (!inventoryOut.ok) {
    return failure("content_slice_failed", inventoryOut.error, { log });
  }

  const loadedInventory = inventoryPersistence.loadInventoryById(characterPatched.inventory_id);
  log.push({ step: "load_inventory_for_seed", result: clone(loadedInventory) });
  if (!loadedInventory.ok) {
    return failure("content_slice_failed", loadedInventory.error || "failed loading inventory", { log });
  }

  const seededInventory = clone(loadedInventory.payload.inventory);
  seededInventory.equipment_items = Array.isArray(seededInventory.equipment_items) ? seededInventory.equipment_items : [];
  seededInventory.stackable_items = Array.isArray(seededInventory.stackable_items) ? seededInventory.stackable_items : [];
  seededInventory.equipment_items.push({
    item_id: trainingSword.item_id,
    item_name: trainingSword.name,
    quantity: 1,
    owner_player_id: playerId,
    metadata: clone(trainingSword.metadata || {})
  });
  seededInventory.stackable_items.push({
    item_id: healPotion.item_id,
    item_name: healPotion.name,
    item_type: healPotion.item_type,
    quantity: 2,
    owner_player_id: playerId,
    metadata: clone(healPotion.metadata || {})
  });

  const savedInventory = inventoryPersistence.saveInventory(seededInventory);
  log.push({ step: "save_seeded_inventory", result: clone(savedInventory) });
  if (!savedInventory.ok) {
    return failure("content_slice_failed", savedInventory.error || "failed seeding inventory", { log });
  }

  const equipOut = await runCommand(
    runtime,
    "equip",
    [
      { name: "item_id", value: trainingSword.item_id },
      { name: "slot", value: "main_hand" }
    ],
    playerId,
    "equip",
    log
  );
  if (!equipOut.ok) {
    return failure("content_slice_failed", equipOut.error, { log });
  }

  const enterOut = await runCommand(
    runtime,
    "dungeon",
    [
      {
        type: 1,
        name: "enter",
        options: [{ name: "dungeon_id", value: starterDungeon.dungeon_id }]
      }
    ],
    playerId,
    "dungeon_enter",
    log
  );
  if (!enterOut.ok) {
    return failure("content_slice_failed", enterOut.error, { log });
  }

  const createdSessionId = enterOut.payload.response.payload.data.session.session_id;
  const sessionRoomObjects = starterDungeon.rooms.map((room) => {
    return createRoomObject({
      room_id: room.room_id,
      name: room.name || room.room_id,
      room_type: room.room_type,
      exits: room.exits,
      encounter: room.encounter || null
    });
  });
  const addRoomsOut = sessionManager.addMultipleRoomsToSession({
    session_id: createdSessionId,
    rooms: sessionRoomObjects
  });
  log.push({ step: "add_rooms_from_content", result: clone(addRoomsOut) });
  if (!addRoomsOut.ok) {
    return failure("content_slice_failed", addRoomsOut.error || "failed adding content rooms", { log });
  }

  const setStartOut = sessionManager.setStartRoom({
    session_id: createdSessionId,
    room_id: starterDungeon.start_room_id
  });
  log.push({ step: "set_start_room_from_content", result: clone(setStartOut) });
  if (!setStartOut.ok) {
    return failure("content_slice_failed", setStartOut.error || "failed setting start room", { log });
  }

  const persistSessionOut = sessionPersistence.saveSession(setStartOut.payload.session);
  log.push({ step: "persist_session_with_rooms", result: clone(persistSessionOut) });
  if (!persistSessionOut.ok) {
    return failure("content_slice_failed", persistSessionOut.error || "failed persisting content session", { log });
  }

  const moveOut = await runCommand(
    runtime,
    "move",
    [
      { name: "session_id", value: createdSessionId },
      { name: "destination_id", value: starterMonsterRef.room_id }
    ],
    playerId,
    "move",
    log
  );
  if (!moveOut.ok) {
    return failure("content_slice_failed", moveOut.error, { log });
  }

  const currentSession = sessionPersistence.loadSessionById(createdSessionId);
  log.push({ step: "load_session_after_move", result: clone(currentSession) });
  if (!currentSession.ok) {
    return failure("content_slice_failed", currentSession.error || "failed loading moved session", { log });
  }

  const movedRoomId = currentSession.payload.session.current_room_id;
  if (String(movedRoomId) !== String(starterMonsterRef.room_id)) {
    return failure("content_slice_failed", "party did not reach encounter room", {
      log,
      expected_room_id: starterMonsterRef.room_id,
      actual_room_id: movedRoomId
    });
  }

  const playerCombatOut = toCombatParticipant({
    character: characterPatched,
    team: "party",
    attack_bonus: 4,
    damage: Number(trainingSword.metadata.damage || 4),
    armor_class: 12,
    current_hp: 18,
    max_hp: 18
  });
  log.push({ step: "to_combat_participant_player", result: clone(playerCombatOut) });
  if (!playerCombatOut.ok) {
    return failure("content_slice_failed", playerCombatOut.error || "failed to build player combat participant", { log });
  }

  const sessionCombatId = currentSession.payload.session.active_combat_id;
  const combatId = "combat-" + createdSessionId;
  const createCombatOut = combatManager.createCombat({
    combat_id: combatId,
    status: "pending"
  });
  log.push({ step: "create_combat_for_encounter", result: clone(createCombatOut) });
  if (!createCombatOut.ok) {
    return failure("content_slice_failed", createCombatOut.error || "failed creating encounter combat", { log });
  }

  const addPlayerOut = combatManager.addParticipant({
    combat_id: combatId,
    participant: {
      ...playerCombatOut.payload.participant,
      participant_id: playerId,
      position: { x: 0, y: 0 }
    }
  });
  log.push({ step: "add_player_to_combat", result: clone(addPlayerOut) });
  if (!addPlayerOut.ok) {
    return failure("content_slice_failed", addPlayerOut.error || "failed adding player combatant", { log });
  }

  const addMonsterOut = combatManager.addParticipant({
    combat_id: combatId,
    participant: {
      participant_id: starterMonster.monster_id,
      name: starterMonster.name,
      team: "enemy",
      armor_class: starterMonster.armor_class,
      current_hp: starterMonster.max_hp,
      max_hp: starterMonster.max_hp,
      attack_bonus: starterMonster.attack_bonus,
      damage: starterMonster.damage,
      position: { x: 1, y: 0 }
    }
  });
  log.push({ step: "add_monster_to_combat", result: clone(addMonsterOut) });
  if (!addMonsterOut.ok) {
    return failure("content_slice_failed", addMonsterOut.error || "failed adding monster combatant", { log });
  }

  const startCombatOut = startCombat({
    combatManager,
    combat_id: combatId,
    roll_function(participant) {
      return participant.participant_id === playerId ? 20 : 10;
    }
  });
  log.push({ step: "start_combat", result: clone(startCombatOut) });
  if (!startCombatOut.ok) {
    return failure("content_slice_failed", startCombatOut.error || "failed starting combat", { log });
  }

  const attackOut = await runCommand(
    runtime,
    "attack",
    [
      { name: "combat_id", value: combatId },
      { name: "target_id", value: starterMonster.monster_id }
    ],
    playerId,
    "attack",
    log
  );
  if (!attackOut.ok) {
    return failure("content_slice_failed", attackOut.error, { log });
  }

  const useOut = await runCommand(
    runtime,
    "use",
    [
      { name: "combat_id", value: combatId },
      { name: "item_id", value: healPotion.item_id }
    ],
    playerId,
    "use",
    log
  );
  if (!useOut.ok) {
    return failure("content_slice_failed", useOut.error, { log });
  }

  const combatReturn = processSessionCombatReturnRequest({
    context: {
      sessionManager,
      sessionPersistence
    },
    player_id: playerId,
    session_id: createdSessionId,
    combat_id: sessionCombatId,
    payload: { outcome: "victory" }
  });
  log.push({ step: "process_combat_return", result: clone(combatReturn) });
  if (!combatReturn.ok) {
    return failure("content_slice_failed", combatReturn.error || "failed to return session from combat", { log });
  }

  const rewardPrepared = prepareRewardHook({
    manager: sessionManager,
    sessionPersistence,
    session_id: createdSessionId,
    reward_context: "encounter_clear"
  });
  log.push({ step: "prepare_reward_hook", result: clone(rewardPrepared) });
  if (!rewardPrepared.ok) {
    return failure("content_slice_failed", rewardPrepared.error || "failed preparing reward hook", { log });
  }

  const lootTable = createLootTableObject({
    loot_table_id: starterMonster.loot_table_id,
    name: "Starter Monster Loot",
    guaranteed_entries: [
      {
        item_id: lootMaterial.item_id,
        item_name: lootMaterial.name,
        rarity: "common",
        quantity: 1
      }
    ],
    weighted_entries: [
      {
        item_id: healPotion.item_id,
        item_name: healPotion.name,
        rarity: "common",
        weight: 100,
        quantity: 1
      }
    ]
  });

  const consumedHook = consumeRewardHook({
    reward_hook: {
      ...rewardPrepared.payload.reward_event.payload,
      target_player_id: playerId,
      loot_table_id: starterMonster.loot_table_id
    },
    loot_table: lootTable
  });
  log.push({ step: "consume_reward_hook", result: clone(consumedHook) });
  if (!consumedHook.ok) {
    return failure("content_slice_failed", consumedHook.error || "failed consuming reward hook", { log });
  }

  const rolledLoot = rollLoot({
    ...consumedHook.payload.next_step.roll_input,
    random_fn: () => 0
  });
  log.push({ step: "roll_loot", result: clone(rolledLoot) });
  if (!rolledLoot.ok) {
    return failure("content_slice_failed", rolledLoot.error || "failed rolling loot", { log });
  }

  const grantedLoot = grantLootToInventory({
    inventory_service: buildCanonicalInventoryService(inventoryPersistence),
    inventory_id: characterPatched.inventory_id,
    owner_id: playerId,
    loot_bundle: rolledLoot.payload.loot_bundle
  });
  log.push({ step: "grant_loot", result: clone(grantedLoot) });
  if (!grantedLoot.ok) {
    return failure("content_slice_failed", grantedLoot.error || "failed granting loot", { log });
  }

  const leaveOut = await runCommand(
    runtime,
    "leave",
    [{ name: "session_id", value: createdSessionId }],
    playerId,
    "leave_session",
    log
  );
  if (!leaveOut.ok) {
    return failure("content_slice_failed", leaveOut.error, { log });
  }

  const finalInventory = inventoryPersistence.loadInventoryById(characterPatched.inventory_id);
  const finalSessionList = sessionPersistence.listSessions();
  return success("content_slice_completed", {
    command_responses: {
      start: startOut.payload.response,
      profile: profileOut.payload.response,
      inventory: inventoryOut.payload.response,
      equip: equipOut.payload.response,
      dungeon_enter: enterOut.payload.response,
      move: moveOut.payload.response,
      attack: attackOut.payload.response,
      use: useOut.payload.response,
      leave: leaveOut.payload.response
    },
    content_used: {
      race_id: starterRace.id,
      class_id: starterClass.id,
      background_id: starterBackground.id,
      dungeon_id: starterDungeon.dungeon_id,
      monster_id: starterMonster.monster_id
    },
    combat_id: combatId,
    session_id: createdSessionId,
    final_inventory: finalInventory.ok ? clone(finalInventory.payload.inventory) : null,
    sessions_remaining: finalSessionList.ok ? finalSessionList.payload.sessions.length : null,
    log
  });
}

if (require.main === module) {
  runContentSliceHarness()
    .then((out) => {
      console.log(JSON.stringify(out, null, 2));
      if (!out.ok) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  runContentSliceHarness
};
