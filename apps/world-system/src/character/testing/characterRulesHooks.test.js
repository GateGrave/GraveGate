"use strict";

const assert = require("assert");
const { createInMemoryAdapter } = require("../../../../database/src/adapters/inMemoryAdapter");
const { CharacterPersistenceBridge } = require("../character.persistence");
const {
  getRaceData,
  listAvailableRaces,
  getRaceOptions,
  getRaceOptionData,
  getRaceRule,
  applyRaceHooks
} = require("../rules/raceRules");
const {
  getClassData,
  listAvailableClasses,
  getClassOptions,
  getClassOptionData,
  getClassRule,
  applyClassHooks
} = require("../rules/classRules");
const {
  getBackgroundData,
  listAvailableBackgrounds,
  getBackgroundRule,
  applyBackgroundHooks
} = require("../rules/backgroundRules");
const {
  getSpellData,
  listAvailableSpells,
  listSpellsForClass
} = require("../rules/spellRules");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runCharacterRulesHooksTests() {
  const results = [];

  runTest("modules_load_and_return_structured_scaffold_data", () => {
    const raceListOut = listAvailableRaces();
    assert.equal(raceListOut.ok, true);
    assert.equal(raceListOut.event_type, "race_rules_listed");
    assert.equal(Array.isArray(raceListOut.payload.races), true);

    const classListOut = listAvailableClasses();
    assert.equal(classListOut.ok, true);
    assert.equal(classListOut.event_type, "class_rules_listed");
    assert.equal(Array.isArray(classListOut.payload.classes), true);

    const backgroundListOut = listAvailableBackgrounds();
    assert.equal(backgroundListOut.ok, true);
    assert.equal(backgroundListOut.event_type, "background_rules_listed");
    assert.equal(Array.isArray(backgroundListOut.payload.backgrounds), true);

    const raceDataOut = getRaceData("elf");
    assert.equal(raceDataOut.ok, true);
    assert.equal(raceDataOut.payload.race_data.id, "elf");
    assert.equal(typeof raceDataOut.payload.race_data.name, "string");
    assert.equal(typeof raceDataOut.payload.race_data.stat_modifiers, "object");
    assert.equal(Array.isArray(raceDataOut.payload.race_data.features), true);
    assert.equal(typeof raceDataOut.payload.race_data.metadata, "object");

    const classDataOut = getClassData("fighter");
    assert.equal(classDataOut.ok, true);
    assert.equal(classDataOut.payload.class_data.id, "fighter");
    assert.equal(typeof classDataOut.payload.class_data.name, "string");
    assert.equal(typeof classDataOut.payload.class_data.stat_modifiers, "object");
    assert.equal(Array.isArray(classDataOut.payload.class_data.features), true);
    assert.equal(typeof classDataOut.payload.class_data.metadata, "object");

    const backgroundDataOut = getBackgroundData("soldier");
    assert.equal(backgroundDataOut.ok, true);
    assert.equal(backgroundDataOut.payload.background_data.id, "soldier");
    assert.equal(typeof backgroundDataOut.payload.background_data.name, "string");
    assert.equal(typeof backgroundDataOut.payload.background_data.stat_modifiers, "object");
    assert.equal(Array.isArray(backgroundDataOut.payload.background_data.features), true);
    assert.equal(typeof backgroundDataOut.payload.background_data.metadata, "object");

    const spellListOut = listAvailableSpells();
    assert.equal(spellListOut.ok, true);
    assert.equal(spellListOut.event_type, "spell_rules_listed");
    assert.equal(Array.isArray(spellListOut.payload.spells), true);

    const spellDataOut = getSpellData("fire_bolt");
    assert.equal(spellDataOut.ok, true);
    assert.equal(spellDataOut.payload.spell_data.spell_id, "fire_bolt");
    assert.equal(typeof spellDataOut.payload.spell_data.name, "string");
    assert.equal(typeof spellDataOut.payload.spell_data.school, "string");
    assert.equal(typeof spellDataOut.payload.spell_data.effect, "object");
  }, results);

  runTest("legacy_hook_helpers_remain_usable", () => {
    const raceRuleOut = getRaceRule("elf");
    assert.equal(raceRuleOut.ok, true);
    assert.equal(raceRuleOut.payload.race.id, "elf");

    const classRuleOut = getClassRule("fighter");
    assert.equal(classRuleOut.ok, true);
    assert.equal(classRuleOut.payload.class_rule.id, "fighter");

    const backgroundRuleOut = getBackgroundRule("soldier");
    assert.equal(backgroundRuleOut.ok, true);
    assert.equal(backgroundRuleOut.payload.background.id, "soldier");

    const raceApplyOut = applyRaceHooks({ character_id: "char-race-001", name: "Ria" }, "human");
    assert.equal(raceApplyOut.ok, true);
    assert.equal(raceApplyOut.payload.character.race, "human");

    const classApplyOut = applyClassHooks({ character_id: "char-class-001", name: "Kai" }, "wizard");
    assert.equal(classApplyOut.ok, true);
    assert.equal(classApplyOut.payload.character.class, "wizard");

    const backgroundApplyOut = applyBackgroundHooks(
      { character_id: "char-bg-001", name: "Mora" },
      "acolyte"
    );
    assert.equal(backgroundApplyOut.ok, true);
    assert.equal(backgroundApplyOut.payload.character.background, "acolyte");
  }, results);

  runTest("invalid_ids_fail_safely", () => {
    const raceOut = getRaceData("not-a-race");
    const classOut = getClassData("not-a-class");
    const backgroundOut = getBackgroundData("not-a-background");
    const spellOut = getSpellData("not-a-spell");

    assert.equal(raceOut.ok, false);
    assert.equal(classOut.ok, false);
    assert.equal(backgroundOut.ok, false);
    assert.equal(spellOut.ok, false);

    assert.equal(typeof raceOut.error, "string");
    assert.equal(typeof classOut.error, "string");
    assert.equal(typeof backgroundOut.error, "string");
    assert.equal(typeof spellOut.error, "string");
  }, results);

  runTest("class_spell_lookup_returns_structured_starter_spell_metadata", () => {
    const wizardSpellsOut = listSpellsForClass("wizard");
    assert.equal(wizardSpellsOut.ok, true);
    assert.equal(wizardSpellsOut.event_type, "class_spell_listed");
    assert.equal(Array.isArray(wizardSpellsOut.payload.spells), true);

    const hasMagicMissile = wizardSpellsOut.payload.spells.some((entry) => {
      return entry && String(entry.spell_id) === "magic_missile";
    });
    assert.equal(hasMagicMissile, true);
    const hasAlarm = wizardSpellsOut.payload.spells.some((entry) => {
      return entry && String(entry.spell_id) === "alarm";
    });
    assert.equal(hasAlarm, false);
  }, results);

  runTest("non_alpha_spell_library_entries_remain_addressable_but_hidden_from_alpha_lists", () => {
    const spellOut = getSpellData("alarm");
    assert.equal(spellOut.ok, true);
    assert.equal(spellOut.payload.spell_data.metadata.alpha_selectable, false);

    const allSpellsOut = listAvailableSpells();
    assert.equal(allSpellsOut.ok, true);
    assert.equal(allSpellsOut.payload.spells.some((entry) => String(entry.spell_id) === "alarm"), false);
  }, results);

  runTest("spell_metadata_survives_character_persistence_reload", () => {
    const spellOut = getSpellData("magic_missile");
    assert.equal(spellOut.ok, true);

    const adapter = createInMemoryAdapter();
    const persistence = new CharacterPersistenceBridge({ adapter });

    const saved = persistence.saveCharacter({
      character_id: "char-spell-persist-001",
      player_id: "player-spell-persist-001",
      name: "Spell Persist Tester",
      spellbook: {
        known_spell_ids: ["magic_missile"],
        known_spells: [spellOut.payload.spell_data]
      }
    });
    assert.equal(saved.ok, true);

    const loaded = persistence.loadCharacterById("char-spell-persist-001");
    assert.equal(loaded.ok, true);
    assert.equal(Array.isArray(loaded.payload.character.spellbook.known_spells), true);
    assert.equal(loaded.payload.character.spellbook.known_spells[0].spell_id, "magic_missile");
    assert.equal(loaded.payload.character.spellbook.known_spells[0].school, "evocation");
  }, results);

  runTest("race_options_support_subraces_and_dragonborn_ancestry", () => {
    const dwarfOptionsOut = getRaceOptions("dwarf");
    assert.equal(dwarfOptionsOut.ok, true);
    assert.equal(Array.isArray(dwarfOptionsOut.payload.subraces), true);
    assert.equal(dwarfOptionsOut.payload.subraces.length >= 2, true);

    const hillDwarfOut = getRaceOptionData("dwarf", "hill_dwarf");
    assert.equal(hillDwarfOut.ok, true);
    assert.equal(hillDwarfOut.payload.option_type, "subrace");
    assert.equal(hillDwarfOut.payload.option_data.id, "hill_dwarf");

    const dragonbornOptionsOut = getRaceOptions("dragonborn");
    assert.equal(dragonbornOptionsOut.ok, true);
    assert.equal(Array.isArray(dragonbornOptionsOut.payload.ancestry_options), true);
    assert.equal(dragonbornOptionsOut.payload.ancestry_options.length >= 10, true);

    const redAncestryOut = getRaceOptionData("dragonborn", "red");
    assert.equal(redAncestryOut.ok, true);
    assert.equal(redAncestryOut.payload.option_type, "draconic_ancestry");
    assert.equal(redAncestryOut.payload.option_data.damage_type, "fire");

    const invalidOptionOut = getRaceOptionData("dragonborn", "not_real");
    assert.equal(invalidOptionOut.ok, false);
  }, results);

  runTest("class_content_includes_all_srd_5_1_base_classes", () => {
    const classListOut = listAvailableClasses();
    assert.equal(classListOut.ok, true);

    const classIds = classListOut.payload.classes.map((entry) => entry.id).sort();
    const expected = [
      "barbarian",
      "bard",
      "cleric",
      "druid",
      "fighter",
      "monk",
      "paladin",
      "ranger",
      "rogue",
      "sorcerer",
      "warlock",
      "wizard"
    ];

    assert.deepEqual(classIds, expected);
  }, results);

  runTest("class_options_support_subclass_selection", () => {
    const fighterOptionsOut = getClassOptions("fighter");
    assert.equal(fighterOptionsOut.ok, true);
    assert.equal(Array.isArray(fighterOptionsOut.payload.subclasses), true);
    assert.equal(fighterOptionsOut.payload.subclasses.length >= 1, true);

    const championOut = getClassOptionData("fighter", "champion");
    assert.equal(championOut.ok, true);
    assert.equal(championOut.payload.option_type, "subclass");
    assert.equal(championOut.payload.option_data.id, "champion");

    const invalidOut = getClassOptionData("fighter", "not_real");
    assert.equal(invalidOut.ok, false);
  }, results);

  runTest("class_content_exposes_subclass_unlock_levels", () => {
    const clericOut = getClassData("cleric");
    const sorcererOut = getClassData("sorcerer");
    const warlockOut = getClassData("warlock");
    const fighterOut = getClassData("fighter");
    const wizardOut = getClassData("wizard");

    assert.equal(clericOut.payload.class_data.metadata.subclass_unlock_level, 1);
    assert.equal(sorcererOut.payload.class_data.metadata.subclass_unlock_level, 1);
    assert.equal(warlockOut.payload.class_data.metadata.subclass_unlock_level, 1);
    assert.equal(fighterOut.payload.class_data.metadata.subclass_unlock_level, 3);
    assert.equal(wizardOut.payload.class_data.metadata.subclass_unlock_level, 2);
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
  const summary = runCharacterRulesHooksTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCharacterRulesHooksTests
};
