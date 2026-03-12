"use strict";

// Character identity data that should persist in World State.
// This is core profile data, not gameplay logic.
const characterIdentityModel = {
  character_id: "string",
  player_id: "string",
  character_name: "string",
  campaign_id: "string",
  created_at: "ISO-8601 string",
  updated_at: "ISO-8601 string",
  status: "active | retired | archived"
};

const exampleCharacterIdentity = {
  character_id: "char-001",
  player_id: "user-789",
  character_name: "Aria Vale",
  campaign_id: "campaign-main",
  created_at: "2026-03-07T00:00:00.000Z",
  updated_at: "2026-03-07T00:00:00.000Z",
  status: "active"
};

module.exports = {
  characterIdentityModel,
  exampleCharacterIdentity
};
