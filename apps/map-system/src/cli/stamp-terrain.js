"use strict";

const path = require("path");
const {
  listTerrainStampPresets,
  applyTerrainStampToProfile,
  loadProfileFile,
  writeJsonFile
} = require("../core/terrain-stamping");

function parseArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function parseNumber(value, fallback) {
  if (value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value) {
  if (value === "") {
    return undefined;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function main() {
  if (parseArg("list-presets") === "true") {
    console.log(JSON.stringify({
      ok: true,
      event_type: "terrain_stamp_presets_listed",
      payload: {
        presets: listTerrainStampPresets()
      }
    }, null, 2));
    return;
  }

  const profilePathArg = parseArg("profile");
  const presetId = parseArg("preset");
  const x = parseNumber(parseArg("x"), Number.NaN);
  const y = parseNumber(parseArg("y"), Number.NaN);

  if (!profilePathArg || !presetId || !Number.isFinite(x) || !Number.isFinite(y)) {
    console.error("Usage: --profile=<path> --preset=<preset-id> --x=<int> --y=<int> [--shape=rectangle|circle] [--width=<int>] [--height=<int>] [--radius=<int>] [--zone-id=<id>]");
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const profilePath = path.resolve(repoRoot, profilePathArg);
  const profile = loadProfileFile(profilePath);
  const updated = applyTerrainStampToProfile(profile, {
    preset_id: presetId,
    zone_id: parseArg("zone-id"),
    shape: parseArg("shape"),
    x,
    y,
    width: parseNumber(parseArg("width"), undefined),
    height: parseNumber(parseArg("height"), undefined),
    radius: parseNumber(parseArg("radius"), undefined),
    terrain_type: parseArg("terrain-type"),
    movement_cost: parseNumber(parseArg("movement-cost"), undefined),
    blocks_movement: parseBoolean(parseArg("blocks-movement")),
    blocks_sight: parseBoolean(parseArg("blocks-sight")),
    label: parseArg("label")
  });

  writeJsonFile(profilePath, updated);

  console.log(JSON.stringify({
    ok: true,
    event_type: "terrain_stamp_applied",
    payload: {
      profile_path: profilePath,
      preset_id: presetId,
      x,
      y
    }
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  main
};
