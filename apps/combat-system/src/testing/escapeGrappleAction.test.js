"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { performEscapeGrappleAction } = require("../actions/escapeGrappleAction");
const { applyConditionToCombatState } = require("../conditions/conditionHelpers");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createActiveCombatForEscapeTests() {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: "combat-escape-001",
    status: "active",
    round: 1,
    turn_index: 0,
    initiative_order: ["p1", "p2"],
    participants: [
      {
        participant_id: "p1",
        name: "Hero",
        team: "A",
        armor_class: 12,
        current_hp: 10,
        max_hp: 10,
        position: { x: 1, y: 1 },
        stats: { strength: 12, dexterity: 16 }
      },
      {
        participant_id: "p2",
        name: "Goblin",
        team: "B",
        armor_class: 11,
        current_hp: 10,
        max_hp: 10,
        position: { x: 2, y: 1 },
        stats: { strength: 12, dexterity: 10 }
      }
    ],
    conditions: [],
    event_log: []
  });
  const combat = manager.getCombatById("combat-escape-001").payload.combat;
  const applied = applyConditionToCombatState(combat, {
    condition_type: "grappled",
    source_actor_id: "p2",
    target_actor_id: "p1",
    expiration_trigger: "manual"
  });
  manager.combats.set("combat-escape-001", applied.next_state);
  return manager;
}

function runEscapeGrappleActionTests() {
  const results = [];

  runTest("successful_escape_removes_grappled_condition_and_consumes_action", () => {
    const manager = createActiveCombatForEscapeTests();
    const out = performEscapeGrappleAction({
      combatManager: manager,
      combat_id: "combat-escape-001",
      participant_id: "p1",
      contest_roll_fn(_participant, _ability, _combat, role) {
        return role === "attacker" ? 18 : 5;
      }
    });
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "escape_grapple_action_resolved");
    assert.equal(out.payload.escaped, true);
    const combat = manager.getCombatById("combat-escape-001").payload.combat;
    const actor = combat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(actor.action_available, false);
    assert.equal(combat.conditions.some((entry) => String(entry && entry.condition_type || "") === "grappled" && String(entry.target_actor_id || "") === "p1"), false);
  }, results);

  runTest("escape_fails_when_not_grappled", () => {
    const manager = createActiveCombatForEscapeTests();
    const combat = manager.getCombatById("combat-escape-001").payload.combat;
    combat.conditions = [];
    manager.combats.set("combat-escape-001", combat);
    const out = performEscapeGrappleAction({
      combatManager: manager,
      combat_id: "combat-escape-001",
      participant_id: "p1"
    });
    assert.equal(out.ok, false);
    assert.equal(out.error, "participant is not grappled");
  }, results);

  const passed = results.filter((x) => x.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    totals: { total: results.length, passed, failed },
    results
  };
}

if (require.main === module) {
  const summary = runEscapeGrappleActionTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runEscapeGrappleActionTests
};
