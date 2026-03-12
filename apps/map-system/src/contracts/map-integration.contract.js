"use strict";

const MAP_SYSTEM_INTEGRATION_CONTRACT = Object.freeze({
  purpose: "Map interaction, targeting preview, token rendering, and map-oriented input normalization.",
  map_system_owns: [
    "grid coordinate math",
    "line-of-sight and terrain preview helpers",
    "reachable tile previews",
    "physical range previews",
    "spell range and area preview helpers",
    "token catalog, token cleanup, and token rendering",
    "map command parsing for player-facing coordinate and target inputs",
    "Discord map message payloads for edit-in-place interaction flows",
    "selection-mode helpers for move, attack, spell, and token interaction states"
  ],
  map_system_does_not_own: [
    "authoritative combat resolution",
    "authoritative spell resolution",
    "damage, healing, condition, or resource mutation as final source of truth",
    "turn order progression as canonical state owner",
    "database persistence as final game-state source of truth",
    "Discord gateway transport concerns outside map payload shaping"
  ],
  expected_inputs: [
    "canonical map state or render-ready map state",
    "actor token and position context",
    "spell and action metadata from authoritative systems",
    "player-facing commands or button actions",
    "token catalog and selected token identifiers"
  ],
  emitted_outputs: [
    "rendered map artifacts",
    "normalized map action intents",
    "valid target and area preview sets",
    "Discord message payloads for create or edit flows",
    "selection results such as selected token choice or selected spell targets"
  ],
  later_integration_direction: [
    "gateway/controller/runtime should call into map-system helpers for preview and payload generation",
    "combat and world systems should remain the authoritative owners of game-state mutation",
    "map-system should emit or return data that can be turned into canonical events rather than mutating final game state directly"
  ]
});

module.exports = {
  MAP_SYSTEM_INTEGRATION_CONTRACT
};
