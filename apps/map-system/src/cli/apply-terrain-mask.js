"use strict";

const fs = require("fs");
const path = require("path");
const {
  loadJsonFile,
  applyMapProfile
} = require("../core/map-profile-loader");
const {
  buildTerrainEntriesFromMaskPath
} = require("../core/terrain-mask-loader");

function parseArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeUniqueByCoordinate(primaryList, secondaryList) {
  const merged = new Map();

  [].concat(primaryList || [], secondaryList || []).forEach((entry) => {
    merged.set(`${entry.x},${entry.y}`, entry);
  });

  return Array.from(merged.values());
}

async function main() {
  const mapPathArg = parseArg("map");
  const profilePathArg = parseArg("profile");
  const outputProfileArg = parseArg("output-profile");

  if (!mapPathArg) {
    console.error("Missing --map=<path-to-map-json>");
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const mapPath = path.resolve(repoRoot, mapPathArg);
  const profilePath = profilePathArg ? path.resolve(repoRoot, profilePathArg) : "";
  const outputProfilePath = outputProfileArg
    ? path.resolve(repoRoot, outputProfileArg)
    : (profilePath || path.resolve(repoRoot, "apps/map-system/data/profiles/mask-generated.profile.json"));

  const baseMap = loadJsonFile(mapPath);
  const existingProfile = profilePath && fs.existsSync(profilePath)
    ? loadJsonFile(profilePath)
    : {
      name: `${baseMap.name || baseMap.map_id || "Map"} Mask Profile`,
      terrain: [],
      terrain_zones: [],
      tokens: [],
      overlays: []
    };
  const mergedMap = applyMapProfile(baseMap, existingProfile);
  const built = await buildTerrainEntriesFromMaskPath(mergedMap, {});

  if (!built.summary) {
    throw new Error("map does not define asset.terrain_mask_path");
  }

  const preservedManualTerrain = (existingProfile.terrain || []).filter((entry) => entry.mask_generated !== true);
  const nextProfile = clone(existingProfile);
  nextProfile.terrain = mergeUniqueByCoordinate(built.terrain, preservedManualTerrain);
  nextProfile.terrain_mask_metadata = built.summary;

  fs.mkdirSync(path.dirname(outputProfilePath), { recursive: true });
  fs.writeFileSync(outputProfilePath, JSON.stringify(nextProfile, null, 2), "utf8");

  console.log(JSON.stringify({
    ok: true,
    event_type: "terrain_mask_applied",
    payload: {
      map_path: mapPath,
      profile_path: profilePath || null,
      output_profile_path: outputProfilePath,
      terrain_mask_summary: built.summary
    }
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = {
  main
};
