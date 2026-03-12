"use strict";

const { CharacterManager } = require("./character.manager");
const { CharacterService } = require("./character.service");

// Shared default in-memory character service for scaffold-level flows.
// Keeping this in a leaf module avoids circular imports with character/index.js.
const defaultCharacterManager = new CharacterManager();
const defaultCharacterService = new CharacterService({ manager: defaultCharacterManager });

module.exports = {
  defaultCharacterManager,
  defaultCharacterService
};
