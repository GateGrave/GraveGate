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

function createCombatWithParticipants() {
  const manager = new CombatManager();
  manager.createCombat({ combat_id: "combat-init-001" });
  manager.addParticipant({
    combat_id: "combat-init-001",
    participant: { participant_id: "p1", name: "A", initiative_modifier: 2 }
  });
  manager.addParticipant({
    combat_id: "combat-init-001",
    participant: { participant_id: "p2", name: "B", initiative_modifier: 1 }
  });
  manager.addParticipant({
    combat_id: "combat-init-001",
    participant: { participant_id: "p3", name: "C", initiative_modifier: 0 }
  });
  return manager;
}

function runInitiativeTests() {
  const results = [];

  runTest("initiative_assignment", () => {
    const manager = createCombatWithParticipants();
    const out = manager.initializeInitiativeOrder({
      combat_id: "combat-init-001",
      roll_function: () => 10
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "initiative_initialized");
    assert.equal(out.payload.initiative_order.length, 3);
    assert.equal(Array.isArray(out.payload.initiative_entries), true);
  }, results);

  runTest("deterministic_initiative_order", () => {
    const manager = createCombatWithParticipants();
    const rollMap = { p1: 5, p2: 18, p3: 12 };
    const out = manager.initializeInitiativeOrder({
      combat_id: "combat-init-001",
      roll_function: (participant) => rollMap[participant.participant_id]
    });

    assert.equal(out.ok, true);
    // totals: p2=19, p3=12, p1=7
    assert.deepEqual(out.payload.initiative_order, ["p2", "p3", "p1"]);
  }, results);

  runTest("tie_handling_stable_rule", () => {
    const manager = createCombatWithParticipants();
    // totals: p1=12, p2=12, p3=10 -> p1 should stay before p2 (added earlier)
    const out = manager.initializeInitiativeOrder({
      combat_id: "combat-init-001",
      roll_function: (participant) => {
        if (participant.participant_id === "p1") return 10;
        if (participant.participant_id === "p2") return 11;
        return 10;
      }
    });

    assert.equal(out.ok, true);
    assert.deepEqual(out.payload.initiative_order, ["p1", "p2", "p3"]);
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
  const summary = runInitiativeTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runInitiativeTests
};

