"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { performDashAction } = require("../actions/dashAction");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createActiveCombatForDashTests() {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: "combat-dash-001",
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
        attack_bonus: 3,
        damage: 4,
        movement_speed: 30,
        movement_remaining: 10
      },
      {
        participant_id: "p2",
        name: "Goblin",
        team: "B",
        armor_class: 11,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 3
      }
    ],
    event_log: []
  });
  return manager;
}

function runDashActionTests() {
  const results = [];

  runTest("successful_dash_adds_movement_and_consumes_action", () => {
    const manager = createActiveCombatForDashTests();
    const out = performDashAction({
      combatManager: manager,
      combat_id: "combat-dash-001",
      participant_id: "p1"
    });
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dash_action_resolved");
    assert.equal(out.payload.movement_before, 10);
    assert.equal(out.payload.movement_added, 30);
    assert.equal(out.payload.movement_after, 40);
    const combat = manager.getCombatById("combat-dash-001").payload.combat;
    const actor = combat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(actor.action_available, false);
    assert.equal(actor.movement_remaining, 40);
    assert.equal(combat.event_log.some((entry) => String(entry && entry.event_type || "") === "dash_action"), true);
  }, results);

  runTest("dash_fails_when_not_actors_turn", () => {
    const manager = createActiveCombatForDashTests();
    const out = performDashAction({
      combatManager: manager,
      combat_id: "combat-dash-001",
      participant_id: "p2"
    });
    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dash_action_failed");
    assert.equal(out.error, "it is not the participant's turn");
  }, results);

  runTest("dash_can_consume_hasted_action_when_normal_action_is_spent", () => {
    const manager = createActiveCombatForDashTests();
    const combat = manager.getCombatById("combat-dash-001").payload.combat;
    const actor = combat.participants.find((entry) => entry.participant_id === "p1");
    actor.action_available = false;
    actor.hasted_action_available = true;
    combat.conditions = [{
      condition_id: "condition-haste-dash-001",
      condition_type: "haste",
      source_actor_id: "p2",
      target_actor_id: "p1",
      expiration_trigger: "manual",
      metadata: {
        grants_hasted_action: true
      }
    }];
    manager.combats.set("combat-dash-001", combat);

    const out = performDashAction({
      combatManager: manager,
      combat_id: "combat-dash-001",
      participant_id: "p1"
    });

    assert.equal(out.ok, true);
    const updatedCombat = manager.getCombatById("combat-dash-001").payload.combat;
    const updatedActor = updatedCombat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(updatedActor.action_available, false);
    assert.equal(updatedActor.hasted_action_available, false);
    assert.equal(updatedActor.movement_remaining, 40);
  }, results);

  runTest("dash_can_consume_bonus_action_under_expeditious_retreat", () => {
    const manager = createActiveCombatForDashTests();
    const combat = manager.getCombatById("combat-dash-001").payload.combat;
    const actor = combat.participants.find((entry) => entry.participant_id === "p1");
    actor.action_available = false;
    actor.bonus_action_available = true;
    combat.conditions = [{
      condition_id: "condition-expeditious-retreat-001",
      condition_type: "expeditious_retreat",
      source_actor_id: "p1",
      target_actor_id: "p1",
      expiration_trigger: "manual",
      metadata: {
        allow_dash_as_bonus_action: true,
        source_spell_id: "expeditious_retreat"
      }
    }];
    manager.combats.set("combat-dash-001", combat);

    const out = performDashAction({
      combatManager: manager,
      combat_id: "combat-dash-001",
      participant_id: "p1"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.consumed_resource, "bonus_action");
    const updatedCombat = manager.getCombatById("combat-dash-001").payload.combat;
    const updatedActor = updatedCombat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(updatedActor.action_available, false);
    assert.equal(updatedActor.bonus_action_available, false);
    assert.equal(updatedActor.movement_remaining, 40);
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
  const summary = runDashActionTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runDashActionTests
};
