"use strict";

// Phase 2A Character Data Model Scaffolding (World State only).
// This module exports model shapes and example JSON objects.
// No combat logic and no Discord UI logic are implemented here.
const { characterIdentityModel, exampleCharacterIdentity } = require("./models/character-identity.model");
const { raceModel, exampleRace } = require("./models/race.model");
const { classDataModel, exampleClassData } = require("./models/class-data.model");
const { multiclassDataModel, exampleMulticlassData } = require("./models/multiclass-data.model");
const { gestaltProgressionModel, exampleGestaltProgression } = require("./models/gestalt-progression.model");
const { statsModel, exampleStats } = require("./models/stats.model");
const { featsModel, exampleFeats } = require("./models/feats.model");
const {
  spellListReferencesModel,
  exampleSpellListReferences
} = require("./models/spell-list-references.model");
const {
  characterSheetSummaryModel,
  exampleCharacterSheetSummary
} = require("./models/character-sheet-summary.model");
const {
  exampleCharacterWorldStateA,
  exampleCharacterWorldStateB
} = require("./models/example-characters");
const phase2B = require("./phase-2b");

module.exports = {
  models: {
    characterIdentityModel,
    raceModel,
    classDataModel,
    multiclassDataModel,
    gestaltProgressionModel,
    statsModel,
    featsModel,
    spellListReferencesModel,
    characterSheetSummaryModel
  },
  examples: {
    characterIdentity: exampleCharacterIdentity,
    race: exampleRace,
    classData: exampleClassData,
    multiclassData: exampleMulticlassData,
    gestaltProgression: exampleGestaltProgression,
    stats: exampleStats,
    feats: exampleFeats,
    spellListReferences: exampleSpellListReferences,
    characterSheetSummary: exampleCharacterSheetSummary,
    characterWorldStateA: exampleCharacterWorldStateA,
    characterWorldStateB: exampleCharacterWorldStateB
  },
  phase2B
};
