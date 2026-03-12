"use strict";

const {
  DUNGEON_SESSION_SCHEMA,
  createDungeonSessionRecord,
  isDungeonSessionShapeValid
} = require("./schema/dungeon-session.schema");
const {
  DUNGEON_ROOM_SCHEMA,
  createRoom,
  markRoomDiscovered,
  markRoomCleared,
  getRoomExits
} = require("./models/dungeon-room.model");
const {
  CHALLENGE_SOLUTIONS,
  DUNGEON_CHALLENGE_SCHEMA,
  createChallenge
} = require("./models/dungeon-challenge.model");
const { InMemoryDungeonSessionStore } = require("./store/in-memory-dungeon-session-store");
const { DungeonSessionManager } = require("./manager/dungeon-session-manager");
const {
  lockDungeonSession,
  unlockDungeonSession,
  isDungeonSessionLocked
} = require("./locks/dungeon-session-lock");
const { processDungeonSessionEventSafe } = require("./processing/process-dungeon-session-event-safe");
const {
  moveParty,
  validateLeader,
  checkExitConnection,
  transferLeader
} = require("./movement/party-movement");
const {
  ROOM_ENTRY_OUTCOMES,
  NEXT_SYSTEMS,
  resolveRoomEntry
} = require("./resolvers/room-entry.resolver");
const {
  InMemoryChallengeStore,
  resolveChallenge,
  createDefaultChallengeStore
} = require("./resolvers/challenge.resolver");
const {
  checkDungeonCompletion,
  hasBossBeenDefeated,
  isFinalRoomCleared,
  isObjectiveCompleted
} = require("./validators/dungeon-completion.validator");
const { createSnapshot, restoreSnapshot } = require("./snapshots/dungeon-session.snapshot");
const {
  REWARD_TRIGGER_TYPES,
  createRewardTriggerPayload,
  onEncounterCleared,
  onBossDefeated,
  onChestOpened,
  onDungeonCompleted
} = require("./hooks/reward-triggers.hooks");
const { DungeonSimulationRunner } = require("./testing/dungeon-simulation-runner");
const { SessionPersistenceBridge } = require("./session.persistence");
const {
  processEnterDungeonRequest,
  processLeaveSessionRequest
} = require("./flow/processSessionLifecycleRequest");
const {
  processSessionMoveRequest,
  processSessionCombatReturnRequest
} = require("./flow/processActiveSessionAction");

// Tiny scaffolding example for local checks.
function mockDungeonSessionFlow() {
  const manager = new DungeonSessionManager();

  const created = manager.createDungeonSession({
    session_id: "session-001",
    party_id: "party-alpha",
    dungeon_type: "crypt",
    floor_number: 1,
    leader_id: "player-001",
    movement_locked: false
  });

  const updated = manager.updateDungeonSession(created.session_id, {
    current_room_id: "room-A1"
  });

  return {
    created,
    updated,
    active: manager.listActiveDungeonSessions()
  };
}

async function mockDungeonSessionLockFlow() {
  const manager = new DungeonSessionManager();
  manager.createDungeonSession({
    session_id: "session-lock-001",
    party_id: "party-alpha",
    dungeon_type: "crypt",
    floor_number: 1,
    leader_id: "player-001",
    movement_locked: false
  });

  const processed = await processDungeonSessionEventSafe({
    manager,
    event: {
      event_id: "evt-session-001",
      event_type: "session_room_updated",
      session_id: "session-lock-001",
      payload: {
        current_room_id: "room-B2"
      }
    },
    processEventFn: async ({ event }) => ({
      statePatch: {
        current_room_id: event.payload.current_room_id
      },
      output: {
        event_type: "session_room_updated_result",
        session_id: event.session_id
      }
    })
  });

  return {
    processed,
    is_locked_after: isDungeonSessionLocked(manager, "session-lock-001")
  };
}

module.exports = {
  DUNGEON_SESSION_SCHEMA,
  DUNGEON_ROOM_SCHEMA,
  DUNGEON_CHALLENGE_SCHEMA,
  createDungeonSessionRecord,
  isDungeonSessionShapeValid,
  CHALLENGE_SOLUTIONS,
  createRoom,
  markRoomDiscovered,
  markRoomCleared,
  getRoomExits,
  createChallenge,
  InMemoryDungeonSessionStore,
  DungeonSessionManager,
  lockDungeonSession,
  unlockDungeonSession,
  isDungeonSessionLocked,
  processDungeonSessionEventSafe,
  moveParty,
  validateLeader,
  checkExitConnection,
  transferLeader,
  ROOM_ENTRY_OUTCOMES,
  NEXT_SYSTEMS,
  resolveRoomEntry,
  InMemoryChallengeStore,
  resolveChallenge,
  createDefaultChallengeStore,
  checkDungeonCompletion,
  hasBossBeenDefeated,
  isFinalRoomCleared,
  isObjectiveCompleted,
  createSnapshot,
  restoreSnapshot,
  REWARD_TRIGGER_TYPES,
  createRewardTriggerPayload,
  onEncounterCleared,
  onBossDefeated,
  onChestOpened,
  onDungeonCompleted,
  SessionPersistenceBridge,
  processEnterDungeonRequest,
  processLeaveSessionRequest,
  processSessionMoveRequest,
  processSessionCombatReturnRequest,
  DungeonSimulationRunner,
  mockDungeonSessionFlow,
  mockDungeonSessionLockFlow
};
