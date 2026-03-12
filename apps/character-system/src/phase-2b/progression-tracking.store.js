"use strict";

// Persistent progression tracking.
// Stores experience/progression points and milestone markers.
const progressionTrackingStoreShape = {
  character_id: "string",
  progression_type: "xp | milestone",
  current_xp: "number",
  xp_to_next_level: "number",
  progression_points: "number",
  completed_milestones: ["string"],
  updated_at: "ISO-8601 string"
};

module.exports = {
  progressionTrackingStoreShape
};
