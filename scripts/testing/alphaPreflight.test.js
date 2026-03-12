"use strict";

const assert = require("assert");
const path = require("path");
const preflight = require("../alpha-preflight");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runScript(args, env) {
  const originalArgv = process.argv.slice();
  const originalExitCode = process.exitCode;
  const originalLog = console.log;
  const originalEnv = {
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    DISCORD_APPLICATION_ID: process.env.DISCORD_APPLICATION_ID,
    DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID
  };
  const writes = [];

  try {
    process.argv = ["node", path.resolve(__dirname, "../alpha-preflight.js")].concat(args || []);
    process.exitCode = 0;
    process.env.DISCORD_BOT_TOKEN = env.DISCORD_BOT_TOKEN;
    process.env.DISCORD_APPLICATION_ID = env.DISCORD_APPLICATION_ID;
    process.env.DISCORD_GUILD_ID = env.DISCORD_GUILD_ID;
    console.log = function capture(message) {
      writes.push(String(message));
    };

    preflight.run();

    const stdout = writes.join("\n").trim();
    return {
      status: process.exitCode || 0,
      stdout,
      json: stdout ? JSON.parse(stdout) : null
    };
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    console.log = originalLog;
    process.env.DISCORD_BOT_TOKEN = originalEnv.DISCORD_BOT_TOKEN;
    process.env.DISCORD_APPLICATION_ID = originalEnv.DISCORD_APPLICATION_ID;
    process.env.DISCORD_GUILD_ID = originalEnv.DISCORD_GUILD_ID;
  }
}

function runAlphaPreflightScriptTests() {
  const results = [];

  runTest("alpha_preflight_passes_default_repo_readiness_checks", () => {
    const out = runScript([], {
      DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
      DISCORD_APPLICATION_ID: process.env.DISCORD_APPLICATION_ID,
      DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID
    });

    assert.equal(out.status, 0);
    assert.equal(Boolean(out.json), true);
    assert.equal(out.json.ok, true);

    const contentCheck = out.json.checks.find((entry) => entry.name === "content_bundle");
    assert.equal(Boolean(contentCheck), true);
    assert.equal(contentCheck.ok, true);
  }, results);

  runTest("alpha_preflight_strict_missing_discord_env_fails_clearly_without_dotenv", () => {
    const out = runScript(["--require-discord-env", "--skip-dotenv"], {
      DISCORD_BOT_TOKEN: "",
      DISCORD_APPLICATION_ID: "",
      DISCORD_GUILD_ID: ""
    });

    assert.equal(out.status, 1);
    assert.equal(Boolean(out.json), true);
    assert.equal(out.json.ok, false);
    const failedNames = out.json.checks.filter((entry) => entry.ok !== true).map((entry) => entry.name);
    assert.equal(failedNames.includes("discord_bot_token"), true);
    assert.equal(failedNames.includes("discord_application_id"), true);
    assert.equal(failedNames.includes("discord_guild_id"), true);
  }, results);

  const passed = results.filter((entry) => entry.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    totals: { total: results.length, passed, failed },
    results
  };
}

if (require.main === module) {
  const summary = runAlphaPreflightScriptTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runAlphaPreflightScriptTests
};
