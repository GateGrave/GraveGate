"use strict";

const assert = require("assert");
const { DungeonSessionManagerCore } = require("../core/dungeonSessionManager");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runDungeonSessionCoreTests() {
  const results = [];

  runTest("creating_session", () => {
    const manager = new DungeonSessionManagerCore();
    const out = manager.createSession({
      session_id: "dungeon-core-001",
      dungeon_id: "dungeon-alpha",
      status: "pending"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dungeon_session_created");
    assert.equal(out.payload.session.session_id, "dungeon-core-001");
  }, results);

  runTest("retrieving_session", () => {
    const manager = new DungeonSessionManagerCore();
    manager.createSession({
      session_id: "dungeon-core-001",
      dungeon_id: "dungeon-alpha"
    });

    const out = manager.getSessionById("dungeon-core-001");
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dungeon_session_found");
    assert.equal(out.payload.session.dungeon_id, "dungeon-alpha");
  }, results);

  runTest("assigning_party", () => {
    const manager = new DungeonSessionManagerCore();
    manager.createSession({
      session_id: "dungeon-core-001",
      dungeon_id: "dungeon-alpha"
    });

    const setParty = manager.setParty({
      session_id: "dungeon-core-001",
      party: {
        party_id: "party-001",
        members: ["player-001", "player-002"]
      }
    });
    assert.equal(setParty.ok, true);
    assert.equal(setParty.event_type, "dungeon_session_party_set");

    const getParty = manager.getParty("dungeon-core-001");
    assert.equal(getParty.ok, true);
    assert.equal(getParty.payload.party.party_id, "party-001");
    assert.equal(getParty.payload.party.members.length, 2);
  }, results);

  runTest("setting_current_room", () => {
    const manager = new DungeonSessionManagerCore();
    manager.createSession({
      session_id: "dungeon-core-001",
      dungeon_id: "dungeon-alpha"
    });

    const out = manager.setCurrentRoom({
      session_id: "dungeon-core-001",
      current_room_id: "room-A1"
    });
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dungeon_session_room_set");
    assert.equal(out.payload.current_room_id, "room-A1");
    assert.equal(out.payload.session.event_log.length, 1);
    assert.equal(out.payload.session.event_log[0].event_type, "dungeon_room_set");
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
  const summary = runDungeonSessionCoreTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runDungeonSessionCoreTests
};

