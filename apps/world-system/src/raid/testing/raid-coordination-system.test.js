"use strict";

const assert = require("assert");
const {
  RaidManager,
  InMemoryRaidStore,
  joinRaidParty,
  leaveRaidParty,
  markRaidPartyReady,
  markRaidPlayerReady,
  setRaidCoordinationLock,
  validateMultiPartyParticipation
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createRaidManager() {
  const raidManager = new RaidManager({
    store: new InMemoryRaidStore()
  });

  raidManager.createRaidInstance({
    raid_id: "raid-001",
    raid_name: "Vault of Ash",
    participating_party_ids: [],
    participating_player_ids: [],
    raid_state: {},
    encounter_state: {},
    raid_status: "pending"
  });
  return raidManager;
}

function runRaidCoordinationSystemTests() {
  const results = [];

  runTest("party_joins_raid", () => {
    const raidManager = createRaidManager();
    const out = joinRaidParty({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-001",
      player_ids: ["player-001", "player-002"]
    });
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "raid_party_joined");
  }, results);

  runTest("party_leaves_raid", () => {
    const raidManager = createRaidManager();
    joinRaidParty({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-001",
      player_ids: ["player-001", "player-002"]
    });

    const out = leaveRaidParty({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-001"
    });
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "raid_party_left");
  }, results);

  runTest("readiness_tracking", () => {
    const raidManager = createRaidManager();
    joinRaidParty({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-001",
      player_ids: ["player-001", "player-002"],
      require_all_players_ready: true
    });

    const readyPlayer1 = markRaidPlayerReady({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-001",
      player_id: "player-001",
      ready: true
    });
    const readyPlayer2 = markRaidPlayerReady({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-001",
      player_id: "player-002",
      ready: true
    });
    const readyParty = markRaidPartyReady({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-001",
      ready: true
    });

    assert.equal(readyPlayer1.ok, true);
    assert.equal(readyPlayer2.ok, true);
    assert.equal(readyParty.ok, true);

    const validation = validateMultiPartyParticipation({
      raidManager,
      raid_id: "raid-001",
      min_parties: 1
    });
    assert.equal(validation.ok, true);
    assert.equal(validation.payload.ready_party_count, 1);
  }, results);

  runTest("invalid_duplicate_join_rejection", () => {
    const raidManager = createRaidManager();
    const first = joinRaidParty({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-001",
      player_ids: ["player-001", "player-002"]
    });
    const second = joinRaidParty({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-001",
      player_ids: ["player-001", "player-002"]
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.payload.reason, "party_already_joined");
  }, results);

  runTest("leaving_updates_participant_state_correctly", () => {
    const raidManager = createRaidManager();
    joinRaidParty({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-001",
      player_ids: ["player-001", "player-002"]
    });
    joinRaidParty({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-002",
      player_ids: ["player-003"]
    });

    leaveRaidParty({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-001"
    });

    const raid = raidManager.getRaidInstance("raid-001");
    assert.equal(raid.participating_party_ids.includes("party-001"), false);
    assert.equal(raid.participating_player_ids.includes("player-001"), false);
    assert.equal(raid.participating_party_ids.includes("party-002"), true);
  }, results);

  runTest("coordination_lock_behavior", () => {
    const raidManager = createRaidManager();
    const locked = setRaidCoordinationLock({
      raidManager,
      raid_id: "raid-001",
      lock: true
    });
    const joinBlocked = joinRaidParty({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-001",
      player_ids: ["player-001"]
    });
    const unlocked = setRaidCoordinationLock({
      raidManager,
      raid_id: "raid-001",
      lock: false
    });
    const joinAllowed = joinRaidParty({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-001",
      player_ids: ["player-001"]
    });

    assert.equal(locked.ok, true);
    assert.equal(joinBlocked.ok, false);
    assert.equal(joinBlocked.payload.reason, "coordination_locked");
    assert.equal(unlocked.ok, true);
    assert.equal(joinAllowed.ok, true);
  }, results);

  runTest("malformed_party_participation_handling", () => {
    const raidManager = createRaidManager();
    const missingPartyId = joinRaidParty({
      raidManager,
      raid_id: "raid-001",
      party_id: "",
      player_ids: ["player-001"]
    });
    const missingPlayerIds = joinRaidParty({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-001",
      player_ids: []
    });

    assert.equal(missingPartyId.ok, false);
    assert.equal(missingPartyId.payload.reason, "party_id_required");
    assert.equal(missingPlayerIds.ok, false);
    assert.equal(missingPlayerIds.payload.reason, "player_ids_required");
  }, results);

  runTest("stale_readiness_state_handling", () => {
    const raidManager = createRaidManager();
    joinRaidParty({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-001",
      player_ids: ["player-001", "player-002"],
      require_all_players_ready: true
    });

    markRaidPlayerReady({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-001",
      player_id: "player-001",
      ready: true
    });

    // mutate to stale player list; refresh happens on next flow call
    raidManager.updateRaidInstance("raid-001", (raid) => {
      const next = clone(raid);
      next.raid_state.coordination_state.parties["party-001"].player_ids = ["player-001"];
      return next;
    });

    const readyParty = markRaidPartyReady({
      raidManager,
      raid_id: "raid-001",
      party_id: "party-001",
      ready: true
    });

    const raid = raidManager.getRaidInstance("raid-001");
    const playersReady = raid.raid_state.coordination_state.parties["party-001"].players_ready;
    assert.equal(readyParty.ok, true);
    assert.equal(playersReady["player-002"], undefined);
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

if (require.main === module) {
  const summary = runRaidCoordinationSystemTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runRaidCoordinationSystemTests
};

