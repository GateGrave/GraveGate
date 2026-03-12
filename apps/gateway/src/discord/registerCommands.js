"use strict";

const path = require("path");
const dotenv = require("dotenv");
const { REST, Routes } = require("discord.js");
const { getDiscordConfig } = require("../config/discordConfig");
const { commandDefinitions } = require("./commandDefinitions");

// Load root .env so command registration can run from this module directly.
dotenv.config({
  path: path.resolve(__dirname, "../../../../.env")
});

async function registerCommands() {
  const config = getDiscordConfig();
  const rest = new REST({ version: "10" }).setToken(config.botToken);

  const route = config.devMode
    ? Routes.applicationGuildCommands(config.applicationId, config.guildId)
    : Routes.applicationCommands(config.applicationId);

  await rest.put(route, { body: commandDefinitions });

  console.log(
    "Registered " +
      commandDefinitions.length +
      " slash command(s) in " +
      (config.devMode ? "development (guild)" : "global") +
      " mode."
  );
}

module.exports = {
  registerCommands
};

