"use strict";

// Persistent gestalt level tracking for World State.
// Keeps each class track level separate for later rule handling.
const gestaltLevelTrackingStoreShape = {
  character_id: "string",
  gestalt_enabled: "boolean",
  track_a: {
    class_key: "string | null",
    level: "number"
  },
  track_b: {
    class_key: "string | null",
    level: "number"
  },
  synchronization_notes: "string"
};

module.exports = {
  gestaltLevelTrackingStoreShape
};
