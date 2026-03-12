"use strict";

const { InMemoryCharacterStore: DatabaseCharacterStore } = require("../../../database/src/world-storage/characters.store");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {},
    error: null
  };
}

function failure(eventType, message, payload) {
  return {
    ok: false,
    event_type: eventType,
    payload: payload || {},
    error: message
  };
}

class CharacterRepository {
  constructor(options) {
    const cfg = options || {};
    // Repository bridge to world-storage character store. Can be swapped for a DB adapter later.
    this.store = cfg.store || new DatabaseCharacterStore();
  }

  saveCharacter(character) {
    try {
      if (!character || !character.character_id) {
        return failure("character_repository_save_failed", "character.character_id is required");
      }

      const saved = this.store.saveCharacter(character);
      return success("character_repository_saved", {
        character: clone(saved)
      });
    } catch (error) {
      return failure("character_repository_save_failed", error.message);
    }
  }

  loadCharacterById(characterId) {
    if (!characterId || String(characterId).trim() === "") {
      return failure("character_repository_load_failed", "character_id is required");
    }

    const loaded = this.store.loadCharacter(String(characterId));
    if (!loaded) {
      return failure("character_repository_load_failed", "character not found", {
        character_id: String(characterId)
      });
    }

    return success("character_repository_loaded", {
      character: clone(loaded)
    });
  }

  listStoredCharacters() {
    let list = [];

    if (typeof this.store.listCharacters === "function") {
      list = this.store.listCharacters();
    } else if (this.store.charactersById && typeof this.store.charactersById.values === "function") {
      // Fallback for older in-memory store shapes.
      list = Array.from(this.store.charactersById.values());
    }

    return success("character_repository_listed", {
      characters: clone(list)
    });
  }
}

module.exports = {
  CharacterRepository
};
