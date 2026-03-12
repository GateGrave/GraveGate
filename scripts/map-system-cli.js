"use strict";

const path = require("path");
const { runMapSystemTests } = require("../apps/map-system/src/testing/mapSystem.test");
const renderMapCli = require("../apps/map-system/src/cli/render-map");
const renderMovementPreviewCli = require("../apps/map-system/src/cli/render-movement-speed-preview");
const renderActorMovementPreviewCli = require("../apps/map-system/src/cli/render-actor-movement-preview");
const applyTerrainMaskCli = require("../apps/map-system/src/cli/apply-terrain-mask");
const inspectTerrainMaskCli = require("../apps/map-system/src/cli/inspect-terrain-mask");
const processTokenCli = require("../apps/map-system/src/cli/process-token");
const processPlayerBatchCli = require("../apps/map-system/src/cli/process-player-token-batch");
const processEnemyBatchCli = require("../apps/map-system/src/cli/process-enemy-token-batch");
const stampTerrainCli = require("../apps/map-system/src/cli/stamp-terrain");

const COMMANDS = Object.freeze({
  test: async () => {
    const summary = runMapSystemTests();
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) {
      process.exitCode = 1;
    }
  },
  "apply-terrain-mask": () => applyTerrainMaskCli.main(),
  "inspect-terrain-mask": () => inspectTerrainMaskCli.main(),
  "render-map": () => renderMapCli.main(),
  "render-movement-preview": () => renderMovementPreviewCli.main(),
  "render-actor-movement-preview": () => renderActorMovementPreviewCli.main(),
  "process-token": () => processTokenCli.main(),
  "process-player-tokens": () => processPlayerBatchCli.main(),
  "process-enemy-tokens": () => processEnemyBatchCli.main(),
  "stamp-terrain": () => stampTerrainCli.main()
});

async function main() {
  const command = process.argv[2];

  if (!command || !COMMANDS[command]) {
    console.error([
      "Usage: node scripts/map-system-cli.js <command> [--args]",
      "",
      "Commands:",
      "  test",
      "  apply-terrain-mask",
      "  inspect-terrain-mask",
      "  render-map",
      "  render-movement-preview",
      "  render-actor-movement-preview",
      "  process-token",
      "  process-player-tokens",
      "  process-enemy-tokens",
      "  stamp-terrain"
    ].join("\n"));
    process.exit(1);
  }

  const originalArgv = process.argv.slice();
  process.argv = [originalArgv[0], path.resolve(__filename)].concat(originalArgv.slice(3));
  await COMMANDS[command]();
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
