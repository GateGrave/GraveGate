"use strict";

const path = require("path");
const { loadMapWithProfile, normalizeProfilePaths } = require("../core/map-profile-loader");

function parseArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

async function main() {
  const mapPathArg = parseArg("map");
  const profilePathArg = parseArg("profile");

  if (!mapPathArg) {
    console.error("Missing --map=<path-to-map-json>");
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const map = await loadMapWithProfile({
    map_path: path.resolve(repoRoot, mapPathArg),
    profile_path: normalizeProfilePaths(profilePathArg).map((profilePath) => path.resolve(repoRoot, profilePath))
  });

  console.log(JSON.stringify({
    ok: true,
    event_type: "terrain_mask_inspected",
    payload: {
      map_id: map.map_id,
      profile_path: normalizeProfilePaths(profilePathArg).length > 0
        ? normalizeProfilePaths(profilePathArg).map((profilePath) => path.resolve(repoRoot, profilePath))
        : null,
      terrain_mask_summary: map.terrain_mask_summary || map.terrain_mask_metadata || null
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
