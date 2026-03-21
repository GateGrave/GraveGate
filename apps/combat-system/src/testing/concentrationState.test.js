"use strict";

const assert = require("assert");
const {
  clearParticipantConcentration,
  resolveConcentrationDamageCheck,
  startParticipantConcentration
} = require("../concentration/concentrationState");

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
    combat_id: "combat-concentration-001",
    status: "active",
    round: 1,
    participants: [
      {
        participant_id: "caster-001",
        armor_class: 12,
        current_hp: 10,
        constitution_save_modifier: 2,
        concentration: {
          is_concentrating: false,
          source_spell_id: null,
          target_actor_id: null,
          linked_condition_ids: [],
          linked_restorations: [],
          started_at_round: null,
          broken_reason: null
        }
      },
      {
        participant_id: "ally-001",
        armor_class: 16,
        current_hp: 10
      }
    ],
    conditions: [
      {
        condition_id: "condition-shield-001",
        condition_type: "shield_of_faith",
        source_actor_id: "caster-001",
        target_actor_id: "ally-001",
        expiration_trigger: "manual",
        metadata: {}
      }
    ],
    event_log: []
  };
}

function runConcentrationStateTests() {
  const results = [];

  runTest("starting_concentration_tracks_spell_and_links", () => {
    const combat = createCombatState();
    const started = startParticipantConcentration(combat, {
      participant_id: "caster-001",
      source_spell_id: "shield_of_faith",
      target_actor_id: "ally-001",
      linked_condition_ids: ["condition-shield-001"],
      linked_restorations: [{
        type: "armor_class_delta",
        target_actor_id: "ally-001",
        delta: -2
      }],
      started_at_round: 1
    });

    assert.equal(started.ok, true);
    assert.equal(started.concentration.source_spell_id, "shield_of_faith");
    assert.deepEqual(started.concentration.linked_condition_ids, ["condition-shield-001"]);
    assert.equal(started.next_state.participants[0].concentration.is_concentrating, true);
  }, results);

  runTest("clearing_concentration_removes_conditions_and_restores_state", () => {
    const combat = createCombatState();
    combat.participants[0].concentration = {
      is_concentrating: true,
      source_spell_id: "shield_of_faith",
      target_actor_id: "ally-001",
      linked_condition_ids: ["condition-shield-001"],
      linked_restorations: [{
        type: "armor_class_delta",
        target_actor_id: "ally-001",
        delta: -2
      }],
      started_at_round: 1,
      broken_reason: null
    };

    const cleared = clearParticipantConcentration(combat, "caster-001", "failed_save");
    assert.equal(cleared.ok, true);
    assert.equal(cleared.next_state.conditions.length, 0);
    assert.equal(cleared.next_state.participants[1].armor_class, 14);
    assert.equal(cleared.next_state.participants[0].concentration.is_concentrating, false);
    assert.equal(cleared.next_state.participants[0].concentration.broken_reason, "failed_save");
  }, results);

  runTest("failed_concentration_damage_check_breaks_concentration", () => {
    const combat = createCombatState();
    combat.participants[0].concentration = {
      is_concentrating: true,
      source_spell_id: "shield_of_faith",
      target_actor_id: "ally-001",
      linked_condition_ids: ["condition-shield-001"],
      linked_restorations: [{
        type: "armor_class_delta",
        target_actor_id: "ally-001",
        delta: -2
      }],
      started_at_round: 1,
      broken_reason: null
    };

    const out = resolveConcentrationDamageCheck(combat, "caster-001", 8, () => 0);
    assert.equal(out.ok, true);
    assert.equal(out.concentration_result.concentration_broken, true);
    assert.equal(out.next_state.participants[0].concentration.is_concentrating, false);
    assert.equal(out.next_state.participants[1].armor_class, 14);
    assert.equal(out.next_state.conditions.length, 0);
  }, results);

  runTest("war_caster_grants_advantage_on_concentration_saves", () => {
    const combat = createCombatState();
    combat.participants[0].feat_flags = {
      war_caster: true
    };
    combat.participants[0].concentration = {
      is_concentrating: true,
      source_spell_id: "shield_of_faith",
      target_actor_id: "ally-001",
      linked_condition_ids: ["condition-shield-001"],
      linked_restorations: [],
      started_at_round: 1,
      broken_reason: null
    };

    let callCount = 0;
    const out = resolveConcentrationDamageCheck(combat, "caster-001", 12, () => {
      callCount += 1;
      return callCount === 1 ? 0.15 : 0.75;
    });

    assert.equal(out.ok, true);
    assert.equal(out.required, true);
    assert.equal(out.concentration_result.concentration_broken, false);
    assert.equal(out.next_state.participants[0].concentration.is_concentrating, true);
    assert.equal(out.concentration_result.save_result.roll.advantage_state, "advantage");
    assert.deepEqual(out.concentration_result.save_result.roll.raw_dice[0].rolls, [4, 16]);
  }, results);

  runTest("clearing_haste_concentration_applies_lethargy_to_target", () => {
    const combat = createCombatState();
    combat.initiative_order = ["caster-001", "ally-001"];
    combat.turn_index = 0;
    combat.participants[1].movement_remaining = 30;
    combat.participants[1].hasted_action_available = true;
    combat.participants[0].concentration = {
      is_concentrating: true,
      source_spell_id: "haste",
      target_actor_id: "ally-001",
      linked_condition_ids: ["condition-haste-001"],
      linked_restorations: [{
        type: "apply_condition",
        target_actor_id: "ally-001",
        source_actor_id: "caster-001",
        condition_type: "haste_lethargy",
        expiration_trigger: "end_of_turn",
        current_turn_remaining_triggers: 2,
        off_turn_remaining_triggers: 1,
        zero_movement_on_current_turn: true,
        clear_hasted_action: true,
        metadata: {
          blocks_action: true,
          blocks_bonus_action: true,
          blocks_move: true
        }
      }],
      started_at_round: 1,
      broken_reason: null
    };
    combat.conditions = [{
      condition_id: "condition-haste-001",
      condition_type: "haste",
      source_actor_id: "caster-001",
      target_actor_id: "ally-001",
      expiration_trigger: "manual",
      metadata: {
        grants_hasted_action: true
      }
    }];

    const cleared = clearParticipantConcentration(combat, "caster-001", "failed_save");
    assert.equal(cleared.ok, true);
    const lethargy = cleared.next_state.conditions.find((entry) => entry.condition_type === "haste_lethargy");
    assert.equal(Boolean(lethargy), true);
    assert.equal(lethargy.duration.remaining_triggers, 1);
    assert.equal(cleared.next_state.participants[1].hasted_action_available, false);
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
  const summary = runConcentrationStateTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runConcentrationStateTests
};
