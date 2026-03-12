"use strict";

// Optional multiclass records.
// Each entry is a class the character has taken outside the primary class.
const multiclassDataModel = {
  multiclass_entries: [
    {
      class_key: "string",
      class_name: "string",
      class_level: "number",
      subclass_key: "string | null",
      subclass_name: "string | null",
      feature_refs: ["string"]
    }
  ]
};

const exampleMulticlassData = {
  multiclass_entries: [
    {
      class_key: "fighter",
      class_name: "Fighter",
      class_level: 2,
      subclass_key: null,
      subclass_name: null,
      feature_refs: ["second_wind", "action_surge"]
    }
  ]
};

module.exports = {
  multiclassDataModel,
  exampleMulticlassData
};
