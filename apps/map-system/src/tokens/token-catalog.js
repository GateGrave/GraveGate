"use strict";

const path = require("path");
const { TOKEN_TYPES } = require("../constants");

const DEFAULT_TOKEN_STYLES = Object.freeze({
  [TOKEN_TYPES.PLAYER]: {
    color: "#1e88e5",
    border_color: "#ffffff",
    shape: "circle"
  },
  [TOKEN_TYPES.ENEMY]: {
    color: "#c62828",
    border_color: "#ffffff",
    shape: "circle"
  },
  [TOKEN_TYPES.NPC]: {
    color: "#6d4c41",
    border_color: "#ffffff",
    shape: "circle"
  },
  [TOKEN_TYPES.OBJECT]: {
    color: "#546e7a",
    border_color: "#ffffff",
    shape: "square"
  }
});

function normalizeAssetPath(assetPath) {
  if (!assetPath) {
    return "";
  }

  return assetPath.replace(/\\/g, "/");
}

function buildTokenVisualProfile(token) {
  const defaults = DEFAULT_TOKEN_STYLES[token.token_type] || DEFAULT_TOKEN_STYLES[TOKEN_TYPES.OBJECT];
  const defaultImageBorderColor = token.token_type === TOKEN_TYPES.PLAYER
    ? "#d4af37"
    : (token.token_type === TOKEN_TYPES.ENEMY ? "#ff3b30" : defaults.border_color);
  const defaultBadgeColor = token.token_type === TOKEN_TYPES.PLAYER
    ? "#4aa3ff"
    : (token.token_type === TOKEN_TYPES.ENEMY ? "#ffd6d1" : "#ffffff");

  return {
    color: token.color || defaults.color,
    border_color: token.border_color || defaults.border_color,
    image_border_color: token.image_border_color || defaultImageBorderColor,
    badge_color: token.badge_color || defaultBadgeColor,
    badge_text_color: token.badge_text_color || "#ffffff",
    shape: token.shape || defaults.shape,
    label: token.label || "",
    label_plate_color: token.label_plate_color || "#111827",
    label_text_color: token.label_text_color || "#ffffff",
    asset_path: normalizeAssetPath(token.asset_path || ""),
    badge_text: token.badge_text || "",
    focus_marker_text: token.focus_marker_text || "",
    focus_marker_color: token.focus_marker_color || "#8b5cf6",
    focus_marker_text_color: token.focus_marker_text_color || "#ffffff",
    active_tile_color: token.active_tile_color || "",
    active_tile_opacity: Number.isFinite(Number(token.active_tile_opacity))
      ? Number(token.active_tile_opacity)
      : null
  };
}

function applyTokenVisualProfile(token, profile) {
  return {
    ...token,
    ...profile,
    asset_path: normalizeAssetPath(profile.asset_path || token.asset_path || "")
  };
}

function buildPlayerToken(options) {
  const token = {
    token_id: options.token_id,
    token_type: TOKEN_TYPES.PLAYER,
    label: options.label,
    position: options.position,
    character_id: options.character_id || "",
    actor_id: options.actor_id || "",
    color: options.color || DEFAULT_TOKEN_STYLES[TOKEN_TYPES.PLAYER].color,
    border_color: options.border_color || DEFAULT_TOKEN_STYLES[TOKEN_TYPES.PLAYER].border_color,
    image_border_color: options.image_border_color || "#d4af37",
    badge_color: options.badge_color || "#4aa3ff",
    badge_text_color: options.badge_text_color || "#ffffff",
    shape: options.shape || DEFAULT_TOKEN_STYLES[TOKEN_TYPES.PLAYER].shape,
    asset_path: normalizeAssetPath(options.asset_path || ""),
    badge_text: options.badge_text || "",
    label_plate_color: options.label_plate_color || "#111827",
    label_text_color: options.label_text_color || "#ffffff",
    focus_marker_text: options.focus_marker_text || "",
    focus_marker_color: options.focus_marker_color || "#8b5cf6",
    focus_marker_text_color: options.focus_marker_text_color || "#ffffff",
    active_tile_color: options.active_tile_color || "",
    active_tile_opacity: Number.isFinite(Number(options.active_tile_opacity))
      ? Number(options.active_tile_opacity)
      : null
  };

  return applyTokenVisualProfile(token, buildTokenVisualProfile(token));
}

function buildEnemyToken(options) {
  const token = {
    token_id: options.token_id,
    token_type: TOKEN_TYPES.ENEMY,
    label: options.label,
    position: options.position,
    actor_id: options.actor_id || "",
    encounter_actor_id: options.encounter_actor_id || "",
    color: options.color || DEFAULT_TOKEN_STYLES[TOKEN_TYPES.ENEMY].color,
    border_color: options.border_color || DEFAULT_TOKEN_STYLES[TOKEN_TYPES.ENEMY].border_color,
    image_border_color: options.image_border_color || "#ff3b30",
    badge_color: options.badge_color || "#ffd6d1",
    badge_text_color: options.badge_text_color || "#111827",
    shape: options.shape || DEFAULT_TOKEN_STYLES[TOKEN_TYPES.ENEMY].shape,
    asset_path: normalizeAssetPath(options.asset_path || ""),
    badge_text: options.badge_text || "",
    label_plate_color: options.label_plate_color || "#111827",
    label_text_color: options.label_text_color || "#ffffff",
    focus_marker_text: options.focus_marker_text || "",
    focus_marker_color: options.focus_marker_color || "#8b5cf6",
    focus_marker_text_color: options.focus_marker_text_color || "#ffffff",
    active_tile_color: options.active_tile_color || "",
    active_tile_opacity: Number.isFinite(Number(options.active_tile_opacity))
      ? Number(options.active_tile_opacity)
      : null
  };

  return applyTokenVisualProfile(token, buildTokenVisualProfile(token));
}

function buildTokenAssetPath(options) {
  if (!options || !options.file_name) {
    return "";
  }

  return normalizeAssetPath(path.join(
    "apps",
    "map-system",
    "assets",
    "tokens",
    options.category || "players",
    options.file_name
  ));
}

module.exports = {
  DEFAULT_TOKEN_STYLES,
  buildTokenVisualProfile,
  applyTokenVisualProfile,
  buildPlayerToken,
  buildEnemyToken,
  buildTokenAssetPath
};
