"use strict";

// Persistent feat slot tracking.
// Stores unlocked/used slots and selected feat references.
const featSlotsStoreShape = {
  character_id: "string",
  total_feat_slots: "number",
  used_feat_slots: "number",
  available_feat_slots: "number",
  selected_feat_refs: ["string"],
  pending_feat_choices: ["string"]
};

module.exports = {
  featSlotsStoreShape
};
