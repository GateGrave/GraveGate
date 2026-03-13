"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { startCombat } = require("../flow/startCombat");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createManagerWithParticipants(participantCount) {
  const manager = new CombatManager();
  manager.createCombat({ combat_id: "combat-start-001" });

  if (participantCount >= 1) {
    manager.addParticipant({
      combat_id: "combat-start-001",
      participant: { participant_id: "p1", name: "Alpha", initiative_modifier: 0 }
    });
  }
  if (participantCount >= 2) {
    manager.addParticipant({
      combat_id: "combat-start-001",
      participant: { participant_id: "p2", name: "Bravo", initiative_modifier: 0 }
    });
  }
  if (participantCount >= 3) {
    manager.addParticipant({
      combat_id: "combat-start-001",
      participant: { participant_id: "p3", name: "Charlie", initiative_modifier: 0 }
    });
  }

  return manager;
}

function runStartCombatTests() {
  const results = [];

  runTest("successful_combat_start", () => {
    const manager = createManagerWithParticipants(3);
    const out = startCombat({
      combatManager: manager,
      combat_id: "combat-start-001",
      roll_function: () => 10
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "combat_started");
    assert.equal(out.payload.combat.status, "active");
    assert.equal(out.payload.combat.round, 1);
    assert.equal(out.payload.combat.turn_index, 0);
    assert.equal(Array.isArray(out.payload.combat.initiative_order), true);
    assert.equal(out.payload.combat.event_log.length, 1);
    assert.equal(out.payload.combat.event_log[0].event_type, "combat_started");
  }, results);

  runTest("failure_if_too_few_participants", () => {
    const manager = createManagerWithParticipants(1);
    const out = startCombat({
      combatManager: manager,
      combat_id: "combat-start-001",
      roll_function: () => 10
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "combat_start_failed");
    assert.equal(out.error, "combat needs at least 2 participants");
  }, results);

  runTest("failure_if_combat_missing", () => {
    const manager = new CombatManager();
    const out = startCombat({
      combatManager: manager,
      combat_id: "combat-missing-001",
      roll_function: () => 10
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "combat_start_failed");
    assert.equal(out.error, "combat not found");
  }, results);

  runTest("start_sets_first_living_participant_as_active_turn", () => {
    const manager = createManagerWithParticipants(3);
    const found = manager.getCombatById("combat-start-001");
    const combat = found.payload.combat;
    combat.participants[0].current_hp = 0; // p1 defeated before combat start
    manager.combats.set("combat-start-001", combat);

    const out = startCombat({
      combatManager: manager,
      combat_id: "combat-start-001",
      roll_function: () => 10
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.combat.status, "active");
    assert.equal(out.payload.combat.initiative_order[out.payload.combat.turn_index], "p2");
  }, results);

  runTest("cannot_restart_active_combat", () => {
    const manager = createManagerWithParticipants(2);
    const firstStart = startCombat({
      combatManager: manager,
      combat_id: "combat-start-001",
      roll_function: () => 10
    });
    assert.equal(firstStart.ok, true);

    const secondStart = startCombat({
      combatManager: manager,
      combat_id: "combat-start-001",
      roll_function: () => 10
    });

    assert.equal(secondStart.ok, false);
    assert.equal(secondStart.error, "combat is already active");
  }, results);

  runTest("initiative_modifier_controls_start_order_when_rolls_tie", () => {
    const manager = createManagerWithParticipants(2);
    const found = manager.getCombatById("combat-start-001");
    const combat = found.payload.combat;
    combat.participants[0].initiative_modifier = 0;
    combat.participants[1].initiative_modifier = 5;
    manager.combats.set("combat-start-001", combat);

    const out = startCombat({
      combatManager: manager,
      combat_id: "combat-start-001",
      roll_function: () => 10
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.combat.initiative_order[0], "p2");
    assert.equal(out.payload.combat.initiative_order[out.payload.combat.turn_index], "p2");
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
  const summary = runStartCombatTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runStartCombatTests
};
