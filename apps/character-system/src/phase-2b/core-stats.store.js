"use strict";

// Persistent core stats snapshot for World State.
// These are saved values, not runtime combat calculations.
const coreStatsStoreShape = {
  character_id: "string",
  strength: "number",
  dexterity: "number",
  constitution: "number",
  intelligence: "number",
  wisdom: "number",
  charisma: "number",
  updated_at: "ISO-8601 string"
};

module.exports = {
  coreStatsStoreShape
};
