"use strict";

// Attunement slot model.
// Tracks which magical items are attuned in persistent World State.
const attunementSlotsModel = {
  character_id: "string",
  max_slots: "number",
  used_slots: "number",
  attuned_item_ids: ["string"],
  pending_attunement_item_ids: ["string"]
};

const exampleAttunementSlots = {
  character_id: "char-001",
  max_slots: 3,
  used_slots: 1,
  attuned_item_ids: ["item-003"],
  pending_attunement_item_ids: []
};

module.exports = {
  attunementSlotsModel,
  exampleAttunementSlots
};
