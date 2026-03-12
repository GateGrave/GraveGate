"use strict";

const fs = require("fs");
const path = require("path");
const { buildTokenAssetPath, buildEnemyToken } = require("./token-catalog");

function loadEnemyTokenCatalog(catalogPath) {
  const absolutePath = path.resolve(catalogPath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = JSON.parse(raw);

  return Array.isArray(parsed.tokens) ? parsed.tokens : [];
}

function findEnemyTokenChoice(options) {
  const catalog = options.catalog || [];
  const choiceId = options.token_choice_id || "";
  return catalog.find((entry) => entry.token_choice_id === choiceId) || null;
}

function buildEnemyTokenFromChoice(options) {
  const choice = findEnemyTokenChoice({
    catalog: options.catalog,
    token_choice_id: options.token_choice_id
  });

  if (!choice) {
    return null;
  }

  return buildEnemyToken({
    token_id: options.token_id,
    label: options.label,
    actor_id: options.actor_id,
    encounter_actor_id: options.encounter_actor_id,
    position: options.position,
    badge_text: options.badge_text !== undefined ? options.badge_text : (choice.badge_text || ""),
    border_color: options.border_color,
    asset_path: buildTokenAssetPath({
      category: choice.category || "enemies",
      file_name: choice.processed_file_name || choice.file_name
    })
  });
}

function listEnemyTokenChoices(options) {
  const catalog = options.catalog || [];
  return catalog.map((entry) => ({
    token_choice_id: entry.token_choice_id,
    label: entry.label,
    asset_path: buildTokenAssetPath({
      category: entry.category || "enemies",
      file_name: entry.processed_file_name || entry.file_name
    }),
    notes: entry.notes || ""
  }));
}

module.exports = {
  loadEnemyTokenCatalog,
  findEnemyTokenChoice,
  buildEnemyTokenFromChoice,
  listEnemyTokenChoices
};
