"use strict";

const fs = require("fs");
const path = require("path");
const { buildTokenAssetPath, buildPlayerToken } = require("./token-catalog");

function loadPlayerTokenCatalog(catalogPath) {
  const absolutePath = path.resolve(catalogPath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = JSON.parse(raw);

  return Array.isArray(parsed.tokens) ? parsed.tokens : [];
}

function findPlayerTokenChoice(options) {
  const catalog = options.catalog || [];
  const choiceId = options.token_choice_id || "";
  return catalog.find((entry) => entry.token_choice_id === choiceId) || null;
}

function buildPlayerTokenFromChoice(options) {
  const choice = findPlayerTokenChoice({
    catalog: options.catalog,
    token_choice_id: options.token_choice_id
  });

  if (!choice) {
    return null;
  }

  return buildPlayerToken({
    token_id: options.token_id,
    label: options.label,
    actor_id: options.actor_id,
    character_id: options.character_id,
    position: options.position,
    border_color: options.border_color,
    badge_text: options.badge_text !== undefined ? options.badge_text : (choice.badge_text || ""),
    shape: choice.shape || "circle",
    asset_path: buildTokenAssetPath({
      category: choice.category || "players",
      file_name: choice.processed_file_name || choice.file_name
    })
  });
}

function listPlayerTokenChoices(options) {
  const catalog = options.catalog || [];
  return catalog.map((entry) => ({
    token_choice_id: entry.token_choice_id,
    label: entry.label,
    asset_path: buildTokenAssetPath({
      category: entry.category || "players",
      file_name: entry.processed_file_name || entry.file_name
    }),
    notes: entry.notes || ""
  }));
}

module.exports = {
  loadPlayerTokenCatalog,
  findPlayerTokenChoice,
  buildPlayerTokenFromChoice,
  listPlayerTokenChoices
};
