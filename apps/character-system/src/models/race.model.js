"use strict";

// Race data reference for a character.
// This stores selected race information and selected traits.
const raceModel = {
  race_key: "string",
  race_name: "string",
  subrace_key: "string | null",
  subrace_name: "string | null",
  selected_racial_traits: ["string"],
  notes: "string"
};

const exampleRace = {
  race_key: "half-elf",
  race_name: "Half-Elf",
  subrace_key: null,
  subrace_name: null,
  selected_racial_traits: ["darkvision", "fey_ancestry", "skill_versatility"],
  notes: "Roleplay origin stored as text only in Phase 2A."
};

module.exports = {
  raceModel,
  exampleRace
};
