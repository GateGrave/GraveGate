"use strict";

const assert = require("assert");
const { CharacterService } = require("../character.service");
const { CharacterManager, InMemoryCharacterStore } = require("../character.manager");
const { CharacterPersistenceBridge } = require("../character.persistence");
const { createInMemoryAdapter } = require("../../../../database/src/adapters/inMemoryAdapter");
const {
  updateCharacterProgress,
  updateCharacterStats
} = require("../flow/updateCharacterProgress");
const {
  updateCharacterEquipment,
  updateCharacterAttunement
} = require("../flow/updateCharacterEquipment");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createServiceWithCharacter() {
  const store = new InMemoryCharacterStore();
  const manager = new CharacterManager({ store });
  const service = new CharacterService({ manager });

  service.createCharacter({
    character_id: "char-flow-001",
    name: "Flow Hero",
    level: 1,
    stats: {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10
    }
  });

  return service;
}

function createServiceWithClassCharacter(classId) {
  const store = new InMemoryCharacterStore();
  const manager = new CharacterManager({ store });
  const service = new CharacterService({ manager });

  service.createCharacter({
    character_id: "char-flow-class-001",
    name: "Flow Class Hero",
    class: classId,
    level: 1,
    xp: 0,
    stats: {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10
    }
  });

  return service;
}

function runUpdateCharacterFlowsTests() {
  const results = [];

  runTest("xp_update", () => {
    const service = createServiceWithCharacter();

    const out = updateCharacterProgress({
      character_service: service,
      character_id: "char-flow-001",
      xp_delta: 150
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_progress_updated");
    assert.equal(out.payload.current_xp, 150);
  }, results);

  runTest("level_update", () => {
    const service = createServiceWithCharacter();

    const out = updateCharacterProgress({
      character_service: service,
      character_id: "char-flow-001",
      xp_delta: 300,
      level: 2
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.current_level, 2);
    assert.equal(out.payload.character.level, 2);
  }, results);

  runTest("level_up_occurs_at_correct_threshold", () => {
    const service = createServiceWithCharacter();

    const out = updateCharacterProgress({
      character_service: service,
      character_id: "char-flow-001",
      xp_delta: 300
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.current_xp, 300);
    assert.equal(out.payload.current_level, 2);
    assert.equal(out.payload.character.level, 2);
  }, results);

  runTest("subclass_unlock_available_only_at_correct_level", () => {
    const service = createServiceWithClassCharacter("fighter");

    const levelTwo = updateCharacterProgress({
      character_service: service,
      character_id: "char-flow-class-001",
      xp_delta: 300
    });
    assert.equal(levelTwo.ok, true);
    assert.equal(levelTwo.payload.current_level, 2);
    assert.equal(levelTwo.payload.subclass_available, false);

    const levelThree = updateCharacterProgress({
      character_service: service,
      character_id: "char-flow-class-001",
      xp_delta: 600
    });
    assert.equal(levelThree.ok, true);
    assert.equal(levelThree.payload.current_level, 3);
    assert.equal(levelThree.payload.subclass_available, true);
  }, results);

  runTest("level_one_subclass_classes_report_subclass_available_immediately", () => {
    const service = createServiceWithClassCharacter("cleric");

    const out = updateCharacterProgress({
      character_service: service,
      character_id: "char-flow-class-001",
      xp_delta: 0
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.current_level, 1);
    assert.equal(out.payload.subclass_available, true);
  }, results);

  runTest("caster_progression_updates_spell_access_metadata", () => {
    const service = createServiceWithClassCharacter("wizard");

    const out = updateCharacterProgress({
      character_service: service,
      character_id: "char-flow-class-001",
      xp_delta: 900
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.current_level, 3);
    assert.equal(typeof out.payload.spell_progression, "object");
    assert.equal(out.payload.spell_progression.max_spell_level, 2);
    assert.equal(out.payload.spell_progression.available_spell_ids.includes("fire_bolt"), true);
    assert.equal(out.payload.spell_progression.available_spell_ids.includes("magic_missile"), true);
    assert.equal(out.payload.spell_progression.available_spell_ids.includes("scorching_ray"), true);
  }, results);

  runTest("stat_update", () => {
    const service = createServiceWithCharacter();

    const out = updateCharacterStats({
      character_service: service,
      character_id: "char-flow-001",
      stats_patch: {
        strength: 12,
        wisdom: 11
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_stats_updated");
    assert.equal(out.payload.character.stats.strength, 12);
    assert.equal(out.payload.character.stats.wisdom, 11);
  }, results);

  runTest("equipment_update", () => {
    const service = createServiceWithCharacter();

    const out = updateCharacterEquipment({
      character_service: service,
      character_id: "char-flow-001",
      equipment_patch: {
        weapon_main_hand: "Longsword",
        armor: "Chain Shirt"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_equipment_updated");
    assert.equal(out.payload.character.equipment.weapon_main_hand, "Longsword");
  }, results);

  runTest("attunement_update", () => {
    const service = createServiceWithCharacter();

    const out = updateCharacterAttunement({
      character_service: service,
      character_id: "char-flow-001",
      attunement_patch: {
        attunement_slots: 3,
        attuned_items: ["Ring of Protection"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_attunement_updated");
    assert.equal(out.payload.character.attunement.attunement_slots, 3);
    assert.equal(out.payload.character.attunement.attuned_items.length, 1);
  }, results);

  runTest("failure_on_missing_character", () => {
    const service = createServiceWithCharacter();

    const out = updateCharacterProgress({
      character_service: service,
      character_id: "char-flow-missing-999",
      xp_delta: 25
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "character_progress_update_failed");
    assert.equal(typeof out.error, "string");
    assert.equal(out.error.length > 0, true);
  }, results);

  runTest("invalid_level_up_request_fails_cleanly", () => {
    const service = createServiceWithClassCharacter("fighter");

    const out = updateCharacterProgress({
      character_service: service,
      character_id: "char-flow-class-001",
      level_up_request: true
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "character_progress_update_failed");
    assert.equal(typeof out.error, "string");
    assert.equal(out.error.includes("xp threshold"), true);
  }, results);

  runTest("progression_state_survives_persistence_reload", () => {
    const service = createServiceWithClassCharacter("wizard");
    const adapter = createInMemoryAdapter();
    const bridge = new CharacterPersistenceBridge({ adapter });

    const progressed = updateCharacterProgress({
      character_service: service,
      character_id: "char-flow-class-001",
      xp_delta: 900
    });
    assert.equal(progressed.ok, true);

    const saved = bridge.saveCharacter(progressed.payload.character);
    assert.equal(saved.ok, true);

    const loaded = bridge.loadCharacterById("char-flow-class-001");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.payload.character.level, 3);
    assert.equal(loaded.payload.character.xp, 900);
    assert.equal(loaded.payload.character.proficiency_bonus, 2);
    assert.equal(loaded.payload.character.spell_progression.max_spell_level, 2);
  }, results);

  const passed = results.filter((x) => x.ok).length;
  const failed = results.length - passed;

  return {
    ok: failed === 0,
    totals: {
      total: results.length,
      passed,
      failed
    },
    results
  };
}

if (require.main === module) {
  const summary = runUpdateCharacterFlowsTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runUpdateCharacterFlowsTests
};
