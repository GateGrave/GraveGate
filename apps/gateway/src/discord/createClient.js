"use strict";

const { Client, GatewayIntentBits } = require("discord.js");

// Creates a Discord client for gateway shell behavior only.
function createDiscordClient() {
  return new Client({
    intents: [GatewayIntentBits.Guilds]
  });
}

module.exports = {
  createDiscordClient
};

