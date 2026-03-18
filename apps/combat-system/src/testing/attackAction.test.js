"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { performAttackAction } = require("../actions/attackAction");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createActiveCombatForAttackTests() {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: "combat-attack-001",
    status: "active",
    round: 1,
    turn_index: 0,
    initiative_order: ["attacker-001", "target-001"],
    participants: [
      {
        participant_id: "attacker-001",
        name: "Hero",
        team: "A",
        armor_class: 14,
        current_hp: 20,
        max_hp: 20,
        attack_bonus: 5,
        damage: 6,
        position: { x: 0, y: 0 }
      },
      {
        participant_id: "target-001",
        name: "Goblin",
        team: "B",
        armor_class: 12,
        current_hp: 16,
        max_hp: 16,
        attack_bonus: 2,
        damage: 4,
        position: { x: 1, y: 0 }
      }
    ],
    conditions: [],
    battlefield: {},
    event_log: []
  });
  return manager;
}

function runAttackActionTests() {
  const results = [];

  runTest("successful_hit", () => {
    const manager = createActiveCombatForAttackTests();
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 15,
      damage_roll_fn: () => 5
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "attack_action_resolved");
    assert.equal(out.payload.hit, true);
    assert.equal(out.payload.damage_dealt, 5);
    assert.equal(out.payload.target_hp_after, 11);
    assert.equal(out.payload.combat.event_log.length, 1);
    const attacker = out.payload.combat.participants.find((entry) => entry.participant_id === "attacker-001");
    assert.equal(attacker.action_available, false);
  }, results);

  runTest("attacking_consumes_action_for_turn", () => {
    const manager = createActiveCombatForAttackTests();
    const first = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 15,
      damage_roll_fn: () => 5
    });
    assert.equal(first.ok, true);

    const second = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 15,
      damage_roll_fn: () => 5
    });
    assert.equal(second.ok, false);
    assert.equal(second.error, "action is not available");
  }, results);

  runTest("miss", () => {
    const manager = createActiveCombatForAttackTests();
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 2,
      damage_roll_fn: () => 999
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.hit, false);
    assert.equal(out.payload.damage_dealt, 0);
    assert.equal(out.payload.target_hp_after, 16);
  }, results);

  runTest("wrong_turn", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    combat.turn_index = 1; // target's turn
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 15,
      damage_roll_fn: () => 5
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "attack_action_failed");
    assert.equal(out.error, "it is not the attacker's turn");
  }, results);

  runTest("invalid_target", () => {
    const manager = createActiveCombatForAttackTests();
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-missing-001",
      attack_roll_fn: () => 15,
      damage_roll_fn: () => 5
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "attack_action_failed");
    assert.equal(out.error, "target not found in combat");
  }, results);

  runTest("target_out_of_attack_range_fails_cleanly", () => {
    const manager = createActiveCombatForAttackTests();
    const combat = manager.getCombatById("combat-attack-001").payload.combat;
    const target = combat.participants.find((p) => p.participant_id === "target-001");
    target.position = { x: 4, y: 0 };
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 15,
      damage_roll_fn: () => 5
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "target is out of attack range");
  }, results);

  runTest("damage_reducing_hp", () => {
    const manager = createActiveCombatForAttackTests();
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 20,
      damage_roll_fn: () => 7
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.hit, true);
    assert.equal(out.payload.target_hp_after, 9);

    const loaded = manager.getCombatById("combat-attack-001");
    const target = loaded.payload.combat.participants.find((p) => p.participant_id === "target-001");
    assert.equal(target.current_hp, 9);
  }, results);

  runTest("defeating_grappler_clears_grappled_condition", () => {
    const manager = createActiveCombatForAttackTests();
    const combat = manager.getCombatById("combat-attack-001").payload.combat;
    combat.turn_index = 1;
    combat.participants[0].current_hp = 4;
    combat.conditions = [{
      condition_id: "condition-attack-grapple-001",
      condition_type: "grappled",
      source_actor_id: "attacker-001",
      target_actor_id: "target-001",
      expiration_trigger: "manual"
    }];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "target-001",
      target_id: "attacker-001",
      attack_roll_fn: () => 18,
      damage_roll_fn: () => 5
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.target_hp_after, 0);
    assert.equal(out.payload.combat.conditions.some((entry) => {
      return String(entry && entry.condition_type || "") === "grappled";
    }), false);
  }, results);

  runTest("typed_weapon_damage_respects_target_resistance", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    const attacker = combat.participants.find((p) => p.participant_id === "attacker-001");
    const target = combat.participants.find((p) => p.participant_id === "target-001");
    attacker.damage_type = "slashing";
    target.resistances = ["slashing"];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 20,
      damage_roll_fn: () => 6
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.damage_type, "slashing");
    assert.equal(out.payload.damage_dealt, 3);
    assert.equal(out.payload.target_hp_after, 13);
  }, results);

  runTest("typed_weapon_damage_respects_target_damage_reduction", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    const attacker = combat.participants.find((p) => p.participant_id === "attacker-001");
    const target = combat.participants.find((p) => p.participant_id === "target-001");
    attacker.damage_type = "slashing";
    target.damage_reduction = 2;
    target.damage_reduction_types = ["slashing", "piercing", "bludgeoning"];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 20,
      damage_roll_fn: () => 6
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.damage_dealt, 4);
    assert.equal(out.payload.damage_result.stages.apply_damage_reduction.has_damage_reduction, true);
    assert.equal(out.payload.damage_result.stages.apply_damage_reduction.damage_after_reduction, 4);
    assert.equal(out.payload.target_hp_after, 12);
  }, results);

  runTest("temporary_hit_points_are_consumed_before_current_hp", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    const attacker = combat.participants.find((p) => p.participant_id === "attacker-001");
    const target = combat.participants.find((p) => p.participant_id === "target-001");
    attacker.damage_type = "slashing";
    target.temporary_hitpoints = 4;
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 20,
      damage_roll_fn: () => 6
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.damage_dealt, 6);
    assert.equal(out.payload.damage_result.temporary_hp_before, 4);
    assert.equal(out.payload.damage_result.temporary_hp_after, 0);
    assert.equal(out.payload.target_hp_after, 14);
    const updatedTarget = out.payload.combat.participants.find((entry) => entry.participant_id === "target-001");
    assert.equal(updatedTarget.current_hp, 14);
    assert.equal(updatedTarget.temporary_hitpoints, 0);
  }, results);

  runTest("weapon_profile_damage_type_is_used_when_attacker_damage_type_is_missing", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    const attacker = combat.participants.find((p) => p.participant_id === "attacker-001");
    const target = combat.participants.find((p) => p.participant_id === "target-001");
    attacker.readiness = {
      weapon_profile: {
        weapon: {
          damage_type: "piercing"
        }
      }
    };
    target.resistances = ["piercing"];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 20,
      damage_roll_fn: () => 7
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.damage_type, "piercing");
    assert.equal(out.payload.damage_dealt, 3);
    assert.equal(out.payload.target_hp_after, 13);
  }, results);

  runTest("mobile_melee_attack_applies_targeted_opportunity_attack_immunity", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    const attacker = combat.participants.find((entry) => entry.participant_id === "attacker-001");
    attacker.feats = ["mobile"];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 15,
      damage_roll_fn: () => 4
    });

    assert.equal(out.ok, true);
    const immunity = out.payload.combat.conditions.find((entry) => {
      return entry.condition_type === "opportunity_attack_immunity" &&
        entry.target_actor_id === "attacker-001" &&
        entry.metadata &&
        entry.metadata.blocked_reactor_id === "target-001";
    });
    assert.equal(Boolean(immunity), true);
    assert.equal(immunity.expiration_trigger, "start_of_turn");
  }, results);

  runTest("magical_weapon_bonus_damage_is_applied_on_hit", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    const attacker = combat.participants.find((p) => p.participant_id === "attacker-001");
    attacker.damage_type = "slashing";
    attacker.damage_formula = "1d4";
    attacker.magical_on_hit_effects = [{
      item_id: "item_blazing_blade",
      item_name: "Blazing Blade",
      damage_dice: "1d4",
      damage_type: "fire"
    }];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 20,
      damage_roll_rng: () => 0
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.damage_dealt > Number(out.payload.damage_result.final_damage), true);
    assert.equal(Array.isArray(out.payload.bonus_damage_results), true);
    assert.equal(out.payload.bonus_damage_results.length, 1);
    assert.equal(out.payload.bonus_damage_results[0].damage_type, "fire");
    assert.equal(out.payload.bonus_damage_results[0].source_item_id, "item_blazing_blade");
    assert.equal(out.payload.target_hp_after, 16 - out.payload.damage_dealt);
  }, results);

  runTest("reactive_magical_item_deals_damage_back_on_melee_hit", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    const target = combat.participants.find((p) => p.participant_id === "target-001");
    target.magical_reactive_effects = [{
      item_id: "item_stormguard_loop",
      item_name: "Stormguard Loop",
      trigger: "melee_hit_taken",
      damage_dice: "1d4",
      damage_type: "lightning"
    }];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 20,
      damage_roll_fn: () => 6,
      damage_roll_rng: () => 0
    });

    assert.equal(out.ok, true);
    assert.equal(Array.isArray(out.payload.reactive_damage_results), true);
    assert.equal(out.payload.reactive_damage_results.length, 1);
    assert.equal(out.payload.reactive_damage_results[0].damage_type, "lightning");
    const updatedAttacker = out.payload.combat.participants.find((entry) => entry.participant_id === "attacker-001");
    assert.equal(updatedAttacker.current_hp < 20, true);
  }, results);

  runTest("armor_of_agathys_condition_deals_reactive_damage_and_ends_when_temp_hp_breaks", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    const target = combat.participants.find((p) => p.participant_id === "target-001");
    target.temporary_hitpoints = 5;
    combat.conditions = [{
      condition_id: "condition-armor-of-agathys-001",
      condition_type: "armor_of_agathys",
      source_actor_id: "target-001",
      target_actor_id: "target-001",
      expiration_trigger: "manual",
      metadata: {
        retaliation_damage: 5,
        retaliation_damage_type: "cold"
      }
    }];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 20,
      damage_roll_fn: () => 6
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.reactive_damage_results.length, 1);
    assert.equal(out.payload.reactive_damage_results[0].damage_type, "cold");
    assert.equal(out.payload.combat.conditions.some((entry) => entry.condition_type === "armor_of_agathys"), false);
  }, results);

  runTest("attack_against_dodging_target_uses_disadvantage", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    const target = combat.participants.find((p) => p.participant_id === "target-001");
    target.is_dodging = true;
    manager.combats.set("combat-attack-001", combat);

    let callCount = 0;
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      // Should be called twice because target is dodging.
      attack_roll_fn: () => {
        callCount += 1;
        return callCount === 1 ? 19 : 3;
      },
      damage_roll_fn: () => 5
    });

    assert.equal(out.ok, true);
    assert.equal(callCount, 2);
    assert.equal(out.payload.attack_roll_mode, "disadvantage");
    assert.deepEqual(out.payload.attack_roll_values, [19, 3]);
    assert.equal(out.payload.attack_roll, 3);
    assert.equal(out.payload.attack_total, 8);
    assert.equal(out.payload.hit, false);
  }, results);

  runTest("prone_target_grants_advantage_to_adjacent_melee_attack", () => {
    const manager = createActiveCombatForAttackTests();
    const combat = manager.getCombatById("combat-attack-001").payload.combat;
    combat.conditions = [{
      condition_id: "condition-prone-target-001",
      condition_type: "prone",
      target_actor_id: "target-001",
      expiration_trigger: "manual"
    }];
    manager.combats.set("combat-attack-001", combat);

    let callCount = 0;
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => {
        callCount += 1;
        return callCount === 1 ? 4 : 15;
      },
      damage_roll_fn: () => 3
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.attack_roll_mode, "advantage");
  }, results);

  runTest("prone_target_imposes_disadvantage_on_ranged_attack", () => {
    const manager = createActiveCombatForAttackTests();
    const combat = manager.getCombatById("combat-attack-001").payload.combat;
    const attacker = combat.participants.find((p) => p.participant_id === "attacker-001");
    const target = combat.participants.find((p) => p.participant_id === "target-001");
    attacker.position = { x: 0, y: 0 };
    target.position = { x: 3, y: 0 };
    attacker.readiness = {
      weapon_profile: {
        weapon_class: "simple_ranged",
        weapon: {
          damage_dice: "1d6",
          damage_type: "piercing",
          range: {
            normal: 80,
            long: 320
          }
        }
      }
    };
    combat.conditions = [{
      condition_id: "condition-prone-ranged-target-001",
      condition_type: "prone",
      target_actor_id: "target-001",
      expiration_trigger: "manual"
    }];
    manager.combats.set("combat-attack-001", combat);

    let callCount = 0;
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => {
        callCount += 1;
        return callCount === 1 ? 17 : 3;
      },
      damage_roll_fn: () => 3
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.attack_roll_mode, "disadvantage");
    assert.equal(out.payload.attack_mode, "ranged");
  }, results);

  runTest("paralyzed_target_grants_advantage_on_attack_roll", () => {
    const manager = createActiveCombatForAttackTests();
    const combat = manager.getCombatById("combat-attack-001").payload.combat;
    combat.conditions = [{
      condition_id: "condition-attack-paralyzed-001",
      condition_type: "paralyzed",
      target_actor_id: "target-001",
      expiration_trigger: "manual"
    }];
    manager.combats.set("combat-attack-001", combat);

    let sawMultipleRolls = 0;
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn() {
        sawMultipleRolls += 1;
        return 18;
      },
      damage_roll_fn() {
        return 4;
      }
    });

    assert.equal(out.ok, true);
    assert.equal(sawMultipleRolls, 2);
  }, results);

  runTest("guiding_bolt_marked_target_grants_advantage_and_consumes_mark", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    combat.conditions = [{
      condition_id: "condition-guiding-bolt-001",
      condition_type: "guiding_bolt_marked",
      source_actor_id: "cleric-001",
      target_actor_id: "target-001",
      expiration_trigger: "start_of_source_turn",
      duration: {
        remaining_triggers: 1
      }
    }];
    manager.combats.set("combat-attack-001", combat);

    let callCount = 0;
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => {
        callCount += 1;
        return callCount === 1 ? 2 : 17;
      },
      damage_roll_fn: () => 5
    });

    assert.equal(out.ok, true);
    assert.equal(callCount, 2);
    assert.equal(out.payload.attack_roll_mode, "advantage");
    assert.deepEqual(out.payload.attack_roll_values, [2, 17]);
    assert.equal(out.payload.attack_roll, 17);
    assert.equal(out.payload.hit, true);
    assert.equal(out.payload.combat.conditions.length, 0);
  }, results);

  runTest("faerie_fire_grants_advantage_without_consuming_condition", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    combat.conditions = [{
      condition_id: "condition-faerie-fire-001",
      condition_type: "faerie_fire_lit",
      source_actor_id: "bard-001",
      target_actor_id: "target-001",
      expiration_trigger: "manual",
      duration: {
        remaining_triggers: 1
      }
    }];
    manager.combats.set("combat-attack-001", combat);

    let callCount = 0;
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => {
        callCount += 1;
        return callCount === 1 ? 4 : 16;
      },
      damage_roll_fn: () => 5
    });

    assert.equal(out.ok, true);
    assert.equal(callCount, 2);
    assert.equal(out.payload.attack_roll_mode, "advantage");
    assert.equal(out.payload.combat.conditions.some((entry) => entry.condition_type === "faerie_fire_lit"), true);
  }, results);

  runTest("blurred_target_imposes_disadvantage_on_attack_rolls", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    combat.conditions = [{
      condition_id: "condition-blur-target-001",
      condition_type: "blurred",
      target_actor_id: "target-001",
      expiration_trigger: "manual",
      metadata: {
        attackers_have_disadvantage: true
      }
    }];
    manager.combats.set("combat-attack-001", combat);

    let callCount = 0;
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => {
        callCount += 1;
        return callCount === 1 ? 19 : 4;
      },
      damage_roll_fn: () => 5
    });

    assert.equal(out.ok, true);
    assert.equal(callCount, 2);
    assert.equal(out.payload.attack_roll_mode, "disadvantage");
    assert.deepEqual(out.payload.attack_roll_values, [19, 4]);
    assert.equal(out.payload.attack_roll, 4);
  }, results);

  runTest("poisoned_attacker_has_disadvantage_on_attack_rolls", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    combat.conditions = [{
      condition_id: "condition-poisoned-attack-001",
      condition_type: "poisoned",
      target_actor_id: "attacker-001",
      expiration_trigger: "manual"
    }];
    manager.combats.set("combat-attack-001", combat);

    let callCount = 0;
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => {
        callCount += 1;
        return callCount === 1 ? 19 : 4;
      },
      damage_roll_fn: () => 5
    });

    assert.equal(out.ok, true);
    assert.equal(callCount, 2);
    assert.equal(out.payload.attack_roll_mode, "disadvantage");
    assert.deepEqual(out.payload.attack_roll_values, [19, 4]);
    assert.equal(out.payload.attack_roll, 4);
  }, results);

  runTest("restrained_target_grants_advantage_on_attack_rolls", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    combat.conditions = [{
      condition_id: "condition-restrained-target-001",
      condition_type: "restrained",
      target_actor_id: "target-001",
      expiration_trigger: "manual"
    }];
    manager.combats.set("combat-attack-001", combat);

    let callCount = 0;
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => {
        callCount += 1;
        return callCount === 1 ? 2 : 15;
      },
      damage_roll_fn: () => 5
    });

    assert.equal(out.ok, true);
    assert.equal(callCount, 2);
    assert.equal(out.payload.attack_roll_mode, "advantage");
    assert.equal(out.payload.attack_roll, 15);
  }, results);

  runTest("sanctuary_blocks_attack_when_attacker_fails_wisdom_save", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    combat.conditions = [{
      condition_id: "condition-sanctuary-target-001",
      condition_type: "sanctuary",
      target_actor_id: "target-001",
      expiration_trigger: "manual",
      metadata: {
        blocks_attack_targeting: true,
        targeting_save_ability: "wisdom",
        targeting_save_dc: 13
      }
    }];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 18,
      damage_roll_fn: () => 5,
      targeting_save_fn: () => ({ final_total: 8 })
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "target is protected from hostile attacks");
  }, results);

  runTest("attacker_sanctuary_breaks_when_making_attack", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    combat.conditions = [{
      condition_id: "condition-sanctuary-attacker-001",
      condition_type: "sanctuary",
      target_actor_id: "attacker-001",
      expiration_trigger: "manual",
      metadata: {
        blocks_attack_targeting: true,
        targeting_save_ability: "wisdom",
        targeting_save_dc: 13,
        breaks_on_harmful_action: true
      }
    }];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 18,
      damage_roll_fn: () => 5
    });

    assert.equal(out.ok, true);
    const updatedCombat = manager.getCombatById("combat-attack-001").payload.combat;
    assert.equal(updatedCombat.conditions.some((entry) => entry.condition_type === "sanctuary" && entry.target_actor_id === "attacker-001"), false);
  }, results);

  runTest("damaging_a_concentrating_target_can_break_concentration", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    const target = combat.participants.find((p) => p.participant_id === "target-001");
    target.constitution_save_modifier = 0;
    target.concentration = {
      is_concentrating: true,
      source_spell_id: "shield_of_faith",
      target_actor_id: "target-001",
      linked_condition_ids: ["condition-concentration-001"],
      linked_restorations: [],
      started_at_round: 1,
      broken_reason: null
    };
    combat.conditions = [{
      condition_id: "condition-concentration-001",
      condition_type: "shield_of_faith",
      source_actor_id: "target-001",
      target_actor_id: "target-001",
      expiration_trigger: "manual",
      metadata: {}
    }];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 18,
      damage_roll_fn: () => 8,
      concentration_save_rng: () => 0
    });

    assert.equal(out.ok, true);
    assert.equal(Boolean(out.payload.concentration_result), true);
    assert.equal(out.payload.concentration_result.concentration_broken, true);
    assert.equal(out.payload.combat.conditions.length, 0);
    const updatedTarget = out.payload.combat.participants.find((entry) => entry.participant_id === "target-001");
    assert.equal(updatedTarget.concentration.is_concentrating, false);
  }, results);

  runTest("successful_concentration_save_keeps_concentration_active", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    const target = combat.participants.find((p) => p.participant_id === "target-001");
    target.constitution_save_modifier = 5;
    target.concentration = {
      is_concentrating: true,
      source_spell_id: "shield_of_faith",
      target_actor_id: "target-001",
      linked_condition_ids: ["condition-concentration-002"],
      linked_restorations: [],
      started_at_round: 1,
      broken_reason: null
    };
    combat.conditions = [{
      condition_id: "condition-concentration-002",
      condition_type: "shield_of_faith",
      source_actor_id: "target-001",
      target_actor_id: "target-001",
      expiration_trigger: "manual",
      metadata: {}
    }];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 18,
      damage_roll_fn: () => 4,
      concentration_save_rng: () => 18
    });

    assert.equal(out.ok, true);
    assert.equal(Boolean(out.payload.concentration_result), true);
    assert.equal(out.payload.concentration_result.concentration_broken, false);
    assert.equal(out.payload.combat.conditions.length, 1);
    const updatedTarget = out.payload.combat.participants.find((entry) => entry.participant_id === "target-001");
    assert.equal(updatedTarget.concentration.is_concentrating, true);
  }, results);

  runTest("defeated_participant_cannot_attack", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    const attacker = combat.participants.find((p) => p.participant_id === "attacker-001");
    attacker.current_hp = 0;
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 20,
      damage_roll_fn: () => 9
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "attack_action_failed");
    assert.equal(out.error, "defeated participants cannot act");
  }, results);

  runTest("cannot_attack_target_that_is_already_defeated", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    const target = combat.participants.find((p) => p.participant_id === "target-001");
    target.current_hp = 0;
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 20,
      damage_roll_fn: () => 9
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "attack_action_failed");
    assert.equal(out.error, "target is already defeated");
  }, results);

  runTest("ended_combat_rejects_attack_actions", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    combat.status = "complete";
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 20,
      damage_roll_fn: () => 7
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "attack_action_failed");
    assert.equal(out.error, "combat is not active");
  }, results);

  runTest("stunned_participant_cannot_attack", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-attack-001",
        condition_type: "stunned",
        target_actor_id: "attacker-001",
        expiration_trigger: "manual"
      }
    ];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 20,
      damage_roll_fn: () => 7
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "stunned participants cannot act");
  }, results);

  runTest("bless_adds_d4_to_attack_total", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    combat.conditions = [{
      condition_id: "condition-bless-001",
      condition_type: "bless",
      source_actor_id: "cleric-001",
      target_actor_id: "attacker-001",
      expiration_trigger: "manual",
      metadata: {
        dice_bonus: "1d4"
      }
    }];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 6,
      damage_roll_fn: () => 4,
      condition_bonus_rng: () => 0
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.condition_bonus, 1);
    assert.equal(out.payload.attack_total, 12);
    assert.equal(out.payload.hit, true);
  }, results);

  runTest("bane_subtracts_d4_from_attack_total", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    combat.conditions = [{
      condition_id: "condition-bane-001",
      condition_type: "bane",
      source_actor_id: "cleric-001",
      target_actor_id: "attacker-001",
      expiration_trigger: "manual",
      metadata: {
        dice_bonus: "1d4"
      }
    }];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 8,
      damage_roll_fn: () => 4,
      condition_bonus_rng: () => 0
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.condition_bonus, -1);
    assert.equal(out.payload.attack_total, 12);
    assert.equal(out.payload.hit, true);
  }, results);

  runTest("helped_attack_condition_grants_advantage_and_is_consumed", () => {
    const manager = createActiveCombatForAttackTests();
    const found = manager.getCombatById("combat-attack-001");
    const combat = found.payload.combat;
    combat.conditions = [ {
      condition_id: "condition-helped-attack-001",
      condition_type: "helped_attack",
      source_actor_id: "helper-001",
      target_actor_id: "attacker-001",
      expiration_trigger: "start_of_source_turn",
      metadata: {
        source: "help_action",
        apply_to_attack_roll: true
      }
    } ];
    manager.combats.set("combat-attack-001", combat);

    let rollCall = 0;
    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => {
        rollCall += 1;
        return rollCall === 1 ? 4 : 16;
      },
      damage_roll_fn: () => 3
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.attack_roll_mode, "advantage");
    const updated = manager.getCombatById("combat-attack-001").payload.combat;
    assert.equal(updated.conditions.some((entry) => {
      return String(entry && entry.condition_type || "") === "helped_attack" &&
        String(entry && entry.target_actor_id || "") === "attacker-001";
    }), false);
  }, results);

  runTest("blinded_attacker_has_disadvantage_and_blinded_target_grants_advantage", () => {
    const manager = createActiveCombatForAttackTests();
    const combat = manager.getCombatById("combat-attack-001").payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-blinded-attacker-001",
        condition_type: "blinded",
        target_actor_id: "attacker-001",
        expiration_trigger: "manual",
        metadata: {
          has_attack_disadvantage: true
        }
      },
      {
        condition_id: "condition-blinded-target-001",
        condition_type: "blinded",
        target_actor_id: "target-001",
        expiration_trigger: "manual",
        metadata: {
          attackers_have_advantage: true
        }
      }
    ];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 10,
      damage_roll_fn: () => 3
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.attack_roll_mode, "normal");
  }, results);

  runTest("invisible_attacker_has_advantage_and_invisible_target_imposes_disadvantage", () => {
    const manager = createActiveCombatForAttackTests();
    const combat = manager.getCombatById("combat-attack-001").payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-invisible-attacker-001",
        condition_type: "invisible",
        target_actor_id: "attacker-001",
        expiration_trigger: "manual",
        metadata: {
          has_attack_advantage: true
        }
      },
      {
        condition_id: "condition-invisible-target-001",
        condition_type: "invisible",
        target_actor_id: "target-001",
        expiration_trigger: "manual",
        metadata: {
          attackers_have_disadvantage: true
        }
      }
    ];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 10,
      damage_roll_fn: () => 3
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.attack_roll_mode, "normal");
  }, results);

  runTest("harmful_attack_breaks_harmful_action_conditions_on_attacker", () => {
    const manager = createActiveCombatForAttackTests();
    const combat = manager.getCombatById("combat-attack-001").payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-invisibility-break-001",
        condition_type: "invisible",
        source_actor_id: "attacker-001",
        target_actor_id: "attacker-001",
        expiration_trigger: "manual",
        metadata: {
          breaks_on_harmful_action: true
        }
      }
    ];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 16,
      damage_roll_fn: () => 3
    });

    assert.equal(out.ok, true);
    const updated = manager.getCombatById("combat-attack-001").payload.combat;
    const remaining = (updated.conditions || []).filter((condition) => {
      return String(condition && condition.target_actor_id || "") === "attacker-001";
    });
    assert.equal(remaining.length, 0);
  }, results);

  runTest("charmed_attacker_cannot_attack_the_charmer", () => {
    const manager = createActiveCombatForAttackTests();
    const combat = manager.getCombatById("combat-attack-001").payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-charmed-attack-001",
        condition_type: "charmed",
        source_actor_id: "target-001",
        target_actor_id: "attacker-001",
        expiration_trigger: "manual",
        metadata: {
          cannot_target_actor_ids: ["target-001"]
        }
      }
    ];
    manager.combats.set("combat-attack-001", combat);

    const out = performAttackAction({
      combatManager: manager,
      combat_id: "combat-attack-001",
      attacker_id: "attacker-001",
      target_id: "target-001",
      attack_roll_fn: () => 16,
      damage_roll_fn: () => 3
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "charmed participants cannot make harmful attacks against the charmer");
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
  const summary = runAttackActionTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runAttackActionTests
};
