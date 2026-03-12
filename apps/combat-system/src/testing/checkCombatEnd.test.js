"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { checkCombatEnd } = require("../flow/checkCombatEnd");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createCombatForEndChecks() {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: "combat-end-001",
    status: "active",
    round: 2,
    turn_index: 0,
    initiative_order: ["a1", "b1"],
    participants: [
      {
        participant_id: "a1",
        name: "Knight",
        team: "alpha",
        armor_class: 14,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 3,
        damage: 5
      },
      {
        participant_id: "b1",
        name: "Raider",
        team: "beta",
        armor_class: 12,
        current_hp: 8,
        max_hp: 8,
        attack_bonus: 2,
        damage: 4
      }
    ],
    event_log: []
  });
  return manager;
}

function runCheckCombatEndTests() {
  const results = [];

  runTest("combat_continues_when_multiple_teams_remain", () => {
    const manager = createCombatForEndChecks();
    const out = checkCombatEnd({
      combatManager: manager,
      combat_id: "combat-end-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "combat_continues");
    assert.equal(out.payload.living_team_count, 2);

    const loaded = manager.getCombatById("combat-end-001");
    assert.equal(loaded.payload.combat.status, "active");
  }, results);

  runTest("combat_ends_when_one_team_remains", () => {
    const manager = createCombatForEndChecks();
    const loaded = manager.getCombatById("combat-end-001");
    const combat = loaded.payload.combat;
    combat.participants[1].current_hp = 0; // beta defeated
    manager.combats.set("combat-end-001", combat);

    const out = checkCombatEnd({
      combatManager: manager,
      combat_id: "combat-end-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "combat_completed");
    assert.equal(out.payload.winner_team, "alpha");
    assert.equal(out.payload.winner_participants.length, 1);
    assert.equal(out.payload.winner_participants[0].participant_id, "a1");

    const after = manager.getCombatById("combat-end-001");
    assert.equal(after.payload.combat.status, "complete");
    assert.equal(after.payload.combat.event_log.length, 1);
    assert.equal(after.payload.combat.event_log[0].event_type, "combat_completed");
  }, results);

  runTest("completed_combat_does_not_emit_duplicate_completion_side_effects", () => {
    const manager = createCombatForEndChecks();
    const loaded = manager.getCombatById("combat-end-001");
    const combat = loaded.payload.combat;
    combat.participants[1].current_hp = 0;
    manager.combats.set("combat-end-001", combat);

    const first = checkCombatEnd({
      combatManager: manager,
      combat_id: "combat-end-001"
    });
    assert.equal(first.ok, true);
    assert.equal(first.event_type, "combat_completed");

    const second = checkCombatEnd({
      combatManager: manager,
      combat_id: "combat-end-001"
    });
    assert.equal(second.ok, true);
    assert.equal(second.event_type, "combat_already_completed");

    const after = manager.getCombatById("combat-end-001");
    assert.equal(after.ok, true);
    assert.equal(after.payload.combat.event_log.length, 1);
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
  const summary = runCheckCombatEndTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCheckCombatEndTests
};
