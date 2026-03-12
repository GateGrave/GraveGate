"use strict";

const fs = require("fs");
const path = require("path");
const { inferTerrainTypeFromText, getTerrainDefinition } = require("../logic/terrain-catalog");

function walkFiles(startPath, out) {
  if (!fs.existsSync(startPath)) {
    return;
  }

  const stats = fs.statSync(startPath);
  if (stats.isFile()) {
    out.push(startPath);
    return;
  }

  fs.readdirSync(startPath).forEach((child) => {
    walkFiles(path.join(startPath, child), out);
  });
}

function toSlashPath(inputPath) {
  return inputPath.replace(/\\/g, "/");
}

function buildAssetLibraryManifest(assetRoot) {
  const root = path.resolve(assetRoot);
  const files = [];
  walkFiles(root, files);

  const groups = {
    base_maps: [],
    overlays: [],
    tiles: [],
    tokens: []
  };
  const tile_metadata = [];

  files.forEach((filePath) => {
    const relative = toSlashPath(path.relative(root, filePath));
    const groupName = relative.split("/")[0];
    if (groupName === "base-maps") groups.base_maps.push(relative);
    if (groupName === "overlays") groups.overlays.push(relative);
    if (groupName === "tiles") {
      groups.tiles.push(relative);
      const inferredTerrainType = inferTerrainTypeFromText(relative);
      const definition = getTerrainDefinition(inferredTerrainType);
      tile_metadata.push({
        asset_path: relative,
        terrain_type: inferredTerrainType || "",
        blocks_movement: Boolean(definition && definition.blocks_movement),
        blocks_sight: Boolean(definition && definition.blocks_sight)
      });
    }
    if (groupName === "tokens") groups.tokens.push(relative);
  });

  return {
    asset_root: toSlashPath(root),
    generated_at: new Date().toISOString(),
    groups,
    tile_metadata
  };
}

module.exports = {
  buildAssetLibraryManifest
};
