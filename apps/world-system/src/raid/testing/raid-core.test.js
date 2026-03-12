"use strict";

const assert = require("assert");
const {
  RaidManager,
  InMemoryRaidStore,
  createRaidRecord
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createManager() {
  return new RaidManager({
    store: new InMemoryRaidStore()
  });
}

function baseRaid(overrides) {
  return {
    raid_id: "raid-001",
    raid_name: "Vault of Ash",
    participating_party_ids: ["party-001", "party-002"],
    participating_player_ids: ["player-001", "player-002", "player-003"],
    raid_state: { stage: "entry" },
    encounter_state: { encounter_id: "enc-001", status: "pending" },
    raid_status: "pending",
    ...(overrides || {})
  };
}

function runRaidCoreTests() {
  const results = [];

  runTest("raid_creation", () => {
    const manager = createManager();
    const created = manager.createRaidInstance(baseRaid());
    assert.equal(created.raid_id, "raid-001");
    assert.equal(created.raid_name, "Vault of Ash");
  }, results);

  runTest("fetch_raid", () => {
    const manager = createManager();
    manager.createRaidInstance(baseRaid());
    const loaded = manager.getRaidInstance("raid-001");
    assert.ok(loaded);
    assert.equal(loaded.raid_status, "pending");
  }, results);

  runTest("update_raid", () => {
    const manager = createManager();
    manager.createRaidInstance(baseRaid());
    const updated = manager.updateRaidInstance("raid-001", {
      raid_status: "active",
      raid_state: { stage: "boss_room" }
    });
    assert.equal(updated.raid_status, "active");
    assert.equal(updated.raid_state.stage, "boss_room");
  }, results);

  runTest("delete_raid", () => {
    const manager = createManager();
    manager.createRaidInstance(baseRaid());
    const deleted = manager.deleteRaidInstance("raid-001");
    const loaded = manager.getRaidInstance("raid-001");
    assert.equal(deleted, true);
    assert.equal(loaded, null);
  }, results);

  runTest("list_participants", () => {
    const manager = createManager();
    manager.createRaidInstance(baseRaid());
    const participants = manager.listRaidParticipants("raid-001");
    assert.equal(participants.participating_party_ids.length, 2);
    assert.equal(participants.participating_player_ids.length, 3);
  }, results);

  runTest("malformed_raid_rejection", () => {
    assert.throws(() => createRaidRecord({}), /raid_id/);
    assert.throws(() => createRaidRecord(baseRaid({ raid_name: "" })), /raid_name/);
    assert.throws(() => createRaidRecord(baseRaid({ raid_state: "bad" })), /raid_state must be an object/);
  }, results);

  runTest("duplicate_player_party_handling", () => {
    const manager = createManager();
    const created = manager.createRaidInstance(
      baseRaid({
        participating_party_ids: ["party-001", "party-001", "party-002"],
        participating_player_ids: ["player-001", "player-001", "player-002"]
      })
    );
    assert.equal(created.participating_party_ids.length, 2);
    assert.equal(created.participating_player_ids.length, 2);
  }, results);

  runTest("invalid_raid_state_handling", () => {
    assert.throws(
      () => createRaidRecord(baseRaid({ raid_status: "not-a-valid-status" })),
      /raid_status must be one of/
    );
    assert.throws(
      () => createRaidRecord(baseRaid({ encounter_state: [] })),
      /encounter_state must be an object/
    );
  }, results);

  runTest("duplicate_raid_id_handling", () => {
    const manager = createManager();
    manager.createRaidInstance(baseRaid());
    assert.throws(() => manager.createRaidInstance(baseRaid({ raid_name: "Duplicate Raid" })), /unique raid_id/);
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
  const summary = runRaidCoreTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runRaidCoreTests
};

