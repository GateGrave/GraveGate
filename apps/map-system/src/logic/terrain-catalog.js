"use strict";

const terrainCatalog = require("../../data/terrain/terrain-catalog.json");

function normalizeTerrainType(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function buildDefinitionIndex() {
  const index = new Map();
  const definitions = Array.isArray(terrainCatalog.definitions) ? terrainCatalog.definitions : [];

  definitions.forEach((definition) => {
    const canonicalType = normalizeTerrainType(definition.terrain_type);
    if (!canonicalType) {
      return;
    }

    index.set(canonicalType, {
      terrain_type: canonicalType,
      blocks_movement: definition.blocks_movement === true,
      blocks_sight: definition.blocks_sight === true,
      movement_cost: typeof definition.movement_cost === "number" ? definition.movement_cost : 1,
      aliases: Array.isArray(definition.aliases) ? definition.aliases.map(normalizeTerrainType) : []
    });
  });

  return index;
}

const DEFINITION_INDEX = buildDefinitionIndex();

function getTerrainDefinition(terrainType) {
  const normalized = normalizeTerrainType(terrainType);
  if (!normalized) {
    return null;
  }

  if (DEFINITION_INDEX.has(normalized)) {
    return DEFINITION_INDEX.get(normalized);
  }

  for (const definition of DEFINITION_INDEX.values()) {
    if (definition.aliases.includes(normalized)) {
      return definition;
    }
  }

  return null;
}

function inferTerrainTypeFromText(input) {
  const normalized = normalizeTerrainType(input);
  if (!normalized) {
    return "";
  }

  if (DEFINITION_INDEX.has(normalized)) {
    return normalized;
  }

  const haystack = normalized.replace(/[^a-z0-9_/-]/g, "_");
  for (const definition of DEFINITION_INDEX.values()) {
    if (haystack.includes(definition.terrain_type)) {
      return definition.terrain_type;
    }

    if (definition.aliases.some((alias) => haystack.includes(alias))) {
      return definition.terrain_type;
    }
  }

  return "";
}

function inferTerrainType(entry) {
  if (entry && entry.terrain_type) {
    return normalizeTerrainType(entry.terrain_type);
  }

  return inferTerrainTypeFromText(
    [
      entry && entry.asset_path,
      entry && entry.label,
      entry && entry.zone_id,
      entry && entry.file_name
    ].filter(Boolean).join(" ")
  );
}

function resolveTerrainDefinition(entry) {
  const inferredType = inferTerrainType(entry);
  return getTerrainDefinition(inferredType);
}

module.exports = {
  normalizeTerrainType,
  getTerrainDefinition,
  inferTerrainTypeFromText,
  inferTerrainType,
  resolveTerrainDefinition
};
