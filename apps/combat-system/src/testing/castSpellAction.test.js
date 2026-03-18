"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { startCombat } = require("../flow/startCombat");
const { processCombatCastSpellRequest } = require("../flow/processCombatActionRequest");
const { performCastSpellAction } = require("../actions/castSpellAction");
const { applyDamageToCombatState } = require("../damage/apply-damage-to-combat-state");
const { resolveAttackAgainstCombatState } = require("../actions/attackAction");
const { resolveSavingThrowOutcome } = require("../spells/spellcastingHelpers");

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

function findParticipant(combat, participantId) {
  const participants = Array.isArray(combat && combat.participants) ? combat.participants : [];
  return participants.find((entry) => String(entry && entry.participant_id || "") === String(participantId || "")) || null;
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

  const extraParticipants = Array.isArray(cfg.extraParticipants) ? cfg.extraParticipants : [];
  for (let index = 0; index < extraParticipants.length; index += 1) {
    manager.addParticipant({
      combat_id: combatId,
      participant: Object.assign({
        armor_class: 12,
        current_hp: 12,
        max_hp: 12,
        attack_bonus: 2,
        damage: 3,
        position: { x: 0, y: 0 }
      }, clone(extraParticipants[index]))
    });
  }
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

  runTest("false_life_applies_temporary_hitpoints_to_caster", () => {
    const casterId = "caster-spell-false-life-001";
    const combatId = "combat-spell-false-life-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["false_life"]
    });
    const falseLife = {
      spell_id: "false_life",
      name: "False Life",
      casting_time: "1 action",
      targeting: { type: "self" },
      range: "self",
      attack_or_save: { type: "none" },
      effect: {
        vitality_ref: "spell_false_life_temporary_hitpoints",
        temporary_hitpoints: 7
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [falseLife]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "false_life"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.vitality_result.temporary_hitpoints_granted, 7);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const updatedCaster = updatedCombat.participants.find((entry) => entry.participant_id === casterId);
    assert.equal(updatedCaster.temporary_hitpoints, 7);
  }, results);

  runTest("armor_of_agathys_applies_temporary_hitpoints_and_reactive_condition", () => {
    const casterId = "caster-spell-agathys-001";
    const combatId = "combat-spell-agathys-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["armor_of_agathys"]
    });
    const armorOfAgathys = {
      spell_id: "armor_of_agathys",
      name: "Armor of Agathys",
      casting_time: "1 action",
      targeting: { type: "self" },
      range: "self",
      attack_or_save: { type: "none" },
      effect: {
        vitality_ref: "spell_armor_of_agathys_temporary_hitpoints",
        temporary_hitpoints: 5,
        status_hint: "armor_of_agathys",
        retaliation_damage: 5
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [armorOfAgathys]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "armor_of_agathys"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.vitality_result.temporary_hitpoints_granted, 5);
    assert.equal(out.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "armor_of_agathys"), true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const updatedCaster = updatedCombat.participants.find((entry) => entry.participant_id === casterId);
    assert.equal(updatedCaster.temporary_hitpoints, 5);
  }, results);

  runTest("healing_word_uses_bonus_action_and_restores_hp", () => {
    const casterId = "caster-spell-healing-word-001";
    const combatId = "combat-spell-healing-word-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["healing_word"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const ally = combat.participants.find((entry) => entry.participant_id === "ally-unrelated-001");
    ally.current_hp = 4;
    manager.combats.set(combatId, combat);

    const healingWord = {
      spell_id: "healing_word",
      name: "Healing Word",
      casting_time: "1 bonus action",
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "none" },
      healing: {
        dice: "1d4",
        bonus: "spellcasting_ability_modifier"
      },
      effect: { healing_ref: "spell_heal_healing_word" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [healingWord], {
        spellHealingRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "healing_word",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.action_cost, "bonus_action");
    assert.equal(out.payload.cast_spell.healing_result.healed_for, 4);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const updatedCaster = updatedCombat.participants.find((entry) => entry.participant_id === casterId);
    assert.equal(updatedCaster.bonus_action_available, false);
    assert.equal(updatedCaster.action_available, true);
    assert.equal(out.payload.cast_spell.healing_result.hp_after, 8);
  }, results);

  runTest("bonus_action_spell_allows_action_cantrip_but_blocks_leveled_action_spell", () => {
    const casterId = "caster-spell-bonus-rule-001";
    const combatId = "combat-spell-bonus-rule-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["healing_word", "fire_bolt", "magic_missile"]
    });
    const healingWord = {
      spell_id: "healing_word",
      name: "Healing Word",
      level: 1,
      casting_time: "1 bonus action",
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "none" },
      healing: {
        dice: "1d4",
        bonus: "spellcasting_ability_modifier"
      }
    };
    const fireBolt = {
      spell_id: "fire_bolt",
      name: "Fire Bolt",
      level: 0,
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "120 feet",
      attack_or_save: { type: "spell_attack" },
      damage: { dice: "1d10", damage_type: "fire" }
    };
    const magicMissile = {
      spell_id: "magic_missile",
      name: "Magic Missile",
      level: 1,
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "120 feet",
      attack_or_save: { type: "auto_hit" },
      damage: { dice: "3d4+3", damage_type: "force" }
    };
    const first = performCastSpellAction({
      combatManager: manager,
      combat_id: combatId,
      caster_id: casterId,
      target_id: "ally-unrelated-001",
      spell: healingWord,
      healing_rng: () => 0
    });
    assert.equal(first.ok, true);

    const second = performCastSpellAction({
      combatManager: manager,
      combat_id: combatId,
      caster_id: casterId,
      target_id: "enemy-spell-001",
      spell: fireBolt,
      attack_roll_fn: () => ({ final_total: 20 }),
      damage_rng: () => 0
    });
    assert.equal(second.ok, true);

    const third = performCastSpellAction({
      combatManager: manager,
      combat_id: combatId,
      caster_id: casterId,
      target_id: "enemy-spell-001",
      spell: magicMissile,
      damage_rng: () => 0
    });
    assert.equal(third.ok, false);
    assert.equal(third.error, "after casting a bonus action spell, only a cantrip with a 1 action casting time can be cast this turn");
  }, results);

  runTest("leveled_action_spell_blocks_bonus_action_spell_same_turn", () => {
    const casterId = "caster-spell-bonus-rule-002";
    const combatId = "combat-spell-bonus-rule-002";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["magic_missile", "healing_word"]
    });
    const magicMissile = {
      spell_id: "magic_missile",
      name: "Magic Missile",
      level: 1,
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "120 feet",
      attack_or_save: { type: "auto_hit" },
      damage: { dice: "3d4+3", damage_type: "force" }
    };
    const healingWord = {
      spell_id: "healing_word",
      name: "Healing Word",
      level: 1,
      casting_time: "1 bonus action",
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "none" },
      healing: {
        dice: "1d4",
        bonus: "spellcasting_ability_modifier"
      }
    };
    const context = createCombatContext(manager, [magicMissile, healingWord], {
      spellDamageRng: () => 0,
      spellHealingRng: () => 0
    });

    const first = processCombatCastSpellRequest({
      context,
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "magic_missile",
        target_id: "enemy-spell-001"
      }
    });
    assert.equal(first.ok, true);

    const second = processCombatCastSpellRequest({
      context,
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "healing_word",
        target_id: "ally-unrelated-001"
      }
    });
    assert.equal(second.ok, false);
    assert.equal(second.error, "cannot cast a bonus action spell after casting a leveled spell this turn");
  }, results);

  runTest("barkskin_raises_low_armor_class_to_minimum_and_starts_concentration", () => {
    const casterId = "caster-spell-barkskin-001";
    const combatId = "combat-spell-barkskin-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["barkskin"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const ally = combat.participants.find((entry) => entry.participant_id === "ally-unrelated-001");
    ally.armor_class = 12;
    manager.combats.set(combatId, combat);

    const barkskin = {
      spell_id: "barkskin",
      name: "Barkskin",
      casting_time: "1 action",
      concentration: true,
      targeting: { type: "single_target" },
      range: "touch",
      attack_or_save: { type: "none" },
      effect: {
        defense_ref: "spell_barkskin_minimum_ac",
        minimum_ac: 16
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [barkskin]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "barkskin",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.defense_result.armor_class_before, 12);
    assert.equal(out.payload.cast_spell.defense_result.armor_class_after, 16);
    assert.equal(Boolean(out.payload.cast_spell.concentration_started), true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const updatedAlly = updatedCombat.participants.find((entry) => entry.participant_id === "ally-unrelated-001");
    assert.equal(updatedAlly.armor_class, 12);
    const incomingAttack = resolveAttackAgainstCombatState({
      combat: updatedCombat,
      attacker_id: "enemy-spell-001",
      target_id: "ally-unrelated-001",
      skip_turn_validation: true,
      reaction_mode: true,
      attack_roll_fn: () => 13,
      damage_roll_fn: () => 3
    });
    assert.equal(incomingAttack.ok, true);
    assert.equal(incomingAttack.payload.target_armor_class, 16);
    assert.equal(incomingAttack.payload.hit, false);
  }, results);

  runTest("heroism_applies_start_of_turn_temp_hp_condition_and_concentration", () => {
    const casterId = "caster-spell-heroism-001";
    const combatId = "combat-spell-heroism-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["heroism"]
    });

    const heroism = {
      spell_id: "heroism",
      name: "Heroism",
      casting_time: "1 action",
      concentration: true,
      targeting: { type: "up_to_three_allies" },
      range: "touch",
      attack_or_save: { type: "none" },
      effect: {
        status_hint: "heroism",
        start_of_turn_temporary_hitpoints: 3
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [heroism]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "heroism",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(Boolean(out.payload.cast_spell.concentration_started), true);
    assert.equal(out.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "heroism"), true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const condition = updatedCombat.conditions.find((entry) => entry.condition_type === "heroism" && entry.target_actor_id === "ally-unrelated-001");
    assert.equal(Boolean(condition), true);
    assert.equal(condition.metadata.start_of_turn_temporary_hitpoints, 3);
  }, results);

  runTest("blade_ward_applies_weapon_resistance_condition", () => {
    const casterId = "caster-spell-blade-ward-001";
    const combatId = "combat-spell-blade-ward-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["blade_ward"]
    });
    const bladeWard = {
      spell_id: "blade_ward",
      name: "Blade Ward",
      casting_time: "1 action",
      targeting: { type: "self" },
      range: "self",
      attack_or_save: { type: "none" },
      effect: {
        status_hint: "blade_ward"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [bladeWard]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "blade_ward"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "blade_ward"), true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const incomingAttack = resolveAttackAgainstCombatState({
      combat: updatedCombat,
      attacker_id: "enemy-spell-001",
      target_id: casterId,
      skip_turn_validation: true,
      reaction_mode: true,
      attack_roll_fn: () => 18,
      damage_roll_fn: () => 6
    });
    assert.equal(incomingAttack.ok, true);
    assert.equal(incomingAttack.payload.damage_dealt, 3);
  }, results);

  runTest("sanctuary_blocks_harmful_spell_targeting_on_failed_wisdom_save", () => {
    const casterId = "caster-spell-sanctuary-001";
    const combatId = "combat-spell-sanctuary-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["fire_bolt"]
    });
    const fireBolt = {
      spell_id: "fire_bolt",
      name: "Fire Bolt",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "120 feet",
      attack_or_save: { type: "spell_attack" },
      damage: { dice: "1d10", damage_type: "fire" }
    };

    const combat = manager.getCombatById(combatId).payload.combat;
    combat.conditions = [{
      condition_id: "condition-sanctuary-spell-target-001",
      condition_type: "sanctuary",
      source_actor_id: casterId,
      target_actor_id: "ally-unrelated-001",
      expiration_trigger: "manual",
      metadata: {
        blocks_attack_targeting: true,
        blocks_harmful_spell_targeting: true,
        targeting_save_ability: "wisdom",
        targeting_save_dc: 13
      }
    }];
    const enemy = combat.participants.find((entry) => entry.participant_id === "enemy-spell-001");
    enemy.spellbook = { known_spell_ids: ["fire_bolt"] };
    enemy.spellcasting_ability = "charisma";
    enemy.spell_attack_bonus = 4;
    enemy.spellsave_dc = 12;
    enemy.action_available = true;
    combat.turn_index = combat.initiative_order.indexOf("enemy-spell-001");
    manager.combats.set(combatId, combat);

    const second = performCastSpellAction({
      combatManager: manager,
      combat_id: combatId,
      caster_id: "enemy-spell-001",
      target_id: "ally-unrelated-001",
      spell: fireBolt,
      skip_turn_validation: true,
      targeting_save_fn: () => ({ final_total: 7 }),
      attack_roll_fn: () => ({ final_total: 20 }),
      damage_rng: () => 0
    });

    assert.equal(second.ok, false);
    assert.equal(second.error, "target is protected from harmful spells");
  }, results);

  runTest("sanctuary_on_caster_breaks_when_casting_harmful_spell", () => {
    const casterId = "caster-spell-sanctuary-break-001";
    const combatId = "combat-spell-sanctuary-break-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["sanctuary", "fire_bolt"]
    });
    const sanctuary = {
      spell_id: "sanctuary",
      name: "Sanctuary",
      casting_time: "1 bonus action",
      targeting: { type: "self" },
      range: "self",
      attack_or_save: { type: "none" },
      effect: {
        status_hint: "sanctuary"
      }
    };
    const fireBolt = {
      spell_id: "fire_bolt",
      name: "Fire Bolt",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "120 feet",
      attack_or_save: { type: "spell_attack" },
      damage: { dice: "1d10", damage_type: "fire" }
    };

    const first = processCombatCastSpellRequest({
      context: createCombatContext(manager, [sanctuary, fireBolt]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "sanctuary"
      }
    });
    assert.equal(first.ok, true);

    const combat = manager.getCombatById(combatId).payload.combat;
    const caster = combat.participants.find((entry) => entry.participant_id === casterId);
    caster.action_available = true;
    caster.bonus_action_available = true;
    caster.spellcasting_turn_state = {
      bonus_action_spell_cast: false,
      action_spell_cast: false,
      action_spell_was_cantrip: false
    };
    combat.turn_index = combat.initiative_order.indexOf(casterId);
    manager.combats.set(combatId, combat);

    const second = processCombatCastSpellRequest({
      context: createCombatContext(manager, [sanctuary, fireBolt], {
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

    assert.equal(second.ok, true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.equal(updatedCombat.conditions.some((entry) => entry.condition_type === "sanctuary" && entry.target_actor_id === casterId), false);
  }, results);

  runTest("aid_increases_current_and_max_hitpoints_and_applies_condition", () => {
    const casterId = "caster-spell-aid-001";
    const combatId = "combat-spell-aid-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["aid"]
    });

    const aid = {
      spell_id: "aid",
      name: "Aid",
      casting_time: "1 action",
      concentration: false,
      targeting: { type: "up_to_three_allies" },
      range: "30 feet",
      attack_or_save: { type: "none" },
      effect: {
        vitality_ref: "spell_aid_hitpoint_bonus",
        hitpoint_max_bonus: 5,
        status_hint: "aid"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [aid]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "aid",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.vitality_result.hitpoint_max_bonus, 5);
    assert.equal(out.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "aid"), true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const updatedAlly = updatedCombat.participants.find((entry) => entry.participant_id === "ally-unrelated-001");
    assert.equal(updatedAlly.max_hp, 15);
    assert.equal(updatedAlly.current_hp, 15);
  }, results);

  runTest("concentration_spell_starts_and_replaces_existing_concentration", () => {
    const casterId = "caster-spell-concentration-001";
    const combatId = "combat-spell-concentration-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["hex_test", "shield_of_faith"]
    });
    const hexTest = {
      spell_id: "hex_test",
      name: "Hex Test",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "90 feet",
      concentration: true,
      attack_or_save: { type: "auto_hit" },
      applied_conditions: [
        {
          condition_type: "hexed",
          expiration_trigger: "manual"
        }
      ]
    };
    const shieldOfFaith = {
      spell_id: "shield_of_faith",
      name: "Shield of Faith",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "60 feet",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: {
        defense_ref: "spell_shield_of_faith_ac_bonus",
        ac_bonus: 2
      }
    };

    const first = processCombatCastSpellRequest({
      context: createCombatContext(manager, [hexTest, shieldOfFaith]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "hex_test",
        target_id: "enemy-spell-001"
      }
    });
    assert.equal(first.ok, true);
    assert.equal(first.payload.cast_spell.concentration_required, true);
    assert.equal(first.payload.cast_spell.concentration_started.source_spell_id, "hex_test");

    const combatAfterFirst = manager.getCombatById(combatId).payload.combat;
    const caster = combatAfterFirst.participants.find((entry) => entry.participant_id === casterId);
    caster.action_available = true;
    combatAfterFirst.turn_index = combatAfterFirst.initiative_order.indexOf(casterId);
    manager.combats.set(combatId, combatAfterFirst);

    const second = processCombatCastSpellRequest({
      context: createCombatContext(manager, [hexTest, shieldOfFaith]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "shield_of_faith",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(second.ok, true);
    assert.equal(second.payload.cast_spell.concentration_required, true);
    assert.equal(second.payload.cast_spell.concentration_started.source_spell_id, "shield_of_faith");
    assert.equal(second.payload.cast_spell.concentration_replaced.source_spell_id, "hex_test");
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.equal(updatedCombat.conditions.some((entry) => entry.condition_type === "hexed"), false);
    const updatedCaster = updatedCombat.participants.find((entry) => entry.participant_id === casterId);
    assert.equal(updatedCaster.concentration.source_spell_id, "shield_of_faith");
  }, results);

  runTest("damage_to_concentrating_target_from_spell_forces_concentration_save", () => {
    const casterId = "caster-spell-concentration-break-001";
    const combatId = "combat-spell-concentration-break-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["fire_bolt"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const target = combat.participants.find((entry) => entry.participant_id === "enemy-spell-001");
    target.constitution_save_modifier = 0;
    target.concentration = {
      is_concentrating: true,
      source_spell_id: "shield_of_faith",
      target_actor_id: "enemy-spell-001",
      linked_condition_ids: ["condition-concentration-spell-001"],
      linked_restorations: [],
      started_at_round: 1,
      broken_reason: null
    };
    combat.conditions = [{
      condition_id: "condition-concentration-spell-001",
      condition_type: "shield_of_faith",
      source_actor_id: "enemy-spell-001",
      target_actor_id: "enemy-spell-001",
      expiration_trigger: "manual",
      metadata: {}
    }];
    manager.combats.set(combatId, combat);

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
        spellDamageRng: () => 0,
        concentrationSaveRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "fire_bolt",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(Boolean(out.payload.cast_spell.concentration_result), true);
    assert.equal(out.payload.cast_spell.concentration_result.concentration_broken, true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const updatedTarget = updatedCombat.participants.find((entry) => entry.participant_id === "enemy-spell-001");
    assert.equal(updatedTarget.concentration.is_concentrating, false);
    assert.equal(updatedCombat.conditions.length, 0);
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

  runTest("bless_applies_attack_and_save_bonus_condition_to_ally", () => {
    const casterId = "caster-spell-bless-001";
    const combatId = "combat-spell-bless-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["bless"]
    });
    const blessSpell = {
      spell_id: "bless",
      name: "Bless",
      casting_time: "1 action",
      concentration: true,
      targeting: { type: "up_to_three_allies" },
      range: "30 feet",
      attack_or_save: { type: "none" },
      effect: {
        buff_ref: "spell_bless_attack_and_save_bonus",
        dice_bonus: "1d4"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [blessSpell]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "bless",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(Array.isArray(out.payload.cast_spell.applied_conditions), true);
    assert.equal(out.payload.cast_spell.applied_conditions[0].condition_type, "bless");
    const combat = manager.getCombatById(combatId).payload.combat;
    const condition = combat.conditions.find((entry) => entry.condition_type === "bless");
    assert.equal(Boolean(condition), true);
    assert.equal(condition.target_actor_id, "ally-unrelated-001");
  }, results);

  runTest("bane_applies_attack_and_save_penalty_condition_to_enemy", () => {
    const casterId = "caster-spell-bane-001";
    const combatId = "combat-spell-bane-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["bane"]
    });
    const baneSpell = {
      spell_id: "bane",
      name: "Bane",
      casting_time: "1 action",
      concentration: true,
      targeting: { type: "up_to_three_enemies" },
      range: "30 feet",
      attack_or_save: { type: "none" },
      effect: {
        debuff_ref: "spell_bane_attack_and_save_penalty",
        dice_bonus: "1d4"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [baneSpell]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "bane",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(Array.isArray(out.payload.cast_spell.applied_conditions), true);
    assert.equal(out.payload.cast_spell.applied_conditions[0].condition_type, "bane");
    const combat = manager.getCombatById(combatId).payload.combat;
    const condition = combat.conditions.find((entry) => entry.condition_type === "bane");
    assert.equal(Boolean(condition), true);
    assert.equal(condition.target_actor_id, "enemy-spell-001");
  }, results);

  runTest("faerie_fire_applies_persistent_advantage_condition_on_failed_save", () => {
    const casterId = "caster-spell-faerie-001";
    const combatId = "combat-spell-faerie-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["faerie_fire"]
    });
    const faerieFire = {
      spell_id: "faerie_fire",
      name: "Faerie Fire",
      casting_time: "1 action",
      concentration: true,
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "save", save_ability: "dexterity" },
      effect: {
        status_hint: "outlined_for_advantage"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [faerieFire], {
        spellSavingThrowFn: () => ({ final_total: 5 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "faerie_fire",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.saved, false);
    assert.equal(out.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "faerie_fire_lit"), true);
    const combat = manager.getCombatById(combatId).payload.combat;
    const condition = combat.conditions.find((entry) => entry.condition_type === "faerie_fire_lit");
    assert.equal(Boolean(condition), true);
  }, results);

  runTest("hold_person_applies_paralyzed_condition_on_failed_save", () => {
    const casterId = "caster-spell-hold-001";
    const combatId = "combat-spell-hold-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["hold_person"]
    });
    const holdPerson = {
      spell_id: "hold_person",
      name: "Hold Person",
      casting_time: "1 action",
      concentration: true,
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "save", save_ability: "wisdom" },
      applied_conditions: [
        {
            condition_type: "paralyzed",
          expiration_trigger: "manual",
          metadata: {
            source: "hold_person"
          }
        }
      ]
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [holdPerson], {
        spellSavingThrowFn: () => ({ final_total: 5 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "hold_person",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.saved, false);
    assert.equal(out.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "paralyzed"), true);
    assert.equal(Boolean(out.payload.cast_spell.concentration_started), true);
    const combat = manager.getCombatById(combatId).payload.combat;
    assert.equal(combat.conditions.some((entry) => entry.condition_type === "paralyzed" && entry.target_actor_id === "enemy-spell-001"), true);
  }, results);

  runTest("spell_that_paralyzes_grappler_clears_existing_grappled_condition", () => {
    const casterId = "caster-spell-hold-grapple-001";
    const combatId = "combat-spell-hold-grapple-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["hold_person"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    combat.conditions = [{
      condition_id: "condition-grapple-spell-cleanup-001",
      condition_type: "grappled",
      source_actor_id: "enemy-spell-001",
      target_actor_id: "ally-unrelated-001",
      expiration_trigger: "manual"
    }];
    manager.combats.set(combatId, combat);

    const holdPerson = {
      spell_id: "hold_person",
      name: "Hold Person",
      casting_time: "1 action",
      concentration: true,
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "save", save_ability: "wisdom" },
      applied_conditions: [
        {
          condition_type: "paralyzed",
          expiration_trigger: "manual",
          metadata: {
            source: "hold_person"
          }
        }
      ]
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [holdPerson], {
        spellSavingThrowFn: () => ({ final_total: 5 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "hold_person",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.equal(updatedCombat.conditions.some((entry) => {
      return entry.condition_type === "paralyzed" && entry.target_actor_id === "enemy-spell-001";
    }), true);
    assert.equal(updatedCombat.conditions.some((entry) => {
      return entry.condition_type === "grappled" && entry.source_actor_id === "enemy-spell-001";
    }), false);
  }, results);

  runTest("lesser_restoration_removes_supported_condition_from_target", () => {
    const casterId = "caster-spell-restoration-001";
    const combatId = "combat-spell-restoration-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["lesser_restoration"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    combat.conditions = [{
      condition_id: "condition-poisoned-001",
      condition_type: "poisoned",
      target_actor_id: "ally-unrelated-001",
      source_actor_id: "enemy-spell-001",
      expiration_trigger: "manual",
      duration: {},
      metadata: {}
    }];
    manager.combats.set(combatId, combat);

    const lesserRestoration = {
      spell_id: "lesser_restoration",
      name: "Lesser Restoration",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "touch",
      attack_or_save: { type: "none" },
      effect: {
        status_ref: "spell_lesser_restoration_cleanse",
          remove_conditions: ["poisoned", "stunned", "paralyzed"]
        }
      };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [lesserRestoration]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "lesser_restoration",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(Array.isArray(out.payload.cast_spell.removed_conditions), true);
    assert.equal(out.payload.cast_spell.removed_conditions.some((entry) => entry.condition_type === "poisoned"), true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.equal(updatedCombat.conditions.some((entry) => entry.condition_type === "poisoned" && entry.target_actor_id === "ally-unrelated-001"), false);
  }, results);

  runTest("protection_from_poison_removes_poisoned_and_grants_poison_resistance", () => {
    const casterId = "caster-spell-protection-poison-001";
    const combatId = "combat-spell-protection-poison-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["protection_from_poison"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    combat.conditions = [{
      condition_id: "condition-poisoned-spell-001",
      condition_type: "poisoned",
      target_actor_id: "ally-unrelated-001",
      source_actor_id: "enemy-spell-001",
      expiration_trigger: "manual",
      duration: {},
      metadata: {}
    }];
    manager.combats.set(combatId, combat);

    const protectionFromPoison = {
      spell_id: "protection_from_poison",
      name: "Protection from Poison",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "touch",
      attack_or_save: { type: "none" },
      effect: {
        status_ref: "spell_protection_from_poison",
        remove_conditions: ["poisoned"],
        applied_conditions: [
          {
            condition_type: "protection_from_poison",
            expiration_trigger: "manual",
            metadata: {
              resistances: ["poison"],
              source_spell_id: "protection_from_poison"
            }
          }
        ]
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [protectionFromPoison]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "protection_from_poison",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.removed_conditions.some((entry) => entry.condition_type === "poisoned"), true);
    assert.equal(out.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "protection_from_poison"), true);

    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.equal(updatedCombat.conditions.some((entry) => entry.condition_type === "poisoned" && entry.target_actor_id === "ally-unrelated-001"), false);
    const protectedTarget = updatedCombat.participants.find((entry) => entry.participant_id === "ally-unrelated-001");
    protectedTarget.current_hp = 10;
    const applied = applyDamageToCombatState({
      combat_state: updatedCombat,
      target_participant_id: "ally-unrelated-001",
      damage_type: "poison",
      damage_formula: "1d8",
      rng: () => 0
    });
    assert.equal(applied.damage_result.final_damage, 0);
  }, results);

  runTest("blur_applies_defensive_disadvantage_condition_and_concentration", () => {
    const casterId = "caster-spell-blur-001";
    const combatId = "combat-spell-blur-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["blur"]
    });
    const blur = {
      spell_id: "blur",
      name: "Blur",
      casting_time: "1 action",
      targeting: { type: "self" },
      range: "self",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: {
        status_hint: "blur"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [blur]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "blur"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "blurred"), true);
    assert.equal(Boolean(out.payload.cast_spell.concentration_started), true);
  }, results);

  runTest("longstrider_applies_speed_bonus_condition", () => {
    const casterId = "caster-spell-longstrider-001";
    const combatId = "combat-spell-longstrider-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["longstrider"]
    });
    const longstrider = {
      spell_id: "longstrider",
      name: "Longstrider",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "touch",
      attack_or_save: { type: "none" },
      effect: {
        status_hint: "longstrider",
        speed_bonus_feet: 10
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [longstrider]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "longstrider",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(out.ok, true);
    const appliedCondition = out.payload.cast_spell.applied_conditions.find((entry) => entry.condition_type === "longstrider");
    assert.equal(Boolean(appliedCondition), true);
    assert.equal(appliedCondition.metadata.speed_bonus_feet, 10);
  }, results);

  runTest("resistance_applies_save_bonus_condition_and_affects_save_resolution", () => {
    const casterId = "caster-spell-resistance-001";
    const combatId = "combat-spell-resistance-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["resistance"]
    });
    const resistance = {
      spell_id: "resistance",
      name: "Resistance",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "touch",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: {
        buff_ref: "spell_resistance_save_bonus",
        dice_bonus: "1d4"
      }
    };

    const castOut = processCombatCastSpellRequest({
      context: createCombatContext(manager, [resistance]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "resistance",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(castOut.ok, true);
    assert.equal(castOut.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "resistance"), true);

    const combat = manager.getCombatById(combatId).payload.combat;
    const saveOut = resolveSavingThrowOutcome({
      combat_state: combat,
      participant: combat.participants.find((entry) => entry.participant_id === "ally-unrelated-001"),
      save_ability: "wisdom",
      dc: 10,
      saving_throw_fn: () => ({ final_total: 9 }),
      bonus_rng: () => 0
    });

    assert.equal(saveOut.ok, true);
    assert.equal(saveOut.payload.bonus_modifier, 1);
    assert.equal(saveOut.payload.success, true);
  }, results);

  runTest("shield_can_be_cast_in_reaction_mode_and_dynamically_raises_ac", () => {
    const casterId = "caster-spell-shield-001";
    const combatId = "combat-spell-shield-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["shield"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    combat.turn_index = combat.initiative_order.indexOf("enemy-spell-001");
    manager.combats.set(combatId, combat);

    const shield = {
      spell_id: "shield",
      name: "Shield",
      casting_time: "1 reaction",
      targeting: { type: "self" },
      range: "self",
      attack_or_save: { type: "none" },
      effect: {
        defense_ref: "spell_shield_ac_bonus",
        ac_bonus: 5
      }
    };

    const castOut = processCombatCastSpellRequest({
      context: createCombatContext(manager, [shield]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "shield",
        reaction_mode: true
      }
    });

    assert.equal(castOut.ok, true);
    assert.equal(castOut.payload.cast_spell.action_cost, "reaction");
    assert.equal(castOut.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "shield"), true);

    const afterShield = manager.getCombatById(combatId).payload.combat;
    const attackOut = resolveAttackAgainstCombatState({
      combat: afterShield,
      attacker_id: "enemy-spell-001",
      target_id: casterId,
      skip_turn_validation: true,
      reaction_mode: true,
      attack_roll_fn: () => 14,
      damage_roll_fn: () => 4
    });

    assert.equal(attackOut.ok, true);
    assert.equal(attackOut.payload.target_armor_class, 17);
    assert.equal(attackOut.payload.hit, false);
  }, results);

  runTest("shield_of_faith_uses_dynamic_ac_condition_instead_of_mutating_base_ac", () => {
    const casterId = "caster-spell-shield-faith-dynamic-001";
    const combatId = "combat-spell-shield-faith-dynamic-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["shield_of_faith"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const ally = combat.participants.find((entry) => entry.participant_id === "ally-unrelated-001");
    ally.armor_class = 14;
    manager.combats.set(combatId, combat);

    const shieldOfFaith = {
      spell_id: "shield_of_faith",
      name: "Shield of Faith",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "60 feet",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: {
        defense_ref: "spell_shield_of_faith_ac_bonus",
        ac_bonus: 2
      }
    };

    const castOut = processCombatCastSpellRequest({
      context: createCombatContext(manager, [shieldOfFaith]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "shield_of_faith",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(castOut.ok, true);
    const afterCast = manager.getCombatById(combatId).payload.combat;
    const updatedAlly = afterCast.participants.find((entry) => entry.participant_id === "ally-unrelated-001");
    assert.equal(updatedAlly.armor_class, 14);
    const attackOut = resolveAttackAgainstCombatState({
      combat: afterCast,
      attacker_id: "enemy-spell-001",
      target_id: "ally-unrelated-001",
      skip_turn_validation: true,
      reaction_mode: true,
      attack_roll_fn: () => 13,
      damage_roll_fn: () => 3
    });
    assert.equal(attackOut.ok, true);
    assert.equal(attackOut.payload.target_armor_class, 16);
    assert.equal(attackOut.payload.hit, false);
  }, results);

  runTest("restrained_target_has_disadvantage_on_dexterity_saves", () => {
    const casterId = "caster-spell-restrained-save-001";
    const combatId = "combat-spell-restrained-save-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["sacred_flame"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    combat.conditions = [{
      condition_id: "condition-restrained-save-001",
      condition_type: "restrained",
      target_actor_id: "enemy-spell-001",
      expiration_trigger: "manual"
    }];
    manager.combats.set(combatId, combat);

    let seenDisadvantage = null;
    const sacredFlame = {
      spell_id: "sacred_flame",
      name: "Sacred Flame",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "save", save_ability: "dexterity" },
      damage: { dice: "1d8", damage_type: "radiant" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [sacredFlame], {
        spellSavingThrowFn: (input) => {
          seenDisadvantage = input && input.disadvantage;
          return { final_total: 20 };
        }
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "sacred_flame",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(seenDisadvantage, true);
    assert.equal(out.payload.cast_spell.save_result.disadvantage, true);
  }, results);

  runTest("dodging_target_has_advantage_on_dexterity_saves", () => {
    const casterId = "caster-spell-dodge-save-001";
    const combatId = "combat-spell-dodge-save-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["sacred_flame"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    combat.conditions = [{
      condition_id: "condition-dodging-save-001",
      condition_type: "dodging",
      target_actor_id: "enemy-spell-001",
      expiration_trigger: "start_of_turn"
    }];
    manager.combats.set(combatId, combat);

    let seenAdvantage = null;
    const sacredFlame = {
      spell_id: "sacred_flame",
      name: "Sacred Flame",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "save", save_ability: "dexterity" },
      damage: { dice: "1d8", damage_type: "radiant" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [sacredFlame], {
        spellSavingThrowFn: (input) => {
          seenAdvantage = input && input.advantage;
          return { final_total: 20 };
        }
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "sacred_flame",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(seenAdvantage, true);
    assert.equal(out.payload.cast_spell.save_result.advantage, true);
  }, results);

  runTest("participant_dodge_state_also_grants_advantage_on_dexterity_saves", () => {
    const casterId = "caster-spell-dodge-flag-001";
    const combatId = "combat-spell-dodge-flag-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["sacred_flame"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const target = combat.participants.find((entry) => entry.participant_id === "enemy-spell-001");
    target.is_dodging = true;
    manager.combats.set(combatId, combat);

    let seenAdvantage = null;
    const sacredFlame = {
      spell_id: "sacred_flame",
      name: "Sacred Flame",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "save", save_ability: "dexterity" },
      damage: { dice: "1d8", damage_type: "radiant" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [sacredFlame], {
        spellSavingThrowFn: (input) => {
          seenAdvantage = input && input.advantage;
          return { final_total: 20 };
        }
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "sacred_flame",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(seenAdvantage, true);
    assert.equal(out.payload.cast_spell.save_result.advantage, true);
  }, results);

  runTest("psychic_damage_spell_is_supported_and_persisted", () => {
    const casterId = "caster-spell-psychic-001";
    const combatId = "combat-spell-psychic-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["vicious_mockery"]
    });
    const viciousMockery = {
      spell_id: "vicious_mockery",
      name: "Vicious Mockery",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "save", save_ability: "wisdom" },
      damage: { dice: "1d4", damage_type: "psychic" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [viciousMockery], {
        spellSavingThrowFn: () => ({ final_total: 4 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "vicious_mockery",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.damage_type, "psychic");
    assert.equal(out.payload.cast_spell.damage_result.damage_type, "psychic");
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const logEntry = updatedCombat.event_log.find((entry) => entry.event_type === "cast_spell_action");
    assert.equal(logEntry.damage_type, "psychic");
  }, results);

  runTest("entangle_applies_restrained_on_failed_save", () => {
    const casterId = "caster-spell-entangle-001";
    const combatId = "combat-spell-entangle-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["entangle"]
    });
    const entangle = {
      spell_id: "entangle",
      name: "Entangle",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "90 feet",
      concentration: true,
      attack_or_save: { type: "save", save_ability: "strength" },
      applied_conditions: [
        {
          condition_type: "restrained",
          expiration_trigger: "manual",
          metadata: {
            source: "entangle"
          }
        }
      ]
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [entangle], {
        spellSavingThrowFn: () => ({ final_total: 5 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "entangle",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.saved, false);
    assert.equal(out.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "restrained"), true);
    assert.equal(Boolean(out.payload.cast_spell.concentration_started), true);
  }, results);

  runTest("blurred_target_imposes_disadvantage_on_spell_attack_rolls", () => {
    const casterId = "caster-spell-blur-attack-001";
    const combatId = "combat-spell-blur-attack-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      conditions: [{
        condition_id: "condition-blur-spell-001",
        condition_type: "blurred",
        target_actor_id: "enemy-spell-001",
        expiration_trigger: "manual",
        metadata: {
          attackers_have_disadvantage: true
        }
      }]
    });
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
        spellAttackRollFn(input) {
          assert.equal(input.disadvantage, true);
          return { final_total: 19 };
        },
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
  }, results);

  runTest("blindness_deafness_applies_blinded_on_failed_save", () => {
    const casterId = "caster-spell-blindness-001";
    const combatId = "combat-spell-blindness-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["blindness_deafness"]
    });
    const blindness = {
      spell_id: "blindness_deafness",
      name: "Blindness/Deafness",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "30 feet",
      attack_or_save: { type: "save", save_ability: "constitution" },
      effect: { status_hint: "blindness" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [blindness], {
        spellSavingThrowFn: () => ({ final_total: 4 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "blindness_deafness",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.saved, false);
    assert.equal(out.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "blinded"), true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const condition = updatedCombat.conditions.find((entry) => entry.condition_type === "blinded" && entry.target_actor_id === "enemy-spell-001");
    const turnAdvance = (updatedCombat.event_log || []).find((entry) => entry.event_type === "turn_advanced" && entry.details && Array.isArray(entry.details.end_of_turn_save_results) && entry.details.end_of_turn_save_results.length > 0);
    assert.equal(Boolean(condition) || Boolean(turnAdvance), true);
    if (condition) {
      assert.equal(condition.metadata.end_of_turn_save_ability, "constitution");
    } else {
      assert.equal(turnAdvance.details.end_of_turn_save_results[0].condition_type, "blinded");
    }
  }, results);

  runTest("bless_can_apply_to_up_to_three_allies", () => {
    const casterId = "caster-spell-bless-multi-001";
    const combatId = "combat-spell-bless-multi-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["bless"],
      extraParticipants: [
        {
          participant_id: "ally-spell-002",
          team: "heroes",
          current_hp: 12,
          max_hp: 12,
          armor_class: 12,
          position: { x: 2, y: 0 }
        },
        {
          participant_id: "ally-spell-003",
          team: "heroes",
          current_hp: 12,
          max_hp: 12,
          armor_class: 12,
          position: { x: 1, y: 1 }
        }
      ]
    });
    const bless = {
      spell_id: "bless",
      name: "Bless",
      casting_time: "1 action",
      targeting: { type: "up_to_three_allies" },
      range: "30 feet",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: {
        buff_ref: "spell_bless_attack_and_save_bonus",
        dice_bonus: "1d4"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [bless]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "bless",
        target_id: casterId,
        target_ids: [casterId, "ally-spell-002", "ally-spell-003"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.target_results.length, 3);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.equal(updatedCombat.conditions.filter((entry) => entry.condition_type === "bless").length, 3);
    assert.equal(Boolean(out.payload.cast_spell.concentration_started), true);
  }, results);

  runTest("magic_missile_can_split_projectiles_across_targets", () => {
    const casterId = "caster-spell-missile-split-001";
    const combatId = "combat-spell-missile-split-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["magic_missile"],
      extraParticipants: [
        {
          participant_id: "enemy-spell-002",
          team: "monsters",
          current_hp: 12,
          max_hp: 12,
          armor_class: 12,
          position: { x: 2, y: 0 }
        },
        {
          participant_id: "enemy-spell-003",
          team: "monsters",
          current_hp: 12,
          max_hp: 12,
          armor_class: 12,
          position: { x: 3, y: 0 }
        }
      ]
    });
    const magicMissile = {
      spell_id: "magic_missile",
      name: "Magic Missile",
      casting_time: "1 action",
      targeting: { type: "single_or_split_target" },
      range: "120 feet",
      attack_or_save: { type: "auto_hit" },
      damage: { dice: "3d4+3", damage_type: "force" },
      effect: {
        projectiles: 3,
        projectile_damage_dice: "1d4+1"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [magicMissile], {
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "magic_missile",
        target_id: "enemy-spell-001",
        target_ids: ["enemy-spell-001", "enemy-spell-002", "enemy-spell-003"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.target_results.length, 3);
    assert.equal(out.payload.cast_spell.target_results.every((entry) => entry.final_damage === 2), true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.equal(findParticipant(updatedCombat, "enemy-spell-001").current_hp, 10);
    assert.equal(findParticipant(updatedCombat, "enemy-spell-002").current_hp, 10);
    assert.equal(findParticipant(updatedCombat, "enemy-spell-003").current_hp, 10);
  }, results);

  runTest("invisibility_applies_and_breaks_on_harmful_spell_cast", () => {
    const casterId = "caster-spell-invisibility-001";
    const combatId = "combat-spell-invisibility-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["invisibility", "fire_bolt"]
    });
    const invisibility = {
      spell_id: "invisibility",
      name: "Invisibility",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "touch",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: {
        status_hint: "invisibility"
      }
    };
    const fireBolt = {
      spell_id: "fire_bolt",
      name: "Fire Bolt",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "120 feet",
      attack_or_save: { type: "spell_attack" },
      damage: { dice: "1d10", damage_type: "fire" }
    };

    const invisibilityOut = processCombatCastSpellRequest({
      context: createCombatContext(manager, [invisibility, fireBolt], {
        spellAttackRollFn: () => ({ final_total: 20 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "invisibility",
        target_id: casterId
      }
    });

    assert.equal(invisibilityOut.ok, true);
    assert.equal(invisibilityOut.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "invisible"), true);

    const combatAfterInvisibility = manager.getCombatById(combatId).payload.combat;
    const caster = findParticipant(combatAfterInvisibility, casterId);
    caster.action_available = true;
    combatAfterInvisibility.turn_index = combatAfterInvisibility.initiative_order.indexOf(casterId);
    manager.combats.set(combatId, combatAfterInvisibility);

    const harmfulOut = processCombatCastSpellRequest({
      context: createCombatContext(manager, [invisibility, fireBolt], {
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

    assert.equal(harmfulOut.ok, true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const invisibilityCondition = (updatedCombat.conditions || []).find((entry) => {
      return String(entry && entry.condition_type || "") === "invisible" &&
        String(entry && entry.target_actor_id || "") === String(casterId);
    });
    assert.equal(Boolean(invisibilityCondition), false);
  }, results);

  runTest("charm_person_applies_charmed_on_failed_save", () => {
    const casterId = "caster-spell-charm-001";
    const combatId = "combat-spell-charm-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["charm_person"]
    });
    const charmPerson = {
      spell_id: "charm_person",
      name: "Charm Person",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "30 feet",
      attack_or_save: { type: "save", save_ability: "wisdom" },
      effect: { status_hint: "charm_person" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [charmPerson], {
        spellSavingThrowFn: () => ({ final_total: 4 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "charm_person",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.saved, false);
    assert.equal(out.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "charmed"), true);
  }, results);

  runTest("fear_applies_frightened_and_starts_concentration_on_failed_save", () => {
    const casterId = "caster-spell-fear-001";
    const combatId = "combat-spell-fear-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["fear"]
    });
    const fear = {
      spell_id: "fear",
      name: "Fear",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "30 feet",
      concentration: true,
      attack_or_save: { type: "save", save_ability: "wisdom" },
      effect: { status_hint: "fear" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [fear], {
        spellSavingThrowFn: () => ({ final_total: 4 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "fear",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.saved, false);
    assert.equal(out.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "frightened"), true);
    assert.equal(Boolean(out.payload.cast_spell.concentration_started), true);
  }, results);

  runTest("charmed_caster_cannot_target_charmer_with_harmful_spell", () => {
    const casterId = "caster-spell-charmed-block-001";
    const combatId = "combat-spell-charmed-block-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["fire_bolt"],
      extraParticipants: [
        {
          participant_id: "charmer-001",
          team: "monsters",
          current_hp: 12,
          max_hp: 12,
          armor_class: 12,
          position: { x: 2, y: 0 }
        }
      ]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    combat.conditions = [
      {
        condition_id: "condition-charmed-caster-001",
        condition_type: "charmed",
        source_actor_id: "charmer-001",
        target_actor_id: casterId,
        expiration_trigger: "manual",
        metadata: {
          cannot_target_actor_ids: ["charmer-001"]
        }
      }
    ];
    manager.combats.set(combatId, combat);
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
        target_id: "charmer-001"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "charmed participants cannot target the charmer with harmful spells");
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
