"use strict";

const { CombatSimulationRunner } = require("../testing");

async function runCombatTestingHarnessExample() {
  const runner = new CombatSimulationRunner();
  return runner.runAllScenarios();
}

if (require.main === module) {
  runCombatTestingHarnessExample()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error("combat testing harness failed:", error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  runCombatTestingHarnessExample
};
