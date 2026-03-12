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
        equipped_item_profiles: {
          main_hand: {
            item_id: "item_longsword"
          },
          body: {
            item_id: "item_chain_mail"
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
    assert.equal(out.payload.participant.stats.strength, 16);
    assert.equal(out.payload.participant.spellcasting_ability, "charisma");
    assert.equal(out.payload.participant.spellsave_dc, 13);
    assert.equal(out.payload.participant.spell_attack_bonus, 5);
    assert.equal(out.payload.participant.spellbook.known_spell_ids[0], "magic_missile");
    assert.equal(out.payload.participant.readiness.race_id, "human");
    assert.equal(out.payload.participant.readiness.class_id, "fighter");
    assert.equal(out.payload.participant.readiness.weapon_profile.item_id, "item_longsword");
    assert.equal(out.payload.participant.readiness.armor_profile.item_id, "item_chain_mail");
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
