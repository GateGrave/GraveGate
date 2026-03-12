"use strict";

const fs = require("fs");
const path = require("path");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function normalizeProfilePaths(profilePathInput) {
  if (!profilePathInput) {
    return [];
  }

  if (Array.isArray(profilePathInput)) {
    return profilePathInput
      .filter(Boolean)
      .map((entry) => String(entry).trim())
      .filter(Boolean);
  }

  return String(profilePathInput)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mergeUniqueByCoordinate(primaryList, secondaryList) {
  const merged = new Map();

  [].concat(primaryList || [], secondaryList || []).forEach((entry) => {
    merged.set(`${entry.x},${entry.y}`, entry);
  });

  return Array.from(merged.values());
}

function mergeLists(primaryList, secondaryList) {
  return [].concat(primaryList || [], secondaryList || []);
}

function buildStableEntryKey(entry, fallbackPrefix, index) {
  if (!entry || typeof entry !== "object") {
    return `${fallbackPrefix}:${index}`;
  }

  if (entry.token_id) {
    return `token:${entry.token_id}`;
  }

  if (entry.overlay_id) {
    return `overlay:${entry.overlay_id}`;
  }

  if (entry.x !== undefined && entry.y !== undefined) {
    return `${fallbackPrefix}:${entry.x},${entry.y}`;
  }

  if (entry.position && entry.position.x !== undefined && entry.position.y !== undefined) {
    return `${fallbackPrefix}:${entry.position.x},${entry.position.y}:${entry.token_type || ""}:${entry.label || ""}`;
  }

  if (entry.kind) {
    return `${fallbackPrefix}:${entry.kind}:${index}`;
  }

  return `${fallbackPrefix}:${index}:${JSON.stringify(entry)}`;
}

function mergeEntriesByStableKey(primaryList, secondaryList, fallbackPrefix) {
  const merged = new Map();

  [].concat(primaryList || []).forEach((entry, index) => {
    merged.set(buildStableEntryKey(entry, fallbackPrefix, index), entry);
  });

  [].concat(secondaryList || []).forEach((entry, index) => {
    merged.set(buildStableEntryKey(entry, fallbackPrefix, index), entry);
  });

  return Array.from(merged.values());
}

function applyMapProfile(baseMap, profile) {
  const merged = clone(baseMap);

  if (profile.name) {
    merged.name = profile.name;
  }

  merged.blocked_tiles = mergeUniqueByCoordinate(merged.blocked_tiles, profile.blocked_tiles);
  merged.terrain = mergeUniqueByCoordinate(merged.terrain, profile.terrain);
  merged.terrain_zones = mergeLists(merged.terrain_zones, profile.terrain_zones);

  if (Array.isArray(profile.tokens)) {
    merged.tokens = mergeEntriesByStableKey(merged.tokens, clone(profile.tokens), "token");
  }

  if (Array.isArray(profile.overlays)) {
    merged.overlays = mergeEntriesByStableKey(merged.overlays, clone(profile.overlays), "overlay");
  }

  if (profile.terrain_mask_metadata) {
    merged.terrain_mask_metadata = clone(profile.terrain_mask_metadata);
    merged.terrain_mask_summary = clone(profile.terrain_mask_metadata);
  } else if (profile.terrain_mask_summary) {
    merged.terrain_mask_summary = clone(profile.terrain_mask_summary);
  }

  return merged;
}

function loadMapWithProfile(options) {
  const map = loadJsonFile(options.map_path);
  const profilePaths = normalizeProfilePaths(options.profile_path);
  if (profilePaths.length === 0) {
    return map;
  }

  return profilePaths.reduce((currentMap, profilePath) => {
    const profile = loadJsonFile(profilePath);
    return applyMapProfile(currentMap, profile);
  }, map);
}

module.exports = {
  loadJsonFile,
  normalizeProfilePaths,
  applyMapProfile,
  loadMapWithProfile
};
