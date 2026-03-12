"use strict";

const assert = require("assert");
const {
  runCasterCombatSliceHarness,
  validateSpellMetadata
} = require("./casterCombatSliceHarness");
const { listSpellsForClass } = require("../../../world-system/src/character/rules/spellRules");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runCasterCombatSliceHarnessTests() {
  const results = [];

  runTest("sorcerer_can_access_magic_missile_metadata_successfully", () => {
    const out = listSpellsForClass("sorcerer");
    assert.equal(out.ok, true);
    const hasSpell = out.payload.spells.some((entry) => {
      return entry && String(entry.spell_id) === "magic_missile";
    });
    assert.equal(hasSpell, true);
  }, results);

  runTest("cleric_can_access_cure_wounds_and_sacred_flame_metadata_successfully", () => {
    const out = listSpellsForClass("cleric");
    assert.equal(out.ok, true);
    const hasCureWounds = out.payload.spells.some((entry) => String(entry.spell_id) === "cure_wounds");
    const hasSacredFlame = out.payload.spells.some((entry) => String(entry.spell_id) === "sacred_flame");
    assert.equal(hasCureWounds, true);
    assert.equal(hasSacredFlame, true);
  }, results);

  runTest("caster_combat_action_resolves_through_expected_system_path", () => {
    const out = runCasterCombatSliceHarness({
      player_id: "player-caster-path-001",
      character_id: "char-caster-path-001",
      combat_id: "combat-caster-path-001",
      class_id: "sorcerer",
      spell_id: "fire_bolt"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "caster_combat_slice_completed");
    assert.equal(out.payload.class_spell_lookup.available, true);
    assert.equal(out.payload.cast_action.validated, true);
    assert.equal(out.payload.spell_resolution.spell_id, "fire_bolt");
    assert.equal(out.payload.spell_resolution.resolution_type, "spell_attack");
  }, results);

  runTest("invalid_spell_for_class_fails_clearly", () => {
    const out = runCasterCombatSliceHarness({
      player_id: "player-caster-invalid-class-001",
      character_id: "char-caster-invalid-class-001",
      combat_id: "combat-caster-invalid-class-001",
      class_id: "cleric",
      spell_id: "magic_missile"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "caster_combat_slice_failed");
    assert.equal(out.error, "spell is not available for class");
  }, results);

  runTest("malformed_spell_metadata_fails_clearly", () => {
    const malformed = validateSpellMetadata({
      spell_id: "broken_spell",
      name: "Broken Spell"
    });

    assert.equal(malformed.ok, false);
    assert.equal(malformed.event_type, "caster_spell_metadata_invalid");
    assert.equal(typeof malformed.error, "string");
  }, results);

  runTest("spell_related_combat_state_survives_persistence_reload", () => {
    const out = runCasterCombatSliceHarness({
      player_id: "player-caster-persist-001",
      character_id: "char-caster-persist-001",
      combat_id: "combat-caster-persist-001",
      class_id: "cleric",
      spell_id: "sacred_flame"
    });

    assert.equal(out.ok, true);
    assert.equal(typeof out.payload.persisted_snapshot_id, "string");
    assert.equal(out.payload.persisted_snapshot_id.trim() !== "", true);
    assert.equal(out.payload.spell_resolution.spell_id, "sacred_flame");
  }, results);

  runTest("expanded_content_spell_and_monster_slice_runs_successfully", () => {
    const out = runCasterCombatSliceHarness({
      player_id: "player-caster-expanded-001",
      character_id: "char-caster-expanded-001",
      combat_id: "combat-caster-expanded-001",
      class_id: "sorcerer",
      spell_id: "chromatic_orb",
      monster_id: "monster_gnoll_skullcleaver"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.spell_resolution.spell_id, "chromatic_orb");
    assert.equal(out.payload.monster_summary.monster_id, "monster_gnoll_skullcleaver");
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
  const summary = runCasterCombatSliceHarnessTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCasterCombatSliceHarnessTests
};
