"use strict";

const assert = require("assert");
const { CharacterService } = require("../character.service");
const { CharacterManager, InMemoryCharacterStore } = require("../character.manager");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createService() {
  const store = new InMemoryCharacterStore();
  const manager = new CharacterManager({ store });
  return new CharacterService({ manager });
}

function runCharacterServiceTests() {
  const results = [];

  runTest("creating_a_character", () => {
    const service = createService();

    const out = service.createCharacter({
      character_id: "char-service-001",
      name: "Alden",
      race: "Human",
      class: "Fighter",
      level: 1,
      stats: {
        strength: 14,
        dexterity: 12,
        constitution: 13,
        intelligence: 10,
        wisdom: 10,
        charisma: 8
      },
      inventory_id: "inv-service-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_service_created");
    assert.equal(out.payload.character.character_id, "char-service-001");
  }, results);

  runTest("retrieving_by_id", () => {
    const service = createService();
    service.createCharacter({ character_id: "char-service-002", name: "Bran" });

    const out = service.getCharacterById("char-service-002");

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_service_found");
    assert.equal(out.payload.character.name, "Bran");
  }, results);

  runTest("listing_characters", () => {
    const service = createService();
    service.createCharacter({ character_id: "char-service-003", name: "Cora" });
    service.createCharacter({ character_id: "char-service-004", name: "Dax" });

    const out = service.listCharacters();

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_service_listed");
    assert.equal(out.payload.characters.length, 2);
  }, results);

  runTest("updating_simple_fields", () => {
    const service = createService();
    service.createCharacter({
      character_id: "char-service-005",
      name: "Eira",
      level: 1,
      armor_class: 12
    });

    const out = service.updateCharacter({
      character_id: "char-service-005",
      patch: {
        level: 2,
        armor_class: 13,
        name: "Eira the Bold"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_service_updated");
    assert.equal(out.payload.character.level, 2);
    assert.equal(out.payload.character.armor_class, 13);
    assert.equal(out.payload.character.name, "Eira the Bold");
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
  const summary = runCharacterServiceTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCharacterServiceTests
};
