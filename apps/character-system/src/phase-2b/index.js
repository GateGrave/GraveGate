"use strict";

// Phase 2B: stat and progression scaffolding (World State only).
// This module is structure-only and does not implement gameplay rules.
const { coreStatsStoreShape } = require("./core-stats.store");
const { levelStoreShape } = require("./level.store");
const { progressionTrackingStoreShape } = require("./progression-tracking.store");
const { gestaltLevelTrackingStoreShape } = require("./gestalt-level-tracking.store");
const { featSlotsStoreShape } = require("./feat-slots.store");
const {
  spellProgressionReferencesStoreShape
} = require("./spell-progression-references.store");
const {
  exampleProgressionA,
  exampleProgressionB
} = require("./example-progression.objects");

module.exports = {
  storeShapes: {
    coreStats: coreStatsStoreShape,
    level: levelStoreShape,
    progressionTracking: progressionTrackingStoreShape,
    gestaltLevelTracking: gestaltLevelTrackingStoreShape,
    featSlots: featSlotsStoreShape,
    spellProgressionReferences: spellProgressionReferencesStoreShape
  },
  examples: {
    progressionA: exampleProgressionA,
    progressionB: exampleProgressionB
  }
};
