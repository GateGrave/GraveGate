"use strict";

const assert = require("assert");
const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { SessionPersistenceBridge } = require("../session.persistence");
const { InventoryPersistenceBridge } = require("../../../inventory-system/src/inventory.persistence");
const { createInventoryRecord } = require("../../../inventory-system/src/inventory.schema");
const { CombatManager } = require("../../../combat-system/src/core/combatManager");
const { CombatPersistenceBridge } = require("../../../combat-system/src/combat.persistence");
const { DungeonSessionManagerCore } = require("../core/dungeonSessionManager");
const { createRoomObject } = require("../rooms/roomModel");
const {
  processEnterDungeonRequest,
  processLeaveSessionRequest
} = require("../flow/processSessionLifecycleRequest");
const {
  processSessionMoveRequest,
  processSessionCombatReturnRequest,
  processSessionInteractRequest
} = require("../flow/processActiveSessionAction");
const { prepareRewardHook } = require("../flow/prepareRewardHook");
const { createLootTableObject } = require("../../../world-system/src/loot/tables/lootTableModel");
const { consumeRewardHook } = require("../../../world-system/src/loot/flow/consumeRewardHook");
const { rollLoot } = require("../../../world-system/src/loot/flow/rollLoot");
const { grantLootToInventory } = require("../../../world-system/src/loot/flow/grantLootToInventory");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createContext() {
  const adapter = createInMemoryAdapter();
  return {
    sessionManager: new DungeonSessionManagerCore(),
    sessionPersistence: new SessionPersistenceBridge({ adapter }),
    inventoryPersistence: new InventoryPersistenceBridge({ adapter }),
    combatManager: new CombatManager(),
    combatPersistence: new CombatPersistenceBridge({ adapter })
  };
}

function addStarterRooms(context, sessionId) {
  const addRooms = context.sessionManager.addMultipleRoomsToSession({
    session_id: sessionId,
    rooms: [
      createRoomObject({
        room_id: "room-entry",
        room_type: "empty",
        exits: [{ direction: "east", to_room_id: "room-encounter" }]
      }),
      createRoomObject({
        room_id: "room-encounter",
        room_type: "encounter",
        encounter: {
          encounter_id: "enc-goblin-001",
          monster_id: "monster_goblin"
        },
        exits: [
          { direction: "west", to_room_id: "room-entry" },
          { direction: "east", to_room_id: "room-exit" }
        ]
      }),
      createRoomObject({
        room_id: "room-exit",
        room_type: "rest",
        exits: [{ direction: "west", to_room_id: "room-encounter" }]
      })
    ]
  });
  assert.equal(addRooms.ok, true);

  const setStart = context.sessionManager.setStartRoom({
    session_id: sessionId,
    room_id: "room-entry"
  });
  assert.equal(setStart.ok, true);
  const persisted = context.sessionPersistence.saveSession(setStart.payload.session);
  assert.equal(persisted.ok, true);
}

function enterSession(context, playerId, sessionId, dungeonId) {
  const entered = processEnterDungeonRequest({
    context,
    player_id: playerId,
    session_id: sessionId,
    dungeon_id: dungeonId,
    party_id: "party-" + playerId
  });
  assert.equal(entered.ok, true);
  return entered.payload.session;
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

function runDungeonLoopStabilizationTests() {
  const results = [];

  runTest("session_creation_produces_valid_initial_state", () => {
    const context = createContext();
    const session = enterSession(context, "player-loop-001", "session-loop-001", "dungeon-loop-001");
    addStarterRooms(context, session.session_id);

    const loaded = context.sessionManager.getSessionById("session-loop-001");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.payload.session.status, "active");
    assert.equal(loaded.payload.session.current_room_id, "room-entry");
    assert.equal(loaded.payload.session.party.leader_id, "player-loop-001");
  }, results);

  runTest("duplicate_session_entry_returns_existing_session_without_duplication", () => {
    const context = createContext();
    enterSession(context, "player-loop-entry-001", "session-loop-entry-001", "dungeon-loop-entry-001");
    context.sessionManager.sessions.clear();

    const enteredAgain = processEnterDungeonRequest({
      context,
      player_id: "player-loop-entry-001",
      session_id: "session-loop-entry-001",
      dungeon_id: "dungeon-loop-entry-001",
      party_id: "party-player-loop-entry-001"
    });

    assert.equal(enteredAgain.ok, true);
    assert.equal(enteredAgain.payload.enter_status, "already_exists");
    const hydrated = context.sessionManager.getSessionById("session-loop-entry-001");
    assert.equal(hydrated.ok, true);

    const listed = context.sessionPersistence.listSessions();
    assert.equal(listed.ok, true);
    assert.equal(listed.payload.sessions.length, 1);
  }, results);

  runTest("exploration_progression_and_invalid_movement_are_stable", () => {
    const context = createContext();
    enterSession(context, "player-loop-002", "session-loop-002", "dungeon-loop-002");
    addStarterRooms(context, "session-loop-002");

    const moved = processSessionMoveRequest({
      context,
      player_id: "player-loop-002",
      session_id: "session-loop-002",
      payload: { direction: "east" }
    });
    assert.equal(moved.ok, true);
    assert.equal(moved.payload.to_room_id, "room-encounter");
    assert.equal(moved.payload.room_outcome, "encounter");
    assert.equal(moved.payload.session.discovered_rooms.includes("room-encounter"), true);

    const blockedByCombat = processSessionMoveRequest({
      context,
      player_id: "player-loop-002",
      session_id: "session-loop-002",
      payload: { destination_id: "room-exit" }
    });
    assert.equal(blockedByCombat.ok, false);
    assert.equal(blockedByCombat.error, "session has active combat");

    const invalidMove = processSessionMoveRequest({
      context,
      player_id: "player-loop-002",
      session_id: "session-loop-002",
      payload: { destination_id: "room-does-not-exist" }
    });
    assert.equal(invalidMove.ok, false);

    const malformedMove = processSessionMoveRequest({
      context,
      player_id: "player-loop-002",
      session_id: "session-loop-002",
      payload: "invalid-payload"
    });
    assert.equal(malformedMove.ok, false);
    assert.equal(malformedMove.error, "payload must be an object");
  }, results);

  runTest("entry_trap_locks_movement_until_disarmed", () => {
    const context = createContext();
    enterSession(context, "player-loop-trap-001", "session-loop-trap-001", "dungeon-loop-trap-001");
    const addRooms = context.sessionManager.addMultipleRoomsToSession({
      session_id: "session-loop-trap-001",
      rooms: [
        createRoomObject({
          room_id: "room-trap-entry",
          room_type: "empty",
          exits: [{ direction: "east", to_room_id: "room-trap" }]
        }),
        createRoomObject({
          room_id: "room-trap",
          room_type: "empty",
          exits: [
            { direction: "west", to_room_id: "room-trap-entry" },
            { direction: "east", to_room_id: "room-trap-exit" }
          ],
          objects: [{
            object_id: "obj-trap-loop-001",
            object_type: "trap"
          }]
        }),
        createRoomObject({
          room_id: "room-trap-exit",
          room_type: "rest",
          exits: [{ direction: "west", to_room_id: "room-trap" }]
        })
      ]
    });
    assert.equal(addRooms.ok, true);
    const setStart = context.sessionManager.setStartRoom({
      session_id: "session-loop-trap-001",
      room_id: "room-trap-entry"
    });
    assert.equal(setStart.ok, true);
    context.sessionPersistence.saveSession(setStart.payload.session);

    const movedIntoTrap = processSessionMoveRequest({
      context,
      player_id: "player-loop-trap-001",
      session_id: "session-loop-trap-001",
      payload: { direction: "east" }
    });
    assert.equal(movedIntoTrap.ok, true);
    assert.equal(movedIntoTrap.payload.trap_trigger.object_id, "obj-trap-loop-001");

    const blockedMove = processSessionMoveRequest({
      context,
      player_id: "player-loop-trap-001",
      session_id: "session-loop-trap-001",
      payload: { direction: "east" }
    });
    assert.equal(blockedMove.ok, false);
    assert.equal(blockedMove.error, "session movement is locked");

    const disarm = processSessionInteractRequest({
      context,
      player_id: "player-loop-trap-001",
      session_id: "session-loop-trap-001",
      payload: {
        object_id: "obj-trap-loop-001",
        action: "disarm"
      }
    });
    assert.equal(disarm.ok, true);
    assert.equal(disarm.payload.interaction_action, "disarmed");

    const movedOut = processSessionMoveRequest({
      context,
      player_id: "player-loop-trap-001",
      session_id: "session-loop-trap-001",
      payload: { direction: "east" }
    });
    assert.equal(movedOut.ok, true);
    assert.equal(movedOut.payload.to_room_id, "room-trap-exit");
  }, results);

  runTest("session_move_rolls_back_when_encounter_handoff_fails", () => {
    const context = createContext();
    enterSession(context, "player-loop-rollback-001", "session-loop-rollback-001", "dungeon-loop-rollback-001");
    addStarterRooms(context, "session-loop-rollback-001");

    context.combatManager.addParticipant = function failAddParticipant() {
      return {
        ok: false,
        error: "forced encounter handoff failure"
      };
    };

    const moved = processSessionMoveRequest({
      context,
      player_id: "player-loop-rollback-001",
      session_id: "session-loop-rollback-001",
      payload: { destination_id: "room-encounter" }
    });
    assert.equal(moved.ok, false);
    assert.equal(moved.error, "forced encounter handoff failure");
    assert.equal(moved.payload.rollback_applied, true);

    const loaded = context.sessionManager.getSessionById("session-loop-rollback-001");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.payload.session.current_room_id, "room-entry");
    assert.equal(Boolean(loaded.payload.session.active_combat_id), false);
    const consumedKeys = loaded.payload.session.trigger_state && Array.isArray(loaded.payload.session.trigger_state.consumed_keys)
      ? loaded.payload.session.trigger_state.consumed_keys
      : [];
    assert.equal(consumedKeys.length, 0);
  }, results);

  runTest("combat_handoff_creates_one_combat_and_duplicate_trigger_is_blocked", () => {
    const context = createContext();
    enterSession(context, "player-loop-003", "session-loop-003", "dungeon-loop-003");
    addStarterRooms(context, "session-loop-003");

    const movedFirst = processSessionMoveRequest({
      context,
      player_id: "player-loop-003",
      session_id: "session-loop-003",
      payload: { destination_id: "room-encounter" }
    });
    assert.equal(movedFirst.ok, true);
    assert.equal(movedFirst.payload.combat_handoff.handoff_status, "created");
    const combatId = movedFirst.payload.combat_handoff.combat_id;
    assert.equal(context.combatManager.combats.size, 1);

    const returned = processSessionCombatReturnRequest({
      context,
      session_id: "session-loop-003",
      combat_id: combatId,
      payload: { outcome: "victory" }
    });
    assert.equal(returned.ok, true);
    assert.equal(returned.payload.session.active_combat_id, null);

    const movedBack = processSessionMoveRequest({
      context,
      player_id: "player-loop-003",
      session_id: "session-loop-003",
      payload: { destination_id: "room-entry" }
    });
    assert.equal(movedBack.ok, true);

    const movedSecond = processSessionMoveRequest({
      context,
      player_id: "player-loop-003",
      session_id: "session-loop-003",
      payload: { destination_id: "room-encounter" }
    });
    assert.equal(movedSecond.ok, true);
    assert.equal(movedSecond.payload.trigger.trigger_status, "already_consumed");
    assert.equal(movedSecond.payload.combat_handoff, null);
    assert.equal(context.combatManager.combats.size, 1);
  }, results);

  runTest("monster_first_initiative_on_handoff_auto_progresses_back_to_party_turn", () => {
    const context = createContext();
    enterSession(context, "player-loop-ai-open-001", "session-loop-ai-open-001", "dungeon-loop-ai-open-001");
    addStarterRooms(context, "session-loop-ai-open-001");

    const originalInitialize = context.combatManager.initializeInitiativeOrder.bind(context.combatManager);
    context.combatManager.initializeInitiativeOrder = function initializeEnemyFirst(input) {
      return originalInitialize({
        ...input,
        roll_function(participant) {
          return String(participant.team || "") === "enemy" ? 20 : 1;
        }
      });
    };

    const moved = processSessionMoveRequest({
      context,
      player_id: "player-loop-ai-open-001",
      session_id: "session-loop-ai-open-001",
      payload: { destination_id: "room-encounter" }
    });
    assert.equal(moved.ok, true);

    const combatId = moved.payload.combat_handoff.combat_id;
    const loadedCombat = context.combatManager.getCombatById(combatId);
    assert.equal(loadedCombat.ok, true);
    const combat = loadedCombat.payload.combat;
    const activeParticipantId = combat.initiative_order[combat.turn_index];
    assert.equal(activeParticipantId, "player-loop-ai-open-001");

    const enemyAction = combat.event_log.find((entry) => {
      return entry && (entry.event_type === "attack_action" || entry.event_type === "move_action");
    });
    assert.equal(Boolean(enemyAction), true);
  }, results);

  runTest("stale_completed_combat_instance_cannot_be_reused_for_new_handoff", () => {
    const context = createContext();
    enterSession(context, "player-loop-stale-combat-001", "session-loop-stale-combat-001", "dungeon-loop-stale-combat-001");
    addStarterRooms(context, "session-loop-stale-combat-001");

    context.combatManager.createCombat({
      combat_id: "combat-session-loop-stale-combat-001-room-encounter",
      status: "completed",
      participants: []
    });

    const moved = processSessionMoveRequest({
      context,
      player_id: "player-loop-stale-combat-001",
      session_id: "session-loop-stale-combat-001",
      payload: { destination_id: "room-encounter" }
    });

    assert.equal(moved.ok, false);
    assert.equal(moved.error, "stale combat instance cannot be reused for encounter handoff");
    const loaded = context.sessionManager.getSessionById("session-loop-stale-combat-001");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.payload.session.current_room_id, "room-entry");
    assert.equal(Boolean(loaded.payload.session.active_combat_id), false);
  }, results);

  runTest("return_from_combat_can_complete_session_and_blocks_further_actions", () => {
    const context = createContext();
    enterSession(context, "player-loop-004", "session-loop-004", "dungeon-loop-004");
    addStarterRooms(context, "session-loop-004");

    const moved = processSessionMoveRequest({
      context,
      player_id: "player-loop-004",
      session_id: "session-loop-004",
      payload: { destination_id: "room-encounter" }
    });
    assert.equal(moved.ok, true);
    const combatId = moved.payload.combat_handoff.combat_id;

    const returned = processSessionCombatReturnRequest({
      context,
      session_id: "session-loop-004",
      combat_id: combatId,
      payload: { outcome: "victory", complete_session: true }
    });
    assert.equal(returned.ok, true);
    assert.equal(returned.payload.session.status, "completed");

    const blocked = processSessionMoveRequest({
      context,
      player_id: "player-loop-004",
      session_id: "session-loop-004",
      payload: { destination_id: "room-entry" }
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "session is not active");
  }, results);

  runTest("single_encounter_loop_completes_when_requested_on_combat_return", () => {
    const context = createContext();
    enterSession(context, "player-loop-complete-001", "session-loop-complete-001", "dungeon-loop-complete-001");
    addStarterRooms(context, "session-loop-complete-001");

    const moved = processSessionMoveRequest({
      context,
      player_id: "player-loop-complete-001",
      session_id: "session-loop-complete-001",
      payload: { destination_id: "room-encounter" }
    });
    assert.equal(moved.ok, true);

    const returned = processSessionCombatReturnRequest({
      context,
      session_id: "session-loop-complete-001",
      combat_id: moved.payload.combat_handoff.combat_id,
      payload: { outcome: "victory", complete_session: true }
    });
    assert.equal(returned.ok, true);
    assert.equal(returned.payload.session_completed, true);
    assert.equal(returned.payload.session.status, "completed");

    const reloaded = context.sessionPersistence.loadSessionById("session-loop-complete-001");
    assert.equal(reloaded.ok, true);
    assert.equal(reloaded.payload.session.status, "completed");
  }, results);

  runTest("combat_return_rejects_non_participant_player_when_player_id_provided", () => {
    const context = createContext();
    enterSession(context, "player-loop-return-auth-001", "session-loop-return-auth-001", "dungeon-loop-return-auth-001");
    addStarterRooms(context, "session-loop-return-auth-001");

    const moved = processSessionMoveRequest({
      context,
      player_id: "player-loop-return-auth-001",
      session_id: "session-loop-return-auth-001",
      payload: { destination_id: "room-encounter" }
    });
    assert.equal(moved.ok, true);

    const returned = processSessionCombatReturnRequest({
      context,
      player_id: "player-outsider-return-auth-001",
      session_id: "session-loop-return-auth-001",
      combat_id: moved.payload.combat_handoff.combat_id,
      payload: { outcome: "victory" }
    });
    assert.equal(returned.ok, false);
    assert.equal(returned.error, "player is not a participant in this session");
  }, results);

  runTest("reward_grant_is_single_fire_and_duplicate_reward_is_rejected", () => {
    const context = createContext();
    const playerId = "player-loop-005";
    const sessionId = "session-loop-005";
    enterSession(context, playerId, sessionId, "dungeon-loop-005");
    addStarterRooms(context, sessionId);

    const moved = processSessionMoveRequest({
      context,
      player_id: playerId,
      session_id: sessionId,
      payload: { destination_id: "room-encounter" }
    });
    assert.equal(moved.ok, true);

    const combatReturn = processSessionCombatReturnRequest({
      context,
      session_id: sessionId,
      combat_id: moved.payload.combat_handoff.combat_id,
      payload: { outcome: "victory" }
    });
    assert.equal(combatReturn.ok, true);

    const inventoryId = "inventory-loop-005";
    const createdInventory = context.inventoryPersistence.saveInventory(
      createInventoryRecord({
        inventory_id: inventoryId,
        owner_type: "player",
        owner_id: playerId
      })
    );
    assert.equal(createdInventory.ok, true);

    const hookOne = prepareRewardHook({
      manager: context.sessionManager,
      session_id: sessionId,
      reward_context: "encounter_clear"
    });
    assert.equal(hookOne.ok, true);

    const lootTable = createLootTableObject({
      loot_table_id: "loot-loop-005",
      name: "Loop Reward",
      guaranteed_entries: [{ item_id: "item_rat_tail", quantity: 1 }],
      weighted_entries: []
    });
    const consumed = consumeRewardHook({
      reward_hook: {
        ...hookOne.payload.reward_event.payload,
        target_player_id: playerId,
        loot_table_id: "loot-loop-005"
      },
      loot_table: lootTable
    });
    assert.equal(consumed.ok, true);

    const rolled = rollLoot({
      ...consumed.payload.next_step.roll_input,
      random_fn: () => 0
    });
    assert.equal(rolled.ok, true);

    const granted = grantLootToInventory({
      inventory_service: buildInventoryService(context.inventoryPersistence),
      inventory_id: inventoryId,
      owner_id: playerId,
      loot_bundle: rolled.payload.loot_bundle
    });
    assert.equal(granted.ok, true);

    const hookTwo = prepareRewardHook({
      manager: context.sessionManager,
      session_id: sessionId,
      reward_context: "encounter_clear"
    });
    assert.equal(hookTwo.ok, false);
    assert.equal(hookTwo.error, "reward already consumed for room/context");
  }, results);

  runTest("multiple_sessions_remain_isolated", () => {
    const context = createContext();
    enterSession(context, "player-loop-006A", "session-loop-006A", "dungeon-loop-006");
    enterSession(context, "player-loop-006B", "session-loop-006B", "dungeon-loop-006");
    addStarterRooms(context, "session-loop-006A");
    addStarterRooms(context, "session-loop-006B");

    const moveA = processSessionMoveRequest({
      context,
      player_id: "player-loop-006A",
      session_id: "session-loop-006A",
      payload: { destination_id: "room-encounter" }
    });
    assert.equal(moveA.ok, true);

    const sessionA = context.sessionManager.getSessionById("session-loop-006A");
    const sessionB = context.sessionManager.getSessionById("session-loop-006B");
    assert.equal(sessionA.ok, true);
    assert.equal(sessionB.ok, true);
    assert.equal(sessionA.payload.session.current_room_id, "room-encounter");
    assert.equal(sessionB.payload.session.current_room_id, "room-entry");
    assert.equal(Boolean(sessionA.payload.session.active_combat_id), true);
    assert.equal(Boolean(sessionB.payload.session.active_combat_id), false);
  }, results);

  runTest("ended_session_is_cleaned_up_and_rejects_further_actions", () => {
    const context = createContext();
    enterSession(context, "player-loop-leave-001", "session-loop-leave-001", "dungeon-loop-leave-001");
    addStarterRooms(context, "session-loop-leave-001");

    const left = processLeaveSessionRequest({
      context,
      player_id: "player-loop-leave-001",
      session_id: "session-loop-leave-001"
    });
    assert.equal(left.ok, true);
    assert.equal(left.payload.deleted, true);

    const moved = processSessionMoveRequest({
      context,
      player_id: "player-loop-leave-001",
      session_id: "session-loop-leave-001",
      payload: { destination_id: "room-encounter" }
    });
    assert.equal(moved.ok, false);
    assert.equal(moved.error, "no active session found");
  }, results);

  const passed = results.filter((x) => x.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    totals: {
      total: results.length,
      passed,
      failed
    },
    results
  };
}

if (require.main === module) {
  const summary = runDungeonLoopStabilizationTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runDungeonLoopStabilizationTests
};
