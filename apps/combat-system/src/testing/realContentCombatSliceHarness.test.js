"use strict";

const assert = require("assert");
const {
  runRealContentCombatSliceHarness,
  buildCombatReadyCharacter
} = require("./realContentCombatSliceHarness");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runRealContentCombatSliceHarnessTests() {
  const results = [];

  runTest("fighter_with_starter_weapon_can_attack_goblin_successfully", () => {
    const out = runRealContentCombatSliceHarness({
      player_id: "player-real-slice-attack-001",
      character_id: "char-real-slice-attack-001",
      combat_id: "combat-real-slice-attack-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "real_content_combat_slice_completed");
    assert.equal(out.payload.attack.hit, true);
    assert.equal(out.payload.attack.damage_dealt > 0, true);
    assert.equal(typeof out.payload.attack.target_hp_after, "number");
  }, results);

  runTest("armored_character_readiness_metadata_survives_into_combat_state", () => {
    const out = runRealContentCombatSliceHarness({
      player_id: "player-real-slice-ready-001",
      character_id: "char-real-slice-ready-001",
      combat_id: "combat-real-slice-ready-001"
    });

    assert.equal(out.ok, true);
    assert.equal(Boolean(out.payload.readiness.weapon_profile), true);
    assert.equal(Boolean(out.payload.readiness.armor_profile), true);
    assert.equal(Boolean(out.payload.readiness.shield_profile), true);
    assert.equal(out.payload.readiness.derived_armor_class >= 12, true);
  }, results);

  runTest("invalid_or_missing_equipment_metadata_fails_clearly", () => {
    const out = buildCombatReadyCharacter({
      character_id: "char-missing-equipment-001",
      equipped_item_profiles: {
        body: {
          item_id: "item_chain_mail"
        }
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "missing equipped main_hand weapon metadata");
  }, results);

  runTest("combat_result_remains_compatible_with_persistence_expectations", () => {
    const out = runRealContentCombatSliceHarness({
      player_id: "player-real-slice-persist-001",
      character_id: "char-real-slice-persist-001",
      combat_id: "combat-real-slice-persist-001"
    });

    assert.equal(out.ok, true);
    assert.equal(typeof out.payload.persisted_snapshot_id, "string");
    assert.equal(out.payload.persisted_snapshot_id.trim() !== "", true);
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
  const summary = runRealContentCombatSliceHarnessTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runRealContentCombatSliceHarnessTests
};

