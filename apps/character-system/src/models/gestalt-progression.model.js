"use strict";

// Gestalt progression scaffolding.
// Stores parallel class track references without implementing rules.
const gestaltProgressionModel = {
  enabled: "boolean",
  track_a_class_key: "string | null",
  track_b_class_key: "string | null",
  track_a_level: "number",
  track_b_level: "number",
  progression_notes: "string"
};

const exampleGestaltProgression = {
  enabled: true,
  track_a_class_key: "wizard",
  track_b_class_key: "fighter",
  track_a_level: 5,
  track_b_level: 5,
  progression_notes: "Phase 2A stores class tracks only; no feature resolution yet."
};

module.exports = {
  gestaltProgressionModel,
  exampleGestaltProgression
};
