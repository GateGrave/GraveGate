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

function runCharacterSheetTests() {
  const results = [];

  runTest("default_character_sheet_shape", () => {
    const service = createService();

    const created = service.createCharacter({
      character_id: "char-sheet-001",
      name: "Sheet Defaults"
    });

    assert.equal(created.ok, true);
    const c = created.payload.character;

    assert.equal(c.character_id, "char-sheet-001");
    assert.equal(c.account_id, null);
    assert.equal(c.name, "Sheet Defaults");
    assert.equal(c.player_id, null);
    assert.equal(c.race, "unknown");
    assert.equal(c.class, "unknown");
    assert.equal(c.background, "unknown");
    assert.equal(c.level, 1);
    assert.equal(c.xp, 0);
    assert.equal(typeof c.proficiency_bonus, "number");

    assert.equal(typeof c.stats, "object");
    assert.equal(c.stats.strength, 10);
    assert.equal(c.stats.dexterity, 10);
    assert.equal(c.stats.constitution, 10);
    assert.equal(c.stats.intelligence, 10);
    assert.equal(c.stats.wisdom, 10);
    assert.equal(c.stats.charisma, 10);

    assert.equal(c.hp_summary.current, 10);
    assert.equal(c.hp_summary.max, 10);
    assert.equal(c.hp_summary.temporary, 0);
    assert.equal(c.current_hitpoints, 10);
    assert.equal(c.hitpoint_max, 10);
    assert.equal(c.temporary_hitpoints, 0);
    assert.equal(c.armor_class, 10);
    assert.equal(c.bab, 0);
    assert.equal(c.initiative, 0);
    assert.equal(c.speed, 30);

    assert.equal("spellcasting_ability" in c, true);
    assert.equal("spellsave_dc" in c, true);
    assert.deepEqual(c.saving_throws, {});
    assert.deepEqual(c.skills, {});
    assert.deepEqual(c.feats, []);

    assert.equal(c.inventory_id, null);
    assert.equal(c.inventory_ref, null);
    assert.equal(c.inventory, null);
    assert.deepEqual(c.equipment, {});
    assert.deepEqual(c.attunement, {});
    assert.deepEqual(c.multiclass, {});
    assert.deepEqual(c.gestalt_progression, {});
    assert.deepEqual(c.status_flags, []);
    assert.deepEqual(c.metadata, {});
  }, results);

  runTest("custom_field_values", () => {
    const service = createService();

    const created = service.createCharacter({
      character_id: "char-sheet-002",
      account_id: "account-002",
      player_id: "player-002",
      name: "Custom Sheet",
      race: "Human",
      class: "Fighter",
      background: "Soldier",
      level: 3,
      xp: 900,
      stats: {
        strength: 14,
        dexterity: 12,
        constitution: 13,
        intelligence: 10,
        wisdom: 11,
        charisma: 8
      },
      hp_summary: {
        current: 22,
        max: 25,
        temporary: 3
      },
      inventory_id: "inv-sheet-002",
      inventory_ref: "inventory:inv-sheet-002",
      equipment: {
        weapon_main: "longsword",
        armor: "chain_mail"
      },
      attunement: {
        slots_used: 1,
        items: ["ring_of_protection"]
      },
      multiclass: {
        enabled: true,
        classes: [{ class: "fighter", level: 2 }, { class: "wizard", level: 1 }]
      },
      gestalt_progression: {
        enabled: false
      },
      status_flags: ["in_party", "ready"],
      metadata: {
        origin: "test_fixture"
      }
    });

    assert.equal(created.ok, true);
    const c = created.payload.character;
    assert.equal(c.account_id, "account-002");
    assert.equal(c.player_id, "player-002");
    assert.equal(c.background, "Soldier");
    assert.equal(c.xp, 900);
    assert.equal(c.hp_summary.current, 22);
    assert.equal(c.hp_summary.max, 25);
    assert.equal(c.hp_summary.temporary, 3);
    assert.equal(c.current_hitpoints, 22);
    assert.equal(c.hitpoint_max, 25);
    assert.equal(c.temporary_hitpoints, 3);
    assert.equal(c.inventory_ref, "inventory:inv-sheet-002");
    assert.equal(c.equipment.weapon_main, "longsword");
    assert.equal(c.attunement.slots_used, 1);
    assert.equal(c.multiclass.enabled, true);
    assert.equal(c.multiclass.classes.length, 2);
    assert.equal(c.gestalt_progression.enabled, false);
    assert.deepEqual(c.status_flags, ["in_party", "ready"]);
    assert.equal(c.metadata.origin, "test_fixture");
  }, results);

  runTest("sensible_defaults_for_arrays_and_objects", () => {
    const service = createService();

    const created = service.createCharacter({
      character_id: "char-sheet-003",
      name: "Defaults Check",
      feats: null,
      skills: null,
      equipment: null,
      attunement: null,
      multiclass: null,
      gestalt_progression: null,
      status_flags: null,
      metadata: null
    });

    assert.equal(created.ok, true);
    const c = created.payload.character;
    assert.deepEqual(c.feats, []);
    assert.deepEqual(c.skills, {});
    assert.deepEqual(c.equipment, {});
    assert.deepEqual(c.attunement, {});
    assert.deepEqual(c.multiclass, {});
    assert.deepEqual(c.gestalt_progression, {});
    assert.deepEqual(c.status_flags, []);
    assert.deepEqual(c.metadata, {});
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
  const summary = runCharacterSheetTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCharacterSheetTests
};
