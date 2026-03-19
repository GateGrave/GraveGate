"use strict";

const assert = require("assert");
const {
  CONTENT_SCHEMAS,
  validateContentEntry,
  loadRaceContent,
  loadClassContent,
  loadBackgroundContent,
  loadItemContent,
  loadMonsterContent,
  loadSpellContent,
  loadFeatContent,
  loadDungeonContent,
  loadRecipeContent,
  loadStarterContentBundle,
  loadContentFile,
  validateCrossContentReferences
} = require("..");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({
      name,
      ok: false,
      reason: error.message
    });
  }
}

function expectLoaded(out, expectedType) {
  assert.equal(out.ok, true);
  assert.equal(out.event_type, "content_file_loaded");
  assert.equal(out.payload.content_type, expectedType);
  assert.equal(Array.isArray(out.payload.entries), true);
  assert.equal(out.payload.entries.length > 0, true);
}

function runContentLoaderTests() {
  const results = [];

  runTest("content_schemas_defined_for_stage15_files", () => {
    assert.equal(typeof CONTENT_SCHEMAS.race, "object");
    assert.equal(typeof CONTENT_SCHEMAS.class, "object");
    assert.equal(typeof CONTENT_SCHEMAS.background, "object");
    assert.equal(typeof CONTENT_SCHEMAS.item, "object");
    assert.equal(typeof CONTENT_SCHEMAS.monster, "object");
    assert.equal(typeof CONTENT_SCHEMAS.spell, "object");
    assert.equal(typeof CONTENT_SCHEMAS.feat, "object");
    assert.equal(typeof CONTENT_SCHEMAS.dungeon, "object");
    assert.equal(typeof CONTENT_SCHEMAS.recipe, "object");
  }, results);

  runTest("individual_content_files_load_and_validate", () => {
    expectLoaded(loadRaceContent(), "race");
    expectLoaded(loadClassContent(), "class");
    expectLoaded(loadBackgroundContent(), "background");
    expectLoaded(loadItemContent(), "item");
    expectLoaded(loadMonsterContent(), "monster");
    expectLoaded(loadSpellContent(), "spell");
    expectLoaded(loadFeatContent(), "feat");
    expectLoaded(loadDungeonContent(), "dungeon");
    expectLoaded(loadRecipeContent(), "recipe");
  }, results);

  runTest("starter_content_bundle_loads_minimum_playable_slice", () => {
    const out = loadStarterContentBundle();
    assert.equal(out.ok, true);
    assert.equal(out.event_type, "starter_content_bundle_loaded");

    const content = out.payload.content;
    assert.equal(Array.isArray(content.races), true);
    assert.equal(Array.isArray(content.classes), true);
    assert.equal(Array.isArray(content.backgrounds), true);
    assert.equal(Array.isArray(content.items), true);
    assert.equal(Array.isArray(content.monsters), true);
    assert.equal(Array.isArray(content.spells), true);
    assert.equal(Array.isArray(content.feats), true);
    assert.equal(Array.isArray(content.dungeons), true);
    assert.equal(Array.isArray(content.recipes), true);
    assert.equal(typeof out.payload.cross_validation, "object");
  }, results);

  runTest("starter_items_include_minimum_equipment_and_consumables_slice", () => {
    const out = loadItemContent();
    expectLoaded(out, "item");

    const items = out.payload.entries;
    const byId = {};
    for (let i = 0; i < items.length; i += 1) {
      byId[String(items[i].item_id)] = items[i];
    }

    assert.equal(Boolean(byId.item_club), true);
    assert.equal(Boolean(byId.item_shortbow), true);
    assert.equal(Boolean(byId.item_longsword), true);
    assert.equal(Boolean(byId.item_leather_armor), true);
    assert.equal(Boolean(byId.item_chain_shirt), true);
    assert.equal(Boolean(byId.item_chain_mail), true);
    assert.equal(Boolean(byId.item_shield), true);
    assert.equal(Boolean(byId.item_healing_potion), true);
    assert.equal(Boolean(byId.item_spear), true);
    assert.equal(Boolean(byId.item_handaxe), true);
    assert.equal(Boolean(byId.item_light_crossbow), true);
    assert.equal(Boolean(byId.item_scale_mail), true);
    assert.equal(Boolean(byId.item_smoke_bomb), true);
    assert.equal(Boolean(byId.item_torch_bundle), true);
    assert.equal(Boolean(byId.item_rapier), true);
    assert.equal(Boolean(byId.item_longbow), true);
    assert.equal(Boolean(byId.item_half_plate), true);
    assert.equal(Boolean(byId.item_alchemists_fire), true);

    assert.equal(byId.item_longsword.metadata.category, "weapon");
    assert.equal(byId.item_chain_mail.metadata.category, "armor");
    assert.equal(byId.item_shield.metadata.category, "shield");
    assert.equal(byId.item_healing_potion.item_type, "consumable");
    assert.equal(byId.item_smoke_bomb.item_type, "consumable");
  }, results);

  runTest("starter_backgrounds_include_structured_scaffold_fields", () => {
    const out = loadBackgroundContent();
    expectLoaded(out, "background");

    const backgrounds = out.payload.entries;
    const byId = {};
    for (let i = 0; i < backgrounds.length; i += 1) {
      byId[String(backgrounds[i].id)] = backgrounds[i];
    }

    assert.equal(Boolean(byId.acolyte), true);
    assert.equal(Boolean(byId.soldier), true);
    assert.equal(Boolean(byId.sage), true);
    assert.equal(Boolean(byId.criminal), true);
    assert.equal(Boolean(byId.folk_hero), true);

    assert.equal(Array.isArray(byId.acolyte.skill_proficiencies), true);
    assert.equal(Array.isArray(byId.criminal.tool_refs), true);
    assert.equal(Array.isArray(byId.soldier.feature_refs), true);
  }, results);

  runTest("starter_monsters_include_minimum_early_encounter_slice", () => {
    const out = loadMonsterContent();
    expectLoaded(out, "monster");

    const monsters = out.payload.entries;
    const byId = {};
    for (let i = 0; i < monsters.length; i += 1) {
      byId[String(monsters[i].monster_id)] = monsters[i];
    }

    assert.equal(Boolean(byId.monster_goblin_scout), true);
    assert.equal(Boolean(byId.monster_skeleton_guard), true);
    assert.equal(Boolean(byId.monster_wolf_hunter), true);
    assert.equal(Boolean(byId.monster_bandit_raider), true);
    assert.equal(Boolean(byId.monster_hobgoblin_captain), true);
    assert.equal(Boolean(byId.monster_kobold_skirmisher), true);
    assert.equal(Boolean(byId.monster_zombie_shambler), true);
    assert.equal(Boolean(byId.monster_cultist_initiate), true);
    assert.equal(Boolean(byId.monster_orc_brute), true);
    assert.equal(Boolean(byId.monster_giant_spiderling), true);
    assert.equal(Boolean(byId.monster_gnoll_skullcleaver), true);
    assert.equal(Boolean(byId.monster_wight_captain), true);

    assert.equal(typeof byId.monster_goblin_scout.metadata.movement, "number");
    assert.equal(Array.isArray(byId.monster_goblin_scout.metadata.attacks), true);
    assert.equal(byId.monster_hobgoblin_captain.metadata.role, "miniboss");
    assert.equal(byId.monster_hobgoblin_captain.metadata.tier, "elite");
    assert.equal(typeof byId.monster_hobgoblin_captain.metadata.reward_curve, "object");
  }, results);

  runTest("monster_attack_metadata_accessible_for_combat_harness_use", () => {
    const out = loadMonsterContent();
    expectLoaded(out, "monster");

    const goblin = out.payload.entries.find((entry) => entry.monster_id === "monster_goblin_scout");
    assert.equal(Boolean(goblin), true);
    assert.equal(Array.isArray(goblin.metadata.attacks), true);
    assert.equal(goblin.metadata.attacks.length >= 1, true);

    const primaryAttack = goblin.metadata.attacks[0];
    assert.equal(typeof primaryAttack.name, "string");
    assert.equal(typeof primaryAttack.to_hit, "number");
    assert.equal(typeof primaryAttack.damage_dice, "string");
  }, results);

  runTest("starter_spells_include_minimum_caster_slice", () => {
    const out = loadSpellContent();
    expectLoaded(out, "spell");

    const spells = out.payload.entries;
    const byId = {};
    for (let i = 0; i < spells.length; i += 1) {
      byId[String(spells[i].spell_id)] = spells[i];
    }

    assert.equal(Boolean(byId.fire_bolt), true);
    assert.equal(Boolean(byId.ray_of_frost), true);
    assert.equal(Boolean(byId.magic_missile), true);
    assert.equal(Boolean(byId.shield), true);
    assert.equal(Boolean(byId.cure_wounds), true);
    assert.equal(Boolean(byId.sacred_flame), true);
    assert.equal(Boolean(byId.guiding_bolt), true);
    assert.equal(Boolean(byId.mage_armor), true);
    assert.equal(Boolean(byId.acid_splash), true);
    assert.equal(Boolean(byId.shocking_grasp), true);
    assert.equal(Boolean(byId.bless), true);
    assert.equal(Boolean(byId.burning_hands), true);
    assert.equal(Boolean(byId.thunderwave), true);
    assert.equal(Boolean(byId.chromatic_orb), true);
    assert.equal(Boolean(byId.healing_word), true);
    assert.equal(Boolean(byId.scorching_ray), true);
    assert.equal(Boolean(byId.light), true);
    assert.equal(Boolean(byId.poison_spray), true);

    assert.equal(Array.isArray(byId.magic_missile.class_refs), true);
    assert.equal(byId.shield.concentration, false);
    assert.equal(byId.bless.concentration, true);
    assert.equal(byId.fire_bolt.metadata.runtime_support.combat_resolution, "supported");
    assert.equal(Array.isArray(byId.fire_bolt.metadata.runtime_support.resolver_tags), true);
    assert.equal(byId.detect_magic.metadata.runtime_support.combat_resolution, "partial");
    assert.equal(byId.detect_magic.metadata.runtime_support.content_scope, "utility");
  }, results);

  runTest("spell_library_includes_non_alpha_srd_import_entries", () => {
    const out = loadSpellContent();
    expectLoaded(out, "spell");

    const byId = {};
    for (let i = 0; i < out.payload.entries.length; i += 1) {
      byId[String(out.payload.entries[i].spell_id)] = out.payload.entries[i];
    }

    assert.equal(Boolean(byId.alarm), true);
    assert.equal(Boolean(byId.guidance), true);
    assert.equal(byId.alarm.metadata.alpha_selectable, false);
    assert.equal(byId.guidance.metadata.alpha_selectable, false);
    assert.equal(byId.alarm.metadata.runtime_support.combat_resolution, "partial");
  }, results);

  runTest("starter_feats_include_minimum_progression_slice", () => {
    const out = loadFeatContent();
    expectLoaded(out, "feat");

    const feats = out.payload.entries;
    const byId = {};
    for (let i = 0; i < feats.length; i += 1) {
      byId[String(feats[i].feat_id)] = feats[i];
    }

    assert.equal(Boolean(byId.alert), true);
    assert.equal(Boolean(byId.tough), true);
    assert.equal(Boolean(byId.war_caster), true);
    assert.equal(Array.isArray(byId.alert.effects), true);
    assert.equal(typeof byId.war_caster.prerequisites, "object");
    assert.equal(byId.war_caster.prerequisites.spellcasting_required, true);
  }, results);

  runTest("starter_dungeons_include_tutorial_path_slice", () => {
    const out = loadDungeonContent();
    expectLoaded(out, "dungeon");

    const tutorial = out.payload.entries.find((entry) => entry.dungeon_id === "dungeon_tutorial_path");
    assert.equal(Boolean(tutorial), true);
    assert.equal(tutorial.start_room_id, "room_tutorial_entry");
    assert.equal(Array.isArray(tutorial.rooms), true);
    assert.equal(tutorial.rooms.length >= 3, true);

    const encounterRoom = tutorial.rooms.find((room) => room.room_type === "encounter");
    const exitRoom = tutorial.rooms.find((room) => room.room_id === "room_tutorial_exit");

    assert.equal(Boolean(encounterRoom), true);
    assert.equal(Boolean(encounterRoom.encounter && encounterRoom.encounter.monster_id), true);
    assert.equal(Boolean(exitRoom), true);

    const forestRuins = out.payload.entries.find((entry) => entry.dungeon_id === "dungeon_forest_ruins");
    const banditHideout = out.payload.entries.find((entry) => entry.dungeon_id === "dungeon_bandit_hideout");
    assert.equal(Boolean(forestRuins), true);
    assert.equal(Boolean(banditHideout), true);

    const spiderDen = out.payload.entries.find((entry) => entry.dungeon_id === "dungeon_spider_den");
    const fallenCrypt = out.payload.entries.find((entry) => entry.dungeon_id === "dungeon_fallen_crypt");
    assert.equal(Boolean(spiderDen), true);
    assert.equal(Boolean(fallenCrypt), true);
    assert.equal(String(spiderDen.metadata.reward_item_id), "item_alchemists_fire");
    assert.equal(String(fallenCrypt.metadata.difficulty_tier), "veteran");
    assert.equal(typeof fallenCrypt.metadata.reward_curve, "object");
  }, results);

  runTest("starter_recipes_include_minimum_crafting_slice", () => {
    const out = loadRecipeContent();
    expectLoaded(out, "recipe");

    const recipes = out.payload.entries;
    const byId = {};
    for (let i = 0; i < recipes.length; i += 1) {
      byId[String(recipes[i].recipe_id)] = recipes[i];
    }

    assert.equal(Boolean(byId.recipe_minor_healing_tonic), true);
    assert.equal(Boolean(byId.recipe_bandage_bundle), true);
    assert.equal(Boolean(byId.recipe_torch_bundle), true);
    assert.equal(Boolean(byId.recipe_simple_ration_pack), true);
    assert.equal(Boolean(byId.recipe_sharpened_blade_kit), true);
    assert.equal(Boolean(byId.recipe_field_bandage), true);
    assert.equal(Boolean(byId.recipe_smoke_bomb_mix), true);
    assert.equal(Boolean(byId.recipe_torch_pack), true);
    assert.equal(Boolean(byId.recipe_oil_flask), true);
    assert.equal(Boolean(byId.recipe_quick_tonic), true);
    assert.equal(Boolean(byId.recipe_hunters_spear), true);
    assert.equal(Boolean(byId.recipe_guardians_mace), true);
    assert.equal(Boolean(byId.recipe_scout_kit), true);
    assert.equal(Boolean(byId.recipe_firestarter_mix), true);
    assert.equal(Boolean(byId.recipe_smoke_screen_bundle), true);

    assert.equal(Array.isArray(byId.recipe_minor_healing_tonic.required_materials), true);
    assert.equal(typeof byId.recipe_minor_healing_tonic.metadata.recipe_type, "string");
    assert.equal(typeof byId.recipe_sharpened_blade_kit.metadata.required_profession, "string");
    assert.equal(String(byId.recipe_firestarter_mix.output_item_id), "item_alchemists_fire");
  }, results);

  runTest("shape_validation_fails_safely_on_missing_required_fields", () => {
    const out = validateContentEntry("item", {
      item_id: "missing-name",
      item_type: "equipment",
      stackable: false,
      metadata: {}
    });

    assert.equal(out.ok, false);
    assert.equal(typeof out.error, "string");
  }, results);

  runTest("invalid_monster_definition_fails_validation_cleanly", () => {
    const out = validateContentEntry("monster", {
      monster_id: "monster_invalid",
      name: "Broken Monster",
      level: 1,
      max_hp: 10,
      armor_class: 12,
      attack_bonus: 2,
      damage: 4,
      loot_table_id: "loot_table_invalid"
      // metadata missing by design for validation failure
    });

    assert.equal(out.ok, false);
    assert.equal(typeof out.error, "string");
    assert.equal(out.error, "invalid or missing field: metadata");
  }, results);

  runTest("invalid_spell_definition_fails_validation_cleanly", () => {
    const out = validateContentEntry("spell", {
      spell_id: "spell_invalid",
      name: "Broken Spell",
      level: 1,
      school: "evocation"
      // effect and metadata missing on purpose
    });

    assert.equal(out.ok, false);
    assert.equal(typeof out.error, "string");
    assert.equal(out.error, "invalid or missing field: effect");
  }, results);

  runTest("spell_without_runtime_support_metadata_fails_validation_cleanly", () => {
    const out = validateContentEntry("spell", {
      spell_id: "spell_missing_support",
      name: "Supportless Spell",
      level: 1,
      school: "evocation",
      effect: {},
      metadata: {
        source: "test"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "invalid or missing field: metadata");
  }, results);

  runTest("invalid_recipe_definition_fails_validation_cleanly", () => {
    const out = validateContentEntry("recipe", {
      recipe_id: "recipe_invalid",
      name: "Broken Recipe",
      output_quantity: 1,
      required_materials: [],
      metadata: {}
      // output_item_id missing on purpose
    });

    assert.equal(out.ok, false);
    assert.equal(typeof out.error, "string");
    assert.equal(out.error, "invalid or missing field: output_item_id");
  }, results);

  runTest("invalid_recipe_materials_payload_fails_validation_cleanly", () => {
    const out = validateContentEntry("recipe", {
      recipe_id: "recipe_invalid_materials",
      name: "Broken Materials Recipe",
      output_item_id: "item_healing_potion",
      output_quantity: 1,
      required_materials: [
        {
          item_id: "item_rat_tail",
          quantity: 0
        }
      ],
      metadata: {}
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "invalid or missing field: required_materials");
  }, results);

  runTest("unknown_content_type_load_fails_safely", () => {
    const out = loadContentFile("not-real");
    assert.equal(out.ok, false);
    assert.equal(out.event_type, "content_file_load_failed");
  }, results);

  runTest("valid_alpha_baseline_content_passes_cross_reference_validation", () => {
    const bundleOut = loadStarterContentBundle();
    assert.equal(bundleOut.ok, true);

    const crossOut = validateCrossContentReferences(bundleOut.payload.content);
    assert.equal(crossOut.ok, true);
    assert.equal(crossOut.event_type, "content_cross_reference_validation_passed");
  }, results);

  runTest("recipe_with_missing_item_ref_fails_clearly", () => {
    const bundleOut = loadStarterContentBundle();
    assert.equal(bundleOut.ok, true);

    const broken = JSON.parse(JSON.stringify(bundleOut.payload.content));
    broken.recipes[0].output_item_id = "item_does_not_exist_for_recipe_test";

    const crossOut = validateCrossContentReferences(broken);
    assert.equal(crossOut.ok, false);
    assert.equal(crossOut.event_type, "content_cross_reference_validation_failed");

    const hit = crossOut.payload.errors.find((entry) => {
      return entry && entry.content_type === "recipe" && entry.entry_id === broken.recipes[0].recipe_id;
    });
    assert.ok(hit);
    assert.equal(hit.field, "output_item_id");
    assert.equal(hit.missing_reference, "item_does_not_exist_for_recipe_test");
  }, results);

  runTest("dungeon_with_missing_monster_ref_fails_clearly", () => {
    const bundleOut = loadStarterContentBundle();
    assert.equal(bundleOut.ok, true);

    const broken = JSON.parse(JSON.stringify(bundleOut.payload.content));
    broken.dungeons[0].rooms[1].encounter.monster_id = "monster_does_not_exist_for_dungeon_test";

    const crossOut = validateCrossContentReferences(broken);
    assert.equal(crossOut.ok, false);

    const hit = crossOut.payload.errors.find((entry) => {
      return entry && entry.content_type === "dungeon" && entry.entry_id === broken.dungeons[0].dungeon_id;
    });
    assert.ok(hit);
    assert.equal(hit.field, "rooms.encounter.monster_id");
    assert.equal(hit.missing_reference, "monster_does_not_exist_for_dungeon_test");
  }, results);

  runTest("spell_with_invalid_class_ref_fails_clearly", () => {
    const bundleOut = loadStarterContentBundle();
    assert.equal(bundleOut.ok, true);

    const broken = JSON.parse(JSON.stringify(bundleOut.payload.content));
    broken.spells[0].class_refs = ["class_does_not_exist_for_spell_test"];

    const crossOut = validateCrossContentReferences(broken);
    assert.equal(crossOut.ok, false);

    const hit = crossOut.payload.errors.find((entry) => {
      return entry && entry.content_type === "spell" && entry.entry_id === broken.spells[0].spell_id;
    });
    assert.ok(hit);
    assert.equal(hit.field, "class_refs");
    assert.equal(hit.missing_reference, "class_does_not_exist_for_spell_test");
  }, results);

  runTest("monster_with_invalid_loot_item_ref_fails_clearly", () => {
    const bundleOut = loadStarterContentBundle();
    assert.equal(bundleOut.ok, true);

    const broken = JSON.parse(JSON.stringify(bundleOut.payload.content));
    broken.monsters[0].metadata.loot_item_refs = ["item_does_not_exist_for_monster_test"];

    const crossOut = validateCrossContentReferences(broken);
    assert.equal(crossOut.ok, false);

    const hit = crossOut.payload.errors.find((entry) => {
      return entry && entry.content_type === "monster" && entry.entry_id === broken.monsters[0].monster_id;
    });
    assert.ok(hit);
    assert.equal(hit.field, "metadata.loot_item_refs");
    assert.equal(hit.missing_reference, "item_does_not_exist_for_monster_test");
  }, results);

  runTest("monster_with_invalid_tier_or_reward_curve_fails_clearly", () => {
    const bundleOut = loadStarterContentBundle();
    assert.equal(bundleOut.ok, true);

    const broken = JSON.parse(JSON.stringify(bundleOut.payload.content));
    broken.monsters[0].metadata.tier = "mythic_plus_plus";
    broken.monsters[0].metadata.reward_curve = {
      quantity_multiplier: -2
    };

    const crossOut = validateCrossContentReferences(broken);
    assert.equal(crossOut.ok, false);

    const tierError = crossOut.payload.errors.find((entry) => {
      return entry && entry.content_type === "monster" && entry.field === "metadata.tier";
    });
    assert.ok(tierError);
    assert.equal(tierError.missing_reference, "mythic_plus_plus");

    const curveError = crossOut.payload.errors.find((entry) => {
      return entry && entry.content_type === "monster" && entry.field === "metadata.reward_curve.quantity_multiplier";
    });
    assert.ok(curveError);
  }, results);

  runTest("dungeon_with_invalid_tier_or_reward_curve_fails_clearly", () => {
    const bundleOut = loadStarterContentBundle();
    assert.equal(bundleOut.ok, true);

    const broken = JSON.parse(JSON.stringify(bundleOut.payload.content));
    broken.dungeons[0].metadata.difficulty_tier = "nightmare";
    broken.dungeons[0].metadata.reward_curve = {
      weighted_bonus_rolls: -1
    };

    const crossOut = validateCrossContentReferences(broken);
    assert.equal(crossOut.ok, false);

    const tierError = crossOut.payload.errors.find((entry) => {
      return entry && entry.content_type === "dungeon" && entry.field === "metadata.difficulty_tier";
    });
    assert.ok(tierError);
    assert.equal(tierError.missing_reference, "nightmare");

    const curveError = crossOut.payload.errors.find((entry) => {
      return entry && entry.content_type === "dungeon" && entry.field === "metadata.reward_curve.weighted_bonus_rolls";
    });
    assert.ok(curveError);
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
  const summary = runContentLoaderTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runContentLoaderTests
};
