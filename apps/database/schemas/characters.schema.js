"use strict";

// Characters are long-lived player/NPC records.
// This is persistent data owned by World State.
const charactersSchema = {
  table: "characters",
  description: "Persistent character identity, progression, and core stats.",
  primaryKey: "character_id",
  columns: {
    character_id: "string",
    user_id: "string",
    name: "string",
    class_id: "string",
    level: "number",
    experience: "number",
    created_at: "datetime",
    updated_at: "datetime"
  }
};

module.exports = {
  charactersSchema
};