"use strict";

const assert = require("assert");
const { defaultCharacterService } = require("../character.defaults");
const { updateCharacterProgress } = require("../flow/updateCharacterProgress");
const { updateCharacterEquipment } = require("../flow/updateCharacterEquipment");
const characterModule = require("..");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runCharacterDefaultServiceLoadTests() {
  const results = [];

  runTest("default_character_service_module_loads_deterministically", () => {
    assert.equal(Boolean(defaultCharacterService), true);
    assert.equal(typeof defaultCharacterService.getCharacterById, "function");
    assert.equal(typeof defaultCharacterService.updateCharacter, "function");
  }, results);

  runTest("character_barrel_and_default_service_can_load_together_without_cycle_risk", () => {
    assert.equal(Boolean(characterModule), true);
    assert.equal(typeof characterModule.defaultCharacterService.getCharacterById, "function");
    assert.equal(typeof defaultCharacterService.getCharacterById, "function");
  }, results);

  runTest("progress_flow_uses_default_service_without_barrel_cycle", () => {
    const created = defaultCharacterService.createCharacter({
      character_id: "char-default-load-001",
      name: "Default Flow Hero"
    });
    assert.equal(created.ok, true);

    const out = updateCharacterProgress({
      character_id: "char-default-load-001",
      xp_delta: 10
    });
    assert.equal(out.ok, true);
    assert.equal(out.payload.current_xp, 10);
  }, results);

  runTest("equipment_flow_uses_default_service_without_barrel_cycle", () => {
    const out = updateCharacterEquipment({
      character_id: "char-default-load-001",
      equipment_patch: {
        main_hand: "item-default-sword-001"
      }
    });
    assert.equal(out.ok, true);
    assert.equal(out.payload.character.equipment.main_hand, "item-default-sword-001");
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
  const summary = runCharacterDefaultServiceLoadTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCharacterDefaultServiceLoadTests
};
