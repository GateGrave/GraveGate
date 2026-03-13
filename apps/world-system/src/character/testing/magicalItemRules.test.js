"use strict";

const assert = require("assert");
const {
  buildResolvedItemEffectSummary,
  applyResolvedItemEffectState
} = require("../rules/magicalItemRules");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runMagicalItemRulesTests() {
  const results = [];

  runTest("attuned_and_equipped_magical_item_applies_passive_effects", () => {
    const character = {
      character_id: "char-magic-rules-001",
      armor_class: 15,
      speed: 30,
      hitpoint_max: 20,
      current_hitpoints: 20
    };
    const inventory = {
      equipment_items: [
        {
          item_id: "item_ring_of_protection",
          item_name: "Ring of Protection",
          item_type: "equipment",
          equip_slot: "ring",
          metadata: {
            magical: true,
            requires_attunement: true,
            equipped: true,
            equipped_slot: "ring",
            is_attuned: true,
            armor_class_bonus: 1,
            saving_throw_bonus: 1
          }
        },
        {
          item_id: "item_boots_of_swiftness",
          item_name: "Boots of Swiftness",
          item_type: "equipment",
          equip_slot: "feet",
          metadata: {
            magical: true,
            requires_attunement: true,
            equipped: true,
            equipped_slot: "feet",
            is_attuned: true,
            speed_bonus: 10
          }
        }
      ]
    };

    const summary = buildResolvedItemEffectSummary(character, inventory);
    assert.equal(summary.armor_class_bonus, 1);
    assert.equal(summary.saving_throw_bonus, 1);
    assert.equal(summary.speed_bonus, 10);
    assert.equal(summary.active_item_ids.includes("item_ring_of_protection"), true);

    const next = applyResolvedItemEffectState(character, inventory);
    assert.equal(next.effective_armor_class, 16);
    assert.equal(next.effective_speed, 40);
    assert.equal(next.item_effects.active_item_names.includes("Ring of Protection"), true);
  }, results);

  runTest("attunement_required_item_is_inactive_until_equipped_and_attuned", () => {
    const summary = buildResolvedItemEffectSummary({}, {
      equipment_items: [
        {
          item_id: "item_ring_of_protection",
          item_name: "Ring of Protection",
          item_type: "equipment",
          equip_slot: "ring",
          metadata: {
            magical: true,
            requires_attunement: true,
            equipped: false,
            is_attuned: true,
            armor_class_bonus: 1
          }
        }
      ]
    });

    assert.equal(summary.armor_class_bonus, 0);
    assert.equal(summary.active_item_ids.length, 0);
  }, results);

  runTest("spellcasting_and_resistance_effects_are_aggregated_for_active_items", () => {
    const summary = buildResolvedItemEffectSummary({}, {
      equipment_items: [
        {
          item_id: "item_wand_of_the_warmage",
          item_name: "Wand of the Warmage",
          item_type: "equipment",
          metadata: {
            magical: true,
            requires_attunement: true,
            equipped: true,
            equipped_slot: "main_hand",
            is_attuned: true,
            spell_attack_bonus: 1
          }
        },
        {
          item_id: "item_amulet_of_the_devout",
          item_name: "Amulet of the Devout",
          item_type: "equipment",
          metadata: {
            magical: true,
            requires_attunement: true,
            equipped: true,
            equipped_slot: "accessory",
            is_attuned: true,
            spell_save_dc_bonus: 1
          }
        },
        {
          item_id: "item_frostbrand_charm",
          item_name: "Frostbrand Charm",
          item_type: "equipment",
          metadata: {
            magical: true,
            requires_attunement: true,
            equipped: true,
            equipped_slot: "accessory",
            is_attuned: true,
            resistances: ["cold"]
          }
        }
      ]
    });

    assert.equal(summary.spell_attack_bonus, 1);
    assert.equal(summary.spell_save_dc_bonus, 1);
    assert.equal(summary.resistances.includes("cold"), true);
    assert.equal(summary.active_item_names.includes("Wand of the Warmage"), true);
  }, results);

  runTest("weapon_attack_bonus_and_on_hit_damage_effects_are_aggregated_for_active_items", () => {
    const summary = buildResolvedItemEffectSummary({}, {
      equipment_items: [
        {
          item_id: "item_blazing_blade",
          item_name: "Blazing Blade",
          item_type: "equipment",
          metadata: {
            magical: true,
            requires_attunement: true,
            equipped: true,
            equipped_slot: "main_hand",
            is_attuned: true,
            attack_bonus: 1,
            bonus_damage_dice: "1d4",
            bonus_damage_type: "fire"
          }
        }
      ]
    });

    assert.equal(summary.attack_bonus, 1);
    assert.equal(Array.isArray(summary.on_hit_damage_effects), true);
    assert.equal(summary.on_hit_damage_effects.length, 1);
    assert.equal(summary.on_hit_damage_effects[0].damage_dice, "1d4");
    assert.equal(summary.on_hit_damage_effects[0].damage_type, "fire");
  }, results);

  runTest("damage_reduction_effects_are_aggregated_for_active_items", () => {
    const summary = buildResolvedItemEffectSummary({}, {
      equipment_items: [
        {
          item_id: "item_guardian_brooch",
          item_name: "Guardian Brooch",
          item_type: "equipment",
          metadata: {
            magical: true,
            requires_attunement: true,
            equipped: true,
            equipped_slot: "accessory",
            is_attuned: true,
            damage_reduction: 2,
            damage_reduction_types: ["slashing", "piercing", "bludgeoning"]
          }
        }
      ]
    });

    assert.equal(summary.damage_reduction, 2);
    assert.equal(summary.damage_reduction_types.includes("slashing"), true);
    assert.equal(summary.damage_reduction_types.includes("piercing"), true);
  }, results);

  runTest("reactive_damage_effects_are_aggregated_for_active_items", () => {
    const summary = buildResolvedItemEffectSummary({}, {
      equipment_items: [
        {
          item_id: "item_stormguard_loop",
          item_name: "Stormguard Loop",
          item_type: "equipment",
          metadata: {
            magical: true,
            requires_attunement: true,
            equipped: true,
            equipped_slot: "ring",
            is_attuned: true,
            reactive_damage_effects: [
              {
                trigger: "melee_hit_taken",
                damage_dice: "1d4",
                damage_type: "lightning"
              }
            ]
          }
        }
      ]
    });

    assert.equal(Array.isArray(summary.reactive_damage_effects), true);
    assert.equal(summary.reactive_damage_effects.length, 1);
    assert.equal(summary.reactive_damage_effects[0].trigger, "melee_hit_taken");
    assert.equal(summary.reactive_damage_effects[0].damage_type, "lightning");
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
  const summary = runMagicalItemRulesTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runMagicalItemRulesTests
};
