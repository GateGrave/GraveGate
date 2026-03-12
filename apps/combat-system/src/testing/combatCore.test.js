"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runCombatCoreTests() {
  const results = [];

  runTest("creating_combat", () => {
    const manager = new CombatManager();
    const out = manager.createCombat({ combat_id: "combat-test-001" });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "combat_created");
    assert.equal(out.payload.combat.combat_id, "combat-test-001");
  }, results);

  runTest("retrieving_combat", () => {
    const manager = new CombatManager();
    manager.createCombat({ combat_id: "combat-test-001" });

    const out = manager.getCombatById("combat-test-001");
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "combat_found");
    assert.equal(out.payload.combat.combat_id, "combat-test-001");
  }, results);

  runTest("adding_participants", () => {
    const manager = new CombatManager();
    manager.createCombat({ combat_id: "combat-test-001" });

    const addOut = manager.addParticipant({
      combat_id: "combat-test-001",
      participant: {
        participant_id: "player-001",
        name: "Test Fighter"
      }
    });

    assert.equal(addOut.ok, true);
    assert.equal(addOut.event_type, "combat_participant_added");
    assert.equal(addOut.payload.participant_count, 1);
  }, results);

  runTest("listing_participants", () => {
    const manager = new CombatManager();
    manager.createCombat({ combat_id: "combat-test-001" });
    manager.addParticipant({
      combat_id: "combat-test-001",
      participant: {
        participant_id: "player-001",
        name: "Test Fighter"
      }
    });

    const out = manager.listParticipants("combat-test-001");
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "combat_participants_listed");
    assert.equal(out.payload.participants.length, 1);
    assert.equal(out.payload.participants[0].participant_id, "player-001");
  }, results);

  runTest("concurrent_combat_instances_are_isolated", () => {
    const manager = new CombatManager();
    manager.createCombat({ combat_id: "combat-test-a" });
    manager.createCombat({ combat_id: "combat-test-b" });

    manager.addParticipant({
      combat_id: "combat-test-a",
      participant: {
        participant_id: "a-player-001",
        name: "A Fighter"
      }
    });

    const a = manager.listParticipants("combat-test-a");
    const b = manager.listParticipants("combat-test-b");
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(a.payload.participants.length, 1);
    assert.equal(b.payload.participants.length, 0);
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
  const summary = runCombatCoreTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCombatCoreTests
};
