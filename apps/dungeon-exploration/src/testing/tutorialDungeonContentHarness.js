"use strict";

const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { loadStarterContentBundle } = require("../../../world-system/src/content");
const { DungeonSessionManagerCore } = require("../core/dungeonSessionManager");
const { SessionPersistenceBridge } = require("../session.persistence");
const { createRoomObject } = require("../rooms/roomModel");
const { moveParty } = require("../flow/moveParty");
const { resolveRoomEntry } = require("../flow/resolveRoomEntry");
const { prepareRewardHook } = require("../flow/prepareRewardHook");
const { createLootTableObject } = require("../../../world-system/src/loot/tables/lootTableModel");
const { consumeRewardHook } = require("../../../world-system/src/loot/flow/consumeRewardHook");
const { rollLoot } = require("../../../world-system/src/loot/flow/rollLoot");
const { grantLootToInventory } = require("../../../world-system/src/loot/flow/grantLootToInventory");
const { InventoryPersistenceBridge } = require("../../../inventory-system/src/inventory.persistence");
const { createInventoryRecord } = require("../../../inventory-system/src/inventory.schema");

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

function buildInventoryService(inventoryPersistence) {
  return {
    getInventory(inventoryId) {
      return inventoryPersistence.loadInventoryById(inventoryId);
    },
    saveInventory(inventory) {
      return inventoryPersistence.saveInventory(inventory);
    }
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeCurve(value) {
  if (!isObject(value)) {
    return null;
  }

  const out = {};
  if (Number.isFinite(value.quantity_multiplier)) {
    out.quantity_multiplier = Number(value.quantity_multiplier);
  }
  if (Number.isFinite(value.guaranteed_quantity_bonus)) {
    out.guaranteed_quantity_bonus = Number(value.guaranteed_quantity_bonus);
  }
  if (Number.isFinite(value.weighted_bonus_rolls)) {
    out.weighted_bonus_rolls = Number(value.weighted_bonus_rolls);
  }
  if (Number.isFinite(value.xp_multiplier)) {
    out.xp_multiplier = Number(value.xp_multiplier);
  }

  return Object.keys(out).length > 0 ? out : null;
}

function mergeRewardCurves(curves) {
  const rows = Array.isArray(curves) ? curves : [];
  let merged = null;

  for (let i = 0; i < rows.length; i += 1) {
    const curve = normalizeCurve(rows[i]);
    if (!curve) {
      continue;
    }

    if (!merged) {
      merged = {
        quantity_multiplier: Number.isFinite(curve.quantity_multiplier) ? curve.quantity_multiplier : 1,
        guaranteed_quantity_bonus: Number.isFinite(curve.guaranteed_quantity_bonus) ? curve.guaranteed_quantity_bonus : 0,
        weighted_bonus_rolls: Number.isFinite(curve.weighted_bonus_rolls) ? curve.weighted_bonus_rolls : 0,
        xp_multiplier: Number.isFinite(curve.xp_multiplier) ? curve.xp_multiplier : 1
      };
      continue;
    }

    if (Number.isFinite(curve.quantity_multiplier)) {
      merged.quantity_multiplier = Math.max(merged.quantity_multiplier, curve.quantity_multiplier);
    }
    if (Number.isFinite(curve.guaranteed_quantity_bonus)) {
      merged.guaranteed_quantity_bonus = Math.max(merged.guaranteed_quantity_bonus, curve.guaranteed_quantity_bonus);
    }
    if (Number.isFinite(curve.weighted_bonus_rolls)) {
      merged.weighted_bonus_rolls = Math.max(merged.weighted_bonus_rolls, curve.weighted_bonus_rolls);
    }
    if (Number.isFinite(curve.xp_multiplier)) {
      merged.xp_multiplier = Math.max(merged.xp_multiplier, curve.xp_multiplier);
    }
  }

  return merged;
}

function runTutorialDungeonContentHarness(input) {
  const data = input || {};
  const playerId = data.player_id || "player-tutorial-dungeon-001";
  const sessionId = data.session_id || "session-tutorial-dungeon-001";
  const inventoryId = data.inventory_id || "inv-tutorial-dungeon-001";
  const dungeonId = data.dungeon_id || "dungeon_tutorial_path";
  const log = [];

  const contentOut = loadStarterContentBundle();
  log.push({ step: "load_content", result: clone(contentOut) });
  if (!contentOut.ok) {
    return failure("tutorial_dungeon_slice_failed", contentOut.error || "content load failed", { log });
  }

  const content = contentOut.payload.content;
  const tutorialDungeon = content.dungeons.find((entry) => entry.dungeon_id === dungeonId);
  const rewardItemId =
    String(
      tutorialDungeon && tutorialDungeon.metadata && tutorialDungeon.metadata.reward_item_id
      || "item_rat_tail"
    ).trim() || "item_rat_tail";
  const rewardMaterial = content.items.find((entry) => entry.item_id === rewardItemId);
  if (!tutorialDungeon || !rewardMaterial) {
    return failure("tutorial_dungeon_slice_failed", "tutorial dungeon or reward material missing", { log });
  }

  const encounterRoom = tutorialDungeon.rooms.find((room) => room.room_type === "encounter");
  if (!encounterRoom || !encounterRoom.encounter || !encounterRoom.encounter.monster_id) {
    return failure("tutorial_dungeon_slice_failed", "tutorial encounter room is missing monster reference", { log });
  }

  const starterMonster = content.monsters.find((entry) => {
    return entry.monster_id === encounterRoom.encounter.monster_id;
  });
  if (!starterMonster) {
    return failure("tutorial_dungeon_slice_failed", "tutorial monster reference not found", { log });
  }

  const adapter = createInMemoryAdapter();
  const manager = new DungeonSessionManagerCore();
  const sessionPersistence = new SessionPersistenceBridge({ adapter });
  const inventoryPersistence = new InventoryPersistenceBridge({ adapter });

  const createdSession = manager.createSession({
    session_id: sessionId,
    dungeon_id: tutorialDungeon.dungeon_id,
    status: "active"
  });
  log.push({ step: "create_session", result: clone(createdSession) });
  if (!createdSession.ok) {
    return failure("tutorial_dungeon_slice_failed", createdSession.error || "create session failed", { log });
  }

  const setParty = manager.setParty({
    session_id: sessionId,
    party: {
      party_id: "party-tutorial-001",
      leader_id: playerId,
      members: [playerId]
    }
  });
  log.push({ step: "set_party", result: clone(setParty) });
  if (!setParty.ok) {
    return failure("tutorial_dungeon_slice_failed", setParty.error || "set party failed", { log });
  }

  const roomObjects = tutorialDungeon.rooms.map((room) => {
    return createRoomObject({
      room_id: room.room_id,
      name: room.name || room.room_id,
      room_type: room.room_type,
      exits: room.exits,
      encounter: room.encounter || null
    });
  });

  const addRooms = manager.addMultipleRoomsToSession({
    session_id: sessionId,
    rooms: roomObjects
  });
  log.push({ step: "add_rooms", result: clone(addRooms) });
  if (!addRooms.ok) {
    return failure("tutorial_dungeon_slice_failed", addRooms.error || "add rooms failed", { log });
  }

  const setStart = manager.setStartRoom({
    session_id: sessionId,
    room_id: tutorialDungeon.start_room_id
  });
  log.push({ step: "set_start_room", result: clone(setStart) });
  if (!setStart.ok) {
    return failure("tutorial_dungeon_slice_failed", setStart.error || "set start room failed", { log });
  }

  const saveInitial = sessionPersistence.saveSession(setStart.payload.session);
  log.push({ step: "save_initial_session", result: clone(saveInitial) });
  if (!saveInitial.ok) {
    return failure("tutorial_dungeon_slice_failed", saveInitial.error || "persist initial session failed", { log });
  }

  const firstMoveTargetRoomId = data.first_move_target_room_id || encounterRoom.room_id;
  const moved = moveParty({
    manager,
    session_id: sessionId,
    target_room_id: firstMoveTargetRoomId
  });
  log.push({ step: "move_to_encounter", result: clone(moved) });
  if (!moved.ok) {
    return failure("tutorial_dungeon_slice_failed", moved.error || "movement failed", { log });
  }

  const entryOutcome = resolveRoomEntry({
    manager,
    session_id: sessionId
  });
  log.push({ step: "resolve_encounter_entry", result: clone(entryOutcome) });
  if (!entryOutcome.ok) {
    return failure("tutorial_dungeon_slice_failed", entryOutcome.error || "room entry failed", { log });
  }

  const markCleared = manager.markRoomCleared({
    session_id: sessionId,
    room_id: encounterRoom.room_id
  });
  log.push({ step: "mark_encounter_cleared", result: clone(markCleared) });
  if (!markCleared.ok) {
    return failure("tutorial_dungeon_slice_failed", markCleared.error || "mark room cleared failed", { log });
  }

  const rewardHook = prepareRewardHook({
    manager,
    session_id: sessionId,
    reward_context: "encounter_clear"
  });
  log.push({ step: "prepare_reward_hook", result: clone(rewardHook) });
  if (!rewardHook.ok) {
    return failure("tutorial_dungeon_slice_failed", rewardHook.error || "reward hook preparation failed", { log });
  }

  const lootTable = createLootTableObject({
    loot_table_id: starterMonster.loot_table_id,
    name: "Tutorial Dungeon Reward",
    guaranteed_entries: [
      {
        item_id: rewardMaterial.item_id,
        item_name: rewardMaterial.name,
        rarity: "common",
        quantity: 1
      }
    ],
    weighted_entries: []
  });

  const consumedReward = consumeRewardHook({
    reward_hook: {
      ...rewardHook.payload.reward_event.payload,
      target_player_id: playerId,
      loot_table_id: starterMonster.loot_table_id,
      reward_curve: mergeRewardCurves([
        tutorialDungeon.metadata && tutorialDungeon.metadata.reward_curve,
        starterMonster.metadata && starterMonster.metadata.reward_curve
      ])
    },
    loot_table: lootTable
  });
  log.push({ step: "consume_reward_hook", result: clone(consumedReward) });
  if (!consumedReward.ok) {
    return failure("tutorial_dungeon_slice_failed", consumedReward.error || "reward hook consume failed", { log });
  }

  const rolledLoot = rollLoot({
    ...consumedReward.payload.next_step.roll_input,
    random_fn: () => 0
  });
  log.push({ step: "roll_loot", result: clone(rolledLoot) });
  if (!rolledLoot.ok) {
    return failure("tutorial_dungeon_slice_failed", rolledLoot.error || "loot roll failed", { log });
  }

  const saveInventory = inventoryPersistence.saveInventory(
    createInventoryRecord({
      inventory_id: inventoryId,
      owner_type: "player",
      owner_id: playerId
    })
  );
  log.push({ step: "create_inventory", result: clone(saveInventory) });
  if (!saveInventory.ok) {
    return failure("tutorial_dungeon_slice_failed", saveInventory.error || "inventory create failed", { log });
  }

  const grantLoot = grantLootToInventory({
    inventory_service: buildInventoryService(inventoryPersistence),
    inventory_id: inventoryId,
    owner_id: playerId,
    loot_bundle: rolledLoot.payload.loot_bundle
  });
  log.push({ step: "grant_loot", result: clone(grantLoot) });
  if (!grantLoot.ok) {
    return failure("tutorial_dungeon_slice_failed", grantLoot.error || "grant loot failed", { log });
  }

  const exitRoom = tutorialDungeon.rooms.find((room) => {
    return String(room.room_id) === "room_tutorial_exit";
  }) || tutorialDungeon.rooms.find((room) => {
    if (String(room.room_id) === String(encounterRoom.room_id)) {
      return false;
    }
    return String(room.room_type || "").toLowerCase() === "rest";
  });
  if (exitRoom) {
    const movedToExit = moveParty({
      manager,
      session_id: sessionId,
      target_room_id: exitRoom.room_id
    });
    log.push({ step: "move_to_exit", result: clone(movedToExit) });
    if (!movedToExit.ok) {
      return failure("tutorial_dungeon_slice_failed", movedToExit.error || "move to exit failed", { log });
    }
  }

  const latestSession = manager.getSessionById(sessionId);
  if (!latestSession.ok) {
    return failure("tutorial_dungeon_slice_failed", latestSession.error || "failed to read final session", { log });
  }

  const saveProgress = sessionPersistence.saveSession(latestSession.payload.session);
  log.push({ step: "save_session_progress", result: clone(saveProgress) });
  if (!saveProgress.ok) {
    return failure("tutorial_dungeon_slice_failed", saveProgress.error || "session progress persistence failed", { log });
  }

  const reloadedSession = sessionPersistence.loadSessionById(sessionId);
  const reloadedInventory = inventoryPersistence.loadInventoryById(inventoryId);
  log.push({ step: "reload_session", result: clone(reloadedSession) });
  log.push({ step: "reload_inventory", result: clone(reloadedInventory) });
  if (!reloadedSession.ok || !reloadedInventory.ok) {
    return failure("tutorial_dungeon_slice_failed", "reload after persistence failed", { log });
  }

  return success("tutorial_dungeon_slice_completed", {
    dungeon_id: tutorialDungeon.dungeon_id,
    session_id: sessionId,
    encounter_room_id: encounterRoom.room_id,
    entry_room_id: tutorialDungeon.start_room_id,
    reloaded_session: clone(reloadedSession.payload.session),
    reloaded_inventory: clone(reloadedInventory.payload.inventory),
    reward_item_id: rewardMaterial.item_id,
    encounter_monster_id: starterMonster.monster_id,
    log
  });
}

if (require.main === module) {
  const out = runTutorialDungeonContentHarness();
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runTutorialDungeonContentHarness
};
