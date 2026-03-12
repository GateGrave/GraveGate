"use strict";

const { createCharacterRecord } = require("./character.schema");

class InMemoryCharacterStore {
  constructor() {
    this.characters = new Map();
  }

  save(character) {
    this.characters.set(character.character_id, character);
    return character;
  }

  load(characterId) {
    if (!characterId) return null;
    return this.characters.get(String(characterId)) || null;
  }

  list() {
    return Array.from(this.characters.values());
  }
}

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

class CharacterManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryCharacterStore();
  }

  createCharacter(input) {
    try {
      const record = createCharacterRecord(input);
      this.store.save(record);
      return success("character_created", {
        character: clone(record)
      });
    } catch (error) {
      return failure("character_create_failed", error.message);
    }
  }

  getCharacterById(characterId) {
    if (!characterId || String(characterId).trim() === "") {
      return failure("character_fetch_failed", "character_id is required");
    }

    const loaded = this.store.load(characterId);
    if (!loaded) {
      return failure("character_fetch_failed", "character not found", {
        character_id: String(characterId)
      });
    }

    return success("character_found", {
      character: clone(loaded)
    });
  }

  listCharacters() {
    return success("character_listed", {
      characters: clone(this.store.list())
    });
  }

  updateCharacter(input) {
    const data = input || {};
    const characterId = data.character_id;
    const patch = data.patch && typeof data.patch === "object" ? data.patch : {};

    if (!characterId || String(characterId).trim() === "") {
      return failure("character_update_failed", "character_id is required");
    }

    const existing = this.store.load(characterId);
    if (!existing) {
      return failure("character_update_failed", "character not found", {
        character_id: String(characterId)
      });
    }

    const updated = {
      ...existing,
      ...patch,
      character_id: String(existing.character_id),
      created_at: existing.created_at,
      updated_at: new Date().toISOString()
    };

    this.store.save(updated);
    return success("character_updated", {
      character: clone(updated)
    });
  }
}

module.exports = {
  InMemoryCharacterStore,
  CharacterManager
};
