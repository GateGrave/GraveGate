"use strict";

const fs = require("fs");
const path = require("path");
const { renderMapSvg } = require("../render/render-map-svg");
const { loadMapWithProfile, normalizeProfilePaths } = require("../core/map-profile-loader");

function parseArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function main() {
  const mapPathArg = parseArg("map");
  const profilePathArg = parseArg("profile");
  const outputPathArg = parseArg("output");
  const hideGrid = parseArg("hide-grid") === "true";

  if (!mapPathArg) {
    console.error("Missing --map=<path-to-map-json>");
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const mapPath = path.resolve(repoRoot, mapPathArg);
  const outputPath = outputPathArg
    ? path.resolve(repoRoot, outputPathArg)
    : path.resolve(repoRoot, "apps/map-system/output/map.snapshot.svg");

  const map = loadMapWithProfile({
    map_path: mapPath,
    profile_path: normalizeProfilePaths(profilePathArg).map((profilePath) => path.resolve(repoRoot, profilePath))
  });
  const renderOptions = {
    output_path: outputPath
  };
  if (hideGrid) {
    renderOptions.show_grid = false;
  }

  renderMapSvg(map, renderOptions);

  console.log(JSON.stringify({
    ok: true,
    event_type: "map_svg_rendered",
    payload: {
      map_path: mapPath,
      profile_path: normalizeProfilePaths(profilePathArg).length > 0
        ? normalizeProfilePaths(profilePathArg).map((profilePath) => path.resolve(repoRoot, profilePath))
        : null,
      output_path: outputPath
    }
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  main
};
