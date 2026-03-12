"use strict";

const { CHARACTER_SCHEMA, createCharacterRecord } = require("./character.schema");
const { InMemoryCharacterStore, CharacterManager } = require("./character.manager");
const { CharacterService } = require("./character.service");
const { CharacterRepository } = require("./character.repository");
const { CharacterPersistenceBridge } = require("./character.persistence");
const { toCombatParticipant } = require("./adapters/toCombatParticipant");
const { toDungeonPartyMember } = require("./adapters/toDungeonPartyMember");
const {
  createCharacterInventory,
  attachInventoryToCharacter,
  loadCharacterWithInventoryContext
} = require("./flow/characterInventoryLink");
const { bootstrapPlayerStart } = require("./flow/bootstrapPlayerStart");
const { processEquipRequest, processUnequipRequest } = require("./flow/processEquipmentRequest");
const {
  applyRaceSelection,
  applyClassSelection,
  finalizeCharacterProfile,
  applyCharacterSelections
} = require("./flow/applyCharacterSelections");
const { getSpellData, listAvailableSpells, listSpellsForClass } = require("./rules/spellRules");
const { defaultCharacterManager, defaultCharacterService } = require("./character.defaults");

function createCharacter(input) {
  return defaultCharacterManager.createCharacter(input);
}

function getCharacterById(character_id) {
  return defaultCharacterManager.getCharacterById(character_id);
}

function listCharacters() {
  return defaultCharacterManager.listCharacters();
}

function updateCharacter(input) {
  return defaultCharacterManager.updateCharacter(input);
}

module.exports = {
  CHARACTER_SCHEMA,
  createCharacterRecord,
  InMemoryCharacterStore,
  CharacterManager,
  CharacterService,
  CharacterRepository,
  CharacterPersistenceBridge,
  toCombatParticipant,
  toDungeonPartyMember,
  createCharacterInventory,
  attachInventoryToCharacter,
  loadCharacterWithInventoryContext,
  bootstrapPlayerStart,
  processEquipRequest,
  processUnequipRequest,
  applyRaceSelection,
  applyClassSelection,
  finalizeCharacterProfile,
  applyCharacterSelections,
  getSpellData,
  listAvailableSpells,
  listSpellsForClass,
  defaultCharacterManager,
  defaultCharacterService,
  createCharacter,
  getCharacterById,
  listCharacters,
  updateCharacter
};
