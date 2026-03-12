"use strict";

// Characters World State storage (in-memory placeholder).
// Later this module should call a real database repository, but for now it
// uses a Map so Phase 2 can move forward without external dependencies.
class InMemoryCharacterStore {
  constructor() {
    this.charactersById = new Map();
  }

  /**
   * Save or replace one character document.
   * @param {object} character
   * @returns {object}
   */
  saveCharacter(character) {
    if (!character || !character.character_id) {
      throw new Error("saveCharacter requires character.character_id");
    }

    this.charactersById.set(character.character_id, character);
    return character;
  }

  /**
   * Load one character by id.
   * @param {string} characterId
   * @returns {object|null}
   */
  loadCharacter(characterId) {
    return this.charactersById.get(characterId) || null;
  }

  /**
   * List all stored characters.
   * @returns {object[]}
   */
  listCharacters() {
    return Array.from(this.charactersById.values());
  }
}

function mockCharacterSaveLoadExample() {
  const store = new InMemoryCharacterStore();
  store.saveCharacter({
    character_id: "char-001",
    character_name: "Aria Vale",
    player_id: "user-789"
  });
  return store.loadCharacter("char-001");
}

module.exports = {
  InMemoryCharacterStore,
  mockCharacterSaveLoadExample
};
