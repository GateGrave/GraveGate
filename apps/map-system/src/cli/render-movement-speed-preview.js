"use strict";

const path = require("path");
const { loadMapWithProfile } = require("../core/map-profile-loader");
const { renderMapSvg } = require("../render/render-map-svg");
const { buildActorMovementOverlay } = require("../logic/overlay-builders");
const { buildPlayerToken } = require("../tokens/token-catalog");

function parseArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function main() {
  const repoRoot = process.cwd();
  const mapPathArg = parseArg("map") || "apps/map-system/data/maps/forest-road.base-map.json";
  const profilePathArg = parseArg("profile") || "apps/map-system/data/profiles/forest-road.combat-profile.json";
  const outputPathArg = parseArg("output") || "apps/map-system/output/forest-road.movement-speed-preview.svg";
  const map = loadMapWithProfile({
    map_path: path.resolve(repoRoot, mapPathArg),
    profile_path: profilePathArg ? path.resolve(repoRoot, profilePathArg) : ""
  });

  const fastActor = buildPlayerToken({
    token_id: "movement-fast-player",
    label: "P30",
    actor_id: "movement-fast-player",
    position: { x: 10, y: 20 },
    badge_text: "30",
    asset_path: "apps/map-system/assets/tokens/players/processed/male-tiefling-03.cleaned.png"
  });
  fastActor.movement_speed_feet = 30;

  const slowActor = buildPlayerToken({
    token_id: "movement-slow-player",
    label: "P15",
    actor_id: "movement-slow-player",
    position: { x: 10, y: 8 },
    badge_text: "15",
    asset_path: "apps/map-system/assets/tokens/players/processed/elf-male-01.cleaned.png"
  });
  slowActor.movement_speed_feet = 15;

  const fastOverlay = buildActorMovementOverlay({
    map: {
      ...map,
      tokens: [fastActor, slowActor]
    },
    actor: fastActor,
    color: "#34c759",
    opacity: 0.42,
    allow_diagonal: true
  });

  const slowOverlay = buildActorMovementOverlay({
    map: {
      ...map,
      tokens: [fastActor, slowActor]
    },
    actor: slowActor,
    color: "#4aa3ff",
    opacity: 0.42,
    allow_diagonal: true
  });

  const previewMap = {
    ...map,
    name: "Forest Road Movement Speed Preview",
    tokens: [fastActor, slowActor],
    overlays: [fastOverlay, slowOverlay]
  };

  const outputPath = path.resolve(repoRoot, outputPathArg);
  renderMapSvg(previewMap, {
    output_path: outputPath
  });

  console.log(JSON.stringify({
    ok: true,
    event_type: "movement_speed_preview_rendered",
    payload: {
      map_path: path.resolve(repoRoot, mapPathArg),
      profile_path: profilePathArg ? path.resolve(repoRoot, profilePathArg) : null,
      output_path: outputPath,
      actors: [
        { token_id: fastActor.token_id, movement_speed_feet: fastActor.movement_speed_feet },
        { token_id: slowActor.token_id, movement_speed_feet: slowActor.movement_speed_feet }
      ]
    }
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  main
};
