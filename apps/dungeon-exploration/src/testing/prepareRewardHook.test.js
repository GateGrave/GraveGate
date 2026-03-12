"use strict";

const assert = require("assert");
const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { DungeonSessionManagerCore } = require("../core/dungeonSessionManager");
const { createRoomObject } = require("../rooms/roomModel");
const { prepareRewardHook } = require("../flow/prepareRewardHook");
const { SessionPersistenceBridge } = require("../session.persistence");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function setupSession(roomOverrides) {
  const manager = new DungeonSessionManagerCore();

  manager.createSession({
    session_id: "session-reward-001",
    dungeon_id: "dungeon-reward-001",
    status: "active"
  });

  manager.setParty({
    session_id: "session-reward-001",
    party: {
      party_id: "party-reward-001",
      members: ["player-001", "player-002"]
    }
  });

  manager.addRoomToSession({
    session_id: "session-reward-001",
    room: createRoomObject(
      Object.assign(
        {
          room_id: "room-RW1",
          room_type: "encounter",
          encounter: { encounter_id: "enc-001" }
        },
        roomOverrides || {}
      )
    )
  });

  manager.setStartRoom({
    session_id: "session-reward-001",
    room_id: "room-RW1"
  });

  return manager;
}

function runPrepareRewardHookTests() {
  const results = [];

  runTest("encounter_reward_hook_preparation", () => {
    const manager = setupSession();

    const out = prepareRewardHook({
      manager,
      session_id: "session-reward-001",
      reward_context: "encounter_clear"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dungeon_reward_hook_prepared");
    assert.equal(out.payload.reward_context, "encounter_clear");
    assert.equal(out.payload.reward_event.payload.source_type, "encounter");
  }, results);

  runTest("boss_reward_hook_preparation", () => {
    const manager = setupSession({
      room_type: "boss",
      encounter: { encounter_id: "enc-boss-001", encounter_type: "boss" }
    });

    const out = prepareRewardHook({
      manager,
      session_id: "session-reward-001",
      reward_context: "boss_clear"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.reward_context, "boss_clear");
    assert.equal(out.payload.reward_event.payload.source_type, "boss");
    assert.equal(out.payload.reward_event.payload.source_id, "enc-boss-001");
  }, results);

  runTest("dungeon_completion_reward_hook_preparation", () => {
    const manager = setupSession();

    const out = prepareRewardHook({
      manager,
      session_id: "session-reward-001",
      reward_context: "dungeon_complete"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.reward_context, "dungeon_complete");
    assert.equal(out.payload.reward_event.payload.source_type, "dungeon");
  }, results);

  runTest("failure_if_session_missing", () => {
    const manager = new DungeonSessionManagerCore();

    const out = prepareRewardHook({
      manager,
      session_id: "session-missing-001",
      reward_context: "encounter_clear"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_reward_hook_prepare_failed");
    assert.equal(out.error, "session not found");
  }, results);

  runTest("failure_if_room_missing", () => {
    const manager = new DungeonSessionManagerCore();

    manager.createSession({
      session_id: "session-reward-002",
      dungeon_id: "dungeon-reward-002",
      status: "active"
    });

    manager.setCurrentRoom({
      session_id: "session-reward-002",
      current_room_id: "room-missing"
    });

    const out = prepareRewardHook({
      manager,
      session_id: "session-reward-002",
      reward_context: "encounter_clear"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_reward_hook_prepare_failed");
    assert.equal(out.error, "current room not found in session rooms");
  }, results);

  runTest("failure_if_session_not_active", () => {
    const manager = new DungeonSessionManagerCore();

    manager.createSession({
      session_id: "session-reward-ended-001",
      dungeon_id: "dungeon-reward-ended-001",
      status: "completed"
    });

    manager.addRoomToSession({
      session_id: "session-reward-ended-001",
      room: createRoomObject({
        room_id: "room-R9",
        room_type: "encounter"
      })
    });
    manager.setStartRoom({
      session_id: "session-reward-ended-001",
      room_id: "room-R9"
    });

    const out = prepareRewardHook({
      manager,
      session_id: "session-reward-ended-001",
      reward_context: "encounter_clear"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_reward_hook_prepare_failed");
    assert.equal(out.error, "session is not active");
  }, results);

  runTest("failure_if_session_still_has_active_combat_for_encounter_rewards", () => {
    const manager = setupSession();
    const live = manager.sessions.get("session-reward-001");
    live.active_combat_id = "combat-active-001";
    manager.sessions.set("session-reward-001", live);

    const out = prepareRewardHook({
      manager,
      session_id: "session-reward-001",
      reward_context: "encounter_clear"
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "session still has active combat");
  }, results);

  runTest("prepared_reward_state_persists_and_blocks_duplicate_after_reload", () => {
    const adapter = createInMemoryAdapter();
    const manager = setupSession();
    const sessionPersistence = new SessionPersistenceBridge({ adapter });
    const saveOut = sessionPersistence.saveSession(manager.getSessionById("session-reward-001").payload.session);
    assert.equal(saveOut.ok, true);

    const first = prepareRewardHook({
      manager,
      sessionPersistence,
      session_id: "session-reward-001",
      reward_context: "encounter_clear"
    });
    assert.equal(first.ok, true);

    const reloaded = sessionPersistence.loadSessionById("session-reward-001");
    assert.equal(reloaded.ok, true);
    assert.equal(Array.isArray(reloaded.payload.session.reward_state.consumed_keys), true);
    assert.equal(reloaded.payload.session.reward_state.consumed_keys.includes("room-RW1:encounter_clear"), true);

    manager.sessions.set("session-reward-001", reloaded.payload.session);

    const second = prepareRewardHook({
      manager,
      sessionPersistence,
      session_id: "session-reward-001",
      reward_context: "encounter_clear"
    });
    assert.equal(second.ok, false);
    assert.equal(second.error, "reward already consumed for room/context");
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
  const summary = runPrepareRewardHookTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runPrepareRewardHookTests
};
