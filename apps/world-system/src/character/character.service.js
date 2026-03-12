"use strict";

const { CharacterManager } = require("./character.manager");

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

class CharacterService {
  constructor(options) {
    const cfg = options || {};
    this.manager = cfg.manager || new CharacterManager({ store: cfg.store });
  }

  createCharacter(input) {
    const result = this.manager.createCharacter(input);
    if (!result.ok) {
      return failure("character_service_create_failed", result.error, {
        manager_result: result
      });
    }

    return success("character_service_created", {
      character: clone(result.payload.character)
    });
  }

  getCharacterById(characterId) {
    const result = this.manager.getCharacterById(characterId);
    if (!result.ok) {
      return failure("character_service_fetch_failed", result.error, {
        manager_result: result
      });
    }

    return success("character_service_found", {
      character: clone(result.payload.character)
    });
  }

  listCharacters() {
    const result = this.manager.listCharacters();
    if (!result.ok) {
      return failure("character_service_list_failed", result.error || "could not list characters", {
        manager_result: result
      });
    }

    return success("character_service_listed", {
      characters: clone(result.payload.characters)
    });
  }

  updateCharacter(input) {
    const result = this.manager.updateCharacter(input);
    if (!result.ok) {
      return failure("character_service_update_failed", result.error, {
        manager_result: result
      });
    }

    return success("character_service_updated", {
      character: clone(result.payload.character)
    });
  }
}

module.exports = {
  CharacterService
};
