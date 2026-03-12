"use strict";

// Persistent level data for a character.
// This stores current level state only.
const levelStoreShape = {
  character_id: "string",
  character_level: "number",
  level_cap: "number",
  last_level_up_at: "ISO-8601 string | null"
};

module.exports = {
  levelStoreShape
};
