"use strict";

function toNumberOrDefault(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toDungeonPartyMember(input) {
  if (!input || typeof input !== "object") {
    return {
      ok: false,
      event_type: "dungeon_party_member_conversion_failed",
      payload: { party_member: null },
      error: "input object is required"
    };
  }

  const character = input.character;
  if (!character || typeof character !== "object") {
    return {
      ok: false,
      event_type: "dungeon_party_member_conversion_failed",
      payload: { party_member: null },
      error: "character object is required"
    };
  }

  if (!character.character_id) {
    return {
      ok: false,
      event_type: "dungeon_party_member_conversion_failed",
      payload: { party_member: null },
      error: "character.character_id is required"
    };
  }

  const statusFlagsFromInput = Array.isArray(input.status_flags) ? input.status_flags : null;
  const statusFlagsFromCharacter = Array.isArray(character.status_flags) ? character.status_flags : null;

  const party_member = {
    character_id: character.character_id,
    player_id: input.player_id || character.player_id || null,
    name: character.name || "Unknown Character",
    level: toNumberOrDefault(character.level, 1),
    status_flags: statusFlagsFromInput || statusFlagsFromCharacter || [],
    inventory_id: character.inventory_id || null,
    inventory_ref: input.inventory_ref || character.inventory_ref || null
  };

  return {
    ok: true,
    event_type: "dungeon_party_member_converted",
    payload: { party_member },
    error: null
  };
}

module.exports = {
  toDungeonPartyMember
};
