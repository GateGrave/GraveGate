"use strict";

// Character feat references.
// Phase 2A stores selected feats and source notes only.
const featsModel = {
  selected_feats: [
    {
      feat_key: "string",
      feat_name: "string",
      source: "level_up | race | bonus"
    }
  ]
};

const exampleFeats = {
  selected_feats: [
    {
      feat_key: "war_caster",
      feat_name: "War Caster",
      source: "level_up"
    }
  ]
};

module.exports = {
  featsModel,
  exampleFeats
};
