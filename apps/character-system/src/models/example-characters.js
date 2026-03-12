"use strict";

const { exampleCharacterIdentity } = require("./character-identity.model");
const { exampleRace } = require("./race.model");
const { exampleClassData } = require("./class-data.model");
const { exampleMulticlassData } = require("./multiclass-data.model");
const { exampleGestaltProgression } = require("./gestalt-progression.model");
const { exampleStats } = require("./stats.model");
const { exampleFeats } = require("./feats.model");
const { exampleSpellListReferences } = require("./spell-list-references.model");
const { exampleCharacterSheetSummary } = require("./character-sheet-summary.model");

// Full example character objects for World State persistence scaffolding.
const exampleCharacterWorldStateA = {
  identity: exampleCharacterIdentity,
  race: exampleRace,
  class_data: exampleClassData,
  multiclass_data: exampleMulticlassData,
  gestalt_progression: exampleGestaltProgression,
  stats: exampleStats,
  feats: exampleFeats,
  spell_list_references: exampleSpellListReferences,
  sheet_summary: exampleCharacterSheetSummary
};

const exampleCharacterWorldStateB = {
  identity: {
    character_id: "char-002",
    player_id: "user-100",
    character_name: "Bram Stone",
    campaign_id: "campaign-main",
    created_at: "2026-03-07T00:00:00.000Z",
    updated_at: "2026-03-07T00:00:00.000Z",
    status: "active"
  },
  race: {
    race_key: "dwarf",
    race_name: "Dwarf",
    subrace_key: "hill_dwarf",
    subrace_name: "Hill Dwarf",
    selected_racial_traits: ["darkvision", "dwarven_resilience"],
    notes: "Second sample character for JSON scaffolding."
  },
  class_data: {
    primary_class_key: "cleric",
    primary_class_name: "Cleric",
    current_level: 4,
    subclass_key: "life_domain",
    subclass_name: "Life Domain",
    class_feature_refs: ["disciple_of_life", "channel_divinity"]
  },
  multiclass_data: {
    multiclass_entries: []
  },
  gestalt_progression: {
    enabled: false,
    track_a_class_key: "cleric",
    track_b_class_key: null,
    track_a_level: 4,
    track_b_level: 0,
    progression_notes: "Non-gestalt sample for comparison."
  },
  stats: {
    ability_scores: {
      strength: 13,
      dexterity: 10,
      constitution: 16,
      intelligence: 10,
      wisdom: 17,
      charisma: 12
    },
    derived_stats: {
      max_hp: 35,
      armor_class: 18,
      speed: 25,
      proficiency_bonus: 2
    }
  },
  feats: {
    selected_feats: []
  },
  spell_list_references: {
    spellcasting_ability: "wisdom",
    known_spell_refs: ["bless", "cure_wounds", "shield_of_faith"],
    prepared_spell_refs: ["bless", "cure_wounds"],
    spell_list_sources: ["class"]
  },
  sheet_summary: {
    character_id: "char-002",
    character_name: "Bram Stone",
    race_name: "Hill Dwarf",
    class_summary: "Cleric (Life Domain)",
    level_summary: "Level 4",
    stat_summary: "STR 13 DEX 10 CON 16 INT 10 WIS 17 CHA 12",
    feat_count: 0,
    prepared_spell_count: 2,
    last_synced_at: "2026-03-07T00:00:00.000Z"
  }
};

module.exports = {
  exampleCharacterWorldStateA,
  exampleCharacterWorldStateB
};
