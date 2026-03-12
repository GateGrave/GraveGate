"use strict";

const assert = require("assert");
const {
  applyConditionToCombatState,
  removeConditionFromCombatState,
  expireConditionsForTrigger,
  getActiveConditionsForParticipant
} = require("../conditions/conditionHelpers");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createBaseCombatState() {
  return {
    combat_id: "combat-condition-001",
    status: "active",
    round: 1,
    turn_index: 0,
    participants: [
      { participant_id: "p1", current_hp: 10 },
      { participant_id: "p2", current_hp: 10 }
    ],
    conditions: [],
    event_log: []
  };
}

function runConditionHelpersTests() {
  const results = [];

  runTest("apply_and_remove_condition", () => {
    const combat = createBaseCombatState();
    const applied = applyConditionToCombatState(combat, {
      condition_type: "prone",
      source_actor_id: "p2",
      target_actor_id: "p1",
      applied_at_round: 1,
      expiration_trigger: "manual"
    });

    assert.equal(applied.ok, true);
    assert.equal(applied.next_state.conditions.length, 1);
    assert.equal(getActiveConditionsForParticipant(applied.next_state, "p1").length, 1);

    const removed = removeConditionFromCombatState(applied.next_state, applied.condition.condition_id);
    assert.equal(removed.ok, true);
    assert.equal(removed.next_state.conditions.length, 0);
  }, results);

  runTest("expire_condition_on_start_of_turn", () => {
    const combat = createBaseCombatState();
    const applied = applyConditionToCombatState(combat, {
      condition_type: "stunned",
      source_actor_id: "p2",
      target_actor_id: "p1",
      applied_at_round: 1,
      expiration_trigger: "start_of_turn",
      duration: {
        remaining_triggers: 1
      }
    });

    const expired = expireConditionsForTrigger(applied.next_state, {
      participant_id: "p1",
      expiration_trigger: "start_of_turn"
    });

    assert.equal(expired.ok, true);
    assert.equal(expired.expired_conditions.length, 1);
    assert.equal(expired.next_state.conditions.length, 0);
  }, results);

  runTest("expire_condition_on_start_of_source_turn", () => {
    const combat = createBaseCombatState();
    const applied = applyConditionToCombatState(combat, {
      condition_type: "guiding_bolt_marked",
      source_actor_id: "p2",
      target_actor_id: "p1",
      applied_at_round: 1,
      expiration_trigger: "start_of_source_turn",
      duration: {
        remaining_triggers: 1
      }
    });

    const expired = expireConditionsForTrigger(applied.next_state, {
      source_actor_id: "p2",
      expiration_trigger: "start_of_source_turn"
    });

    assert.equal(expired.ok, true);
    assert.equal(expired.expired_conditions.length, 1);
    assert.equal(expired.next_state.conditions.length, 0);
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
  const summary = runConditionHelpersTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runConditionHelpersTests
};
