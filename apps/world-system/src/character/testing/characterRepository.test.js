"use strict";

const assert = require("assert");
const { CharacterRepository } = require("../character.repository");
const { InMemoryCharacterStore } = require("../../../../database/src/world-storage/characters.store");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createRepository() {
  return new CharacterRepository({
    store: new InMemoryCharacterStore()
  });
}

function runCharacterRepositoryTests() {
  const results = [];

  runTest("saving_a_character", () => {
    const repo = createRepository();
    const out = repo.saveCharacter({
      character_id: "char-repo-001",
      name: "Repo Hero"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_repository_saved");
    assert.equal(out.payload.character.character_id, "char-repo-001");
  }, results);

  runTest("loading_a_character", () => {
    const repo = createRepository();
    repo.saveCharacter({
      character_id: "char-repo-002",
      name: "Load Hero"
    });

    const out = repo.loadCharacterById("char-repo-002");

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_repository_loaded");
    assert.equal(out.payload.character.name, "Load Hero");
  }, results);

  runTest("listing_stored_characters", () => {
    const repo = createRepository();
    repo.saveCharacter({ character_id: "char-repo-003", name: "List One" });
    repo.saveCharacter({ character_id: "char-repo-004", name: "List Two" });

    const out = repo.listStoredCharacters();

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "character_repository_listed");
    assert.equal(out.payload.characters.length, 2);
  }, results);

  runTest("failure_when_character_missing", () => {
    const repo = createRepository();
    const out = repo.loadCharacterById("char-missing-001");

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "character_repository_load_failed");
    assert.equal(out.error, "character not found");
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
  const summary = runCharacterRepositoryTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCharacterRepositoryTests
};
