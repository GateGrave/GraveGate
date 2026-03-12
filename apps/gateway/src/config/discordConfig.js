"use strict";

// Reads and validates required environment variables for Discord integration.
function requireEnv(name) {
  const value = process.env[name];
  if (!value || String(value).trim() === "") {
    throw new Error(
      "Missing required environment variable: " +
        name +
        ". Add it to your .env file."
    );
  }
  return value;
}

function parseBoolean(value) {
  return String(value).toLowerCase() === "true";
}

function getDiscordConfig() {
  return {
    botToken: requireEnv("DISCORD_BOT_TOKEN"),
    applicationId: requireEnv("DISCORD_APPLICATION_ID"),
    guildId: requireEnv("DISCORD_GUILD_ID"),
    devMode: parseBoolean(process.env.DISCORD_DEV_MODE || "false")
  };
}

module.exports = {
  requireEnv,
  getDiscordConfig
};
