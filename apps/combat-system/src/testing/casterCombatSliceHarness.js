"use strict";

const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { loadStarterContentBundle } = require("../../../world-system/src/content");
const { CharacterPersistenceBridge } = require("../../../world-system/src/character/character.persistence");
const { createCharacterRecord } = require("../../../world-system/src/character/character.schema");
const { applyCharacterSelections } = require("../../../world-system/src/character/flow/applyCharacterSelections");
const { listSpellsForClass, getSpellData } = require("../../../world-system/src/character/rules/spellRules");
const { toCombatParticipant } = require("../../../world-system/src/character/adapters/toCombatParticipant");
const { CombatManager } = require("../core/combatManager");
const { startCombat } = require("../flow/startCombat");
const { validateCombatAction } = require("../validation/validate-combat-action");
const { ACTION_TYPES } = require("../validation/validation-helpers");
const { createBattlefieldGrid } = require("../battlefield");
const { CombatPersistenceBridge } = require("../combat.persistence");

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

function parseRangeFeet(rangeText) {
  const safe = String(rangeText || "").trim().toLowerCase();
  if (!safe) {
    return 5;
  }
  if (safe === "touch") {
    return 5;
  }
  if (safe === "self") {
    return 0;
  }
  const match = safe.match(/(\d+)\s*feet?/);
  if (!match) {
    return 5;
  }
  const asNumber = Number.parseInt(match[1], 10);
  return Number.isFinite(asNumber) ? asNumber : 5;
}

function validateSpellMetadata(spell) {
  const safe = spell && typeof spell === "object" ? spell : null;
  if (!safe) {
    return failure("caster_spell_metadata_invalid", "spell metadata object is required");
  }
  if (!safe.spell_id || String(safe.spell_id).trim() === "") {
    return failure("caster_spell_metadata_invalid", "spell_id is required");
  }
  if (!safe.name || String(safe.name).trim() === "") {
    return failure("caster_spell_metadata_invalid", "spell name is required");
  }
  if (!safe.school || String(safe.school).trim() === "") {
    return failure("caster_spell_metadata_invalid", "spell school is required");
  }
  if (!safe.effect || typeof safe.effect !== "object" || Array.isArray(safe.effect)) {
    return failure("caster_spell_metadata_invalid", "spell effect metadata is required");
  }
  if (!safe.attack_or_save || typeof safe.attack_or_save !== "object" || Array.isArray(safe.attack_or_save)) {
    return failure("caster_spell_metadata_invalid", "spell attack_or_save metadata is required");
  }

  return success("caster_spell_metadata_valid", {
    spell: safe
  });
}

function runCasterCombatSliceHarness(input) {
  const data = input || {};
  const playerId = data.player_id || "player-caster-combat-001";
  const characterId = data.character_id || "char-caster-combat-001";
  const combatId = data.combat_id || "combat-caster-slice-001";
  const raceId = data.race_id || "human";
  const classId = String(data.class_id || "sorcerer");
  const spellId = String(data.spell_id || "magic_missile");
  const monsterId = String(data.monster_id || "monster_goblin_scout");
  const log = [];

  const contentOut = loadStarterContentBundle();
  log.push({ step: "load_content", result: clone(contentOut) });
  if (!contentOut.ok) {
    return failure("caster_combat_slice_failed", contentOut.error || "failed to load content", { log });
  }

  const content = contentOut.payload.content;
  const monster =
    content.monsters.find((entry) => entry.monster_id === monsterId) ||
    content.monsters[0];
  if (!monster) {
    return failure("caster_combat_slice_failed", "starter monster content missing", { log });
  }

  const classSpellsOut = listSpellsForClass(classId);
  log.push({ step: "list_spells_for_class", result: clone(classSpellsOut) });
  if (!classSpellsOut.ok) {
    return failure("caster_combat_slice_failed", classSpellsOut.error || "failed to list class spells", { log });
  }

  const classSpell = classSpellsOut.payload.spells.find((entry) => String(entry.spell_id) === spellId);
  if (!classSpell) {
    return failure("caster_combat_slice_failed", "spell is not available for class", {
      class_id: classId,
      spell_id: spellId,
      log
    });
  }

  let spellData = classSpell;
  const spellLookupOut = getSpellData(spellId);
  log.push({ step: "get_spell_data", result: clone(spellLookupOut) });
  if (spellLookupOut.ok) {
    spellData = spellLookupOut.payload.spell_data;
  }
  if (data.spell_override && typeof data.spell_override === "object") {
    spellData = clone(data.spell_override);
  }

  const spellValidation = validateSpellMetadata(spellData);
  log.push({ step: "validate_spell_metadata", result: clone(spellValidation) });
  if (!spellValidation.ok) {
    return failure("caster_combat_slice_failed", spellValidation.error, { log });
  }

  const adapter = createInMemoryAdapter();
  const characterPersistence = new CharacterPersistenceBridge({ adapter });
  const combatPersistence = new CombatPersistenceBridge({ adapter });
  const combatManager = new CombatManager();

  const baseCharacter = createCharacterRecord({
    character_id: characterId,
    player_id: playerId,
    account_id: "acct-caster-001",
    name: "Caster Slice Character",
    level: 1,
    armor_class: 12,
    current_hitpoints: 12,
    hitpoint_max: 12,
    spellcasting_ability: classId === "cleric" ? "wisdom" : "charisma",
    spellsave_dc: 13
  });
  const selectedOut = applyCharacterSelections({
    character: baseCharacter,
    race_id: raceId,
    class_id: classId,
    background_id: "sage"
  });
  log.push({ step: "apply_character_selections", result: clone(selectedOut) });
  if (!selectedOut.ok) {
    return failure("caster_combat_slice_failed", selectedOut.error || "failed character selection", { log });
  }

  const characterWithSpellbook = Object.assign({}, selectedOut.payload.character_profile, {
    spellbook: {
      known_spell_ids: [spellId],
      known_spells: [clone(spellData)]
    }
  });
  const savedCharacter = characterPersistence.saveCharacter(characterWithSpellbook);
  log.push({ step: "save_character", result: clone(savedCharacter) });
  if (!savedCharacter.ok) {
    return failure("caster_combat_slice_failed", savedCharacter.error || "failed to save character", { log });
  }

  const participantOut = toCombatParticipant({
    character: characterWithSpellbook,
    team: "heroes",
    attack_bonus: 2,
    damage: 3,
    position: { x: 0, y: 0 }
  });
  log.push({ step: "to_combat_participant", result: clone(participantOut) });
  if (!participantOut.ok) {
    return failure("caster_combat_slice_failed", participantOut.error || "failed to build combat participant", { log });
  }

  const createdCombat = combatManager.createCombat({
    combat_id: combatId,
    status: "pending",
    battlefield: { width: 9, height: 9 }
  });
  if (!createdCombat.ok) {
    return failure("caster_combat_slice_failed", createdCombat.error || "failed to create combat", { log });
  }

  const addCaster = combatManager.addParticipant({
    combat_id: combatId,
    participant: {
      ...participantOut.payload.participant,
      participant_id: characterId,
      action_available: true,
      movement_remaining: 30
    }
  });
  const addMonster = combatManager.addParticipant({
    combat_id: combatId,
    participant: {
      participant_id: monster.monster_id,
      name: monster.name,
      team: "monsters",
      armor_class: monster.armor_class,
      current_hp: monster.max_hp,
      max_hp: monster.max_hp,
      attack_bonus: monster.attack_bonus,
      damage: monster.damage,
      position: { x: 1, y: 0 },
      action_available: true,
      movement_remaining: Number(monster.metadata && monster.metadata.movement) || 30
    }
  });
  log.push({ step: "add_caster", result: clone(addCaster) });
  log.push({ step: "add_monster", result: clone(addMonster) });
  if (!addCaster.ok || !addMonster.ok) {
    return failure("caster_combat_slice_failed", "failed to add combat participants", { log });
  }

  const rawCombat = combatManager.combats.get(String(combatId));
  rawCombat.battlefield_grid = createBattlefieldGrid(9, 9);
  combatManager.combats.set(String(combatId), rawCombat);

  const started = startCombat({
    combatManager,
    combat_id: combatId,
    roll_function(participant) {
      return participant.participant_id === characterId ? 18 : 10;
    }
  });
  if (!started.ok) {
    return failure("caster_combat_slice_failed", started.error || "failed to start combat", { log });
  }

  const currentCombat = combatManager.combats.get(String(combatId));
  const actionPayload = {
    action_type: ACTION_TYPES.CAST_SPELL,
    actor_participant_id: characterId,
    target_participant_id: monster.monster_id,
    spell_id: spellId,
    max_range_feet: parseRangeFeet(spellData.range)
  };
  const actionValidation = validateCombatAction({
    combat_state: currentCombat,
    action_payload: actionPayload
  });
  log.push({ step: "validate_cast_spell_action", result: clone(actionValidation) });
  if (!actionValidation.ok) {
    return failure("caster_combat_slice_failed", "caster action validation failed", {
      failed_checks: clone(actionValidation.failed_checks || []),
      log
    });
  }

  const spellResolution = {
    event_type: "combat_spell_cast_resolved_scaffold",
    caster_participant_id: characterId,
    target_participant_id: monster.monster_id,
    spell_id: spellData.spell_id,
    spell_name: spellData.name,
    school: spellData.school,
    resolution_type: spellData.attack_or_save.type || "unknown",
    range: spellData.range,
    attack_or_save: clone(spellData.attack_or_save),
    effect: clone(spellData.effect),
    damage: spellData.damage ? clone(spellData.damage) : null,
    healing: spellData.healing ? clone(spellData.healing) : null
  };
  currentCombat.event_log.push(spellResolution);
  currentCombat.updated_at = new Date().toISOString();
  combatManager.combats.set(String(combatId), currentCombat);

  const savedSnapshot = combatPersistence.saveCombatSnapshot({
    combat_state: currentCombat
  });
  log.push({ step: "save_combat_snapshot", result: clone(savedSnapshot) });
  if (!savedSnapshot.ok) {
    return failure("caster_combat_slice_failed", savedSnapshot.error || "failed to save snapshot", { log });
  }

  const loadedSnapshot = combatPersistence.loadCombatSnapshotById(savedSnapshot.payload.snapshot.snapshot_id);
  log.push({ step: "load_combat_snapshot", result: clone(loadedSnapshot) });
  if (!loadedSnapshot.ok) {
    return failure("caster_combat_slice_failed", loadedSnapshot.error || "failed to load snapshot", { log });
  }

  return success("caster_combat_slice_completed", {
    class_spell_lookup: {
      class_id: classId,
      spell_id: spellId,
      available: true
    },
    cast_action: {
      validated: true,
      action_type: actionPayload.action_type
    },
    spell_resolution: spellResolution,
    monster_summary: {
      monster_id: monster.monster_id,
      name: monster.name
    },
    persisted_snapshot_id: loadedSnapshot.payload.snapshot.snapshot_id,
    log
  });
}

if (require.main === module) {
  const out = runCasterCombatSliceHarness();
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCasterCombatSliceHarness,
  validateSpellMetadata
};
