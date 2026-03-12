"use strict";

const assert = require("assert");
const {
  canParticipantReact,
  consumeReaction,
  resetReactionForParticipant
} = require("../reactions/reactionState");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createCombatState() {
  return {
    combat_id: "combat-reaction-001",
    status: "active",
    participants: [
      {
        participant_id: "p1",
        current_hp: 10,
        reaction_available: true
      }
    ],
    conditions: [],
    event_log: []
  };
}

function runReactionStateTests() {
  const results = [];

  runTest("reaction_cannot_be_used_twice_in_same_round", () => {
    const combat = createCombatState();
    assert.equal(canParticipantReact(combat, "p1"), true);

    const consumed = consumeReaction(combat, "p1");
    assert.equal(consumed.ok, true);
    assert.equal(canParticipantReact(consumed.next_state, "p1"), false);
  }, results);

  runTest("reaction_resets_when_turn_lifecycle_resets_participant", () => {
    const combat = createCombatState();
    const consumed = consumeReaction(combat, "p1");
    const reset = resetReactionForParticipant(consumed.next_state, "p1");
    assert.equal(reset.ok, true);
    assert.equal(canParticipantReact(reset.next_state, "p1"), true);
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
  const summary = runReactionStateTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runReactionStateTests
};
