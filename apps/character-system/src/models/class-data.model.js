"use strict";

// Primary class selection and current level data.
// This is scaffolding only and does not calculate class features.
const classDataModel = {
  primary_class_key: "string",
  primary_class_name: "string",
  current_level: "number",
  subclass_key: "string | null",
  subclass_name: "string | null",
  class_feature_refs: ["string"]
};

const exampleClassData = {
  primary_class_key: "wizard",
  primary_class_name: "Wizard",
  current_level: 5,
  subclass_key: "school_of_evocation",
  subclass_name: "School of Evocation",
  class_feature_refs: ["arcane_recovery", "sculpt_spells"]
};

module.exports = {
  classDataModel,
  exampleClassData
};
