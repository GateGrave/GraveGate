"use strict";

const fs = require("fs");
const path = require("path");
const stampPresets = require("../../data/terrain/terrain-stamp-presets.json");
const { loadJsonFile } = require("./map-profile-loader");
const { resolveTerrainDefinition } = require("../logic/terrain-catalog");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function listTerrainStampPresets() {
  return Array.isArray(stampPresets.presets) ? clone(stampPresets.presets) : [];
}

function findTerrainStampPreset(presetId) {
  return listTerrainStampPresets().find((preset) => String(preset.preset_id) === String(presetId || "")) || null;
}

function buildTerrainStampZone(options) {
  const preset = findTerrainStampPreset(options.preset_id);
  if (!preset) {
    throw new Error(`unknown terrain preset: ${options.preset_id}`);
  }

  const shape = String(options.shape || preset.default_shape || "rectangle");
  const zoneId = String(options.zone_id || `${preset.preset_id}-${options.x}-${options.y}`);
  const terrainType = String(options.terrain_type || preset.terrain_type || "obstacle");
  const definition = resolveTerrainDefinition({ terrain_type: terrainType });

  const zone = {
    zone_id: zoneId,
    shape,
    x: Number(options.x),
    y: Number(options.y),
    terrain_type: terrainType
  };

  if (shape === "rectangle") {
    zone.width = Number(options.width || (preset.recommended && preset.recommended.width) || 1);
    zone.height = Number(options.height || (preset.recommended && preset.recommended.height) || 1);
  }

  if (shape === "circle") {
    zone.radius = Number(options.radius !== undefined ? options.radius : (preset.recommended && preset.recommended.radius) || 0);
  }

  if (options.movement_cost !== undefined) {
    zone.movement_cost = Number(options.movement_cost);
  } else if (definition && typeof definition.movement_cost === "number") {
    zone.movement_cost = definition.movement_cost;
  }

  if (options.blocks_movement !== undefined) {
    zone.blocks_movement = options.blocks_movement === true;
  }

  if (options.blocks_sight !== undefined) {
    zone.blocks_sight = options.blocks_sight === true;
  }

  if (options.label) {
    zone.label = String(options.label);
  }

  return zone;
}

function sortZones(zones) {
  return [].concat(zones || []).sort((left, right) => {
    const leftKey = `${left.terrain_type || ""}:${left.zone_id || ""}:${left.y || 0}:${left.x || 0}`;
    const rightKey = `${right.terrain_type || ""}:${right.zone_id || ""}:${right.y || 0}:${right.x || 0}`;
    return leftKey.localeCompare(rightKey);
  });
}

function applyTerrainStampToProfile(profile, stampOptions) {
  const nextProfile = clone(profile || {});
  nextProfile.terrain_zones = Array.isArray(nextProfile.terrain_zones) ? clone(nextProfile.terrain_zones) : [];
  const zone = buildTerrainStampZone(stampOptions);

  const existingIndex = nextProfile.terrain_zones.findIndex((entry) => String(entry.zone_id) === String(zone.zone_id));
  if (existingIndex >= 0) {
    nextProfile.terrain_zones[existingIndex] = zone;
  } else {
    nextProfile.terrain_zones.push(zone);
  }

  nextProfile.terrain_zones = sortZones(nextProfile.terrain_zones);
  return nextProfile;
}

function writeJsonFile(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadProfileFile(profilePath) {
  if (!fs.existsSync(path.resolve(profilePath))) {
    return {};
  }

  return loadJsonFile(profilePath);
}

module.exports = {
  listTerrainStampPresets,
  findTerrainStampPreset,
  buildTerrainStampZone,
  applyTerrainStampToProfile,
  writeJsonFile,
  loadProfileFile
};
