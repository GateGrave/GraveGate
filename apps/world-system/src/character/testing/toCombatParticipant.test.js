"use strict";

const assert = require("assert");
const { toCombatParticipant } = require("../adapters/toCombatParticipant");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runToCombatParticipantTests() {
  const results = [];

  runTest("successful_conversion", () => {
    const out = toCombatParticipant({
      character: {
        character_id: "char-adapter-001",
        name: "Adapter Hero",
        armor_class: 15,
        current_hitpoints: 18,
        hitpoint_max: 20
      },
      team: "heroes",
      attack_bonus: 5,
      damage: 8,
      position: { x: 2, y: 4 }
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "combat_participant_converted");
    assert.equal(out.payload.participant.participant_id, "char-adapter-001");
    assert.equal(out.payload.participant.team, "heroes");
    assert.equal(out.payload.participant.attack_bonus, 5);
    assert.equal(out.payload.participant.damage, 8);
    assert.deepEqual(out.payload.participant.position, { x: 2, y: 4 });
  }, results);

  runTest("sensible_defaults", () => {
    const out = toCombatParticipant({
      character: {
        character_id: "char-adapter-002",
        name: "Default Hero"
      }
    });

    assert.equal(out.ok, true);
    const p = out.payload.participant;
    assert.equal(p.team, "team_a");
    assert.equal(p.armor_class, 10);
    assert.equal(p.current_hp, 10);
    assert.equal(p.max_hp, 10);
    assert.equal(p.attack_bonus, 0);
    assert.equal(p.damage, 1);
    assert.deepEqual(p.position, { x: 0, y: 0 });
  }, results);

  runTest("preserving_character_identity", () => {
    const out = toCombatParticipant({
      character: {
        character_id: "char-adapter-identity-001",
        name: "Identity Hero",
        race_id: "human",
        class_id: "fighter",
        feats: ["alert", "mobile"],
        stats: {
          strength: 16,
          dexterity: 12,
          constitution: 14,
          intelligence: 10,
          wisdom: 8,
          charisma: 13
        },
        spellcasting_ability: "charisma",
        spellsave_dc: 13,
        spell_attack_bonus: 5,
        spellbook: {
          known_spell_ids: ["magic_missile"]
        },
        initiative: 5,
        equipped_item_profiles: {
          main_hand: {
            item_id: "item_longsword",
            weapon: {
              damage_dice: "1d8",
              damage_type: "slashing"
            }
          },
          body: {
            item_id: "item_chain_mail"
          }
        },
        speed: 40,
        metadata: {
          feat_flags: {
            war_caster: true
          }
        },
        hp_summary: {
          current: 21,
          max: 25
        }
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.participant.participant_id, "char-adapter-identity-001");
    assert.equal(out.payload.participant.name, "Identity Hero");
    assert.equal(out.payload.participant.current_hp, 21);
    assert.equal(out.payload.participant.max_hp, 25);
    assert.equal(out.payload.participant.movement_speed, 40);
    assert.equal(out.payload.participant.stats.strength, 16);
    assert.equal(out.payload.participant.feats.length, 2);
    assert.equal(out.payload.participant.feat_flags.war_caster, true);
    assert.equal(out.payload.participant.spellcasting_ability, "charisma");
    assert.equal(out.payload.participant.spellsave_dc, 13);
    assert.equal(out.payload.participant.spell_attack_bonus, 5);
    assert.equal(out.payload.participant.initiative_modifier, 5);
    assert.equal(out.payload.participant.spellbook.known_spell_ids[0], "magic_missile");
    assert.equal(out.payload.participant.readiness.race_id, "human");
    assert.equal(out.payload.participant.readiness.class_id, "fighter");
    assert.equal(out.payload.participant.readiness.weapon_profile.item_id, "item_longsword");
    assert.equal(out.payload.participant.readiness.armor_profile.item_id, "item_chain_mail");
    assert.equal(out.payload.participant.damage_formula, "1d8");
    assert.equal(out.payload.participant.damage_type, "slashing");
    assert.equal(out.payload.participant.temporary_hitpoints, 0);
  }, results);

  runTest("saving_throw_fallback_reads_numeric_summary_when_explicit_fields_are_missing", () => {
    const out = toCombatParticipant({
      character: {
        character_id: "char-adapter-save-001",
        name: "Save Hero",
        saving_throws: {
          wisdom: 4
        }
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.participant.wisdom_save_modifier, 4);
  }, results);

  runTest("item_effects_are_applied_to_combat_participant_state", () => {
    const out = toCombatParticipant({
      character: {
        character_id: "char-adapter-item-effects-001",
        name: "Relic Hero",
        armor_class: 15,
        speed: 30,
        hitpoint_max: 20,
        current_hitpoints: 20,
        temporary_hitpoints: 5,
        spellsave_dc: 13,
        spell_attack_bonus: 5,
        resistances: ["fire"],
        item_effects: {
          armor_class_bonus: 1,
          attack_bonus: 1,
          saving_throw_bonus: 1,
          spell_save_dc_bonus: 1,
          spell_attack_bonus: 1,
          speed_bonus: 10,
          damage_reduction: 2,
          damage_reduction_types: ["slashing"],
          resistances: ["cold"],
          on_hit_damage_effects: [{
            item_id: "item_blazing_blade",
            item_name: "Blazing Blade",
            damage_dice: "1d4",
            damage_type: "fire"
          }],
          reactive_damage_effects: [{
            item_id: "item_stormguard_loop",
            item_name: "Stormguard Loop",
            trigger: "melee_hit_taken",
            damage_dice: "1d4",
            damage_type: "lightning"
          }]
        },
        effective_armor_class: 16,
        effective_speed: 40,
        strength_save_modifier: 2,
        dexterity_save_modifier: 1,
        constitution_save_modifier: 2,
        intelligence_save_modifier: 0,
        wisdom_save_modifier: 1,
        charisma_save_modifier: 3
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.participant.armor_class, 16);
    assert.equal(out.payload.participant.attack_bonus, 1);
    assert.equal(out.payload.participant.movement_speed, 40);
    assert.equal(out.payload.participant.spellsave_dc, 14);
    assert.equal(out.payload.participant.spell_attack_bonus, 6);
    assert.equal(out.payload.participant.damage_reduction, 2);
    assert.equal(out.payload.participant.damage_reduction_types.includes("slashing"), true);
    assert.equal(out.payload.participant.resistances.includes("fire"), true);
    assert.equal(out.payload.participant.resistances.includes("cold"), true);
    assert.equal(out.payload.participant.magical_on_hit_effects.length, 1);
    assert.equal(out.payload.participant.magical_on_hit_effects[0].damage_type, "fire");
    assert.equal(out.payload.participant.magical_reactive_effects.length, 1);
    assert.equal(out.payload.participant.magical_reactive_effects[0].damage_type, "lightning");
    assert.equal(out.payload.participant.strength_save_modifier, 2);
    assert.equal(out.payload.participant.temporary_hitpoints, 5);
  }, results);

  runTest("failure_on_invalid_character_input", () => {
    const out = toCombatParticipant({
      character: {
        name: "Missing Id"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "combat_participant_conversion_failed");
    assert.equal(out.error, "character.character_id is required");
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
  const summary = runToCombatParticipantTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runToCombatParticipantTests
};
