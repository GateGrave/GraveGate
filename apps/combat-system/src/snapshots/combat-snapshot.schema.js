"use strict";

// Snapshot schema for crash recovery.
// Stored at end of each turn.
const COMBAT_SNAPSHOT_SCHEMA = {
  snapshot_id: "string",
  combat_id: "string",
  snapshot_timestamp: "ISO-8601 string",
  round_number: "number",
  current_turn_index: "number",
  initiative_order: "array",
  grid_positions: "array",
  active_effects: "array",
  combat_state: "object"
};

module.exports = {
  COMBAT_SNAPSHOT_SCHEMA
};
