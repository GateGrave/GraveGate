"use strict";

const assert = require("assert");
const { createInMemoryAdapter } = require("../../../../database/src/adapters/inMemoryAdapter");
const { PartyService } = require("../party.service");
const { PartyPersistenceBridge } = require("../party.persistence");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createService() {
  const partyPersistence = new PartyPersistenceBridge({
    adapter: createInMemoryAdapter()
  });
  return new PartyService({ partyPersistence });
}

function runPartyFoundationTests() {
  const results = [];

  runTest("party_creation_produces_valid_party_state", () => {
    const service = createService();
    const created = service.createParty({
      party_id: "party-foundation-001",
      leader_player_id: "player-party-leader-001"
    });

    assert.equal(created.ok, true);
    assert.equal(created.payload.party.party_id, "party-foundation-001");
    assert.equal(created.payload.party.leader_player_id, "player-party-leader-001");
    assert.deepEqual(created.payload.party.member_player_ids, ["player-party-leader-001"]);
  }, results);

  runTest("invite_join_leave_flow_is_stable", () => {
    const service = createService();
    service.createParty({
      party_id: "party-foundation-002",
      leader_player_id: "player-party-leader-002"
    });

    const invited = service.inviteMember({
      party_id: "party-foundation-002",
      acting_player_id: "player-party-leader-002",
      target_player_id: "player-party-member-002"
    });
    assert.equal(invited.ok, true);

    const joined = service.joinParty({
      party_id: "party-foundation-002",
      player_id: "player-party-member-002"
    });
    assert.equal(joined.ok, true);
    assert.equal(joined.payload.party.member_player_ids.includes("player-party-member-002"), true);

    const left = service.leaveParty({
      party_id: "party-foundation-002",
      player_id: "player-party-member-002"
    });
    assert.equal(left.ok, true);
    assert.equal(left.payload.party.member_player_ids.includes("player-party-member-002"), false);
  }, results);

  runTest("duplicate_membership_and_invalid_removal_fail_safely", () => {
    const service = createService();
    service.createParty({
      party_id: "party-foundation-003",
      leader_player_id: "player-party-leader-003"
    });
    service.inviteMember({
      party_id: "party-foundation-003",
      acting_player_id: "player-party-leader-003",
      target_player_id: "player-party-member-003"
    });
    service.joinParty({
      party_id: "party-foundation-003",
      player_id: "player-party-member-003"
    });

    const duplicate = service.joinParty({
      party_id: "party-foundation-003",
      player_id: "player-party-member-003"
    });
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.error, "player is already a party member");

    const invalidRemove = service.removeMember({
      party_id: "party-foundation-003",
      acting_player_id: "player-party-leader-003",
      target_player_id: "player-not-in-party"
    });
    assert.equal(invalidRemove.ok, false);
    assert.equal(invalidRemove.error, "target player is not a party member");
  }, results);

  runTest("party_disband_removes_party_from_persistence", () => {
    const service = createService();
    const created = service.createParty({
      party_id: "party-foundation-004",
      leader_player_id: "player-party-leader-004"
    });
    assert.equal(created.ok, true);

    const disbanded = service.disbandParty({
      party_id: "party-foundation-004",
      acting_player_id: "player-party-leader-004"
    });
    assert.equal(disbanded.ok, true);
    assert.equal(disbanded.payload.deleted, true);

    const loaded = service.getPartyById("party-foundation-004");
    assert.equal(loaded.ok, false);
    assert.equal(loaded.error, "party not found");
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
  const summary = runPartyFoundationTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runPartyFoundationTests
};

