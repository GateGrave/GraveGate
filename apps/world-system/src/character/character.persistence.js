"use strict";

const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { validateAdapterContract } = require("../../../database/src/adapters/databaseAdapter.interface");

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

class CharacterPersistenceBridge {
  constructor(options) {
    const cfg = options || {};
    this.adapter = cfg.adapter || createInMemoryAdapter();
    this.collection = cfg.collection ? String(cfg.collection) : "characters";

    const contract = validateAdapterContract(this.adapter);
    if (!contract.ok) {
      throw new Error(contract.error);
    }
  }

  saveCharacter(character) {
    if (!character || typeof character !== "object" || Array.isArray(character)) {
      return failure("character_persistence_save_failed", "character must be an object");
    }
    if (!character.character_id || String(character.character_id).trim() === "") {
      return failure("character_persistence_save_failed", "character.character_id is required");
    }

    const id = String(character.character_id);
    const saved = this.adapter.save(this.collection, id, character);
    if (!saved.ok) {
      return failure("character_persistence_save_failed", saved.error || "adapter save failed", {
        adapter_result: saved
      });
    }

    return success("character_persistence_saved", {
      character: clone(saved.payload.record)
    });
  }

  loadCharacterById(characterId) {
    if (!characterId || String(characterId).trim() === "") {
      return failure("character_persistence_load_failed", "character_id is required");
    }

    const loaded = this.adapter.getById(this.collection, String(characterId));
    if (!loaded.ok) {
      return failure("character_persistence_load_failed", loaded.error || "adapter getById failed", {
        adapter_result: loaded
      });
    }
    if (!loaded.payload.record) {
      return failure("character_persistence_load_failed", "character not found", {
        character_id: String(characterId)
      });
    }

    return success("character_persistence_loaded", {
      character: clone(loaded.payload.record)
    });
  }

  listCharacters() {
    const listed = this.adapter.list(this.collection);
    if (!listed.ok) {
      return failure("character_persistence_list_failed", listed.error || "adapter list failed", {
        adapter_result: listed
      });
    }

    const characters = Array.isArray(listed.payload.records)
      ? listed.payload.records.map(function mapRow(row) {
          return clone(row.record);
        })
      : [];

    return success("character_persistence_listed", {
      characters
    });
  }

  deleteCharacter(characterId) {
    if (!characterId || String(characterId).trim() === "") {
      return failure("character_persistence_delete_failed", "character_id is required");
    }

    const deleted = this.adapter.delete(this.collection, String(characterId));
    if (!deleted.ok) {
      return failure("character_persistence_delete_failed", deleted.error || "adapter delete failed", {
        adapter_result: deleted
      });
    }

    return success("character_persistence_deleted", {
      character_id: String(characterId),
      deleted: Boolean(deleted.payload.deleted)
    });
  }
}

module.exports = {
  CharacterPersistenceBridge
};

