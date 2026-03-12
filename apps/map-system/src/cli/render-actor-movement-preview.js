"use strict";

const path = require("path");
const { loadMapWithProfile, normalizeProfilePaths } = require("../core/map-profile-loader");
const { renderMapSvg } = require("../render/render-map-svg");
const { buildActorMovementOverlay } = require("../logic/overlay-builders");

function parseArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function main() {
  const repoRoot = process.cwd();
  const mapPathArg = parseArg("map");
  const profilePathArg = parseArg("profile");
  const outputPathArg = parseArg("output");
  const tokenIdArg = parseArg("token-id");
  const colorArg = parseArg("color");

  if (!mapPathArg) {
    console.error("Missing --map=<path-to-map-json>");
    process.exit(1);
  }

  const map = loadMapWithProfile({
    map_path: path.resolve(repoRoot, mapPathArg),
    profile_path: normalizeProfilePaths(profilePathArg).map((profilePath) => path.resolve(repoRoot, profilePath))
  });

  const actor = tokenIdArg
    ? (map.tokens || []).find((token) => token.token_id === tokenIdArg)
    : (map.tokens || [])[0];

  if (!actor) {
    console.error("No actor token found for movement preview");
    process.exit(1);
  }

  const overlay = buildActorMovementOverlay({
    map,
    actor,
    color: colorArg || "#34c759",
    opacity: 0.42,
    allow_diagonal: true
  });

  const previewMap = {
    ...map,
    overlays: [overlay]
  };

  const outputPath = outputPathArg
    ? path.resolve(repoRoot, outputPathArg)
    : path.resolve(repoRoot, "apps/map-system/output/actor-movement-preview.svg");

  renderMapSvg(previewMap, {
    output_path: outputPath
  });

  console.log(JSON.stringify({
    ok: true,
    event_type: "actor_movement_preview_rendered",
    payload: {
      map_path: path.resolve(repoRoot, mapPathArg),
      profile_path: normalizeProfilePaths(profilePathArg).length > 0
        ? normalizeProfilePaths(profilePathArg).map((profilePath) => path.resolve(repoRoot, profilePath))
        : null,
      output_path: outputPath,
      token_id: actor.token_id,
      movement_speed_feet: actor.movement_speed_feet || null,
      origin: actor.position,
      reachable_tile_count: overlay.tiles.length
    }
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  main
};
