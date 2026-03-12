"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { startCombat } = require("../flow/startCombat");
const { processCombatCastSpellRequest } = require("../flow/processCombatActionRequest");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSpellProvider(spells) {
  const entries = Array.isArray(spells) ? spells : [];
  return function provideSpells() {
    return {
      ok: true,
      payload: {
        spells: clone(entries)
      }
    };
  };
}

function createCombatReadyForSpell(combatId, casterId, options) {
  const cfg = options || {};
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: combatId,
    status: "pending"
  });

  manager.addParticipant({
    combat_id: combatId,
    participant: {
      participant_id: casterId,
      name: "Caster",
      team: "heroes",
      armor_class: 12,
      current_hp: cfg.caster_hp === undefined ? 12 : cfg.caster_hp,
      max_hp: 12,
      attack_bonus: 4,
      damage: 3,
      position: cfg.caster_position || { x: 0, y: 0 },
      action_available: cfg.caster_action_available === undefined ? true : cfg.caster_action_available,
      bonus_action_available: true,
      reaction_available: true,
      spellbook: {
        known_spell_ids: cfg.known_spell_ids || ["magic_missile", "fire_bolt", "sacred_flame", "poison_spray", "guiding_bolt", "ray_of_frost", "thunderwave"]
      },
      spellcasting_ability: "charisma",
      spell_attack_bonus: cfg.spell_attack_bonus === undefined ? 5 : cfg.spell_attack_bonus,
      spellsave_dc: cfg.spellsave_dc === undefined ? 13 : cfg.spellsave_dc,
      stats: {
        charisma: 16,
        dexterity: 12,
        constitution: 12,
        wisdom: 10
      }
    }
  });
  manager.addParticipant({
    combat_id: combatId,
    participant: {
      participant_id: "enemy-spell-001",
      name: "Target",
      team: "monsters",
      armor_class: 11,
      current_hp: cfg.target_hp === undefined ? 12 : cfg.target_hp,
      max_hp: 12,
      attack_bonus: 2,
      damage: 3,
      position: cfg.target_position || { x: 1, y: 0 },
      dexterity_save_modifier: cfg.dexterity_save_modifier === undefined ? 1 : cfg.dexterity_save_modifier,
      constitution_save_modifier: cfg.constitution_save_modifier === undefined ? 1 : cfg.constitution_save_modifier,
      resistances: Array.isArray(cfg.target_resistances) ? cfg.target_resistances : []
    }
  });
  manager.addParticipant({
    combat_id: combatId,
    participant: {
      participant_id: "ally-unrelated-001",
      name: "Unrelated Ally",
      team: "heroes",
      armor_class: 14,
      current_hp: 10,
      max_hp: 10,
      attack_bonus: 3,
      damage: 2,
      position: { x: 0, y: 1 }
    }
  });

  const started = startCombat({
    combatManager: manager,
    combat_id: combatId,
    roll_function(participant) {
      return participant.participant_id === casterId ? 20 : 1;
    }
  });
  assert.equal(started.ok, true);

  if (Array.isArray(cfg.conditions)) {
    const combat = manager.getCombatById(combatId).payload.combat;
    combat.conditions = clone(cfg.conditions);
    manager.combats.set(String(combatId), combat);
  }

  return manager;
}

function createCombatContext(manager, spells, overrides) {
  return Object.assign({
    combatManager: manager,
    spellContentProvider: createSpellProvider(spells),
    combatPersistence: {
      saveCombatSnapshot(input) {
        return {
          ok: true,
          payload: {
            snapshot: input && input.snapshot ? clone(input.snapshot) : { snapshot_id: "snapshot-spell-test-001" }
          }
        };
      }
    }
  }, overrides || {});
}

function runCastSpellActionTests() {
  const results = [];

  runTest("valid_spell_cast_succeeds_and_persists_typed_damage", () => {
    const casterId = "caster-spell-001";
    const combatId = "combat-spell-valid-001";
    const manager = createCombatReadyForSpell(combatId, casterId);
    const context = createCombatContext(manager, [{
      spell_id: "magic_missile",
      name: "Magic Missile",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "120 feet",
      attack_or_save: { type: "auto_hit" },
      damage: { dice: "3d4+3", damage_type: "force" }
    }], {
      spellDamageRng: () => 0
    });

    const out = processCombatCastSpellRequest({
      context,
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "magic_missile",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "player_cast_processed");
    assert.equal(out.payload.cast_spell.damage_type, "force");
    assert.equal(out.payload.cast_spell.damage_result.final_damage, 6);

    const loaded = manager.getCombatById(combatId);
    const target = loaded.payload.combat.participants.find((entry) => entry.participant_id === "enemy-spell-001");
    const caster = loaded.payload.combat.participants.find((entry) => entry.participant_id === casterId);
    const logEntry = loaded.payload.combat.event_log.find((entry) => entry.event_type === "cast_spell_action");
    assert.equal(target.current_hp, 6);
    assert.equal(caster.action_available, false);
    assert.equal(logEntry.event_type, "cast_spell_action");
    assert.equal(logEntry.damage_type, "force");
  }, results);

  runTest("invalid_spell_cast_fails_cleanly_when_spell_is_unknown", () => {
    const casterId = "caster-spell-unknown-001";
    const combatId = "combat-spell-unknown-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["fire_bolt"]
    });
    const context = createCombatContext(manager, [{
      spell_id: "magic_missile",
      name: "Magic Missile",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "120 feet",
      attack_or_save: { type: "auto_hit" },
      damage: { dice: "3d4+3", damage_type: "force" }
    }]);

    const out = processCombatCastSpellRequest({
      context,
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "magic_missile",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "spell is not known by caster");
  }, results);

  runTest("save_based_spell_applies_fail_and_success_paths_correctly", () => {
    const casterId = "caster-spell-save-001";
    const combatId = "combat-spell-save-001";
    const manager = createCombatReadyForSpell(combatId, casterId);
    const sacredFlame = {
      spell_id: "sacred_flame",
      name: "Sacred Flame",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "save", save_ability: "dexterity" },
      damage: { dice: "1d8", damage_type: "radiant" }
    };

    const failOut = processCombatCastSpellRequest({
      context: createCombatContext(manager, [sacredFlame], {
        spellSavingThrowFn: () => ({ final_total: 7 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "sacred_flame",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(failOut.ok, true);
    assert.equal(failOut.payload.cast_spell.saved, false);
    assert.equal(failOut.payload.cast_spell.damage_result.damage_type, "radiant");

    const combatAfterFail = manager.getCombatById(combatId).payload.combat;
    const caster = combatAfterFail.participants.find((entry) => entry.participant_id === casterId);
    caster.action_available = true;
    combatAfterFail.turn_index = combatAfterFail.initiative_order.indexOf(casterId);
    manager.combats.set(combatId, combatAfterFail);

    const targetHpBeforeSuccess = combatAfterFail.participants.find((entry) => entry.participant_id === "enemy-spell-001").current_hp;
    const successOut = processCombatCastSpellRequest({
      context: createCombatContext(manager, [sacredFlame], {
        spellSavingThrowFn: () => ({ final_total: 20 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "sacred_flame",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(successOut.ok, true);
    assert.equal(successOut.payload.cast_spell.saved, true);
    assert.equal(successOut.payload.cast_spell.damage_result, null);
    const targetHpAfterSuccess = manager.getCombatById(combatId).payload.combat.participants
      .find((entry) => entry.participant_id === "enemy-spell-001").current_hp;
    assert.equal(targetHpAfterSuccess, targetHpBeforeSuccess);
  }, results);

  runTest("action_economy_is_consumed_and_cannot_be_used_twice_same_turn", () => {
    const casterId = "caster-spell-economy-001";
    const combatId = "combat-spell-economy-001";
    const manager = createCombatReadyForSpell(combatId, casterId);
    const fireBolt = {
      spell_id: "fire_bolt",
      name: "Fire Bolt",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "120 feet",
      attack_or_save: { type: "spell_attack" },
      damage: { dice: "1d10", damage_type: "fire" }
    };
    const context = createCombatContext(manager, [fireBolt], {
      spellAttackRollFn: () => ({ final_total: 20 }),
      spellDamageRng: () => 0
    });

    const first = processCombatCastSpellRequest({
      context,
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "fire_bolt",
        target_id: "enemy-spell-001"
      }
    });
    const second = processCombatCastSpellRequest({
      context,
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "fire_bolt",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.error, "action is not available");
  }, results);

  runTest("shocking_grasp_applies_no_reaction_rider_on_hit", () => {
    const casterId = "caster-spell-shock-001";
    const combatId = "combat-spell-shock-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["shocking_grasp"]
    });
    const shockingGrasp = {
      spell_id: "shocking_grasp",
      name: "Shocking Grasp",
      casting_time: "1 action",
      range: "touch",
      targeting: { type: "single_target" },
      attack_or_save: { type: "spell_attack" },
      damage: { dice: "1d8", damage_type: "lightning" },
      effect: { status_hint: "no_reaction_until_next_turn" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [shockingGrasp], {
        spellAttackRollFn: () => ({ final_total: 20 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "shocking_grasp",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    const appliedConditions = Array.isArray(out.payload.cast_spell.applied_conditions)
      ? out.payload.cast_spell.applied_conditions
      : [];
    assert.equal(appliedConditions.some((entry) => entry.condition_type === "opportunity_attack_immunity"), true);
  }, results);

  runTest("guiding_bolt_applies_mark_until_source_turn", () => {
    const casterId = "caster-spell-guiding-001";
    const combatId = "combat-spell-guiding-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["guiding_bolt"]
    });
    const guidingBolt = {
      spell_id: "guiding_bolt",
      name: "Guiding Bolt",
      casting_time: "1 action",
      range: "120 feet",
      targeting: { type: "single_target" },
      attack_or_save: { type: "spell_attack" },
      damage: { dice: "4d6", damage_type: "radiant" },
      effect: { status_hint: "next_attack_advantage" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [guidingBolt], {
        spellAttackRollFn: () => ({ final_total: 20 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "guiding_bolt",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    const appliedConditions = Array.isArray(out.payload.cast_spell.applied_conditions)
      ? out.payload.cast_spell.applied_conditions
      : [];
    const mark = appliedConditions.find((entry) => entry.condition_type === "guiding_bolt_marked");
    assert.equal(Boolean(mark), true);
    assert.equal(mark.expiration_trigger, "start_of_source_turn");
  }, results);

  runTest("ray_of_frost_applies_speed_reduction_condition", () => {
    const casterId = "caster-spell-frost-001";
    const combatId = "combat-spell-frost-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["ray_of_frost"]
    });
    const rayOfFrost = {
      spell_id: "ray_of_frost",
      name: "Ray of Frost",
      casting_time: "1 action",
      range: "60 feet",
      targeting: { type: "single_target" },
      attack_or_save: { type: "spell_attack" },
      damage: { dice: "1d8", damage_type: "cold" },
      effect: { status_hint: "speed_reduced" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [rayOfFrost], {
        spellAttackRollFn: () => ({ final_total: 20 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "ray_of_frost",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    const appliedConditions = Array.isArray(out.payload.cast_spell.applied_conditions)
      ? out.payload.cast_spell.applied_conditions
      : [];
    const slow = appliedConditions.find((entry) => entry.condition_type === "speed_reduced");
    assert.equal(Boolean(slow), true);
    assert.equal(slow.expiration_trigger, "start_of_source_turn");
    assert.equal(slow.metadata.reduction_feet, 10);
  }, results);

  runTest("mage_armor_applies_supported_defense_effect", () => {
    const casterId = "caster-spell-armor-001";
    const combatId = "combat-spell-armor-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["mage_armor"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const ally = combat.participants.find((entry) => entry.participant_id === "ally-unrelated-001");
    ally.stats = { dexterity: 16 };
    ally.armor_class = 11;
    manager.combats.set(combatId, combat);

    const mageArmor = {
      spell_id: "mage_armor",
      name: "Mage Armor",
      casting_time: "1 action",
      range: "touch",
      targeting: { type: "single_target" },
      attack_or_save: { type: "none" },
      effect: {
        defense_ref: "spell_mage_armor_base_ac",
        base_ac_formula: "13 + dex_mod"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [mageArmor]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "mage_armor",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.defense_result.armor_class_before, 11);
    assert.equal(out.payload.cast_spell.defense_result.armor_class_after, 16);

    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const updatedAlly = updatedCombat.participants.find((entry) => entry.participant_id === "ally-unrelated-001");
    assert.equal(updatedAlly.armor_class, 16);
    assert.equal(
      Array.isArray(out.payload.cast_spell.applied_conditions) &&
      out.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "mage_armor"),
      true
    );
  }, results);

  runTest("dead_inactive_or_out_of_range_actor_cannot_cast", () => {
    const deadCasterId = "caster-spell-dead-001";
    const deadCombatId = "combat-spell-dead-001";
    const deadManager = createCombatReadyForSpell(deadCombatId, deadCasterId, {
      caster_hp: 0
    });
    const poisonSpray = {
      spell_id: "poison_spray",
      name: "Poison Spray",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "10 feet",
      attack_or_save: { type: "save", save_ability: "constitution" },
      damage: { dice: "1d12", damage_type: "poison" }
    };

    const deadOut = processCombatCastSpellRequest({
      context: createCombatContext(deadManager, [poisonSpray]),
      player_id: deadCasterId,
      combat_id: deadCombatId,
      payload: {
        spell_id: "poison_spray",
        target_id: "enemy-spell-001"
      }
    });
    assert.equal(deadOut.ok, false);
    assert.equal(deadOut.error, "defeated participants cannot act");

    const rangeCasterId = "caster-spell-range-001";
    const rangeCombatId = "combat-spell-range-001";
    const rangeManager = createCombatReadyForSpell(rangeCombatId, rangeCasterId, {
      target_position: { x: 5, y: 5 }
    });
    const rangeOut = processCombatCastSpellRequest({
      context: createCombatContext(rangeManager, [poisonSpray]),
      player_id: rangeCasterId,
      combat_id: rangeCombatId,
      payload: {
        spell_id: "poison_spray",
        target_id: "enemy-spell-001"
      }
    });
    assert.equal(rangeOut.ok, false);
    assert.equal(rangeOut.error, "target is out of spell range");

    const endedCasterId = "caster-spell-ended-001";
    const endedCombatId = "combat-spell-ended-001";
    const endedManager = createCombatReadyForSpell(endedCombatId, endedCasterId);
    const endedCombat = endedManager.getCombatById(endedCombatId).payload.combat;
    endedCombat.status = "complete";
    endedManager.combats.set(endedCombatId, endedCombat);

    const endedOut = processCombatCastSpellRequest({
      context: createCombatContext(endedManager, [poisonSpray]),
      player_id: endedCasterId,
      combat_id: endedCombatId,
      payload: {
        spell_id: "poison_spray",
        target_id: "enemy-spell-001"
      }
    });
    assert.equal(endedOut.ok, false);
    assert.equal(endedOut.error, "combat is not active");
  }, results);

  runTest("spell_cast_does_not_mutate_unrelated_combatants", () => {
    const casterId = "caster-spell-unrelated-001";
    const combatId = "combat-spell-unrelated-001";
    const manager = createCombatReadyForSpell(combatId, casterId);
    const before = clone(manager.getCombatById(combatId).payload.combat);
    const fireBolt = {
      spell_id: "fire_bolt",
      name: "Fire Bolt",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "120 feet",
      attack_or_save: { type: "spell_attack" },
      damage: { dice: "1d10", damage_type: "fire" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [fireBolt], {
        spellAttackRollFn: () => ({ final_total: 20 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "fire_bolt",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    const after = manager.getCombatById(combatId).payload.combat;
    const beforeAlly = before.participants.find((entry) => entry.participant_id === "ally-unrelated-001");
    const afterAlly = after.participants.find((entry) => entry.participant_id === "ally-unrelated-001");
    assert.equal(afterAlly.current_hp, beforeAlly.current_hp);
    assert.deepEqual(afterAlly.position, beforeAlly.position);
    assert.equal(afterAlly.team, beforeAlly.team);
  }, results);

  runTest("save_for_half_spell_applies_half_damage_on_successful_save", () => {
    const casterId = "caster-spell-half-001";
    const combatId = "combat-spell-half-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["thunderwave_test"]
    });
    const thunderwaveTest = {
      spell_id: "thunderwave_test",
      name: "Thunderwave Test",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "15 feet",
      attack_or_save: { type: "save", save_ability: "constitution" },
      save_outcome: "half",
      damage: { dice: "2d8", damage_type: "thunder" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [thunderwaveTest], {
        spellSavingThrowFn: () => ({ final_total: 20 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "thunderwave_test",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.saved, true);
    assert.equal(out.payload.cast_spell.damage_result.damage_type, "thunder");
    assert.equal(out.payload.cast_spell.damage_result.final_damage, 1);
  }, results);

  const passed = results.filter((entry) => entry.ok).length;
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
  const summary = runCastSpellActionTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCastSpellActionTests
};
