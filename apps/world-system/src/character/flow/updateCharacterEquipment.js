"use strict";

const { defaultCharacterService } = require("../character.defaults");

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

function updateCharacterEquipment(input) {
  const data = input || {};
  const characterService = data.character_service || defaultCharacterService;
  const characterId = data.character_id;
  const equipmentPatch = data.equipment_patch && typeof data.equipment_patch === "object"
    ? data.equipment_patch
    : null;

  if (!characterService || typeof characterService.getCharacterById !== "function") {
    return failure("character_equipment_update_failed", "character service is required");
  }
  if (!characterId || String(characterId).trim() === "") {
    return failure("character_equipment_update_failed", "character_id is required");
  }
  if (!equipmentPatch) {
    return failure("character_equipment_update_failed", "equipment_patch object is required");
  }

  const found = characterService.getCharacterById(characterId);
  if (!found.ok) {
    return failure("character_equipment_update_failed", found.error, {
      character_id: String(characterId)
    });
  }

  const character = found.payload.character;
  const nextEquipment = {
    ...(character.equipment && typeof character.equipment === "object" ? character.equipment : {}),
    ...equipmentPatch
  };

  const updated = characterService.updateCharacter({
    character_id: String(characterId),
    patch: {
      equipment: nextEquipment
    }
  });

  if (!updated.ok) {
    return failure("character_equipment_update_failed", updated.error, {
      character_id: String(characterId)
    });
  }

  return success("character_equipment_updated", {
    character: clone(updated.payload.character),
    applied_equipment_patch: clone(equipmentPatch)
  });
}

function updateCharacterAttunement(input) {
  const data = input || {};
  const characterService = data.character_service || defaultCharacterService;
  const characterId = data.character_id;
  const attunementPatch = data.attunement_patch && typeof data.attunement_patch === "object"
    ? data.attunement_patch
    : null;

  if (!characterService || typeof characterService.getCharacterById !== "function") {
    return failure("character_attunement_update_failed", "character service is required");
  }
  if (!characterId || String(characterId).trim() === "") {
    return failure("character_attunement_update_failed", "character_id is required");
  }
  if (!attunementPatch) {
    return failure("character_attunement_update_failed", "attunement_patch object is required");
  }

  const found = characterService.getCharacterById(characterId);
  if (!found.ok) {
    return failure("character_attunement_update_failed", found.error, {
      character_id: String(characterId)
    });
  }

  const character = found.payload.character;
  const nextAttunement = {
    ...(character.attunement && typeof character.attunement === "object" ? character.attunement : {}),
    ...attunementPatch
  };

  const updated = characterService.updateCharacter({
    character_id: String(characterId),
    patch: {
      attunement: nextAttunement
    }
  });

  if (!updated.ok) {
    return failure("character_attunement_update_failed", updated.error, {
      character_id: String(characterId)
    });
  }

  return success("character_attunement_updated", {
    character: clone(updated.payload.character),
    applied_attunement_patch: clone(attunementPatch)
  });
}

module.exports = {
  updateCharacterEquipment,
  updateCharacterAttunement
};
