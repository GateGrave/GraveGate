"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

function hasFlag(name) {
  return process.argv.includes(name);
}

function toCommandString(command, args) {
  return [command].concat(args || []).join(" ");
}

function runStep(step) {
  const cwd = process.cwd();
  const executable = process.execPath;
  const args = [path.resolve(cwd, step.script)].concat(step.args || []);
  const startedAt = new Date().toISOString();
  const out = spawnSync(executable, args, { stdio: "inherit" });
  const endedAt = new Date().toISOString();

  return {
    id: step.id,
    label: step.label,
    script: step.script,
    command: toCommandString(executable, args),
    ok: out.status === 0,
    exit_code: typeof out.status === "number" ? out.status : -1,
    started_at: startedAt,
    ended_at: endedAt
  };
}

function getSteps() {
  const strict = hasFlag("--strict-preflight");
  const includeMultiplayer = !hasFlag("--skip-multiplayer");

  const steps = [
    {
      id: "preflight",
      label: strict ? "alpha preflight strict" : "alpha preflight",
      script: "scripts/alpha-preflight.js",
      args: strict ? ["--require-discord-env"] : []
    },
    {
      id: "character_assembly",
      label: "character assembly smoke",
      script: "apps/world-system/src/character/testing/assembledCharacterProfile.smoke.js"
    },
    {
      id: "content_loop",
      label: "content slice harness",
      script: "apps/runtime/src/testing/contentSliceHarness.test.js"
    },
    {
      id: "dungeon_loop",
      label: "dungeon loop stabilization",
      script: "apps/dungeon-exploration/src/testing/dungeonLoopStabilization.test.js"
    },
    {
      id: "combat_actions",
      label: "combat action request smoke",
      script: "apps/combat-system/src/testing/processCombatActionRequest.test.js"
    },
    {
      id: "combat_render",
      label: "combat render integration smoke",
      script: "apps/combat-system/src/testing/combatRenderIntegration.test.js"
    }
  ];

  if (includeMultiplayer) {
    steps.push({
      id: "multiplayer_foundation",
      label: "multiplayer foundation smoke",
      script: "apps/runtime/src/testing/multiplayerFoundationRuntime.test.js"
    });
  }

  return {
    strict_preflight: strict,
    include_multiplayer: includeMultiplayer,
    steps
  };
}

function run() {
  const plan = getSteps();
  const results = [];

  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index];
    const result = runStep(step);
    results.push(result);
    if (!result.ok) {
      break;
    }
  }

  const failed = results.filter((entry) => entry.ok !== true);
  const output = {
    ok: failed.length === 0 && results.length === plan.steps.length,
    event_type: "internal_alpha_smoke_completed",
    payload: {
      strict_preflight: plan.strict_preflight,
      include_multiplayer: plan.include_multiplayer,
      total_steps: plan.steps.length,
      executed_steps: results.length,
      failed_steps: failed.length,
      results
    },
    error: failed.length > 0 ? "one_or_more_internal_alpha_smoke_steps_failed" : null
  };

  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  run,
  getSteps
};
