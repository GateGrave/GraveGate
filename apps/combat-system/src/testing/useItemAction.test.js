"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { useItemAction } = require("../actions/useItemAction");
const { applyDamageToCombatState } = require("../damage/apply-damage-to-combat-state");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createActiveCombatForUseItemTests() {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: "combat-item-001",
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
        current_hp: 6,
        max_hp: 10,
        attack_bonus: 3,
        damage: 4
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

function runUseItemActionTests() {
  const results = [];

  runTest("successful_healing_item_use", () => {
    const manager = createActiveCombatForUseItemTests();
    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-heal-small",
        item_type: "consumable",
        heal_amount: 3
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "use_item_action_resolved");
    assert.equal(out.payload.hp_before, 6);
    assert.equal(out.payload.hp_after, 9);
    assert.equal(out.payload.healed_for, 3);
    assert.equal(out.payload.combat.event_log.length, 1);
    assert.equal(out.payload.combat.event_log[0].event_type, "use_item_action");
    const actor = out.payload.combat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(actor.action_available, false);
  }, results);

  runTest("using_item_consumes_action_for_turn", () => {
    const manager = createActiveCombatForUseItemTests();
    const first = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-heal-small",
        item_type: "consumable",
        heal_amount: 3
      }
    });
    assert.equal(first.ok, true);

    const second = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-heal-small",
        item_type: "consumable",
        heal_amount: 3
      }
    });
    assert.equal(second.ok, false);
    assert.equal(second.error, "action is not available");
  }, results);

  runTest("bonus_action_item_consumes_bonus_action_and_leaves_action_open", () => {
    const manager = createActiveCombatForUseItemTests();
    const combat = manager.getCombatById("combat-item-001").payload.combat;
    combat.participants[0].action_available = true;
    combat.participants[0].bonus_action_available = true;
    manager.combats.set("combat-item-001", combat);

    const first = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-quick-vial",
        item_type: "consumable",
        heal_amount: 2,
        metadata: {
          use_effect: {
            action_cost: "bonus_action"
          }
        }
      }
    });
    assert.equal(first.ok, true);
    assert.equal(first.payload.action_cost, "bonus_action");
    const actorAfterFirst = first.payload.combat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(actorAfterFirst.action_available, true);
    assert.equal(actorAfterFirst.bonus_action_available, false);

    const second = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-heal-small",
        item_type: "consumable",
        heal_amount: 1
      }
    });
    assert.equal(second.ok, true);
    const actorAfterSecond = second.payload.combat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(actorAfterSecond.action_available, false);
  }, results);

  runTest("bonus_action_item_fails_when_bonus_action_is_unavailable", () => {
    const manager = createActiveCombatForUseItemTests();
    const combat = manager.getCombatById("combat-item-001").payload.combat;
    combat.participants[0].action_available = true;
    combat.participants[0].bonus_action_available = false;
    manager.combats.set("combat-item-001", combat);

    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-quick-vial",
        item_type: "consumable",
        heal_amount: 2,
        metadata: {
          use_effect: {
            action_cost: "bonus_action"
          }
        }
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "bonus action is not available");
  }, results);

  runTest("hp_does_not_exceed_max_hp", () => {
    const manager = createActiveCombatForUseItemTests();
    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-heal-large",
        item_type: "consumable",
        heal_amount: 99
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.hp_after, 10);
    assert.equal(out.payload.healed_for, 4);
  }, results);

  runTest("temporary_hit_points_consumable_sets_temp_hp_without_healing", () => {
    const manager = createActiveCombatForUseItemTests();
    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-heroism-potion",
        item_type: "consumable",
        metadata: {
          temporary_hitpoints: 10
        }
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.hp_before, 6);
    assert.equal(out.payload.hp_after, 6);
    assert.equal(out.payload.healed_for, 0);
    assert.equal(out.payload.temporary_hp_before, 0);
    assert.equal(out.payload.temporary_hp_after, 10);
    const actor = out.payload.combat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(actor.temporary_hitpoints, 10);
  }, results);

  runTest("potion_of_heroism_applies_bless_condition_in_combat", () => {
    const manager = createActiveCombatForUseItemTests();
    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item_potion_of_heroism",
        item_type: "consumable",
        metadata: {
          temporary_hitpoints: 10,
          applied_conditions: [
            {
              condition_type: "bless",
              expiration_trigger: "start_of_turn",
              duration: {
                remaining_triggers: 10
              },
              metadata: {
                dice_bonus: "1d4"
              }
            }
          ]
        }
      }
    });

    assert.equal(out.ok, true);
    assert.equal(Array.isArray(out.payload.applied_conditions), true);
    assert.equal(out.payload.applied_conditions[0].condition_type, "bless");
    const combat = manager.getCombatById("combat-item-001").payload.combat;
    assert.equal(combat.conditions.some((entry) => entry.condition_type === "bless" && entry.target_actor_id === "p1"), true);
  }, results);

  runTest("charged_magical_item_can_grant_temporary_hitpoints_in_combat", () => {
    const manager = createActiveCombatForUseItemTests();
    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item_charm_of_vital_reserve",
        item_type: "equipment",
        metadata: {
          use_effect: {
            temporary_hitpoints: 6
          }
        }
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.temporary_hitpoints_granted, 6);
    const actor = out.payload.combat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(actor.temporary_hitpoints, 6);
  }, results);

  runTest("charged_heroic_charm_applies_start_of_turn_heroism_condition", () => {
    const manager = createActiveCombatForUseItemTests();
    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item_charm_of_heroic_echo",
        item_type: "equipment",
        metadata: {
          use_effect: {
            temporary_hitpoints: 3,
            applied_conditions: [
              {
                condition_type: "heroism",
                expiration_trigger: "manual",
                metadata: {
                  start_of_turn_temporary_hitpoints: 3,
                  source_item_id: "item_charm_of_heroic_echo"
                }
              }
            ]
          }
        }
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.temporary_hitpoints_granted, 3);
    assert.equal(out.payload.applied_conditions.some((entry) => entry.condition_type === "heroism"), true);
  }, results);

  runTest("aid_phial_increases_current_and_max_hitpoints_in_combat", () => {
    const manager = createActiveCombatForUseItemTests();
    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item_aid_phial",
        item_type: "consumable",
        metadata: {
          use_effect: {
            hitpoint_max_bonus: 5,
            applied_conditions: [
              {
                condition_type: "aid",
                expiration_trigger: "manual",
                metadata: {
                  hitpoint_max_bonus: 5,
                  source_item_id: "item_aid_phial"
                }
              }
            ]
          }
        }
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.hitpoint_max_bonus, 5);
    assert.equal(out.payload.hp_after, 11);
    const actor = out.payload.combat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(actor.max_hp, 15);
    assert.equal(out.payload.applied_conditions.some((entry) => entry.condition_type === "aid"), true);
  }, results);

  runTest("purity_phial_removes_poisoned_and_grants_poison_resistance", () => {
    const manager = createActiveCombatForUseItemTests();
    const found = manager.getCombatById("combat-item-001");
    const combat = found.payload.combat;
    combat.conditions = [{
      condition_id: "condition-poisoned-item-001",
      condition_type: "poisoned",
      source_actor_id: "p2",
      target_actor_id: "p1",
      expiration_trigger: "manual",
      metadata: {}
    }];
    manager.combats.set("combat-item-001", combat);

    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item_phial_of_purity",
        item_type: "consumable",
        metadata: {
          use_effect: {
            remove_conditions: ["poisoned"],
            applied_conditions: [
              {
                condition_type: "protection_from_poison",
                expiration_trigger: "manual",
                metadata: {
                  resistances: ["poison"]
                }
              }
            ]
          }
        }
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.removed_conditions.some((entry) => entry.condition_type === "poisoned"), true);
    assert.equal(out.payload.applied_conditions.some((entry) => entry.condition_type === "protection_from_poison"), true);
    const updatedCombat = manager.getCombatById("combat-item-001").payload.combat;
    assert.equal(updatedCombat.conditions.some((entry) => entry.condition_type === "poisoned" && entry.target_actor_id === "p1"), false);

    const damageApplied = applyDamageToCombatState({
      combat_state: updatedCombat,
      target_participant_id: "p1",
      damage_type: "poison",
      damage_formula: "1d8",
      rng: () => 0
    });
    assert.equal(damageApplied.damage_result.final_damage, 0);
  }, results);

  runTest("draught_of_longstrider_applies_speed_bonus_condition", () => {
    const manager = createActiveCombatForUseItemTests();
    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item_draught_of_longstrider",
        item_type: "consumable",
        metadata: {
          use_effect: {
            applied_conditions: [
              {
                condition_type: "longstrider",
                expiration_trigger: "manual",
                metadata: {
                  speed_bonus_feet: 10
                }
              }
            ]
          }
        }
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.applied_conditions.some((entry) => entry.condition_type === "longstrider"), true);
  }, results);

  runTest("talisman_of_resolve_applies_resistance_save_bonus_condition", () => {
    const manager = createActiveCombatForUseItemTests();
    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item_talisman_of_resolve",
        item_type: "equipment",
        metadata: {
          use_effect: {
            applied_conditions: [
              {
                condition_type: "resistance",
                expiration_trigger: "manual",
                metadata: {
                  saving_throw_bonus_dice: "1d4"
                }
              }
            ]
          }
        }
      }
    });

    assert.equal(out.ok, true);
    const appliedCondition = out.payload.applied_conditions.find((entry) => entry.condition_type === "resistance");
    assert.equal(Boolean(appliedCondition), true);
    assert.equal(appliedCondition.metadata.saving_throw_bonus_dice, "1d4");
  }, results);

  runTest("aegis_brooch_applies_dynamic_armor_class_condition", () => {
    const manager = createActiveCombatForUseItemTests();
    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item_aegis_brooch",
        item_type: "equipment",
        metadata: {
          use_effect: {
            applied_conditions: [
              {
                condition_type: "aegis_ward",
                expiration_trigger: "start_of_turn",
                metadata: {
                  armor_class_bonus: 2,
                  apply_armor_class_dynamically: true
                }
              }
            ]
          }
        }
      }
    });

    assert.equal(out.ok, true);
    const appliedCondition = out.payload.applied_conditions.find((entry) => entry.condition_type === "aegis_ward");
    assert.equal(Boolean(appliedCondition), true);
    assert.equal(appliedCondition.metadata.armor_class_bonus, 2);
  }, results);

  runTest("warding_prayer_charm_applies_sanctuary_condition", () => {
    const manager = createActiveCombatForUseItemTests();
    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item_warding_prayer_charm",
        item_type: "equipment",
        metadata: {
          use_effect: {
            applied_conditions: [
              {
                condition_type: "sanctuary",
                expiration_trigger: "manual",
                metadata: {
                  blocks_attack_targeting: true,
                  blocks_harmful_spell_targeting: true,
                  targeting_save_ability: "wisdom",
                  targeting_save_dc: 13
                }
              }
            ]
          }
        }
      }
    });

    assert.equal(out.ok, true);
    const appliedCondition = out.payload.applied_conditions.find((entry) => entry.condition_type === "sanctuary");
    assert.equal(Boolean(appliedCondition), true);
    assert.equal(appliedCondition.metadata.blocks_attack_targeting, true);
    assert.equal(appliedCondition.metadata.targeting_save_dc, 13);
  }, results);

  runTest("wrong_turn_failure", () => {
    const manager = createActiveCombatForUseItemTests();
    const found = manager.getCombatById("combat-item-001");
    const combat = found.payload.combat;
    combat.turn_index = 1;
    manager.combats.set("combat-item-001", combat);

    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-heal-small",
        item_type: "consumable",
        heal_amount: 3
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "use_item_action_failed");
    assert.equal(out.error, "it is not the participant's turn");
  }, results);

  runTest("non_consumable_item_with_supported_use_effect_succeeds", () => {
    const manager = createActiveCombatForUseItemTests();
    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-bomb",
        item_type: "throwable",
        heal_amount: 3
      }
    });

    assert.equal(out.ok, true);
  }, results);

  runTest("item_without_supported_use_effect_fails", () => {
    const manager = createActiveCombatForUseItemTests();
    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-bomb",
        item_type: "throwable"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "use_item_action_failed");
    assert.equal(out.error, "combat item must provide a supported use effect");
  }, results);

  runTest("defeated_participant_cannot_use_item", () => {
    const manager = createActiveCombatForUseItemTests();
    const found = manager.getCombatById("combat-item-001");
    const combat = found.payload.combat;
    const actor = combat.participants.find((p) => p.participant_id === "p1");
    actor.current_hp = 0;
    manager.combats.set("combat-item-001", combat);

    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-heal-small",
        item_type: "consumable",
        heal_amount: 3
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "use_item_action_failed");
    assert.equal(out.error, "defeated participants cannot act");
  }, results);

  runTest("stunned_participant_cannot_use_item", () => {
    const manager = createActiveCombatForUseItemTests();
    const found = manager.getCombatById("combat-item-001");
    const combat = found.payload.combat;
    combat.conditions = [{
      condition_id: "condition-stunned-item-001",
      condition_type: "stunned",
      source_actor_id: "p2",
      target_actor_id: "p1",
      expiration_trigger: "manual",
      metadata: {}
    }];
    manager.combats.set("combat-item-001", combat);

    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-heal-small",
        item_type: "consumable",
        heal_amount: 3
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "stunned participants cannot act");
  }, results);

  runTest("paralyzed_participant_cannot_use_item", () => {
    const manager = createActiveCombatForUseItemTests();
    const found = manager.getCombatById("combat-item-001");
    const combat = found.payload.combat;
    combat.conditions = [{
      condition_id: "condition-paralyzed-item-001",
      condition_type: "paralyzed",
      source_actor_id: "p2",
      target_actor_id: "p1",
      expiration_trigger: "manual",
      metadata: {}
    }];
    manager.combats.set("combat-item-001", combat);

    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-heal-small",
        item_type: "consumable",
        heal_amount: 3
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "paralyzed participants cannot act");
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
  const summary = runUseItemActionTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runUseItemActionTests
};
