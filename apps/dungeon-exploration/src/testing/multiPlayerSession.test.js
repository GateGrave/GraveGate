"use strict";

const assert = require("assert");
const { DungeonSessionManagerCore } = require("../core/dungeonSessionManager");
const { SessionPersistenceBridge } = require("../session.persistence");
const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createSeedSession(manager, sessionId) {
  const created = manager.createSession({
    session_id: sessionId,
    dungeon_id: "dungeon-multi-001",
    status: "active"
  });
  assert.equal(created.ok, true);
}

function runMultiPlayerSessionTests() {
  const results = [];

  runTest("multi_player_dungeon_session_validation", () => {
    const manager = new DungeonSessionManagerCore();
    createSeedSession(manager, "session-multi-001");

    const addLeader = manager.addPartyParticipant({
      session_id: "session-multi-001",
      participant: { player_id: "player-001", character_id: "char-001", name: "Leader" }
    });
    const addSecond = manager.addPartyParticipant({
      session_id: "session-multi-001",
      participant: { player_id: "player-002", character_id: "char-002", name: "Scout" }
    });

    assert.equal(addLeader.ok, true);
    assert.equal(addSecond.ok, true);

    const listed = manager.listPartyParticipants("session-multi-001");
    assert.equal(listed.ok, true);
    assert.equal(Array.isArray(listed.payload.members), true);
    assert.equal(listed.payload.members.length, 2);
  }, results);

  runTest("multi_player_participant_remove", () => {
    const manager = new DungeonSessionManagerCore();
    createSeedSession(manager, "session-multi-002");
    manager.addPartyParticipant({
      session_id: "session-multi-002",
      participant: { player_id: "player-001", character_id: "char-001" }
    });
    manager.addPartyParticipant({
      session_id: "session-multi-002",
      participant: { player_id: "player-002", character_id: "char-002" }
    });

    const removed = manager.removePartyParticipant({
      session_id: "session-multi-002",
      player_id: "player-002"
    });
    assert.equal(removed.ok, true);
    assert.equal(removed.payload.member_count, 1);
  }, results);

  runTest("multi_player_session_persistence_survival", () => {
    const manager = new DungeonSessionManagerCore();
    createSeedSession(manager, "session-multi-003");
    manager.addPartyParticipant({
      session_id: "session-multi-003",
      participant: { player_id: "player-001", character_id: "char-001" }
    });
    manager.addPartyParticipant({
      session_id: "session-multi-003",
      participant: { player_id: "player-002", character_id: "char-002" }
    });

    const persistence = new SessionPersistenceBridge({ adapter: createInMemoryAdapter() });
    const loadedBefore = manager.getSessionById("session-multi-003");
    assert.equal(loadedBefore.ok, true);
    const saved = persistence.saveSession(loadedBefore.payload.session);
    assert.equal(saved.ok, true);

    const reloaded = persistence.loadSessionById("session-multi-003");
    assert.equal(reloaded.ok, true);
    const members = reloaded.payload.session.party && Array.isArray(reloaded.payload.session.party.members)
      ? reloaded.payload.session.party.members
      : [];
    assert.equal(members.length, 2);
  }, results);

  runTest("multi_player_session_missing_session_failure", () => {
    const manager = new DungeonSessionManagerCore();
    const out = manager.addPartyParticipant({
      session_id: "session-missing",
      participant: { player_id: "player-404" }
    });
    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_session_add_participant_failed");
    assert.equal(out.error, "session not found");
  }, results);

  runTest("existing_single_player_dungeon_flow_remains_valid", () => {
    const manager = new DungeonSessionManagerCore();
    createSeedSession(manager, "session-single-001");

    const addOnly = manager.addPartyParticipant({
      session_id: "session-single-001",
      participant: { player_id: "player-solo-001", character_id: "char-solo-001" }
    });
    assert.equal(addOnly.ok, true);

    const listed = manager.listPartyParticipants("session-single-001");
    assert.equal(listed.ok, true);
    assert.equal(listed.payload.members.length, 1);
    assert.equal(listed.payload.members[0].player_id, "player-solo-001");
  }, results);

  const passed = results.filter((entry) => entry.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    totals: { total: results.length, passed, failed },
    results
  };
}

if (require.main === module) {
  const summary = runMultiPlayerSessionTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runMultiPlayerSessionTests
};
