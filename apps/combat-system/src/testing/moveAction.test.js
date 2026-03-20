"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { performMoveAction } = require("../actions/moveAction");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createActiveCombatForMoveTests() {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: "combat-move-001",
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
        position: { x: 0, y: 0 }
      },
      {
        participant_id: "p2",
        name: "Goblin",
        team: "B",
        armor_class: 11,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 3,
        position: { x: 2, y: 2 }
      }
    ],
    conditions: [],
    event_log: []
  });
  return manager;
}

function runMoveActionTests() {
  const results = [];

  runTest("successful_move", () => {
    const manager = createActiveCombatForMoveTests();
    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 }
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "move_action_resolved");
    assert.deepEqual(out.payload.to_position, { x: 1, y: 0 });
    assert.equal(out.payload.combat.event_log.length, 1);
    assert.equal(out.payload.combat.event_log[0].event_type, "move_action");
    const actor = out.payload.combat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(actor.movement_remaining, 25);
  }, results);

  runTest("movement_cost_cannot_exceed_remaining_pool", () => {
    const manager = createActiveCombatForMoveTests();
    const found = manager.getCombatById("combat-move-001");
    const combat = found.payload.combat;
    const actor = combat.participants.find((entry) => entry.participant_id === "p1");
    actor.movement_remaining = 5;
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 2, y: 0 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "not enough movement remaining");
  }, results);

  runTest("out_of_bounds_move", () => {
    const manager = createActiveCombatForMoveTests();
    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 9, y: 0 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "move_action_failed");
    assert.equal(out.error, "target position is out of battlefield bounds");
  }, results);

  runTest("occupied_tile_failure", () => {
    const manager = createActiveCombatForMoveTests();
    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 2, y: 2 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "move_action_failed");
    assert.equal(out.error, "target tile is occupied");
  }, results);

  runTest("movement_blocking_condition_prevents_move", () => {
    const manager = createActiveCombatForMoveTests();
    const combat = manager.getCombatById("combat-move-001").payload.combat;
    combat.conditions.push({
      condition_id: "condition-haste-lethargy-001",
      condition_type: "haste_lethargy",
      source_actor_id: "p2",
      target_actor_id: "p1",
      expiration_trigger: "end_of_turn",
      metadata: {
        blocks_move: true
      }
    });
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "movement is blocked by an active condition");
  }, results);

  runTest("wrong_turn_failure", () => {
    const manager = createActiveCombatForMoveTests();
    const found = manager.getCombatById("combat-move-001");
    const combat = found.payload.combat;
    combat.turn_index = 1;
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "move_action_failed");
    assert.equal(out.error, "it is not the participant's turn");
  }, results);

  runTest("defeated_participant_cannot_move", () => {
    const manager = createActiveCombatForMoveTests();
    const found = manager.getCombatById("combat-move-001");
    const combat = found.payload.combat;
    const actor = combat.participants.find((p) => p.participant_id === "p1");
    actor.current_hp = 0;
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "move_action_failed");
    assert.equal(out.error, "defeated participants cannot move");
  }, results);

  runTest("stunned_participant_cannot_move", () => {
    const manager = createActiveCombatForMoveTests();
    const found = manager.getCombatById("combat-move-001");
    const combat = found.payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-move-001",
        condition_type: "stunned",
        target_actor_id: "p1",
        expiration_trigger: "manual"
      }
    ];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "stunned participants cannot move");
  }, results);

  runTest("restrained_participant_cannot_move", () => {
    const manager = createActiveCombatForMoveTests();
    const found = manager.getCombatById("combat-move-001");
    const combat = found.payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-move-002",
        condition_type: "restrained",
        target_actor_id: "p1",
        expiration_trigger: "manual"
      }
    ];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "restrained participants cannot move");
  }, results);

  runTest("freedom_of_movement_allows_movement_while_restrained_and_ignores_difficult_terrain", () => {
    const manager = createActiveCombatForMoveTests();
    const found = manager.getCombatById("combat-move-001");
    const combat = found.payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-move-fof-001",
        condition_type: "restrained",
        target_actor_id: "p1",
        expiration_trigger: "manual"
      },
      {
        condition_id: "condition-move-fof-002",
        condition_type: "freedom_of_movement",
        target_actor_id: "p1",
        expiration_trigger: "manual",
        metadata: {
          ignore_difficult_terrain: true,
          ignore_grappled_move_block: true,
          ignore_restrained_move_block: true,
          escape_grapple_auto_success: true
        }
      }
    ];
    combat.active_effects = [
      {
        effect_id: "effect-move-fof-001",
        tiles: [{ x: 1, y: 0 }],
        metadata: {
          difficult_terrain: true
        }
      }
    ];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.movement_cost_feet, 5);
  }, results);

  runTest("paralyzed_participant_cannot_move", () => {
    const manager = createActiveCombatForMoveTests();
    const found = manager.getCombatById("combat-move-001");
    const combat = found.payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-move-003",
        condition_type: "paralyzed",
        target_actor_id: "p1",
        expiration_trigger: "manual"
      }
    ];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "paralyzed participants cannot move");
  }, results);

  runTest("frightened_participant_cannot_move_closer_to_fear_source", () => {
    const manager = createActiveCombatForMoveTests();
    const found = manager.getCombatById("combat-move-001");
    const combat = found.payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-move-fear-001",
        condition_type: "frightened",
        source_actor_id: "p2",
        target_actor_id: "p1",
        expiration_trigger: "manual"
      }
    ];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 1 }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "frightened participants cannot move closer to the source of fear");
  }, results);

  runTest("moving_grappler_out_of_reach_clears_grappled_condition", () => {
    const manager = createActiveCombatForMoveTests();
    const combat = manager.getCombatById("combat-move-001").payload.combat;
    combat.participants[1].position = { x: 1, y: 0 };
    combat.conditions = [{
      condition_id: "condition-grapple-move-001",
      condition_type: "grappled",
      source_actor_id: "p1",
      target_actor_id: "p2",
      expiration_trigger: "manual"
    }];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 4, y: 0 }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.combat.conditions.some((entry) => {
      return String(entry && entry.condition_type || "") === "grappled";
    }), false);
  }, results);

  runTest("entering_grease_zone_costs_difficult_terrain_movement", () => {
    const manager = createActiveCombatForMoveTests();
    const combat = manager.getCombatById("combat-move-001").payload.combat;
    combat.active_effects = [{
      effect_id: "effect-grease-zone-001",
      type: "spell_active_grease",
      source: { participant_id: "p2", event_id: null },
      target: { participant_id: "p2" },
      duration: { remaining_turns: 10, max_turns: 10 },
      tick_timing: "none",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: {
        spell_id: "grease",
        area_tiles: [{ x: 1, y: 0 }],
        zone_behavior: {
          terrain_kind: "difficult"
        }
      }
    }];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.movement_cost_feet, 10);
    const actor = out.payload.combat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(actor.movement_remaining, 20);
  }, results);

  runTest("entering_web_zone_failed_save_applies_restrained_condition", () => {
    const manager = createActiveCombatForMoveTests();
    const combat = manager.getCombatById("combat-move-001").payload.combat;
    combat.active_effects = [{
      effect_id: "effect-web-zone-001",
      type: "spell_active_web",
      source: { participant_id: "p2", event_id: null },
      target: { participant_id: "p2" },
      duration: { remaining_turns: 10, max_turns: 10 },
      tick_timing: "none",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: {
        spell_id: "web",
        area_tiles: [{ x: 1, y: 0 }],
        zone_behavior: {
          terrain_kind: "difficult",
          on_enter_condition: {
            save_ability: "dexterity",
            save_dc: 13,
            condition_type: "restrained",
            expiration_trigger: "manual",
            metadata: {
              source_spell_id: "web"
            }
          }
        }
      }
    }];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 },
      saving_throw_fn: () => ({ final_total: 4 })
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.zone_effect_results.length, 1);
    assert.equal(out.payload.zone_effect_results[0].applied_condition.condition_type, "restrained");
    assert.equal(out.payload.combat.conditions.some((entry) => {
      return String(entry && entry.condition_type || "") === "restrained" &&
        String(entry && entry.target_actor_id || "") === "p1";
    }), true);
  }, results);

  runTest("entering_moonbeam_zone_failed_save_applies_radiant_damage", () => {
    const manager = createActiveCombatForMoveTests();
    const combat = manager.getCombatById("combat-move-001").payload.combat;
    combat.active_effects = [{
      effect_id: "effect-moonbeam-zone-001",
      type: "spell_active_moonbeam",
      source: { participant_id: "p2", event_id: null },
      target: { participant_id: "p2" },
      duration: { remaining_turns: 10, max_turns: 10 },
      tick_timing: "none",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: {
        spell_id: "moonbeam",
        area_tiles: [{ x: 1, y: 0 }],
        zone_behavior: {
          on_enter_damage: {
            save_ability: "constitution",
            save_dc: 13,
            damage_formula: "2d10",
            damage_type: "radiant",
            save_result: "half_damage_on_success"
          },
          on_turn_start_damage: {
            save_ability: "constitution",
            save_dc: 13,
            damage_formula: "2d10",
            damage_type: "radiant",
            save_result: "half_damage_on_success"
          }
        }
      }
    }];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 },
      saving_throw_fn: () => ({ final_total: 4 }),
      damage_rng: () => 0
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.zone_effect_results.length, 1);
    assert.equal(out.payload.zone_effect_results[0].damage_applied.damage_type, "radiant");
    assert.equal(Number(out.payload.zone_effect_results[0].damage_applied.final_damage) > 0, true);
  }, results);

  runTest("entering_cloudkill_zone_failed_save_applies_poison_damage", () => {
    const manager = createActiveCombatForMoveTests();
    const combat = manager.getCombatById("combat-move-001").payload.combat;
    combat.active_effects = [{
      effect_id: "effect-cloudkill-zone-001",
      type: "spell_active_cloudkill",
      source: { participant_id: "p2", event_id: null },
      target: { participant_id: "p2" },
      duration: { remaining_turns: 10, max_turns: 10 },
      tick_timing: "none",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: {
        spell_id: "cloudkill",
        area_tiles: [{ x: 1, y: 0 }],
        zone_behavior: {
          on_enter_damage: {
            save_ability: "constitution",
            save_dc: 15,
            damage_formula: "5d8",
            damage_type: "poison",
            save_result: "half_damage_on_success"
          },
          on_turn_start_damage: {
            save_ability: "constitution",
            save_dc: 15,
            damage_formula: "5d8",
            damage_type: "poison",
            save_result: "half_damage_on_success"
          }
        }
      }
    }];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 },
      saving_throw_fn: () => ({ final_total: 4 }),
      damage_rng: () => 0
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.zone_effect_results.length, 1);
    assert.equal(out.payload.zone_effect_results[0].damage_applied.damage_type, "poison");
    assert.equal(Number(out.payload.zone_effect_results[0].damage_applied.final_damage) > 0, true);
  }, results);

  runTest("entering_insect_plague_zone_failed_save_applies_piercing_damage", () => {
    const manager = createActiveCombatForMoveTests();
    const combat = manager.getCombatById("combat-move-001").payload.combat;
    combat.active_effects = [{
      effect_id: "effect-insect-plague-zone-001",
      type: "spell_active_insect_plague",
      source: { participant_id: "p2", event_id: null },
      target: { participant_id: "p2" },
      duration: { remaining_turns: 10, max_turns: 10 },
      tick_timing: "none",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: {
        spell_id: "insect_plague",
        area_tiles: [{ x: 1, y: 0 }],
        zone_behavior: {
          terrain_kind: "difficult",
          on_enter_damage: {
            save_ability: "constitution",
            save_dc: 15,
            damage_formula: "4d10",
            damage_type: "piercing",
            save_result: "half_damage_on_success"
          }
        }
      }
    }];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 },
      saving_throw_fn: () => ({ final_total: 4 }),
      damage_rng: () => 0
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.zone_effect_results.length, 1);
    assert.equal(out.payload.zone_effect_results[0].damage_applied.damage_type, "piercing");
    assert.equal(Number(out.payload.zone_effect_results[0].damage_applied.final_damage) > 0, true);
  }, results);

  runTest("entering_incendiary_cloud_zone_failed_save_applies_fire_damage", () => {
    const manager = createActiveCombatForMoveTests();
    const combat = manager.getCombatById("combat-move-001").payload.combat;
    combat.active_effects = [{
      effect_id: "effect-incendiary-cloud-zone-001",
      type: "spell_active_incendiary_cloud",
      source: { participant_id: "p2", event_id: null },
      target: { participant_id: "p2" },
      duration: { remaining_turns: 10, max_turns: 10 },
      tick_timing: "none",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: {
        spell_id: "incendiary_cloud",
        area_tiles: [{ x: 1, y: 0 }],
        zone_behavior: {
          on_enter_damage: {
            save_ability: "dexterity",
            save_dc: 15,
            damage_formula: "10d8",
            damage_type: "fire",
            save_result: "half_damage_on_success"
          }
        }
      }
    }];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 },
      saving_throw_fn: () => ({ final_total: 4 }),
      damage_rng: () => 0
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.zone_effect_results.length, 1);
    assert.equal(out.payload.zone_effect_results[0].damage_applied.damage_type, "fire");
    assert.equal(Number(out.payload.zone_effect_results[0].damage_applied.final_damage) > 0, true);
  }, results);

  runTest("entering_ice_storm_zone_costs_difficult_terrain_movement", () => {
    const manager = createActiveCombatForMoveTests();
    const combat = manager.getCombatById("combat-move-001").payload.combat;
    combat.active_effects = [{
      effect_id: "effect-ice-storm-zone-001",
      type: "spell_active_ice_storm",
      source: { participant_id: "p2", event_id: null },
      target: { participant_id: "p2" },
      duration: { remaining_turns: 1, max_turns: 1 },
      tick_timing: "none",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: {
        spell_id: "ice_storm",
        area_tiles: [{ x: 1, y: 0 }],
        zone_behavior: {
          terrain_kind: "difficult"
        }
      }
    }];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.movement_cost_feet, 10);
    assert.deepEqual(out.payload.to_position, { x: 1, y: 0 });
  }, results);

  runTest("entering_sleet_storm_zone_failed_save_applies_prone_and_difficult_terrain_cost", () => {
    const manager = createActiveCombatForMoveTests();
    const combat = manager.getCombatById("combat-move-001").payload.combat;
    combat.active_effects = [{
      effect_id: "effect-sleet-storm-zone-001",
      type: "spell_active_sleet_storm",
      source: { participant_id: "p2", event_id: null },
      target: { participant_id: "p2" },
      duration: { remaining_turns: 10, max_turns: 10 },
      tick_timing: "none",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: {
        spell_id: "sleet_storm",
        utility_ref: "spell_fog_cloud_heavily_obscured",
        area_tiles: [{ x: 1, y: 0 }],
        zone_behavior: {
          terrain_kind: "difficult",
          on_enter_condition: {
            save_ability: "dexterity",
            save_dc: 14,
            condition_type: "prone",
            expiration_trigger: "manual",
            metadata: {
              source_spell_id: "sleet_storm"
            }
          }
        }
      }
    }];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 },
      saving_throw_fn: () => ({ final_total: 4 })
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.movement_cost_feet, 10);
    assert.equal(out.payload.zone_effect_results.length, 1);
    assert.equal(out.payload.zone_effect_results[0].applied_condition.condition_type, "prone");
  }, results);

  runTest("moving_through_spike_growth_applies_piercing_damage_per_traversed_hazard_tile", () => {
    const manager = createActiveCombatForMoveTests();
    const combat = manager.getCombatById("combat-move-001").payload.combat;
    const actor = combat.participants.find((entry) => entry.participant_id === "p1");
    actor.current_hp = 20;
    actor.max_hp = 20;
    combat.active_effects = [{
      effect_id: "effect-spike-growth-zone-001",
      type: "spell_active_spike_growth",
      source: { participant_id: "p2", event_id: null },
      target: { participant_id: "p2" },
      duration: { remaining_turns: 10, max_turns: 10 },
      tick_timing: "none",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: {
        spell_id: "spike_growth",
        area_tiles: [{ x: 1, y: 0 }, { x: 2, y: 0 }],
        zone_behavior: {
          on_traverse_damage_per_tile: {
            damage_formula: "2d4",
            damage_type: "piercing"
          }
        }
      }
    }];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 2, y: 0 },
      damage_rng: () => 0
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.zone_effect_results.length, 2);
    assert.equal(out.payload.zone_effect_results.every((entry) => String(entry.damage_applied && entry.damage_applied.damage_type || "") === "piercing"), true);
    const updatedActor = out.payload.combat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(updatedActor.current_hp < 20, true);
  }, results);

  runTest("entering_gust_of_wind_zone_failed_save_applies_forced_movement", () => {
    const manager = createActiveCombatForMoveTests();
    const combat = manager.getCombatById("combat-move-001").payload.combat;
    const source = combat.participants.find((entry) => entry.participant_id === "p2");
    source.position = { x: 0, y: 0 };
    combat.active_effects = [{
      effect_id: "effect-gust-zone-001",
      type: "spell_active_gust_of_wind",
      source: { participant_id: "p2", event_id: null },
      target: { participant_id: "p2" },
      duration: { remaining_turns: 10, max_turns: 10 },
      tick_timing: "none",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: {
        spell_id: "gust_of_wind",
        area_tiles: [{ x: 1, y: 0 }],
        zone_behavior: {
          terrain_kind: "difficult",
          on_enter_forced_movement: {
            save_ability: "strength",
            save_dc: 15,
            push_tiles: 3
          }
        }
      }
    }];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 },
      saving_throw_fn: () => ({ final_total: 4 })
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.zone_effect_results.length, 1);
    assert.equal(out.payload.zone_effect_results[0].forced_movement_result.moved, true);
    assert.equal(out.payload.zone_effect_results[0].forced_movement_result.tiles_moved, 3);
    assert.deepEqual(out.payload.zone_effect_results[0].forced_movement_result.to_position, { x: 4, y: 0 });
  }, results);

  runTest("guardian_of_faith_damages_hostile_entry_once_per_turn_and_reduces_damage_pool", () => {
    const manager = createActiveCombatForMoveTests();
    const combat = manager.getCombatById("combat-move-001").payload.combat;
    combat.turn_index = 1;
    const source = combat.participants.find((entry) => entry.participant_id === "p1");
    const actor = combat.participants.find((entry) => entry.participant_id === "p2");
    source.position = { x: 0, y: 0 };
    actor.current_hp = 40;
    actor.max_hp = 40;
    actor.position = { x: 2, y: 0 };
    combat.active_effects = [{
      effect_id: "effect-guardian-zone-001",
      type: "spell_active_guardian_of_faith",
      source: { participant_id: "p1", event_id: null },
      target: { participant_id: "p1" },
      duration: { remaining_turns: 100, max_turns: 100 },
      tick_timing: "none",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: {
        spell_id: "guardian_of_faith",
        area_tiles: [{ x: 3, y: 0 }, { x: 4, y: 0 }],
        zone_behavior: {
          hostile_only: true,
          trigger_once_per_turn: true,
          damage_pool_remaining: 60,
          expires_when_damage_pool_spent: true,
          on_enter_damage: {
            save_ability: "dexterity",
            save_dc: 15,
            flat_damage: 20,
            damage_type: "radiant",
            save_result: "half_damage_on_success"
          }
        }
      }
    }];
    manager.combats.set("combat-move-001", combat);

    const first = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p2",
      target_position: { x: 3, y: 0 },
      saving_throw_fn: () => ({ final_total: 4 })
    });

    assert.equal(first.ok, true);
    assert.equal(first.payload.zone_effect_results.length, 1);
    assert.equal(first.payload.zone_effect_results[0].damage_applied.final_damage, 20);
    const afterFirst = first.payload.combat.participants.find((entry) => entry.participant_id === "p2");
    assert.equal(afterFirst.current_hp, 20);
    assert.equal(first.payload.combat.active_effects[0].modifiers.zone_behavior.damage_pool_remaining, 40);

    const second = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p2",
      target_position: { x: 4, y: 0 },
      saving_throw_fn: () => ({ final_total: 4 })
    });

    assert.equal(second.ok, true);
    assert.equal(second.payload.zone_effect_results.length, 0);
    assert.equal(second.payload.combat.active_effects[0].modifiers.zone_behavior.damage_pool_remaining, 40);
  }, results);

  runTest("entering_wall_of_fire_zone_failed_save_applies_fire_damage", () => {
    const manager = createActiveCombatForMoveTests();
    const combat = manager.getCombatById("combat-move-001").payload.combat;
    const actor = combat.participants.find((entry) => entry.participant_id === "p1");
    actor.current_hp = 30;
    actor.max_hp = 30;
    combat.active_effects = [{
      effect_id: "effect-wall-fire-zone-001",
      type: "spell_active_wall_of_fire",
      source: { participant_id: "p2", event_id: null },
      target: { participant_id: "p2" },
      duration: { remaining_turns: 10, max_turns: 10 },
      tick_timing: "none",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: {
        spell_id: "wall_of_fire",
        area_tiles: [{ x: 1, y: 0 }],
        zone_behavior: {
          on_enter_damage: {
            save_ability: "dexterity",
            save_dc: 15,
            damage_formula: "5d8",
            damage_type: "fire",
            save_result: "half_damage_on_success"
          }
        }
      }
    }];
    manager.combats.set("combat-move-001", combat);

    const out = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 },
      saving_throw_fn: () => ({ final_total: 4 }),
      damage_rng: () => 0
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.zone_effect_results.length, 1);
    assert.equal(out.payload.zone_effect_results[0].damage_applied.damage_type, "fire");
    const updatedActor = out.payload.combat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(updatedActor.current_hp < 30, true);
  }, results);

  runTest("wall_of_fire_hazard_side_damages_adjacent_tiles_without_damaging_wall_tiles", () => {
    const manager = createActiveCombatForMoveTests();
    const combat = manager.getCombatById("combat-move-001").payload.combat;
    const actor = combat.participants.find((entry) => entry.participant_id === "p1");
    actor.current_hp = 30;
    actor.max_hp = 30;
    combat.active_effects = [{
      effect_id: "effect-wall-fire-hazard-001",
      type: "spell_active_wall_of_fire",
      source: { participant_id: "p2", event_id: null },
      target: { participant_id: "p2" },
      duration: { remaining_turns: 10, max_turns: 10 },
      tick_timing: "none",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: {
        spell_id: "wall_of_fire",
        area_tiles: [{ x: 1, y: 0 }],
        zone_behavior: {
          on_enter_damage: {
            save_ability: "dexterity",
            save_dc: 15,
            damage_formula: "5d8",
            damage_type: "fire",
            save_result: "half_damage_on_success",
            area_tiles: [{ x: 1, y: 1 }]
          }
        }
      }
    }];
    manager.combats.set("combat-move-001", combat);

    const ontoWall = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 0 },
      saving_throw_fn: () => ({ final_total: 4 }),
      damage_rng: () => 0
    });

    assert.equal(ontoWall.ok, true);
    assert.equal(ontoWall.payload.zone_effect_results.length, 0);

    const afterWall = ontoWall.payload.combat;
    const resetActor = afterWall.participants.find((entry) => entry.participant_id === "p1");
    resetActor.current_hp = 30;
    resetActor.max_hp = 30;
    resetActor.position = { x: 0, y: 1 };
    resetActor.movement_remaining = 30;
    manager.combats.set("combat-move-001", afterWall);

    const intoHazard = performMoveAction({
      combatManager: manager,
      combat_id: "combat-move-001",
      participant_id: "p1",
      target_position: { x: 1, y: 1 },
      saving_throw_fn: () => ({ final_total: 4 }),
      damage_rng: () => 0
    });

    assert.equal(intoHazard.ok, true);
    assert.equal(intoHazard.payload.zone_effect_results.length, 1);
    assert.equal(intoHazard.payload.zone_effect_results[0].damage_applied.damage_type, "fire");
    const updatedActor = intoHazard.payload.combat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(updatedActor.current_hp < 30, true);
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
  const summary = runMoveActionTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runMoveActionTests
};
