"use strict";

// Example persistent progression snapshots.
// These examples show stored World State values only.
const exampleProgressionA = {
  core_stats: {
    character_id: "char-001",
    strength: 12,
    dexterity: 14,
    constitution: 14,
    intelligence: 18,
    wisdom: 10,
    charisma: 13,
    updated_at: "2026-03-07T00:00:00.000Z"
  },
  level: {
    character_id: "char-001",
    character_level: 5,
    level_cap: 20,
    last_level_up_at: "2026-03-07T00:00:00.000Z"
  },
  progression_tracking: {
    character_id: "char-001",
    progression_type: "xp",
    current_xp: 7600,
    xp_to_next_level: 1400,
    progression_points: 0,
    completed_milestones: ["intro_arc_complete"],
    updated_at: "2026-03-07T00:00:00.000Z"
  },
  gestalt_level_tracking: {
    character_id: "char-001",
    gestalt_enabled: true,
    track_a: { class_key: "wizard", level: 5 },
    track_b: { class_key: "fighter", level: 5 },
    synchronization_notes: "Tracks advanced together."
  },
  feat_slots: {
    character_id: "char-001",
    total_feat_slots: 2,
    used_feat_slots: 1,
    available_feat_slots: 1,
    selected_feat_refs: ["war_caster"],
    pending_feat_choices: []
  },
  spell_progression_references: {
    character_id: "char-001",
    caster_type: "full",
    spellcasting_ability: "intelligence",
    unlocked_spell_level_cap: 3,
    spell_slot_table_ref: "wizard_standard_slots",
    known_spell_count: 12,
    prepared_spell_count: 8,
    progression_ref_notes: "References only. No spell math in Phase 2B."
  }
};

const exampleProgressionB = {
  core_stats: {
    character_id: "char-002",
    strength: 13,
    dexterity: 10,
    constitution: 16,
    intelligence: 10,
    wisdom: 17,
    charisma: 12,
    updated_at: "2026-03-07T00:00:00.000Z"
  },
  level: {
    character_id: "char-002",
    character_level: 4,
    level_cap: 20,
    last_level_up_at: null
  },
  progression_tracking: {
    character_id: "char-002",
    progression_type: "milestone",
    current_xp: 0,
    xp_to_next_level: 0,
    progression_points: 2,
    completed_milestones: ["act_1_complete", "crypt_cleared"],
    updated_at: "2026-03-07T00:00:00.000Z"
  },
  gestalt_level_tracking: {
    character_id: "char-002",
    gestalt_enabled: false,
    track_a: { class_key: "cleric", level: 4 },
    track_b: { class_key: null, level: 0 },
    synchronization_notes: "Single-track character."
  },
  feat_slots: {
    character_id: "char-002",
    total_feat_slots: 1,
    used_feat_slots: 0,
    available_feat_slots: 1,
    selected_feat_refs: [],
    pending_feat_choices: ["level4_feat_pick"]
  },
  spell_progression_references: {
    character_id: "char-002",
    caster_type: "full",
    spellcasting_ability: "wisdom",
    unlocked_spell_level_cap: 2,
    spell_slot_table_ref: "cleric_standard_slots",
    known_spell_count: 0,
    prepared_spell_count: 6,
    progression_ref_notes: "Prepared caster reference data."
  }
};

module.exports = {
  exampleProgressionA,
  exampleProgressionB
};
