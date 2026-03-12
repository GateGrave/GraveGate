"use strict";

const assert = require("assert");
const {
  applyRaceSelection,
  applyClassSelection,
  finalizeCharacterProfile,
  applyCharacterSelections
} = require("../flow/applyCharacterSelections");
const { createInMemoryAdapter } = require("../../../../database/src/adapters/inMemoryAdapter");
const { CharacterPersistenceBridge } = require("../character.persistence");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runApplyCharacterSelectionsTests() {
  const results = [];

  runTest("human_plus_fighter_applies_successfully", () => {
    const out = applyCharacterSelections({
      character: { character_id: "char-select-001", name: "Vale" },
      race_id: "human",
      class_id: "fighter",
      background_id: "soldier"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_selection_applied");
    assert.equal(out.payload.character_profile.race_id, "human");
    assert.equal(out.payload.character_profile.class_id, "fighter");
    assert.equal(out.payload.character_profile.background_id, "soldier");
    assert.equal(out.payload.character_profile.race_option_id, null);
  }, results);

  runTest("apply_race_selection_base_race", () => {
    const out = applyRaceSelection(
      { character_id: "char-race-001", name: "Iris", applied_stat_modifiers: {}, applied_feature_refs: [] },
      "human"
    );
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_race_selection_applied");
    assert.equal(out.payload.character_profile.race_id, "human");
    assert.equal(out.payload.character_profile.race_selection.race_id, "human");
  }, results);

  runTest("apply_class_selection_base_class", () => {
    const out = applyClassSelection(
      { character_id: "char-class-001", name: "Tane", applied_feature_refs: [], applied_proficiencies: {} },
      "fighter"
    );
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_class_selection_applied");
    assert.equal(out.payload.character_profile.class_id, "fighter");
    assert.equal(out.payload.character_profile.class_selection.class_id, "fighter");
  }, results);

  runTest("hill_dwarf_plus_cleric_applies_successfully", () => {
    const out = applyCharacterSelections({
      character: { character_id: "char-select-002", name: "Brom" },
      race_id: "dwarf",
      race_option_id: "hill_dwarf",
      class_id: "cleric",
      class_option_id: "life_domain"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.character_profile.race_option_id, "hill_dwarf");
    assert.equal(out.payload.character_profile.class_option_id, "life_domain");
    assert.equal(out.payload.character_profile.applied_stat_modifiers.constitution >= 2, true);
    assert.equal(out.payload.character_profile.applied_stat_modifiers.wisdom >= 1, true);
  }, results);

  runTest("dragonborn_blue_plus_sorcerer_draconic_bloodline_applies_successfully", () => {
    const out = applyCharacterSelections({
      character: { character_id: "char-select-003", name: "Aris" },
      race_id: "dragonborn",
      race_option_id: "blue",
      class_id: "sorcerer",
      class_option_id: "draconic_bloodline",
      background_id: "acolyte"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.character_profile.race_option_id, "blue");
    assert.equal(out.payload.character_profile.class_option_id, "draconic_bloodline");
    assert.equal(out.payload.character_profile.background_id, "acolyte");
    assert.equal(out.payload.character_profile.applied_stat_modifiers.strength, 2);
    assert.equal(out.payload.character_profile.applied_stat_modifiers.charisma, 1);
  }, results);

  runTest("valid_background_selection_applies_profile_scaffold", () => {
    const out = applyCharacterSelections({
      character: { character_id: "char-select-003b", name: "Lia" },
      race_id: "human",
      class_id: "rogue",
      background_id: "criminal"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.character_profile.background_id, "criminal");
    assert.equal(out.payload.character_profile.background, "criminal");
    assert.equal(Array.isArray(out.payload.character_profile.applied_proficiencies.skills), true);
    assert.equal(out.payload.character_profile.applied_proficiencies.skills.includes("deception"), true);
  }, results);

  runTest("invalid_subrace_for_race_fails_safely", () => {
    const out = applyCharacterSelections({
      character: { character_id: "char-select-004", name: "Nia" },
      race_id: "human",
      race_option_id: "hill_dwarf",
      class_id: "fighter"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "character_selection_apply_failed");
    assert.equal(out.payload.reason, "invalid_race_option");
  }, results);

  runTest("invalid_race_id_handling", () => {
    const out = finalizeCharacterProfile(
      { character_id: "char-invalid-race-001", name: "Ari" },
      { race_id: "not_a_race", class_id: "fighter" }
    );
    assert.equal(out.ok, false);
    assert.equal(out.event_type, "character_selection_finalize_failed");
    assert.equal(out.payload.reason, "invalid_race_id");
  }, results);

  runTest("invalid_class_id_handling", () => {
    const out = finalizeCharacterProfile(
      { character_id: "char-invalid-class-001", name: "Ari" },
      { race_id: "human", class_id: "not_a_class" }
    );
    assert.equal(out.ok, false);
    assert.equal(out.event_type, "character_selection_finalize_failed");
    assert.equal(out.payload.reason, "invalid_class_id");
  }, results);

  runTest("invalid_subclass_for_class_fails_safely", () => {
    const out = applyCharacterSelections({
      character: { character_id: "char-select-005", name: "Mira" },
      race_id: "human",
      class_id: "fighter",
      class_option_id: "draconic_bloodline"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "character_selection_apply_failed");
    assert.equal(out.payload.reason, "invalid_class_option");
  }, results);

  runTest("invalid_class_option_for_helper_fails_safely", () => {
    const out = applyClassSelection(
      { character_id: "char-class-002", name: "Roa", applied_feature_refs: [], applied_proficiencies: {} },
      "wizard",
      "not_a_real_subclass"
    );
    assert.equal(out.ok, false);
    assert.equal(out.event_type, "character_class_selection_failed");
    assert.equal(out.payload.reason, "invalid_class_option");
  }, results);

  runTest("missing_required_race_option_fails_when_race_has_options", () => {
    const out = applyCharacterSelections({
      character: { character_id: "char-select-006", name: "Korr" },
      race_id: "dragonborn",
      class_id: "fighter"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "character_selection_apply_failed");
    assert.equal(out.payload.reason, "missing_required_race_option");
  }, results);

  runTest("invalid_background_fails_clearly", () => {
    const out = applyCharacterSelections({
      character: { character_id: "char-select-007", name: "Pax" },
      race_id: "human",
      class_id: "fighter",
      background_id: "not_real_background"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "character_selection_apply_failed");
    assert.equal(out.payload.reason, "invalid_background_id");
  }, results);

  runTest("finalize_character_profile_stable_output_shape", () => {
    const out = finalizeCharacterProfile(
      { character_id: "char-finalize-001", name: "Sera", stats: { strength: 10 } },
      {
        race_id: "dragonborn",
        race_option_id: "blue",
        class_id: "sorcerer",
        class_option_id: "draconic_bloodline"
      }
    );

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_profile_finalized");
    const profile = out.payload.character_profile;
    assert.equal(profile.race_id, "dragonborn");
    assert.equal(profile.race_option_id, "blue");
    assert.equal(profile.class_id, "sorcerer");
    assert.equal(profile.class_option_id, "draconic_bloodline");
    assert.equal(typeof profile.race_selection, "object");
    assert.equal(typeof profile.class_selection, "object");
    assert.equal(typeof profile.feature_scaffolds, "object");
    assert.equal(typeof profile.selection, "object");
    assert.equal(profile.selection.race.id, "dragonborn");
    assert.equal(profile.selection.class.id, "sorcerer");
    assert.equal(Array.isArray(profile.applied_feature_refs), true);
    assert.equal(typeof profile.applied_proficiencies, "object");
  }, results);

  runTest("assembled_stat_block_correctness_after_race_modifiers", () => {
    const out = finalizeCharacterProfile(
      {
        character_id: "char-stats-001",
        name: "Kara",
        stats: {
          strength: 10,
          dexterity: 10,
          constitution: 10,
          intelligence: 10,
          wisdom: 10,
          charisma: 10
        }
      },
      {
        race_id: "dragonborn",
        race_option_id: "red",
        class_id: "fighter"
      }
    );
    assert.equal(out.ok, true);
    const profile = out.payload.character_profile;
    assert.equal(profile.base_stats.strength, 10);
    assert.equal(profile.stats.strength, 12);
    assert.equal(profile.stats.charisma, 11);
  }, results);

  runTest("stable_proficiencies_and_class_metadata_attachment", () => {
    const out = finalizeCharacterProfile(
      { character_id: "char-prof-001", name: "Nera" },
      { race_id: "human", class_id: "cleric", class_option_id: "life_domain" }
    );
    assert.equal(out.ok, true);
    const profile = out.payload.character_profile;
    assert.equal(typeof profile.class_selection, "object");
    assert.equal(Array.isArray(profile.class_selection.saving_throws), true);
    assert.equal(Array.isArray(profile.applied_proficiencies.armor), true);
    assert.equal(profile.class_selection.class_id, "cleric");
    assert.equal(profile.class_selection.option_id, "life_domain");
  }, results);

  runTest("stable_scaffold_feature_attachment", () => {
    const out = finalizeCharacterProfile(
      { character_id: "char-features-001", name: "Vern" },
      { race_id: "elf", race_option_id: "wood_elf", class_id: "ranger", class_option_id: "hunter" }
    );
    assert.equal(out.ok, true);
    const profile = out.payload.character_profile;
    assert.equal(Array.isArray(profile.feature_scaffolds.race.feature_refs), true);
    assert.equal(Array.isArray(profile.feature_scaffolds.class.feature_refs), true);
    assert.equal(profile.feature_scaffolds.race.race_id, "elf");
    assert.equal(profile.feature_scaffolds.class.class_id, "ranger");
  }, results);

  runTest("output_shape_stability_assertions", () => {
    const out = finalizeCharacterProfile(
      { character_id: "char-shape-001", name: "Mira" },
      { race_id: "human", class_id: "fighter" }
    );
    assert.equal(out.ok, true);
    const profile = out.payload.character_profile;
    const requiredKeys = [
      "character_id",
      "name",
      "race_id",
      "race_option_id",
      "class_id",
      "class_option_id",
      "stats",
      "base_stats",
      "applied_stat_modifiers",
      "applied_feature_refs",
      "applied_proficiencies",
      "race_selection",
      "class_selection",
      "selection",
      "feature_scaffolds",
      "metadata"
    ];
    for (let i = 0; i < requiredKeys.length; i += 1) {
      const key = requiredKeys[i];
      assert.equal(Object.prototype.hasOwnProperty.call(profile, key), true, "missing key: " + key);
    }
  }, results);

  runTest("malformed_selection_payload_fails_cleanly", () => {
    const out = finalizeCharacterProfile(
      { character_id: "char-finalize-002", name: "Nox" },
      { race_id: "", class_id: "" }
    );
    assert.equal(out.ok, false);
    assert.equal(out.event_type, "character_selection_finalize_failed");
    assert.equal(out.payload.reason, "missing_required_selection_ids");
  }, results);

  runTest("non_object_selection_payload_fails_cleanly", () => {
    const out = finalizeCharacterProfile(
      { character_id: "char-finalize-003", name: "Nyx" },
      "bad"
    );
    assert.equal(out.ok, false);
    assert.equal(out.event_type, "character_selection_finalize_failed");
    assert.equal(out.payload.reason, "malformed_selection_payload");
  }, results);

  runTest("background_metadata_survives_persistence_reload", () => {
    const selected = applyCharacterSelections({
      character: { character_id: "char-select-008", name: "Rin", metadata: {} },
      race_id: "human",
      class_id: "fighter",
      background_id: "sage"
    });

    assert.equal(selected.ok, true);

    const adapter = createInMemoryAdapter();
    const persistence = new CharacterPersistenceBridge({ adapter });
    const saved = persistence.saveCharacter(selected.payload.character_profile);
    assert.equal(saved.ok, true);

    const loaded = persistence.loadCharacterById("char-select-008");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.payload.character.background_id, "sage");
    assert.equal(loaded.payload.character.background, "sage");
    assert.equal(
      loaded.payload.character.metadata.selection_application.background_name,
      "Sage"
    );
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
  const summary = runApplyCharacterSelectionsTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runApplyCharacterSelectionsTests
};
