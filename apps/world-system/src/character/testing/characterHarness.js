"use strict";

const { CharacterService } = require("../character.service");
const { CharacterRepository } = require("../character.repository");
const { updateCharacterProgress } = require("../flow/updateCharacterProgress");
const { toCombatParticipant } = require("../adapters/toCombatParticipant");
const { toDungeonPartyMember } = require("../adapters/toDungeonPartyMember");

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

function runCharacterHarness(input) {
  const data = input || {};
  const log = [];
  const service = new CharacterService();
  const repository = new CharacterRepository();

  const created = service.createCharacter({
    character_id: data.character_id || "char-harness-001",
    name: data.name || "Harness Hero",
    race: data.race || "human",
    class: data.class || "fighter",
    level: data.level || 1,
    armor_class: 12,
    current_hitpoints: 14,
    hitpoint_max: 14,
    inventory_id: data.inventory_id || "inv-harness-001"
  });
  log.push({ step: "create_character", result: clone(created) });
  if (!created.ok) {
    return failure("character_harness_failed", "could not create character", { log });
  }

  const saveResult = repository.saveCharacter(created.payload.character);
  log.push({ step: "save_character", result: clone(saveResult) });
  if (!saveResult.ok) {
    return failure("character_harness_failed", "could not save character", { log });
  }

  const loaded = repository.loadCharacterById(created.payload.character.character_id);
  log.push({ step: "load_character", result: clone(loaded) });
  if (!loaded.ok) {
    return failure("character_harness_failed", "could not load character", { log });
  }

  const progressUpdated = updateCharacterProgress({
    character_service: service,
    character_id: loaded.payload.character.character_id,
    xp_delta: Number.isFinite(data.xp_delta) ? Math.floor(Number(data.xp_delta)) : 300,
    level: Number.isFinite(data.level_after_progress)
      ? Math.max(1, Math.floor(Number(data.level_after_progress)))
      : 2
  });
  log.push({ step: "update_character_progress", result: clone(progressUpdated) });
  if (!progressUpdated.ok) {
    return failure("character_harness_failed", "could not update character progress", { log });
  }

  const updated = service.updateCharacter({
    character_id: loaded.payload.character.character_id,
    patch: {
      armor_class: 13,
      current_hitpoints: 16,
      hitpoint_max: 16
    }
  });
  log.push({ step: "update_character_sheet_fields", result: clone(updated) });
  if (!updated.ok) {
    return failure("character_harness_failed", "could not update character sheet fields", { log });
  }

  const savedUpdated = repository.saveCharacter(updated.payload.character);
  log.push({ step: "save_updated_character", result: clone(savedUpdated) });
  if (!savedUpdated.ok) {
    return failure("character_harness_failed", "could not save updated character", { log });
  }

  const toCombat = toCombatParticipant({
    character: updated.payload.character,
    team: data.team || "team_a",
    position: data.position || { x: 0, y: 0 }
  });
  log.push({ step: "convert_to_combat_participant", result: clone(toCombat) });
  if (!toCombat.ok) {
    return failure("character_harness_failed", "could not convert to combat participant", { log });
  }

  const toDungeon = toDungeonPartyMember({
    character: updated.payload.character,
    player_id: data.player_id || "player-harness-001"
  });
  log.push({ step: "convert_to_dungeon_party_member", result: clone(toDungeon) });
  if (!toDungeon.ok) {
    return failure("character_harness_failed", "could not convert to dungeon party member", { log });
  }

  return success("character_harness_completed", {
    character: clone(updated.payload.character),
    combat_participant: clone(toCombat.payload.participant),
    dungeon_party_member: clone(toDungeon.payload.party_member),
    log
  });
}

if (require.main === module) {
  const out = runCharacterHarness();
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCharacterHarness
};
