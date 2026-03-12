"use strict";

const MAP_BUTTON_ACTIONS = Object.freeze({
  MOVE: "move",
  ATTACK: "attack",
  ATTACK_TARGET: "attack_target",
  ATTACK_CONFIRM: "attack_confirm",
  ATTACK_PAGE: "attack_page",
  SPELL: "spell",
  SPELL_TARGET_TOKEN: "spell_target_token",
  SPELL_CONFIRM: "spell_confirm",
  SPELL_PAGE: "spell_page",
  SPELL_TARGET_PAGE: "spell_target_page",
  SPELL_CLEAR_TARGETS: "spell_clear_targets",
  ITEM: "item",
  TOKEN: "token",
  TOKEN_SELECT: "token_select",
  TOKEN_PAGE: "token_page",
  END_TURN: "end_turn",
  BACK: "back"
});

function buildMapButtonCustomId(options) {
  return [
    "map-ui",
    options.action,
    options.instance_type || "map",
    options.instance_id || "unknown",
    options.actor_id || "unknown"
  ].join(":");
}

function parseMapButtonCustomId(customId) {
  const parts = String(customId || "").split(":");
  if (parts.length !== 5 || parts[0] !== "map-ui") {
    return {
      ok: false,
      error: "invalid map button custom id"
    };
  }

  return {
    ok: true,
    action: parts[1],
    instance_type: parts[2],
    instance_id: parts[3],
    actor_id: parts[4]
  };
}

module.exports = {
  MAP_BUTTON_ACTIONS,
  buildMapButtonCustomId,
  parseMapButtonCustomId
};
