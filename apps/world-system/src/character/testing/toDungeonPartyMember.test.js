"use strict";

const assert = require("assert");
const { toDungeonPartyMember } = require("../adapters/toDungeonPartyMember");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runToDungeonPartyMemberTests() {
  const results = [];

  runTest("successful_conversion", () => {
    const out = toDungeonPartyMember({
      character: {
        character_id: "char-dungeon-001",
        player_id: "player-001",
        name: "Del",
        level: 3,
        status_flags: ["rested"],
        inventory_id: "inv-001"
      },
      inventory_ref: "inventory:inv-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dungeon_party_member_converted");
    assert.equal(out.payload.party_member.character_id, "char-dungeon-001");
    assert.equal(out.payload.party_member.player_id, "player-001");
    assert.equal(out.payload.party_member.level, 3);
    assert.deepEqual(out.payload.party_member.status_flags, ["rested"]);
    assert.equal(out.payload.party_member.inventory_id, "inv-001");
    assert.equal(out.payload.party_member.inventory_ref, "inventory:inv-001");
  }, results);

  runTest("sensible_defaults", () => {
    const out = toDungeonPartyMember({
      character: {
        character_id: "char-dungeon-002",
        name: "Default Delver"
      }
    });

    assert.equal(out.ok, true);
    const member = out.payload.party_member;
    assert.equal(member.player_id, null);
    assert.equal(member.level, 1);
    assert.deepEqual(member.status_flags, []);
    assert.equal(member.inventory_id, null);
    assert.equal(member.inventory_ref, null);
  }, results);

  runTest("preserving_core_character_identity", () => {
    const out = toDungeonPartyMember({
      character: {
        character_id: "char-dungeon-identity-001",
        player_id: "player-identity-001",
        name: "Identity Delver",
        level: 4,
        inventory_id: "inv-identity-001"
      }
    });

    assert.equal(out.ok, true);
    const member = out.payload.party_member;
    assert.equal(member.character_id, "char-dungeon-identity-001");
    assert.equal(member.player_id, "player-identity-001");
    assert.equal(member.name, "Identity Delver");
    assert.equal(member.level, 4);
    assert.equal(member.inventory_id, "inv-identity-001");
  }, results);

  runTest("failure_on_invalid_character_input", () => {
    const out = toDungeonPartyMember({
      character: {
        name: "Missing Id"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_party_member_conversion_failed");
    assert.equal(out.error, "character.character_id is required");
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
  const summary = runToDungeonPartyMemberTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runToDungeonPartyMemberTests
};
