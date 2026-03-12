"use strict";

const path = require("path");
const dotenv = require("dotenv");
const { registerCommands } = require("./registerCommands");

// Load environment variables from the root .env file.
dotenv.config({
  path: path.resolve(__dirname, "../../../../.env")
});

// Stage 0 runner entrypoint for Discord slash-command registration.
async function run() {
  try {
    // Name kept clear for Stage 0 intent.
    const registerGuildCommands = registerCommands;
    await registerGuildCommands();
    console.log("Discord command registration completed successfully.");
  } catch (error) {
    console.error("Discord command registration failed:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  run
};

