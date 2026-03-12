"use strict";

// Character sheet summary.
// This is a flattened read model for quick display or exports.
const characterSheetSummaryModel = {
  character_id: "string",
  character_name: "string",
  race_name: "string",
  class_summary: "string",
  level_summary: "string",
  stat_summary: "string",
  feat_count: "number",
  prepared_spell_count: "number",
  last_synced_at: "ISO-8601 string"
};

const exampleCharacterSheetSummary = {
  character_id: "char-001",
  character_name: "Aria Vale",
  race_name: "Half-Elf",
  class_summary: "Wizard (Evocation) // Fighter",
  level_summary: "Gestalt 5 (Track A 5 / Track B 5)",
  stat_summary: "STR 12 DEX 14 CON 14 INT 18 WIS 10 CHA 13",
  feat_count: 1,
  prepared_spell_count: 3,
  last_synced_at: "2026-03-07T00:00:00.000Z"
};

module.exports = {
  characterSheetSummaryModel,
  exampleCharacterSheetSummary
};
