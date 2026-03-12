"use strict";

const fs = require("fs");
const path = require("path");
const dotenvPath = path.resolve(process.cwd(), ".env");

function hasFlag(name) {
  return process.argv.includes(name);
}

if (!hasFlag("--skip-dotenv") && fs.existsSync(dotenvPath)) {
  try {
    require("dotenv").config({ path: dotenvPath });
  } catch (error) {
    // dotenv is optional for environments that inject env directly.
    // Intentionally continue so missing dependency does not block preflight checks.
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || String(value).trim() === "") {
    return {
      ok: false,
      message: "Missing required environment variable: " + name
    };
  }
  return {
    ok: true,
    value: String(value)
  };
}

function checkNodeVersion() {
  const version = process.versions && process.versions.node ? process.versions.node : "0.0.0";
  const major = Number(String(version).split(".")[0]);
  if (!Number.isFinite(major) || major < 18) {
    return {
      ok: false,
      message: "Node.js >= 18 is required. Found: " + version
    };
  }
  return {
    ok: true,
    message: "Node version is supported: " + version
  };
}

function checkPathExists(relativePath) {
  const absolute = path.resolve(process.cwd(), relativePath);
  if (!fs.existsSync(absolute)) {
    return {
      ok: false,
      message: "Missing required file: " + relativePath
    };
  }
  return {
    ok: true,
    message: "Found: " + relativePath
  };
}

function checkContentLoad() {
  try {
    const { loadStarterContentBundle } = require("../apps/world-system/src/content");
    const out = loadStarterContentBundle();
    if (!out || out.ok !== true) {
      return {
        ok: false,
        message: "Content loader failed: " + (out && out.error ? out.error : "unknown loader error")
      };
    }
    const bundle =
      out.payload && out.payload.content && typeof out.payload.content === "object"
        ? out.payload.content
        : out.payload && out.payload.bundle && typeof out.payload.bundle === "object"
          ? out.payload.bundle
          : {};
    const keys = ["races", "classes", "backgrounds", "items", "monsters", "spells", "dungeons", "recipes"];
    const summary = {};
    let missing = [];
    for (const key of keys) {
      const rows = Array.isArray(bundle[key]) ? bundle[key] : [];
      summary[key] = rows.length;
      if (rows.length === 0) {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      return {
        ok: false,
        message: "Content bundle missing required alpha categories: " + missing.join(", "),
        details: summary
      };
    }
    return {
      ok: true,
      message: "Starter content loaded successfully",
      details: summary
    };
  } catch (error) {
    return {
      ok: false,
      message: "Content loader threw: " + (error && error.message ? error.message : "unknown error")
    };
  }
}

function run() {
  const requireDiscordEnv = hasFlag("--require-discord-env");
  const checks = [];

  checks.push({
    name: "node_version",
    ...checkNodeVersion()
  });
  checks.push({
    name: "runtime_entrypoint",
    ...checkPathExists("apps/runtime/src/readCommandRuntime.js")
  });
  checks.push({
    name: "gateway_entrypoint",
    ...checkPathExists("apps/gateway/src/index.js")
  });
  checks.push({
    name: "stage14_harness",
    ...checkPathExists("apps/dungeon-exploration/src/testing/firstPlayableLoopHarness.test.js")
  });
  checks.push({
    name: "content_bundle",
    ...checkContentLoad()
  });

  if (requireDiscordEnv) {
    checks.push({
      name: "discord_bot_token",
      ...requireEnv("DISCORD_BOT_TOKEN")
    });
    checks.push({
      name: "discord_application_id",
      ...requireEnv("DISCORD_APPLICATION_ID")
    });
    checks.push({
      name: "discord_guild_id",
      ...requireEnv("DISCORD_GUILD_ID")
    });
  } else {
    checks.push({
      name: "discord_env_optional_note",
      ok: true,
      message: "Discord env checks skipped (use --require-discord-env for strict test-server readiness)"
    });
  }

  const adminIds = String(process.env.ADMIN_PLAYER_IDS || "").trim();
  checks.push({
    name: "admin_player_ids",
    ok: true,
    message: adminIds
      ? "ADMIN_PLAYER_IDS configured"
      : "ADMIN_PLAYER_IDS not set (admin command auth will reject all callers)"
  });

  const failed = checks.filter((entry) => entry.ok !== true);
  const output = {
    ok: failed.length === 0,
    mode: requireDiscordEnv ? "strict" : "default",
    failed_count: failed.length,
    checks
  };

  console.log(JSON.stringify(output, null, 2));
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  run
};


