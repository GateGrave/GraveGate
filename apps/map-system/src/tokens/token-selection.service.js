"use strict";

const {
  findPlayerTokenChoice,
  buildPlayerTokenFromChoice,
  listPlayerTokenChoices
} = require("./player-token-selection");

function buildTokenSelectionChoices(options) {
  const catalog = options.catalog || [];
  return listPlayerTokenChoices({ catalog }).map((entry) => ({
    token_choice_id: entry.token_choice_id,
    label: entry.label,
    asset_path: entry.asset_path,
    notes: entry.notes
  }));
}

function applyPlayerTokenChoice(options) {
  const catalog = options.catalog || [];
  const choice = findPlayerTokenChoice({
    catalog,
    token_choice_id: options.token_choice_id
  });

  if (!choice) {
    return {
      ok: false,
      error: "unknown token choice"
    };
  }

  const nextToken = buildPlayerTokenFromChoice({
    catalog,
    token_choice_id: options.token_choice_id,
    token_id: options.token_id,
    label: options.label,
    actor_id: options.actor_id,
    character_id: options.character_id,
    position: options.position,
    badge_text: options.badge_text,
    border_color: options.border_color
  });

  return {
    ok: true,
    event_type: "player_token_selected",
    payload: {
      token_choice_id: options.token_choice_id,
      token: nextToken
    }
  };
}

module.exports = {
  buildTokenSelectionChoices,
  applyPlayerTokenChoice
};
