"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { startCombat } = require("../flow/startCombat");
const { processCombatCastSpellRequest } = require("../flow/processCombatActionRequest");
const { performCastSpellAction } = require("../actions/castSpellAction");
const { applyDamageToCombatState } = require("../damage/apply-damage-to-combat-state");
const { applyConditionToCombatState } = require("../conditions/conditionHelpers");
const { resolveAttackAgainstCombatState } = require("../actions/attackAction");
const { resolveSavingThrowOutcome } = require("../spells/spellcastingHelpers");
const { canParticipantReact } = require("../reactions/reactionState");
const spellContent = require("../../../world-system/src/content/data/Spells.json");

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

function getSpellEntry(spellId) {
  const entries = Array.isArray(spellContent && spellContent.entries) ? spellContent.entries : [];
  return clone(entries.find((entry) => String(entry && entry.id || "") === String(spellId || "")));
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

  runTest("true_strike_applies_pending_condition_and_starts_concentration", () => {
    const casterId = "caster-spell-true-strike-001";
    const combatId = "combat-spell-true-strike-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["true_strike"]
    });
    const trueStrike = {
      spell_id: "true_strike",
      name: "True Strike",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "30 feet",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: { status_hint: "true_strike_advantage" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [trueStrike]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "true_strike",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    const pending = out.payload.cast_spell.applied_conditions.find((entry) => entry.condition_type === "true_strike_pending");
    assert.equal(Boolean(pending), true);
    assert.equal(pending.metadata.prepared_target_actor_id, "enemy-spell-001");
    const combat = manager.getCombatById(combatId).payload.combat;
    const caster = findParticipant(combat, casterId);
    assert.equal(caster.concentration.is_concentrating, true);
    assert.equal(caster.concentration.source_spell_id, "true_strike");
  }, results);

  runTest("color_spray_blinds_lowest_hp_targets_until_hp_pool_is_spent", () => {
    const casterId = "caster-spell-color-spray-001";
    const combatId = "combat-spell-color-spray-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["color_spray"],
      extraParticipants: [
        {
          participant_id: "enemy-spell-002",
          team: "monsters",
          current_hp: 4,
          max_hp: 4,
          armor_class: 12,
          position: { x: 2, y: 0 }
        },
        {
          participant_id: "enemy-spell-003",
          team: "monsters",
          current_hp: 7,
          max_hp: 7,
          armor_class: 12,
          position: { x: 3, y: 0 }
        }
      ]
    });
    const colorSpray = {
      spell_id: "color_spray",
      name: "Color Spray",
      casting_time: "1 action",
      range: "self",
      targeting: { type: "cone_15ft" },
      attack_or_save: { type: "none" },
      effect: {
        status_hint: "color_spray_blind_hp_pool",
        hp_pool_formula: "6d10",
        targeting: "area"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [colorSpray], {
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "color_spray",
        target_ids: ["enemy-spell-001", "enemy-spell-002", "enemy-spell-003"],
        area_tiles: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.vitality_result.hp_pool_total, 6);
    assert.equal(out.payload.cast_spell.applied_conditions.length, 1);
    assert.equal(out.payload.cast_spell.applied_conditions[0].target_actor_id, "enemy-spell-002");
    const targetResults = out.payload.cast_spell.target_results;
    assert.equal(targetResults.find((entry) => entry.target_id === "enemy-spell-002").affected, true);
    assert.equal(targetResults.find((entry) => entry.target_id === "enemy-spell-003").affected, false);
  }, results);

  runTest("sleep_applies_unconscious_to_lowest_hp_targets_until_hp_pool_is_spent", () => {
    const casterId = "caster-spell-sleep-001";
    const combatId = "combat-spell-sleep-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["sleep"],
      extraParticipants: [
        {
          participant_id: "enemy-spell-002",
          team: "monsters",
          current_hp: 4,
          max_hp: 4,
          armor_class: 12,
          position: { x: 2, y: 0 }
        },
        {
          participant_id: "enemy-spell-003",
          team: "monsters",
          current_hp: 9,
          max_hp: 9,
          armor_class: 12,
          position: { x: 3, y: 0 }
        }
      ]
    });
    const sleep = {
      spell_id: "sleep",
      name: "Sleep",
      casting_time: "1 action",
      range: "90 feet",
      targeting: { type: "sphere_20ft" },
      attack_or_save: { type: "none" },
      effect: {
        status_hint: "sleep_hp_pool",
        hp_pool_formula: "5d8",
        targeting: "area"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [sleep], {
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "sleep",
        target_ids: ["enemy-spell-001", "enemy-spell-002", "enemy-spell-003"],
        area_tiles: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.vitality_result.hp_pool_total, 5);
    assert.equal(out.payload.cast_spell.applied_conditions.length, 1);
    assert.equal(out.payload.cast_spell.applied_conditions[0].condition_type, "unconscious");
    assert.equal(out.payload.cast_spell.applied_conditions[0].target_actor_id, "enemy-spell-002");
    const targetResults = out.payload.cast_spell.target_results;
    assert.equal(targetResults.find((entry) => entry.target_id === "enemy-spell-002").affected, true);
    assert.equal(targetResults.find((entry) => entry.target_id === "enemy-spell-003").affected, false);
  }, results);

  runTest("power_word_stun_applies_stunned_when_target_is_under_hp_threshold", () => {
    const casterId = "caster-spell-power-word-stun-001";
    const combatId = "combat-spell-power-word-stun-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["power_word_stun"],
      extraParticipants: [{
        participant_id: "enemy-spell-pws-001",
        team: "monsters",
        current_hp: 120,
        max_hp: 120,
        armor_class: 12,
        position: { x: 2, y: 0 }
      }]
    });
    const spell = {
      spell_id: "power_word_stun",
      name: "Power Word Stun",
      casting_time: "1 action",
      range: "60 feet",
      targeting: { type: "single_target" },
      attack_or_save: { type: "none" },
      effect: { status_hint: "power_word_stun_hp_gate", targeting: "single" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [spell]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "power_word_stun",
        target_id: "enemy-spell-pws-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.applied_conditions.length, 1);
    assert.equal(out.payload.cast_spell.applied_conditions[0].condition_type, "stunned");
    assert.equal(out.payload.cast_spell.target_results[0].affected, true);
  }, results);

  runTest("power_word_kill_kills_target_when_under_hp_threshold", () => {
    const casterId = "caster-spell-power-word-kill-001";
    const combatId = "combat-spell-power-word-kill-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["power_word_kill"],
      extraParticipants: [{
        participant_id: "enemy-spell-pwk-001",
        team: "monsters",
        current_hp: 90,
        max_hp: 90,
        armor_class: 12,
        position: { x: 2, y: 0 }
      }]
    });
    const spell = {
      spell_id: "power_word_kill",
      name: "Power Word Kill",
      casting_time: "1 action",
      range: "60 feet",
      targeting: { type: "single_target" },
      attack_or_save: { type: "none" },
      effect: { status_hint: "power_word_kill_hp_gate", targeting: "single" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [spell]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "power_word_kill",
        target_id: "enemy-spell-pwk-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.vitality_result.killed, true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const target = updatedCombat.participants.find((entry) => entry.participant_id === "enemy-spell-pwk-001");
    assert.equal(target.current_hp, 0);
    assert.equal(String(target.life_state || "").toLowerCase(), "dead");
  }, results);

  runTest("command_applies_pending_grovel_condition_on_failed_save", () => {
    const casterId = "caster-spell-command-001";
    const combatId = "combat-spell-command-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["command"]
    });
    const spell = {
      spell_id: "command",
      name: "Command",
      casting_time: "1 action",
      range: "60 feet",
      targeting: { type: "single_target" },
      attack_or_save: { type: "save", save_ability: "wisdom" },
      effect: { status_hint: "command_forced_action", targeting: "single" }
    };

    const out = performCastSpellAction({
      combatManager: manager,
      combat_id: combatId,
      caster_id: casterId,
      target_id: "enemy-spell-001",
      target_ids: ["enemy-spell-001"],
      command_word: "grovel",
      spell,
      saving_throw_fn: () => ({ final_total: 4 })
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.target_results[0].command_word, "grovel");
    assert.equal(out.payload.combat.conditions.some((entry) => entry.target_actor_id === "enemy-spell-001" && entry.condition_type === "command_pending"), true);
  }, results);

  runTest("command_requires_supported_command_word_selection", () => {
    const casterId = "caster-spell-command-002";
    const combatId = "combat-spell-command-002";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["command"]
    });
    const spell = {
      spell_id: "command",
      name: "Command",
      casting_time: "1 action",
      range: "60 feet",
      targeting: { type: "single_target" },
      attack_or_save: { type: "save", save_ability: "wisdom" },
      effect: { status_hint: "command_forced_action", targeting: "single" }
    };

    const out = performCastSpellAction({
      combatManager: manager,
      combat_id: combatId,
      caster_id: casterId,
      target_id: "enemy-spell-001",
      target_ids: ["enemy-spell-001"],
      command_word: "drop",
      spell,
      saving_throw_fn: () => ({ final_total: 4 })
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "command requires a supported command word selection");
  }, results);

  runTest("hypnotic_pattern_applies_incapacitated_until_damage_breaks_the_effect", () => {
    const casterId = "caster-spell-hypnotic-001";
    const combatId = "combat-spell-hypnotic-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["hypnotic_pattern"]
    });
    const spell = {
      spell_id: "hypnotic_pattern",
      name: "Hypnotic Pattern",
      casting_time: "1 action",
      range: "120 feet",
      targeting: { type: "cube_15ft" },
      concentration: true,
      attack_or_save: { type: "save", save_ability: "wisdom" },
      effect: { status_hint: "hypnotic_pattern_charm_incapacitate", targeting: "area" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [spell], {
        spellSavingThrowFn: () => ({ final_total: 4 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "hypnotic_pattern",
        target_ids: ["ally-unrelated-001"],
        area_tiles: [{ x: 0, y: 1 }, { x: 1, y: 1 }]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "incapacitated"), true);

    const damaged = applyDamageToCombatState({
      combat_state: manager.getCombatById(combatId).payload.combat,
      target_participant_id: "ally-unrelated-001",
      damage_type: "force",
      flat_damage: 1
    });
    const targetConditions = Array.isArray(damaged.next_state.conditions) ? damaged.next_state.conditions : [];
    assert.equal(targetConditions.some((entry) => entry.target_actor_id === "ally-unrelated-001" && entry.condition_type === "incapacitated"), false);
  }, results);

  runTest("calm_emotions_removes_charmed_and_frightened_from_failed_targets", () => {
    const casterId = "caster-spell-calm-001";
    const combatId = "combat-spell-calm-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["calm_emotions"],
      conditions: [{
        condition_id: "condition-fear-001",
        condition_type: "frightened",
        source_actor_id: "enemy-spell-001",
        target_actor_id: "enemy-spell-001",
        expiration_trigger: "manual",
        metadata: {}
      }, {
        condition_id: "condition-charm-001",
        condition_type: "charmed",
        source_actor_id: casterId,
        target_actor_id: "enemy-spell-001",
        expiration_trigger: "manual",
        metadata: {
          cannot_target_actor_ids: [casterId]
        }
      }]
    });
    const spell = {
      spell_id: "calm_emotions",
      name: "Calm Emotions",
      casting_time: "1 action",
      range: "60 feet",
      targeting: { type: "sphere_20ft" },
      concentration: true,
      attack_or_save: { type: "save", save_ability: "charisma" },
      effect: { status_hint: "calm_emotions_suppression", targeting: "area" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [spell], {
        spellSavingThrowFn: () => ({ final_total: 4 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "calm_emotions",
        target_ids: ["enemy-spell-001"],
        area_tiles: [{ x: 1, y: 0 }, { x: 2, y: 0 }]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.target_results[0].removed_conditions.length, 2);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.equal(updatedCombat.conditions.some((entry) => entry.target_actor_id === "enemy-spell-001" && (entry.condition_type === "frightened" || entry.condition_type === "charmed")), false);
    assert.equal(updatedCombat.conditions.some((entry) => entry.target_actor_id === "enemy-spell-001" && entry.condition_type === "calm_emotions"), true);
  }, results);

  runTest("banishment_applies_banished_condition_on_failed_save", () => {
    const casterId = "caster-spell-banish-001";
    const combatId = "combat-spell-banish-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["banishment"]
    });
    const spell = {
      spell_id: "banishment",
      name: "Banishment",
      casting_time: "1 action",
      range: "60 feet",
      targeting: { type: "single_target" },
      concentration: true,
      attack_or_save: { type: "save", save_ability: "charisma" },
      effect: { status_hint: "banishment", targeting: "single" }
    };

    const out = performCastSpellAction({
      combatManager: manager,
      combat_id: combatId,
      caster_id: casterId,
      target_id: "ally-unrelated-001",
      target_ids: ["ally-unrelated-001"],
      spell,
      saving_throw_fn: () => ({ final_total: 4 })
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.applied_conditions.some((entry) => entry.condition_type === "banished"), true);
  }, results);

  runTest("confusion_applies_condition_with_end_of_turn_wisdom_save_metadata", () => {
    const casterId = "caster-spell-confusion-001";
    const combatId = "combat-spell-confusion-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["confusion"]
    });
    const spell = {
      spell_id: "confusion",
      name: "Confusion",
      casting_time: "1 action",
      range: "90 feet",
      targeting: { type: "sphere_10ft" },
      concentration: true,
      attack_or_save: { type: "save", save_ability: "wisdom" },
      effect: { status_hint: "confusion", targeting: "area" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [spell], {
        spellSavingThrowFn: () => ({ final_total: 4 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "confusion",
        target_ids: ["enemy-spell-001"],
        area_tiles: [{ x: 1, y: 0 }]
      }
    });

    assert.equal(out.ok, true);
    const applied = out.payload.cast_spell.applied_conditions.find((entry) => entry.condition_type === "confusion");
    assert.equal(Boolean(applied), true);
    assert.equal(applied.metadata.blocks_reaction, true);
    assert.equal(applied.metadata.end_of_turn_save_ability, "wisdom");
  }, results);

  runTest("beacon_of_hope_maximizes_healing_for_affected_targets", () => {
    const casterId = "caster-spell-beacon-001";
    const combatId = "combat-spell-beacon-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["cure_wounds"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const ally = combat.participants.find((entry) => entry.participant_id === "ally-unrelated-001");
    ally.current_hp = 1;
    combat.conditions = [{
      condition_id: "condition-beacon-of-hope-001",
      condition_type: "beacon_of_hope",
      source_actor_id: casterId,
      target_actor_id: "ally-unrelated-001",
      expiration_trigger: "manual",
      metadata: {
        maximize_healing_received: true,
        death_save_advantage: true,
        save_advantage_abilities: ["wisdom"]
      }
    }];
    manager.combats.set(combatId, combat);

    const cure = {
      spell_id: "cure_wounds",
      name: "Cure Wounds",
      casting_time: "1 action",
      range: "Touch",
      targeting: { type: "single_target" },
      attack_or_save: { type: "none" },
      healing: {
        dice: "1d8",
        bonus: "spellcasting_ability_modifier"
      },
      effect: { targeting: "single" }
    };
    const second = processCombatCastSpellRequest({
      context: createCombatContext(manager, [cure], {
        spellHealingRollFn: () => ({
          total: 4,
          rolls: [4],
          modifier: 3
        })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "cure_wounds",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(second.ok, true);
    assert.equal(second.payload.cast_spell.healing_result.maximize_healing, true);
    assert.equal(second.payload.cast_spell.healing_result.healing_total, 11);
  }, results);

  runTest("freedom_of_movement_applies_supported_mobility_condition", () => {
    const casterId = "caster-spell-freedom-001";
    const combatId = "combat-spell-freedom-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["freedom_of_movement"]
    });
    const freedom = {
      spell_id: "freedom_of_movement",
      name: "Freedom of Movement",
      casting_time: "1 action",
      range: "Touch",
      targeting: { type: "single_target" },
      attack_or_save: { type: "none" },
      effect: { status_hint: "freedom_of_movement", targeting: "single" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [freedom]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "freedom_of_movement",
        target_ids: ["ally-unrelated-001"]
      }
    });

    assert.equal(out.ok, true);
    const applied = out.payload.cast_spell.applied_conditions.find((entry) => entry.condition_type === "freedom_of_movement");
    assert.equal(Boolean(applied), true);
    assert.equal(applied.metadata.ignore_difficult_terrain, true);
    assert.equal(applied.metadata.escape_grapple_auto_success, true);
  }, results);

  runTest("target_scoped_true_strike_advantage_applies_to_spell_attack_and_is_consumed", () => {
    const casterId = "caster-spell-true-strike-spell-001";
    const combatId = "combat-spell-true-strike-spell-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["fire_bolt"],
      conditions: [{
        condition_id: "condition-true-strike-spell-001",
        condition_type: "true_strike_advantage",
        source_actor_id: casterId,
        target_actor_id: casterId,
        expiration_trigger: "start_of_source_turn",
        duration: {
          remaining_triggers: 1
        },
        metadata: {
          has_attack_advantage: true,
          consume_on_attack: true,
          applies_against_actor_ids: ["enemy-spell-001"]
        }
      }]
    });
    const fireBolt = {
      spell_id: "fire_bolt",
      name: "Fire Bolt",
      casting_time: "1 action",
      range: "120 feet",
      targeting: { type: "single_target" },
      attack_or_save: { type: "spell_attack" },
      damage: { dice: "1d10", damage_type: "fire" }
    };
    let sawAdvantage = false;

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [fireBolt], {
        spellAttackRollFn: ({ advantage }) => {
          sawAdvantage = advantage === true;
          return { final_total: 18 };
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
    assert.equal(sawAdvantage, true);
    const combat = manager.getCombatById(combatId).payload.combat;
    assert.equal(combat.conditions.some((entry) => String(entry && entry.condition_type || "") === "true_strike_advantage"), false);
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

  runTest("thunderwave_pushes_target_two_tiles_on_failed_save_when_path_is_clear", () => {
    const casterId = "caster-spell-thunderwave-push-001";
    const combatId = "combat-spell-thunderwave-push-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["thunderwave"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    findParticipant(combat, casterId).position = { x: 1, y: 1 };
    findParticipant(combat, "enemy-spell-001").position = { x: 2, y: 1 };
    manager.combats.set(combatId, combat);
    const thunderwave = {
      spell_id: "thunderwave",
      name: "Thunderwave",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "15 feet",
      attack_or_save: { type: "save", save_ability: "constitution" },
      save_outcome: "half",
      damage: { dice: "2d8", damage_type: "thunder" },
      effect: { status_hint: "push_10_feet_on_fail" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [thunderwave], {
        spellSavingThrowFn: () => ({ final_total: 4 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "thunderwave",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.saved, false);
    assert.equal(out.payload.cast_spell.forced_movement_result.moved, true);
    assert.equal(out.payload.cast_spell.forced_movement_result.tiles_moved, 2);
    assert.deepEqual(out.payload.cast_spell.forced_movement_result.to_position, { x: 4, y: 1 });
  }, results);

  runTest("thunderwave_does_not_push_target_on_successful_save", () => {
    const casterId = "caster-spell-thunderwave-save-001";
    const combatId = "combat-spell-thunderwave-save-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["thunderwave"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    findParticipant(combat, casterId).position = { x: 1, y: 1 };
    findParticipant(combat, "enemy-spell-001").position = { x: 2, y: 1 };
    manager.combats.set(combatId, combat);
    const thunderwave = {
      spell_id: "thunderwave",
      name: "Thunderwave",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "15 feet",
      attack_or_save: { type: "save", save_ability: "constitution" },
      save_outcome: "half",
      damage: { dice: "2d8", damage_type: "thunder" },
      effect: { status_hint: "push_10_feet_on_fail" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [thunderwave], {
        spellSavingThrowFn: () => ({ final_total: 20 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "thunderwave",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.saved, true);
    assert.equal(out.payload.cast_spell.forced_movement_result, null);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.deepEqual(findParticipant(updatedCombat, "enemy-spell-001").position, { x: 2, y: 1 });
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
      effect: { status_hint: "hold_person_disable" }
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
    const applied = out.payload.cast_spell.applied_conditions.find((entry) => entry.condition_type === "paralyzed");
    assert.equal(Boolean(applied), true);
    assert.equal(applied.metadata.end_of_turn_save_ability, "wisdom");
    assert.equal(applied.metadata.end_of_turn_save_dc, 13);
    assert.equal(Boolean(out.payload.cast_spell.concentration_started), true);
    const waitEvent = (out.payload.cast_spell.combat.event_log || []).find((entry) => {
      return entry.event_type === "monster_ai_wait" && entry.actor_id === "enemy-spell-001" && entry.reason === "paralyzed";
    });
    assert.equal(Boolean(waitEvent), true);
  }, results);

  runTest("hold_monster_applies_paralyzed_condition_on_failed_save", () => {
    const casterId = "caster-spell-hold-monster-001";
    const combatId = "combat-spell-hold-monster-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["hold_monster"]
    });
    const holdMonster = {
      spell_id: "hold_monster",
      name: "Hold Monster",
      casting_time: "1 action",
      concentration: true,
      targeting: { type: "single_target" },
      range: "90 feet",
      attack_or_save: { type: "save", save_ability: "wisdom" },
      effect: { status_hint: "hold_monster" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [holdMonster], {
        spellSavingThrowFn: () => ({ final_total: 5 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "hold_monster",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    const applied = out.payload.cast_spell.applied_conditions.find((entry) => entry.condition_type === "paralyzed");
    assert.equal(Boolean(applied), true);
    assert.equal(applied.metadata.end_of_turn_save_ability, "wisdom");
    assert.equal(Boolean(out.payload.cast_spell.concentration_started), true);
  }, results);

  runTest("flesh_to_stone_applies_restrained_progression_condition_on_failed_save", () => {
    const casterId = "caster-spell-flesh-stone-001";
    const combatId = "combat-spell-flesh-stone-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["flesh_to_stone"]
    });

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("flesh_to_stone")], {
        spellSavingThrowFn: () => ({ final_total: 4 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "flesh_to_stone",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    const applied = out.payload.cast_spell.applied_conditions.find((entry) => entry.condition_type === "restrained");
    assert.equal(Boolean(applied), true);
    assert.equal(applied.metadata.status_hint, "flesh_to_stone");
    assert.equal(applied.metadata.flesh_to_stone_failures, 1);
    assert.equal(applied.metadata.end_of_turn_save_ability, "constitution");
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

  runTest("greater_restoration_removes_supported_condition_from_target", () => {
    const casterId = "caster-spell-greater-restoration-001";
    const combatId = "combat-spell-greater-restoration-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["greater_restoration"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    combat.conditions = [{
      condition_id: "condition-petrified-001",
      condition_type: "petrified",
      target_actor_id: "ally-unrelated-001",
      source_actor_id: "enemy-spell-001",
      expiration_trigger: "manual",
      duration: {},
      metadata: {}
    }];
    manager.combats.set(combatId, combat);

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("greater_restoration")]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "greater_restoration",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.removed_conditions.some((entry) => entry.condition_type === "petrified"), true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.equal(updatedCombat.conditions.some((entry) => entry.condition_type === "petrified" && entry.target_actor_id === "ally-unrelated-001"), false);
  }, results);

  runTest("remove_curse_removes_bestow_curse_from_target", () => {
    const casterId = "caster-spell-remove-curse-001";
    const combatId = "combat-spell-remove-curse-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["remove_curse"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    combat.conditions = [{
      condition_id: "condition-bestow-curse-001",
      condition_type: "bestow_curse",
      target_actor_id: "ally-unrelated-001",
      source_actor_id: "enemy-spell-001",
      expiration_trigger: "manual",
      duration: {},
      metadata: {}
    }];
    manager.combats.set(combatId, combat);

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("remove_curse")]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "remove_curse",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.removed_conditions.some((entry) => entry.condition_type === "bestow_curse"), true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.equal(updatedCombat.conditions.some((entry) => entry.condition_type === "bestow_curse" && entry.target_actor_id === "ally-unrelated-001"), false);
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
              immunity_tags: ["poisoned"],
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
    const blockedPoison = applyConditionToCombatState(updatedCombat, {
      condition_type: "poisoned",
      source_actor_id: "enemy-spell-001",
      target_actor_id: "ally-unrelated-001",
      applied_at_round: 1,
      expiration_trigger: "manual"
    });
    assert.equal(blockedPoison.prevented, true);
    assert.equal(blockedPoison.next_state.conditions.some((entry) => entry.condition_type === "poisoned" && entry.target_actor_id === "ally-unrelated-001"), false);
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

  runTest("shillelagh_applies_self_weapon_empower_condition_for_valid_club", () => {
    const casterId = "caster-spell-shillelagh-001";
    const combatId = "combat-spell-shillelagh-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["shillelagh"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const caster = findParticipant(combat, casterId);
    caster.bonus_action_available = true;
    caster.readiness = {
      weapon_profile: {
        item_id: "item_club",
        item_name: "Club",
        weapon: {
          damage_dice: "1d4",
          damage_type: "bludgeoning",
          properties: ["light"]
        }
      }
    };
    manager.combats.set(combatId, combat);

    const shillelagh = {
      spell_id: "shillelagh",
      name: "Shillelagh",
      casting_time: "1 bonus action",
      targeting: { type: "self" },
      range: "touch",
      duration: "1 minute",
      concentration: false,
      attack_or_save: { type: "none" },
      effect: {
        utility_ref: "spell_shillelagh_weapon_empower",
        targeting: "self"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [shillelagh]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "shillelagh",
        target_ids: [casterId]
      }
    });

    assert.equal(out.ok, true);
    const condition = out.payload.cast_spell.applied_conditions.find((entry) => entry.condition_type === "shillelagh");
    assert.ok(condition);
    assert.equal(condition.metadata.override_attack_bonus_source, "spell_attack_bonus");
    assert.equal(condition.metadata.override_damage_formula, "1d8");
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const updatedCaster = findParticipant(updatedCombat, casterId);
    assert.equal(updatedCaster.bonus_action_available, false);
  }, results);

  runTest("shillelagh_rejects_cast_without_valid_weapon_equipped", () => {
    const casterId = "caster-spell-shillelagh-invalid-001";
    const combatId = "combat-spell-shillelagh-invalid-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["shillelagh"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const caster = findParticipant(combat, casterId);
    caster.bonus_action_available = true;
    caster.readiness = {
      weapon_profile: {
        item_id: "item_dagger",
        item_name: "Dagger",
        weapon: {
          damage_dice: "1d4",
          damage_type: "piercing",
          properties: ["finesse", "light", "thrown"]
        }
      }
    };
    manager.combats.set(combatId, combat);

    const shillelagh = {
      spell_id: "shillelagh",
      name: "Shillelagh",
      casting_time: "1 bonus action",
      targeting: { type: "self" },
      range: "touch",
      duration: "1 minute",
      concentration: false,
      attack_or_save: { type: "none" },
      effect: {
        utility_ref: "spell_shillelagh_weapon_empower",
        targeting: "self"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [shillelagh]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "shillelagh",
        target_ids: [casterId]
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "shillelagh requires a club or quarterstaff equipped");
  }, results);

  runTest("expeditious_retreat_applies_bonus_dash_condition_and_starts_concentration", () => {
    const casterId = "caster-spell-expeditious-retreat-001";
    const combatId = "combat-spell-expeditious-retreat-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["expeditious_retreat"]
    });
    const expeditiousRetreat = {
      spell_id: "expeditious_retreat",
      name: "Expeditious Retreat",
      casting_time: "1 bonus action",
      targeting: { type: "self" },
      range: "self",
      duration: "concentration, up to 10 minutes",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: {
        status_hint: "expeditious_retreat_dash_bonus",
        targeting: "self"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [expeditiousRetreat]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "expeditious_retreat",
        target_ids: [casterId]
      }
    });

    assert.equal(out.ok, true);
    const condition = out.payload.cast_spell.applied_conditions.find((entry) => entry.condition_type === "expeditious_retreat");
    assert.ok(condition);
    assert.equal(condition.metadata.allow_dash_as_bonus_action, true);
    assert.equal(out.payload.cast_spell.concentration_required, true);
    assert.equal(out.payload.cast_spell.concentration_started.source_spell_id, "expeditious_retreat");
  }, results);

  runTest("haste_applies_speed_ac_and_dex_save_benefits", () => {
    const casterId = "caster-spell-haste-001";
    const combatId = "combat-spell-haste-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["haste"]
    });
    const haste = {
      spell_id: "haste",
      name: "Haste",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "30 feet",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: {
        status_hint: "haste"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [haste]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "haste",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(out.ok, true);
    const appliedCondition = out.payload.cast_spell.applied_conditions.find((entry) => entry.condition_type === "haste");
    assert.equal(Boolean(appliedCondition), true);
    assert.equal(appliedCondition.metadata.armor_class_bonus, 2);
    assert.equal(appliedCondition.metadata.speed_bonus_feet, 30);
    const combat = manager.getCombatById(combatId).payload.combat;
    const saveOut = resolveSavingThrowOutcome({
      combat_state: combat,
      participant: combat.participants.find((entry) => entry.participant_id === "ally-unrelated-001"),
      save_ability: "dexterity",
      dc: 15,
      saving_throw_fn: ({ advantage }) => {
        assert.equal(advantage, true);
        return { final_total: 12 };
      }
    });
    assert.equal(saveOut.ok, true);
  }, results);

  runTest("slow_can_apply_conditions_across_up_to_six_enemy_targets_and_blocks_reactions", () => {
    const casterId = "caster-spell-slow-001";
    const combatId = "combat-spell-slow-001";
    const extraEnemyIds = ["enemy-spell-002", "enemy-spell-003", "enemy-spell-004", "enemy-spell-005", "enemy-spell-006"];
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["slow"],
      extraParticipants: extraEnemyIds.map((id, index) => ({
        participant_id: id,
        team: "monsters",
        current_hp: 20,
        max_hp: 20,
        armor_class: 12,
        position: { x: index + 2, y: 2 },
        wisdom_save_modifier: 0,
        dexterity_save_modifier: 0
      }))
    });
    const slow = {
      spell_id: "slow",
      name: "Slow",
      casting_time: "1 action",
      targeting: { type: "up_to_six_enemies" },
      range: "120 feet",
      concentration: true,
      attack_or_save: { type: "save", save_ability: "wisdom" },
      effect: {
        status_hint: "slow",
        targeting: "multi_target"
      }
    };

    const targetIds = ["enemy-spell-001"].concat(extraEnemyIds);
    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [slow], {
        spellSavingThrowFn: () => ({ final_total: 5 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "slow",
        target_id: "enemy-spell-001",
        target_ids: targetIds
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.target_results.length, 6);
    assert.equal(out.payload.cast_spell.applied_conditions.filter((entry) => entry.condition_type === "slow").length, 6);
    const combat = manager.getCombatById(combatId).payload.combat;
    assert.equal(canParticipantReact(combat, "enemy-spell-001"), false);
  }, results);

  runTest("slow_blocks_bonus_action_after_action_has_been_used", () => {
    const casterId = "caster-spell-slow-lock-001";
    const combatId = "combat-spell-slow-lock-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["slow"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const slowedTarget = findParticipant(combat, "enemy-spell-001");
    slowedTarget.action_available = false;
    slowedTarget.bonus_action_available = true;
    slowedTarget.reaction_available = true;
    combat.conditions.push({
      condition_id: "condition-slow-lock-001",
      condition_type: "slow",
      source_actor_id: casterId,
      target_actor_id: "enemy-spell-001",
      expiration_trigger: "manual",
      metadata: {
        forbid_action_and_bonus_same_turn: true,
        apply_no_reaction: true
      }
    });
    const healingWord = {
      spell_id: "healing_word",
      name: "Healing Word",
      casting_time: "1 bonus action",
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "none" },
      healing: { formula: "1d4", ability_mod: true }
    };
    const caster = findParticipant(combat, "enemy-spell-001");
    caster.team = "ally";
    caster.spellbook = {
      known_spell_ids: ["healing_word"]
    };
    combat.turn_index = combat.initiative_order.indexOf("enemy-spell-001");
    manager.combats.set(combatId, combat);

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [healingWord]),
      player_id: "enemy-spell-001",
      combat_id: combatId,
      payload: {
        spell_id: "healing_word",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "cannot take a bonus action after using an action this turn");
  }, results);

  runTest("slow_can_block_spellcasting_when_spellcast_gate_roll_fails", () => {
    const casterId = "caster-spell-slow-cast-fail-001";
    const combatId = "combat-spell-slow-cast-fail-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["slow"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const slowedCaster = findParticipant(combat, "enemy-spell-001");
    slowedCaster.team = "heroes";
    slowedCaster.spellbook = {
      known_spell_ids: ["fire_bolt"]
    };
    slowedCaster.spell_attack_bonus = 5;
    combat.turn_index = combat.initiative_order.indexOf("enemy-spell-001");
    combat.conditions.push({
      condition_id: "condition-slow-cast-gate-001",
      condition_type: "slow",
      source_actor_id: casterId,
      target_actor_id: "enemy-spell-001",
      expiration_trigger: "manual",
      metadata: {
        speed_penalty_feet: 20,
        armor_class_bonus: -2,
        save_penalty_by_ability: { dexterity: 2 },
        has_attack_disadvantage: true,
        apply_no_reaction: true,
        forbid_action_and_bonus_same_turn: true,
        spellcast_roll_minimum: 11
      }
    });
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
        spellcastCheckFn: () => ({ rolled_value: 7 })
      }),
      player_id: "enemy-spell-001",
      combat_id: combatId,
      payload: {
        spell_id: "fire_bolt",
        target_id: casterId
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "spell casting fails under the effects of slow");
    assert.equal(out.payload.spellcast_gate.rolled_value, 7);
    assert.equal(out.payload.spellcast_gate.minimum_roll, 11);
  }, results);

  runTest("slow_allows_spellcasting_when_spellcast_gate_roll_succeeds", () => {
    const casterId = "caster-spell-slow-cast-pass-001";
    const combatId = "combat-spell-slow-cast-pass-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["slow"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const slowedCaster = findParticipant(combat, "enemy-spell-001");
    slowedCaster.team = "heroes";
    slowedCaster.spellbook = {
      known_spell_ids: ["fire_bolt"]
    };
    slowedCaster.spell_attack_bonus = 5;
    combat.turn_index = combat.initiative_order.indexOf("enemy-spell-001");
    combat.conditions.push({
      condition_id: "condition-slow-cast-gate-002",
      condition_type: "slow",
      source_actor_id: casterId,
      target_actor_id: "enemy-spell-001",
      expiration_trigger: "manual",
      metadata: {
        speed_penalty_feet: 20,
        armor_class_bonus: -2,
        save_penalty_by_ability: { dexterity: 2 },
        has_attack_disadvantage: true,
        apply_no_reaction: true,
        forbid_action_and_bonus_same_turn: true,
        spellcast_roll_minimum: 11
      }
    });
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
        spellcastCheckFn: () => ({ rolled_value: 15 }),
        spellAttackRollFn: () => ({ final_total: 20 }),
        spellDamageRng: () => 0
      }),
      player_id: "enemy-spell-001",
      combat_id: combatId,
      payload: {
        spell_id: "fire_bolt",
        target_id: casterId
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.hit, true);
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

  runTest("reaction_mode_rejects_non_reaction_spell_without_war_caster_override", () => {
    const casterId = "caster-spell-reaction-invalid-001";
    const combatId = "combat-spell-reaction-invalid-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["fire_bolt"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    combat.turn_index = combat.initiative_order.indexOf("enemy-spell-001");
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
      context: createCombatContext(manager, [fireBolt]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "fire_bolt",
        target_id: "enemy-spell-001",
        reaction_mode: true
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "reaction spell casting is not supported in this phase");
  }, results);

  runTest("war_caster_override_requires_single_target_action_spell", () => {
    const casterId = "caster-spell-war-caster-invalid-001";
    const combatId = "combat-spell-war-caster-invalid-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["bless"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    combat.turn_index = combat.initiative_order.indexOf("enemy-spell-001");
    const caster = findParticipant(combat, casterId);
    caster.feat_flags = { war_caster: true };
    manager.combats.set(combatId, combat);

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
        target_id: "ally-unrelated-001",
        reaction_mode: true,
        war_caster_reaction: true
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "war caster reaction requires a single target spell");
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

  runTest("next_attack_disadvantage_status_hint_applies_one_shot_attack_debuff", () => {
    const casterId = "caster-spell-mockery-like-001";
    const combatId = "combat-spell-mockery-like-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["mockery_like_test"]
    });
    const mockeryLike = {
      spell_id: "mockery_like_test",
      name: "Mockery Like",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "save", save_ability: "wisdom" },
      effect: { status_hint: "next_attack_disadvantage" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [mockeryLike], {
        spellSavingThrowFn: () => ({ final_total: 4 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "mockery_like_test",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "next_attack_disadvantage"), true);
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

  runTest("fog_cloud_at_target_position_imposes_disadvantage_on_spell_attack_rolls", () => {
    const casterId = "caster-spell-fog-attack-001";
    const combatId = "combat-spell-fog-attack-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["fire_bolt"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    combat.active_effects = [{
      effect_id: "effect-fog-cloud-spell-001",
      type: "spell_active_fog_cloud",
      source: {
        participant_id: casterId
      },
      target: {
        participant_id: casterId
      },
      duration: {
        remaining_turns: 10,
        max_turns: 10
      },
      tick_timing: "none",
      stacking_rules: {
        mode: "refresh",
        max_stacks: 1
      },
      modifiers: {
        spell_id: "fog_cloud",
        utility_ref: "spell_fog_cloud_heavily_obscured",
        area_tiles: [{ x: 1, y: 0 }]
      }
    }];
    manager.combats.set(combatId, combat);

    let seenDisadvantage = false;
    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [{
        spell_id: "fire_bolt",
        name: "Fire Bolt",
        casting_time: "1 action",
        targeting: { type: "single_target" },
        range: "120 feet",
        attack_or_save: { type: "spell_attack" },
        damage: { dice: "1d10", damage_type: "fire" }
      }], {
        spellAttackRollFn(input) {
          seenDisadvantage = input && input.disadvantage === true;
          return { final_total: 20 };
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
    assert.equal(seenDisadvantage, true);
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

  runTest("spell_attack_can_apply_damage_across_up_to_three_enemy_targets", () => {
    const casterId = "caster-spell-attack-multi-001";
    const combatId = "combat-spell-attack-multi-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["arc_burst_test"],
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
    const arcBurst = {
      spell_id: "arc_burst_test",
      name: "Arc Burst",
      casting_time: "1 action",
      targeting: { type: "up_to_three_enemies" },
      range: "120 feet",
      attack_or_save: { type: "spell_attack" },
      damage: { dice: "1d10", damage_type: "lightning" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [arcBurst], {
        spellAttackRollFn: () => ({ final_total: 20 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "arc_burst_test",
        target_id: "enemy-spell-001",
        target_ids: ["enemy-spell-001", "enemy-spell-002", "enemy-spell-003"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.target_results.length, 3);
    assert.equal(out.payload.cast_spell.target_results.every((entry) => entry.hit === true), true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.equal(findParticipant(updatedCombat, "enemy-spell-001").current_hp < 12, true);
    assert.equal(findParticipant(updatedCombat, "enemy-spell-002").current_hp < 12, true);
    assert.equal(findParticipant(updatedCombat, "enemy-spell-003").current_hp < 12, true);
  }, results);

  runTest("save_spell_can_apply_damage_and_conditions_across_up_to_three_enemy_targets", () => {
    const casterId = "caster-spell-save-multi-001";
    const combatId = "combat-spell-save-multi-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["terror_peal_test"],
      extraParticipants: [
        {
          participant_id: "enemy-spell-002",
          team: "monsters",
          current_hp: 12,
          max_hp: 12,
          armor_class: 12,
          position: { x: 2, y: 0 },
          wisdom_save_modifier: 0
        },
        {
          participant_id: "enemy-spell-003",
          team: "monsters",
          current_hp: 12,
          max_hp: 12,
          armor_class: 12,
          position: { x: 3, y: 0 },
          wisdom_save_modifier: 0
        }
      ]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const primary = findParticipant(combat, "enemy-spell-001");
    primary.wisdom_save_modifier = 0;
    manager.combats.set(combatId, combat);
    const terrorPeal = {
      spell_id: "terror_peal_test",
      name: "Terror Peal",
      casting_time: "1 action",
      targeting: { type: "up_to_three_enemies" },
      range: "60 feet",
      attack_or_save: { type: "save", save_ability: "wisdom" },
      save_outcome: "none",
      damage: { dice: "1d8", damage_type: "psychic" },
      effect: {
        applied_conditions: [
          {
            condition_type: "frightened",
            expiration_trigger: "manual"
          }
        ]
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [terrorPeal], {
        spellSavingThrowFn: () => ({ final_total: 5, rolled_value: 5 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "terror_peal_test",
        target_id: "enemy-spell-001",
        target_ids: ["enemy-spell-001", "enemy-spell-002", "enemy-spell-003"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.target_results.length, 3);
    assert.equal(out.payload.cast_spell.target_results.every((entry) => entry.saved === false), true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.equal(updatedCombat.conditions.filter((entry) => entry.condition_type === "frightened").length, 3);
  }, results);

  runTest("healing_spell_can_restore_multiple_allies", () => {
    const casterId = "caster-spell-heal-multi-001";
    const combatId = "combat-spell-heal-multi-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["mending_chorus_test"],
      extraParticipants: [
        {
          participant_id: "ally-spell-002",
          team: "heroes",
          current_hp: 5,
          max_hp: 12,
          armor_class: 12,
          position: { x: 2, y: 0 }
        },
        {
          participant_id: "ally-spell-003",
          team: "heroes",
          current_hp: 4,
          max_hp: 12,
          armor_class: 12,
          position: { x: 1, y: 1 }
        }
      ]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    findParticipant(combat, casterId).current_hp = 6;
    manager.combats.set(combatId, combat);
    const mendingChorus = {
      spell_id: "mending_chorus_test",
      name: "Mending Chorus",
      casting_time: "1 action",
      targeting: { type: "up_to_three_allies" },
      range: "30 feet",
      attack_or_save: { type: "none" },
      healing: { dice: "1d4", healing_type: "healing" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [mendingChorus], {
        spellHealingRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "mending_chorus_test",
        target_id: casterId,
        target_ids: [casterId, "ally-spell-002", "ally-spell-003"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.target_results.length, 3);
    assert.equal(out.payload.cast_spell.target_results.every((entry) => {
      return Boolean(entry && entry.healing_result) && Number(entry.healing_result.healed_for) > 0;
    }), true);
  }, results);

  runTest("mass_cure_wounds_can_restore_up_to_six_allies", () => {
    const casterId = "caster-spell-mass-cure-wounds-001";
    const combatId = "combat-spell-mass-cure-wounds-001";
    const allyIds = ["ally-spell-002", "ally-spell-003", "ally-spell-004", "ally-spell-005", "ally-spell-006"];
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["mass_cure_wounds"],
      extraParticipants: allyIds.map((allyId, index) => ({
        participant_id: allyId,
        team: "heroes",
        current_hp: 4 + index,
        max_hp: 18,
        armor_class: 12,
        position: { x: (index % 3) + 1, y: Math.floor(index / 3) + 1 }
      }))
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    findParticipant(combat, casterId).current_hp = 8;
    manager.combats.set(combatId, combat);

    const massCureWounds = {
      spell_id: "mass_cure_wounds",
      name: "Mass Cure Wounds",
      casting_time: "1 action",
      targeting: { type: "up_to_six_allies" },
      range: "60 feet",
      attack_or_save: { type: "none" },
      healing: {
        dice: "3d8",
        bonus: "spellcasting_ability_modifier",
        healing_type: "healing"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [massCureWounds], {
        spellHealingRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "mass_cure_wounds",
        target_id: casterId,
        target_ids: [casterId].concat(allyIds)
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.target_results.length, 6);
    assert.equal(out.payload.cast_spell.target_results.every((entry) => {
      return Boolean(entry && entry.healing_result) && Number(entry.healing_result.healed_for) > 0;
    }), true);
  }, results);

  runTest("mass_heal_uses_a_shared_healing_pool_across_multiple_allies", () => {
    const casterId = "caster-spell-mass-heal-001";
    const combatId = "combat-spell-mass-heal-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["mass_heal"],
      extraParticipants: [{
        participant_id: "ally-mass-heal-001",
        team: "heroes",
        current_hp: 100,
        max_hp: 500,
        armor_class: 12,
        position: { x: 1, y: 1 }
      }, {
        participant_id: "ally-mass-heal-002",
        team: "heroes",
        current_hp: 50,
        max_hp: 500,
        armor_class: 12,
        position: { x: 2, y: 1 }
      }]
    });

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("mass_heal")]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "mass_heal",
        target_ids: ["ally-mass-heal-001", "ally-mass-heal-002"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.target_results.length, 2);
    assert.equal(out.payload.cast_spell.healing_result.healing_pool_total, 700);
    assert.equal(out.payload.cast_spell.healing_result.healing_pool_remaining, 0);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.equal(findParticipant(updatedCombat, "ally-mass-heal-001").current_hp, 500);
    assert.equal(findParticipant(updatedCombat, "ally-mass-heal-002").current_hp, 350);
  }, results);

  runTest("chain_lightning_can_apply_save_damage_across_up_to_four_enemy_targets", () => {
    const casterId = "caster-spell-chain-lightning-001";
    const combatId = "combat-spell-chain-lightning-001";
    const enemyIds = ["enemy-spell-002", "enemy-spell-003", "enemy-spell-004"];
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["chain_lightning"],
      extraParticipants: enemyIds.map((enemyId, index) => ({
        participant_id: enemyId,
        team: "monsters",
        current_hp: 40,
        max_hp: 40,
        armor_class: 12,
        position: { x: index + 2, y: 1 },
        dexterity_save_modifier: 0
      }))
    });
    const chainLightning = {
      spell_id: "chain_lightning",
      name: "Chain Lightning",
      casting_time: "1 action",
      targeting: { type: "up_to_four_enemies" },
      range: "150 feet",
      attack_or_save: { type: "save", save_ability: "dexterity" },
      damage: { dice: "10d8", damage_type: "lightning" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [chainLightning], {
        spellSavingThrowFn: () => ({ final_total: 5, rolled_value: 5 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "chain_lightning",
        target_id: "enemy-spell-001",
        target_ids: ["enemy-spell-001"].concat(enemyIds)
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.target_results.length, 4);
    assert.equal(out.payload.cast_spell.target_results.every((entry) => entry.saved === false), true);
    assert.equal(out.payload.cast_spell.target_results.every((entry) => {
      return Boolean(entry && entry.damage_result) && Number(entry.damage_result.final_damage) > 0;
    }), true);
  }, results);

  runTest("heal_can_restore_fixed_healing_amount_to_single_target", () => {
    const casterId = "caster-spell-heal-fixed-001";
    const combatId = "combat-spell-heal-fixed-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["heal"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const ally = findParticipant(combat, casterId);
    ally.current_hp = 1;
    ally.max_hp = 80;
    manager.combats.set(combatId, combat);

    const heal = {
      spell_id: "heal",
      name: "Heal",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "none" },
      healing: {
        amount: 70,
        healing_type: "healing"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [heal]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "heal",
        target_id: casterId
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.healing_result.healed_for, 70);
    assert.equal(out.payload.cast_spell.healing_result.hp_after, 71);
  }, results);

  runTest("fireball_can_resolve_explicit_area_targets_through_save_pipeline", () => {
    const casterId = "caster-spell-fireball-area-001";
    const combatId = "combat-spell-fireball-area-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["fireball"],
      extraParticipants: [
        {
          participant_id: "enemy-spell-002",
          team: "monsters",
          current_hp: 12,
          max_hp: 12,
          armor_class: 12,
          position: { x: 5, y: 5 },
          dexterity_save_modifier: 0
        },
        {
          participant_id: "enemy-spell-003",
          team: "monsters",
          current_hp: 12,
          max_hp: 12,
          armor_class: 12,
          position: { x: 6, y: 5 },
          dexterity_save_modifier: 0
        }
      ]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const primary = findParticipant(combat, "enemy-spell-001");
    primary.dexterity_save_modifier = 0;
    primary.position = { x: 4, y: 5 };
    manager.combats.set(combatId, combat);

    const fireball = {
      spell_id: "fireball",
      name: "Fireball",
      casting_time: "1 action",
      range: "150 feet",
      targeting: { type: "sphere_20ft" },
      attack_or_save: { type: "save", save_ability: "dexterity" },
      damage: { dice: "8d6", damage_type: "fire" },
      metadata: {
        area_template: {
          shape: "sphere",
          radius_feet: 20,
          origin: "point_within_range"
        }
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [fireball], {
        spellSavingThrowFn: () => ({ final_total: 5, rolled_value: 5 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "fireball",
        target_id: "enemy-spell-001",
        target_ids: ["enemy-spell-001", "enemy-spell-002", "enemy-spell-003"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.target_results.length, 3);
    assert.equal(out.payload.cast_spell.target_results.every((entry) => entry.saved === false), true);
    assert.equal(out.payload.cast_spell.target_results.every((entry) => {
      return Boolean(entry && entry.damage_result) && entry.damage_result.damage_type === "fire";
    }), true);
  }, results);

  runTest("fire_storm_can_resolve_explicit_area_targets_through_save_pipeline", () => {
    const casterId = "caster-spell-fire-storm-area-001";
    const combatId = "combat-spell-fire-storm-area-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["fire_storm"],
      extraParticipants: [
        {
          participant_id: "enemy-spell-002",
          team: "monsters",
          current_hp: 30,
          max_hp: 30,
          armor_class: 12,
          position: { x: 5, y: 5 },
          dexterity_save_modifier: 0
        },
        {
          participant_id: "enemy-spell-003",
          team: "monsters",
          current_hp: 30,
          max_hp: 30,
          armor_class: 12,
          position: { x: 6, y: 5 },
          dexterity_save_modifier: 0
        }
      ]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    findParticipant(combat, "enemy-spell-001").position = { x: 4, y: 5 };
    manager.combats.set(combatId, combat);

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("fire_storm")], {
        spellSavingThrowFn: () => ({ final_total: 5, rolled_value: 5 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "fire_storm",
        target_id: "enemy-spell-001",
        target_ids: ["enemy-spell-001", "enemy-spell-002", "enemy-spell-003"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.target_results.length, 3);
    assert.equal(out.payload.cast_spell.target_results.every((entry) => entry.saved === false), true);
    assert.equal(out.payload.cast_spell.target_results.every((entry) => entry.damage_result.damage_type === "fire"), true);
  }, results);

  runTest("flame_strike_resolves_compound_radiant_fire_damage_components", () => {
    const casterId = "caster-spell-flame-strike-001";
    const combatId = "combat-spell-flame-strike-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["flame_strike"]
    });

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("flame_strike")], {
        spellSavingThrowFn: () => ({ final_total: 4, rolled_value: 4 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "flame_strike",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.damage_result.damage_type, "radiant_fire");
    assert.equal(Array.isArray(out.payload.cast_spell.damage_result.damage_components), true);
    assert.equal(out.payload.cast_spell.damage_result.damage_components.length, 2);
    assert.deepEqual(out.payload.cast_spell.damage_result.damage_components.map((entry) => entry.damage_type), ["radiant", "fire"]);
  }, results);

  runTest("meteor_swarm_resolves_compound_bludgeoning_fire_damage_components", () => {
    const casterId = "caster-spell-meteor-swarm-001";
    const combatId = "combat-spell-meteor-swarm-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["meteor_swarm"]
    });

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("meteor_swarm")], {
        spellSavingThrowFn: () => ({ final_total: 4, rolled_value: 4 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "meteor_swarm",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.damage_result.damage_type, "bludgeoning_fire");
    assert.equal(Array.isArray(out.payload.cast_spell.damage_result.damage_components), true);
    assert.equal(out.payload.cast_spell.damage_result.damage_components.length, 2);
    assert.deepEqual(out.payload.cast_spell.damage_result.damage_components.map((entry) => entry.damage_type), ["bludgeoning", "fire"]);
  }, results);

  runTest("spirit_guardians_can_resolve_explicit_aura_targets_and_start_concentration", () => {
    const casterId = "caster-spell-spirit-guardians-001";
    const combatId = "combat-spell-spirit-guardians-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["spirit_guardians"],
      extraParticipants: [
        {
          participant_id: "enemy-spell-002",
          team: "monsters",
          current_hp: 12,
          max_hp: 12,
          armor_class: 12,
          position: { x: 1, y: 1 },
          wisdom_save_modifier: 0
        },
        {
          participant_id: "enemy-spell-003",
          team: "monsters",
          current_hp: 12,
          max_hp: 12,
          armor_class: 12,
          position: { x: 0, y: 2 },
          wisdom_save_modifier: 0
        }
      ]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    findParticipant(combat, "enemy-spell-001").wisdom_save_modifier = 0;
    manager.combats.set(combatId, combat);

    const spiritGuardians = {
      spell_id: "spirit_guardians",
      name: "Spirit Guardians",
      casting_time: "1 action",
      range: "self",
      duration: "concentration, up to 10 minutes",
      concentration: true,
      targeting: { type: "aura_15ft" },
      attack_or_save: { type: "save", save_ability: "wisdom" },
      damage: { dice: "3d8", damage_type: "radiant" },
      effect: {
        damage_ref: "spell_damage_spirit_guardians",
        targeting: "aura"
      },
      metadata: {
        area_template: {
          shape: "aura",
          radius_feet: 15,
          origin: "self"
        }
      }
    };

    const out = performCastSpellAction({
      combatManager: manager,
      combat_id: combatId,
      caster_id: casterId,
      target_id: "enemy-spell-001",
      target_ids: ["enemy-spell-001", "enemy-spell-002", "enemy-spell-003"],
      area_tiles: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 2 }],
      spell: spiritGuardians,
      saving_throw_fn: () => ({ final_total: 4, rolled_value: 4 }),
      damage_rng: () => 0
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.active_effects_added.length, 1);
    assert.equal(out.payload.concentration_started.linked_effect_ids.length, 1);
    assert.deepEqual(out.payload.active_effects_added[0].modifiers.area_tiles, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 2 }]);
    assert.equal(out.payload.active_effects_added[0].modifiers.zone_behavior.on_turn_start_damage.damage_type, "radiant");
    assert.equal(out.payload.target_results.length, 3);
    assert.equal(out.payload.target_results.filter((entry) => {
      return Boolean(entry && entry.damage_result) && entry.damage_result.damage_type === "radiant";
    }).length, 3);
  }, results);

  runTest("fog_cloud_can_register_persistent_zone_without_participant_targets", () => {
    const casterId = "caster-spell-fog-empty-001";
    const combatId = "combat-spell-fog-empty-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["fog_cloud"]
    });
    const fogCloud = {
      spell_id: "fog_cloud",
      name: "Fog Cloud",
      casting_time: "1 action",
      targeting: { type: "sphere_20ft" },
      range: "120 feet",
      duration: "concentration, up to 1 hour",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: {
        utility_ref: "spell_fog_cloud_heavily_obscured",
        targeting: "area"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [fogCloud]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "fog_cloud",
        area_tiles: [{ x: 2, y: 2 }, { x: 2, y: 3 }]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.target_results.length, 0);
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    assert.deepEqual(out.payload.cast_spell.active_effects_added[0].modifiers.area_tiles, [{ x: 2, y: 2 }, { x: 2, y: 3 }]);
  }, results);

  runTest("point_origin_area_spell_rejects_area_tiles_outside_spell_range", () => {
    const casterId = "caster-spell-area-range-001";
    const combatId = "combat-spell-area-range-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["short_range_cloud"]
    });
    const shortRangeCloud = {
      spell_id: "short_range_cloud",
      name: "Short Range Cloud",
      casting_time: "1 action",
      targeting: { type: "sphere_10ft" },
      range: "30 feet",
      duration: "concentration, up to 1 minute",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: {
        utility_ref: "spell_short_range_cloud",
        targeting: "area"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [shortRangeCloud]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "short_range_cloud",
        area_tiles: [{ x: 8, y: 8 }]
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "area spell tiles are not valid for the spell range/template");
  }, results);

  runTest("spirit_guardians_requires_self_centered_area_tiles", () => {
    const casterId = "caster-spell-spirit-guardians-center-001";
    const combatId = "combat-spell-spirit-guardians-center-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["spirit_guardians"]
    });
    const spiritGuardians = {
      spell_id: "spirit_guardians",
      name: "Spirit Guardians",
      casting_time: "1 action",
      range: "self",
      duration: "concentration, up to 10 minutes",
      concentration: true,
      targeting: { type: "aura_15ft" },
      attack_or_save: { type: "save", save_ability: "wisdom" },
      damage: { dice: "3d8", damage_type: "radiant" },
      effect: {
        damage_ref: "spell_damage_spirit_guardians",
        targeting: "aura"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [spiritGuardians]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "spirit_guardians",
        area_tiles: [{ x: 2, y: 2 }, { x: 2, y: 3 }]
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "self-centered aura tiles must include the caster position");
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

  runTest("scorching_ray_can_split_attack_projectiles_across_targets", () => {
    const casterId = "caster-spell-scorch-ray-001";
    const combatId = "combat-spell-scorch-ray-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["scorching_ray"],
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
    const scorchingRay = {
      spell_id: "scorching_ray",
      name: "Scorching Ray",
      casting_time: "1 action",
      targeting: { type: "single_or_split_target" },
      range: "120 feet",
      attack_or_save: { type: "spell_attack" },
      damage: { dice: "3x2d6", damage_type: "fire" },
      effect: {
        targetting: "single_or_split_target",
        projectiles: 3
      }
    };
    let attackIndex = 0;
    const attackTotals = [20, 19, 18];

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [scorchingRay], {
        spellAttackRollFn: () => ({ final_total: attackTotals[attackIndex++] || 18 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "scorching_ray",
        target_id: "enemy-spell-001",
        target_ids: ["enemy-spell-001", "enemy-spell-002", "enemy-spell-003"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.target_results.length, 3);
    assert.equal(out.payload.cast_spell.target_results.every((entry) => entry.projectile_count === 1), true);
    assert.equal(out.payload.cast_spell.target_results.every((entry) => entry.final_damage === 2), true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.equal(findParticipant(updatedCombat, "enemy-spell-001").current_hp, 10);
    assert.equal(findParticipant(updatedCombat, "enemy-spell-002").current_hp, 10);
    assert.equal(findParticipant(updatedCombat, "enemy-spell-003").current_hp, 10);
  }, results);

  runTest("scorching_ray_can_focus_multiple_attack_projectiles_on_one_target", () => {
    const casterId = "caster-spell-scorch-focus-001";
    const combatId = "combat-spell-scorch-focus-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["scorching_ray"]
    });
    const scorchingRay = {
      spell_id: "scorching_ray",
      name: "Scorching Ray",
      casting_time: "1 action",
      targeting: { type: "single_or_split_target" },
      range: "120 feet",
      attack_or_save: { type: "spell_attack" },
      damage: { dice: "3x2d6", damage_type: "fire" },
      effect: {
        targetting: "single_or_split_target",
        projectiles: 3
      }
    };
    let attackIndex = 0;
    const attackTotals = [20, 20, 9];

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [scorchingRay], {
        spellAttackRollFn: () => ({ final_total: attackTotals[attackIndex++] || 9 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "scorching_ray",
        target_id: "enemy-spell-001",
        target_ids: ["enemy-spell-001"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.target_results.length, 1);
    assert.equal(out.payload.cast_spell.target_results[0].projectile_count, 3);
    assert.equal(out.payload.cast_spell.target_results[0].hit_count, 2);
    assert.equal(out.payload.cast_spell.target_results[0].miss_count, 1);
    assert.equal(out.payload.cast_spell.target_results[0].final_damage, 4);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.equal(findParticipant(updatedCombat, "enemy-spell-001").current_hp, 8);
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

  runTest("greater_invisibility_applies_without_breaking_on_harmful_action_metadata", () => {
    const casterId = "caster-spell-greater-invisibility-001";
    const combatId = "combat-spell-greater-invisibility-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["greater_invisibility"]
    });
    const greaterInvisibility = {
      spell_id: "greater_invisibility",
      name: "Greater Invisibility",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "touch",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: { status_hint: "greater_invisibility" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [greaterInvisibility]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "greater_invisibility",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(out.ok, true);
    const applied = out.payload.cast_spell.applied_conditions.find((entry) => entry.condition_type === "invisible");
    assert.equal(Boolean(applied), true);
    assert.equal(Boolean(applied.metadata.breaks_on_harmful_action), false);
    assert.equal(Boolean(out.payload.cast_spell.concentration_started), true);
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

  runTest("stoneskin_applies_weapon_resistance_condition", () => {
    const casterId = "caster-spell-stoneskin-001";
    const combatId = "combat-spell-stoneskin-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["stoneskin"]
    });
    const stoneskin = {
      spell_id: "stoneskin",
      name: "Stoneskin",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "touch",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: { status_hint: "stoneskin" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [stoneskin]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "stoneskin",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(out.ok, true);
    const applied = out.payload.cast_spell.applied_conditions.find((entry) => entry.condition_type === "stoneskin");
    assert.equal(Boolean(applied), true);
    assert.deepEqual(applied.metadata.resistances, ["bludgeoning", "piercing", "slashing"]);
    assert.equal(Boolean(out.payload.cast_spell.concentration_started), true);
  }, results);

  runTest("protection_from_energy_applies_selected_damage_resistance", () => {
    const casterId = "caster-spell-protection-energy-001";
    const combatId = "combat-spell-protection-energy-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["protection_from_energy"]
    });
    const protection = {
      spell_id: "protection_from_energy",
      name: "Protection from Energy",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "touch",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: { status_hint: "protection_from_energy" }
    };

    const castOut = processCombatCastSpellRequest({
      context: createCombatContext(manager, [protection]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "protection_from_energy",
        target_id: "ally-unrelated-001",
        damage_type: "fire"
      }
    });

    assert.equal(castOut.ok, true);
    const applied = castOut.payload.cast_spell.applied_conditions.find((entry) => entry.condition_type === "protection_from_energy");
    assert.equal(Boolean(applied), true);
    assert.deepEqual(applied.metadata.resistances, ["fire"]);

    const combat = manager.getCombatById(combatId).payload.combat;
    const damageOut = applyDamageToCombatState({
      combat_state: combat,
      target_participant_id: "ally-unrelated-001",
      damage_type: "fire",
      damage_formula: null,
      flat_damage: 10
    });
    assert.equal(damageOut.damage_result.final_damage, 5);
  }, results);

  runTest("death_ward_prevents_fatal_damage_once_and_is_consumed", () => {
    const casterId = "caster-spell-death-ward-001";
    const combatId = "combat-spell-death-ward-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["death_ward"]
    });
    const deathWard = {
      spell_id: "death_ward",
      name: "Death Ward",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "touch",
      attack_or_save: { type: "none" },
      effect: { status_hint: "death_ward" }
    };

    const castOut = processCombatCastSpellRequest({
      context: createCombatContext(manager, [deathWard]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "death_ward",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(castOut.ok, true);
    const applied = castOut.payload.cast_spell.applied_conditions.find((entry) => entry.condition_type === "death_ward");
    assert.equal(Boolean(applied), true);

    const combat = manager.getCombatById(combatId).payload.combat;
    const ally = findParticipant(combat, "ally-unrelated-001");
    ally.current_hp = 8;
    manager.combats.set(combatId, combat);

    const firstDamage = applyDamageToCombatState({
      combat_state: manager.getCombatById(combatId).payload.combat,
      target_participant_id: "ally-unrelated-001",
      damage_type: "necrotic",
      damage_formula: null,
      flat_damage: 20
    });
    assert.equal(firstDamage.damage_result.hp_after, 1);
    assert.equal(Boolean(firstDamage.damage_result.death_ward_result), true);
    assert.equal(firstDamage.next_state.conditions.some((entry) => entry.condition_type === "death_ward"), false);

    const secondDamage = applyDamageToCombatState({
      combat_state: firstDamage.next_state,
      target_participant_id: "ally-unrelated-001",
      damage_type: "necrotic",
      damage_formula: null,
      flat_damage: 5
    });
    assert.equal(secondDamage.damage_result.hp_after, 0);
    assert.equal(Boolean(secondDamage.damage_result.death_ward_result), false);
  }, results);

  runTest("fog_cloud_registers_persistent_active_effect_and_links_it_to_concentration", () => {
    const casterId = "caster-spell-fog-001";
    const combatId = "combat-spell-fog-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["fog_cloud"]
    });
    const fogCloud = {
      spell_id: "fog_cloud",
      name: "Fog Cloud",
      casting_time: "1 action",
      targeting: { type: "sphere_20ft" },
      range: "120 feet",
      duration: "concentration, up to 1 hour",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: {
        utility_ref: "spell_fog_cloud_heavily_obscured",
        targeting: "area"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [fogCloud]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "fog_cloud",
        area_tiles: [{ x: 2, y: 2 }, { x: 2, y: 3 }],
        target_ids: ["enemy-spell-001"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.utility_ref, "spell_fog_cloud_heavily_obscured");
    assert.deepEqual(out.payload.cast_spell.active_effects_added[0].modifiers.area_tiles, [{ x: 2, y: 2 }, { x: 2, y: 3 }]);
    assert.equal(out.payload.cast_spell.concentration_started.linked_effect_ids.length, 1);

    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.equal(Array.isArray(updatedCombat.active_effects), true);
    assert.equal(updatedCombat.active_effects.length, 1);
    assert.equal(updatedCombat.active_effects[0].modifiers.utility_ref, "spell_fog_cloud_heavily_obscured");
    assert.deepEqual(updatedCombat.active_effects[0].modifiers.area_tiles, [{ x: 2, y: 2 }, { x: 2, y: 3 }]);
    assert.equal(findParticipant(updatedCombat, casterId).concentration.linked_effect_ids.length, 1);
  }, results);

  runTest("grease_registers_persistent_zone_effect_with_turn_start_prone_behavior", () => {
    const casterId = "caster-spell-grease-001";
    const combatId = "combat-spell-grease-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["grease"]
    });
    const grease = {
      spell_id: "grease",
      name: "Grease",
      casting_time: "1 action",
      targeting: { type: "cube_15ft" },
      range: "60 feet",
      duration: "1 minute",
      concentration: false,
      attack_or_save: { type: "save", save_ability: "dexterity" },
      effect: {
        status_ref: "spell_grease_prone",
        targeting: "area"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [grease], {
        spellSavingThrowFn: () => ({ final_total: 15 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "grease",
        area_tiles: [{ x: 2, y: 2 }, { x: 2, y: 3 }],
        target_ids: ["enemy-spell-001"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.on_turn_start_condition.condition_type, "prone");
    assert.deepEqual(out.payload.cast_spell.active_effects_added[0].modifiers.area_tiles, [{ x: 2, y: 2 }, { x: 2, y: 3 }]);
  }, results);

  runTest("web_registers_persistent_zone_effect_with_turn_start_restrained_behavior", () => {
    const casterId = "caster-spell-web-001";
    const combatId = "combat-spell-web-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["web"]
    });
    const web = {
      spell_id: "web",
      name: "Web",
      casting_time: "1 action",
      targeting: { type: "cube_15ft" },
      range: "60 feet",
      duration: "concentration, up to 1 hour",
      concentration: true,
      attack_or_save: { type: "save", save_ability: "dexterity" },
      effect: {
        status_ref: "spell_web_restrained",
        targeting: "area"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [web], {
        spellSavingThrowFn: () => ({ final_total: 15 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "web",
        area_tiles: [{ x: 2, y: 2 }, { x: 2, y: 3 }],
        target_ids: ["enemy-spell-001"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    assert.equal(out.payload.cast_spell.concentration_started.linked_effect_ids.length, 1);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.on_turn_start_condition.condition_type, "restrained");
    assert.deepEqual(out.payload.cast_spell.active_effects_added[0].modifiers.area_tiles, [{ x: 2, y: 2 }, { x: 2, y: 3 }]);
  }, results);

  runTest("stinking_cloud_registers_persistent_zone_with_poison_turn_start_behavior", () => {
    const casterId = "caster-spell-stinking-cloud-001";
    const combatId = "combat-spell-stinking-cloud-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["stinking_cloud"]
    });
    const stinkingCloud = {
      spell_id: "stinking_cloud",
      name: "Stinking Cloud",
      casting_time: "1 action",
      targeting: { type: "sphere_20ft" },
      range: "90 feet",
      duration: "concentration, up to 1 minute",
      concentration: true,
      attack_or_save: { type: "save", save_ability: "constitution" },
      effect: {
        status_hint: "stinking_cloud_poisonous_zone",
        targeting: "area"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [stinkingCloud], {
        spellSavingThrowFn: () => ({ final_total: 15 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "stinking_cloud",
        area_tiles: [{ x: 2, y: 2 }, { x: 2, y: 3 }],
        target_ids: ["enemy-spell-001"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.on_turn_start_condition.condition_type, "poisoned");
    assert.equal(out.payload.cast_spell.concentration_started.linked_effect_ids.length, 1);
  }, results);

  runTest("cloudkill_registers_persistent_zone_with_poison_damage_on_entry_and_turn_start", () => {
    const casterId = "caster-spell-cloudkill-001";
    const combatId = "combat-spell-cloudkill-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["cloudkill"]
    });
    const cloudkill = {
      spell_id: "cloudkill",
      name: "Cloudkill",
      casting_time: "1 action",
      targeting: { type: "sphere_20ft" },
      range: "120 feet",
      duration: "concentration, up to 10 minutes",
      concentration: true,
      attack_or_save: { type: "save", save_ability: "constitution" },
      damage: { dice: "5d8", damage_type: "poison" },
      effect: {
        damage_ref: "spell_damage_cloudkill",
        targeting: "area",
        status_hint: "cloudkill_zone"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [cloudkill]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "cloudkill",
        area_tiles: [{ x: 2, y: 2 }, { x: 2, y: 3 }],
        target_ids: ["enemy-spell-001"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    assert.equal(out.payload.cast_spell.concentration_started.linked_effect_ids.length, 1);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.on_enter_damage.damage_type, "poison");
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.on_turn_start_damage.damage_type, "poison");
  }, results);

  runTest("insect_plague_registers_persistent_zone_with_piercing_damage_and_difficult_terrain", () => {
    const casterId = "caster-spell-insect-plague-001";
    const combatId = "combat-spell-insect-plague-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["insect_plague"]
    });
    const insectPlague = getSpellEntry("insect_plague");

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [insectPlague]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "insect_plague",
        area_tiles: [{ x: 2, y: 2 }, { x: 2, y: 3 }],
        target_ids: ["enemy-spell-001"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.terrain_kind, "difficult");
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.on_enter_damage.damage_type, "piercing");
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.on_turn_start_damage.damage_type, "piercing");
  }, results);

  runTest("incendiary_cloud_registers_persistent_zone_with_fire_damage_on_entry_and_turn_start", () => {
    const casterId = "caster-spell-incendiary-cloud-001";
    const combatId = "combat-spell-incendiary-cloud-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["incendiary_cloud"]
    });
    const incendiaryCloud = getSpellEntry("incendiary_cloud");

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [incendiaryCloud]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "incendiary_cloud",
        area_tiles: [{ x: 2, y: 2 }, { x: 2, y: 3 }],
        target_ids: ["enemy-spell-001"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    assert.equal(out.payload.cast_spell.concentration_started.linked_effect_ids.length, 1);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.on_enter_damage.damage_type, "fire");
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.on_turn_start_damage.damage_type, "fire");
  }, results);

  runTest("ice_storm_registers_one_turn_difficult_terrain_active_effect_after_area_damage", () => {
    const casterId = "caster-spell-ice-storm-001";
    const combatId = "combat-spell-ice-storm-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["ice_storm"]
    });
    const iceStorm = {
      spell_id: "ice_storm",
      name: "Ice Storm",
      casting_time: "1 action",
      targeting: { type: "cylinder_20ft" },
      range: "300 feet",
      duration: "instantaneous",
      concentration: false,
      attack_or_save: { type: "save", save_ability: "dexterity" },
      damage: { dice: "2d8+4d6", damage_type: "cold" },
      effect: {
        damage_ref: "spell_damage_ice_storm",
        targeting: "area",
        status_hint: "ice_storm_difficult_terrain"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [iceStorm], {
        spellSavingThrowFn: () => ({ final_total: 4 }),
        damageRollFn: () => 1
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "ice_storm",
        area_tiles: [{ x: 2, y: 2 }, { x: 2, y: 3 }],
        target_ids: ["enemy-spell-001"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.target_results.length, 1);
    assert.equal(out.payload.cast_spell.target_results[0].damage_result.damage_type, "cold");
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.terrain_kind, "difficult");
    assert.equal(out.payload.cast_spell.active_effects_added[0].duration.remaining_turns, 1);
  }, results);

  runTest("sleet_storm_registers_persistent_zone_with_obscuration_and_prone_checks", () => {
    const casterId = "caster-spell-sleet-storm-001";
    const combatId = "combat-spell-sleet-storm-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["sleet_storm"]
    });
    const sleetStorm = {
      spell_id: "sleet_storm",
      name: "Sleet Storm",
      casting_time: "1 action",
      targeting: { type: "cylinder_20ft" },
      range: "150 feet",
      duration: "concentration, up to 1 minute",
      concentration: true,
      attack_or_save: { type: "save", save_ability: "dexterity" },
      effect: {
        utility_ref: "spell_fog_cloud_heavily_obscured",
        status_hint: "sleet_storm_zone",
        targeting: "area"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [sleetStorm]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "sleet_storm",
        area_tiles: [{ x: 2, y: 2 }, { x: 2, y: 3 }],
        target_ids: ["enemy-spell-001"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.utility_ref, "spell_fog_cloud_heavily_obscured");
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.terrain_kind, "difficult");
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.on_turn_start_condition.condition_type, "prone");
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.on_turn_start_concentration_save.save_ability, "dexterity");
    assert.equal(out.payload.cast_spell.concentration_started.linked_effect_ids.length, 1);
  }, results);

  runTest("spike_growth_registers_persistent_zone_with_traversal_damage", () => {
    const casterId = "caster-spell-spike-growth-001";
    const combatId = "combat-spell-spike-growth-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["spike_growth"]
    });
    const spikeGrowth = {
      spell_id: "spike_growth",
      name: "Spike Growth",
      casting_time: "1 action",
      targeting: { type: "sphere_20ft" },
      range: "150 feet",
      duration: "concentration, up to 10 minutes",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: {
        damage_ref: "spell_damage_spike_growth",
        targeting: "area",
        status_hint: "spike_growth_hazard"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [spikeGrowth]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "spike_growth",
        area_tiles: [{ x: 1, y: 0 }, { x: 2, y: 0 }],
        target_ids: ["enemy-spell-001"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.on_traverse_damage_per_tile.damage_type, "piercing");
    assert.equal(out.payload.cast_spell.concentration_started.linked_effect_ids.length, 1);
  }, results);

  runTest("gust_of_wind_registers_persistent_line_zone_with_forced_movement_hooks", () => {
    const casterId = "caster-spell-gust-001";
    const combatId = "combat-spell-gust-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["gust_of_wind"]
    });
    const gustOfWind = {
      spell_id: "gust_of_wind",
      name: "Gust of Wind",
      casting_time: "1 action",
      targeting: { type: "line_100ft_5ft" },
      range: "self",
      duration: "concentration, up to 1 minute",
      concentration: true,
      attack_or_save: { type: "save", save_ability: "strength" },
      effect: {
        status_hint: "gust_of_wind_push_line",
        targeting: "line"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [gustOfWind]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "gust_of_wind",
        area_tiles: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
        target_ids: ["enemy-spell-001"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.terrain_kind, "difficult");
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.on_enter_forced_movement.push_tiles, 3);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.on_turn_start_forced_movement.push_tiles, 3);
    assert.equal(out.payload.cast_spell.concentration_started.linked_effect_ids.length, 1);
  }, results);

  runTest("darkness_registers_persistent_heavily_obscured_active_effect", () => {
    const casterId = "caster-spell-darkness-001";
    const combatId = "combat-spell-darkness-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["darkness"]
    });
    const darkness = {
      spell_id: "darkness",
      name: "Darkness",
      casting_time: "1 action",
      targeting: { type: "sphere_20ft" },
      range: "60 feet",
      duration: "concentration, up to 10 minutes",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: {
        utility_ref: "spell_darkness_heavily_obscured",
        targeting: "area"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [darkness]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "darkness",
        area_tiles: [{ x: 2, y: 2 }, { x: 2, y: 3 }],
        target_ids: ["enemy-spell-001"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.utility_ref, "spell_darkness_heavily_obscured");
    assert.equal(out.payload.cast_spell.concentration_started.linked_effect_ids.length, 1);
  }, results);

  runTest("moonbeam_registers_persistent_zone_effect_with_enter_and_turn_start_damage", () => {
    const casterId = "caster-spell-moonbeam-001";
    const combatId = "combat-spell-moonbeam-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["moonbeam"]
    });
    const moonbeam = {
      spell_id: "moonbeam",
      name: "Moonbeam",
      casting_time: "1 action",
      targeting: { type: "cylinder_20ft" },
      range: "120 feet",
      duration: "concentration, up to 1 minute",
      concentration: true,
      attack_or_save: { type: "save", save_ability: "constitution" },
      damage: { dice: "2d10", damage_type: "radiant" },
      effect: {
        damage_ref: "spell_damage_moonbeam",
        targeting: "area"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [moonbeam]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "moonbeam",
        area_tiles: [{ x: 2, y: 2 }],
        target_ids: ["enemy-spell-001"]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    assert.equal(out.payload.cast_spell.concentration_started.linked_effect_ids.length, 1);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.on_enter_damage.damage_type, "radiant");
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.on_turn_start_damage.damage_type, "radiant");
  }, results);

  runTest("casting_new_concentration_spell_replaces_prior_persistent_active_effect", () => {
    const casterId = "caster-spell-concentration-replace-001";
    const combatId = "combat-spell-concentration-replace-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["spirit_guardians"]
    });
    const spiritGuardians = {
      spell_id: "spirit_guardians",
      name: "Spirit Guardians",
      casting_time: "1 action",
      targeting: { type: "aura_15ft" },
      range: "self",
      duration: "concentration, up to 10 minutes",
      concentration: true,
      attack_or_save: { type: "save", save_ability: "wisdom" },
      damage: { dice: "3d8", damage_type: "radiant" },
      effect: {
        damage_ref: "spell_damage_spirit_guardians",
        targeting: "aura"
      }
    };
    const combat = manager.getCombatById(combatId).payload.combat;
    const caster = findParticipant(combat, casterId);
    const enemy = findParticipant(combat, "enemy-spell-001");
    caster.action_available = true;
    enemy.current_hp = 20;
    enemy.max_hp = 20;
    combat.turn_index = combat.initiative_order.indexOf(casterId);
    combat.active_effects = [{
      effect_id: "effect-fog-cloud-test-001",
      source_actor_id: casterId,
      source_spell_id: "fog_cloud",
      effect_type: "spell_zone",
      expires_on_concentration_end: true,
      modifiers: {
        utility_ref: "spell_fog_cloud_heavily_obscured",
        area_tiles: [{ x: 2, y: 2 }, { x: 2, y: 3 }]
      }
    }];
    caster.concentration = {
      is_concentrating: true,
      source_participant_id: casterId,
      source_spell_id: "fog_cloud",
      target_actor_id: null,
      linked_condition_ids: [],
      linked_effect_ids: ["effect-fog-cloud-test-001"],
      linked_restorations: [],
      started_at_round: 1,
      broken_reason: null
    };
    manager.combats.set(combatId, combat);

    const second = performCastSpellAction({
      combatManager: manager,
      combat_id: combatId,
      caster_id: casterId,
      target_ids: ["enemy-spell-001"],
      area_tiles: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
      spell: spiritGuardians,
      saving_throw_fn: () => ({ final_total: 4 }),
      damage_rng: () => 0
    });

    assert.equal(second.ok, true);
    assert.equal(second.payload.concentration_replaced.source_spell_id, "fog_cloud");
    assert.deepEqual(second.payload.concentration_replaced.removed_effect_ids, ["effect-fog-cloud-test-001"]);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const updatedCaster = updatedCombat.participants.find((entry) => entry.participant_id === casterId);
    assert.equal(updatedCaster.concentration.source_spell_id, "spirit_guardians");
    assert.equal(updatedCombat.active_effects.some((entry) => entry.effect_id === "effect-fog-cloud-test-001"), false);
  }, results);

  runTest("fear_does_not_apply_frightened_to_target_protected_by_heroism", () => {
    const casterId = "caster-spell-fear-heroism-001";
    const combatId = "combat-spell-fear-heroism-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["fear"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    combat.conditions = [{
      condition_id: "condition-heroism-protect-001",
      condition_type: "heroism",
      source_actor_id: casterId,
      target_actor_id: "enemy-spell-001",
      expiration_trigger: "manual",
      metadata: {
        immunity_tags: ["frightened"]
      }
    }];
    manager.combats.set(combatId, combat);
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
    assert.equal(out.payload.cast_spell.applied_conditions.some((entry) => entry.condition_type === "frightened"), false);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.equal(updatedCombat.conditions.some((entry) => entry.condition_type === "frightened" && entry.target_actor_id === "enemy-spell-001"), false);
  }, results);

  runTest("dissonant_whispers_forces_target_to_flee_on_failed_save_when_reaction_is_available", () => {
    const casterId = "caster-spell-dissonant-001";
    const combatId = "combat-spell-dissonant-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["dissonant_whispers"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    findParticipant(combat, casterId).position = { x: 1, y: 1 };
    findParticipant(combat, "enemy-spell-001").position = { x: 2, y: 1 };
    findParticipant(combat, "enemy-spell-001").movement_remaining = 30;
    findParticipant(combat, "enemy-spell-001").reaction_available = true;
    manager.combats.set(combatId, combat);
    const dissonantWhispers = {
      spell_id: "dissonant_whispers",
      name: "Dissonant Whispers",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "save", save_ability: "wisdom" },
      damage: { dice: "3d6", damage_type: "psychic" },
      effect: { status_hint: "flee_on_fail_using_reaction" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [dissonantWhispers], {
        spellSavingThrowFn: () => ({ final_total: 4 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "dissonant_whispers",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.saved, false);
    assert.equal(out.payload.cast_spell.forced_movement_result.moved, true);
    assert.equal(out.payload.cast_spell.forced_movement_result.reason, "reaction_forced_movement");
    assert.deepEqual(out.payload.cast_spell.forced_movement_result.to_position, { x: 8, y: 1 });
    const castEvent = (out.payload.cast_spell.combat.event_log || []).find((entry) => entry.event_type === "cast_spell_action");
    assert.equal(Boolean(castEvent), true);
    assert.equal(castEvent.forced_movement_result.reason, "reaction_forced_movement");
    assert.deepEqual(castEvent.forced_movement_result.to_position, { x: 8, y: 1 });
  }, results);

  runTest("dissonant_whispers_does_not_force_flee_when_target_has_no_reaction", () => {
    const casterId = "caster-spell-dissonant-noreact-001";
    const combatId = "combat-spell-dissonant-noreact-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["dissonant_whispers"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    findParticipant(combat, casterId).position = { x: 1, y: 1 };
    findParticipant(combat, "enemy-spell-001").position = { x: 2, y: 1 };
    findParticipant(combat, "enemy-spell-001").reaction_available = false;
    manager.combats.set(combatId, combat);
    const dissonantWhispers = {
      spell_id: "dissonant_whispers",
      name: "Dissonant Whispers",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "save", save_ability: "wisdom" },
      damage: { dice: "3d6", damage_type: "psychic" },
      effect: { status_hint: "flee_on_fail_using_reaction" }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [dissonantWhispers], {
        spellSavingThrowFn: () => ({ final_total: 4 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "dissonant_whispers",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.forced_movement_result.moved, false);
    assert.equal(out.payload.cast_spell.forced_movement_result.reason, "reaction_unavailable");
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    assert.deepEqual(findParticipant(updatedCombat, "enemy-spell-001").position, { x: 2, y: 1 });
  }, results);

  runTest("toll_the_dead_uses_larger_damage_die_when_target_is_wounded", () => {
    const casterId = "caster-spell-toll-001";
    const combatId = "combat-spell-toll-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["toll_the_dead"],
      target_hp: 9
    });
    const tollTheDead = {
      spell_id: "toll_the_dead",
      name: "Toll the Dead",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "save", save_ability: "wisdom" },
      damage: { dice: "1d8", damage_type: "necrotic" },
      effect: {
        damage_formula_when_target_wounded: "1d12"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [tollTheDead], {
        spellSavingThrowFn: () => ({ final_total: 4 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "toll_the_dead",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.damage_result.stages.roll_damage.formula, "1d12");
    assert.equal(out.payload.cast_spell.damage_result.final_damage, 1);
  }, results);

  runTest("toll_the_dead_uses_base_damage_die_when_target_is_unwounded", () => {
    const casterId = "caster-spell-toll-full-001";
    const combatId = "combat-spell-toll-full-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["toll_the_dead"],
      target_hp: 12
    });
    const tollTheDead = {
      spell_id: "toll_the_dead",
      name: "Toll the Dead",
      casting_time: "1 action",
      targeting: { type: "single_target" },
      range: "60 feet",
      attack_or_save: { type: "save", save_ability: "wisdom" },
      damage: { dice: "1d8", damage_type: "necrotic" },
      effect: {
        damage_formula_when_target_wounded: "1d12"
      }
    };

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [tollTheDead], {
        spellSavingThrowFn: () => ({ final_total: 4 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "toll_the_dead",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.damage_result.stages.roll_damage.formula, "1d8");
    assert.equal(out.payload.cast_spell.damage_result.final_damage, 1);
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

  runTest("charmed_caster_cannot_target_metadata_blocked_hostile_spell_target", () => {
    const casterId = "caster-spell-charmed-metadata-001";
    const combatId = "combat-spell-charmed-metadata-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["fire_bolt"],
      extraParticipants: [
        {
          participant_id: "blocked-target-001",
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
        condition_id: "condition-charmed-caster-metadata-001",
        condition_type: "charmed",
        source_actor_id: null,
        target_actor_id: casterId,
        expiration_trigger: "manual",
        metadata: {
          cannot_target_actor_ids: ["blocked-target-001"]
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
        target_id: "blocked-target-001"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "charmed participants cannot target the charmer with harmful spells");
  }, results);

  runTest("foresight_applies_single_target_advantage_and_all_save_boons", () => {
    const casterId = "caster-spell-foresight-001";
    const combatId = "combat-spell-foresight-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["foresight"],
      extraParticipants: [
        {
          participant_id: "ally-foresight-001",
          team: "heroes",
          current_hp: 26,
          max_hp: 26,
          armor_class: 15,
          position: { x: 1, y: 1 }
        }
      ]
    });
    const foresight = {
      spell_id: "foresight",
      name: "Foresight",
      casting_time: "1 minute",
      targeting: { type: "single_target" },
      range: "touch",
      concentration: false,
      attack_or_save: { type: "none" },
      effect: {
        status_hint: "foresight",
        targeting: "single"
      }
    };

    const out = performCastSpellAction({
      combatManager: manager,
      combat_id: combatId,
      caster_id: casterId,
      target_id: "ally-foresight-001",
      spell: foresight
    });

    assert.equal(out.ok, true);
    const applied = out.payload.applied_conditions.find((entry) => entry.condition_type === "foresight");
    assert.equal(Boolean(applied), true);
    assert.equal(applied.metadata.has_attack_advantage, true);
    assert.equal(applied.metadata.attackers_have_disadvantage, true);
    assert.equal(applied.metadata.save_advantage_all, true);

    const combat = manager.getCombatById(combatId).payload.combat;
    const saveOut = resolveSavingThrowOutcome({
      combat_state: combat,
      participant: combat.participants.find((entry) => entry.participant_id === "ally-foresight-001"),
      save_ability: "wisdom",
      dc: 18,
      saving_throw_fn: ({ advantage }) => {
        assert.equal(advantage, true);
        return { final_total: 19 };
      }
    });
    assert.equal(saveOut.ok, true);
    assert.equal(saveOut.payload.success, true);
  }, results);

  runTest("holy_aura_applies_multi_target_party_boon_conditions", () => {
    const casterId = "caster-spell-holy-aura-001";
    const combatId = "combat-spell-holy-aura-001";
    const allyIds = ["ally-holy-aura-001", "ally-holy-aura-002"];
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["holy_aura"],
      extraParticipants: allyIds.map((id, index) => ({
        participant_id: id,
        team: "heroes",
        current_hp: 24,
        max_hp: 24,
        armor_class: 14,
        position: index === 0 ? { x: 1, y: 1 } : { x: 2, y: 1 }
      }))
    });
    const holyAura = {
      spell_id: "holy_aura",
      name: "Holy Aura",
      casting_time: "1 action",
      targeting: { type: "up_to_ten_allies" },
      range: "self",
      concentration: true,
      attack_or_save: { type: "none" },
      effect: {
        status_hint: "holy_aura",
        targeting: "multi_target",
        target_radius_feet: 30
      }
    };

    const out = performCastSpellAction({
      combatManager: manager,
      combat_id: combatId,
      caster_id: casterId,
      target_ids: allyIds,
      spell: holyAura
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.applied_conditions.length, 2);
    const applied = out.payload.applied_conditions[0];
    assert.equal(applied.condition_type, "holy_aura");
    assert.equal(applied.metadata.attackers_have_disadvantage, true);
    assert.equal(applied.metadata.save_advantage_all, true);
    assert.equal(Array.isArray(applied.metadata.immunity_tags), true);
    assert.equal(applied.metadata.immunity_tags.includes("frightened"), true);
    assert.equal(applied.metadata.retaliatory_melee_hit_condition_type, "blinded");
    assert.equal(Boolean(out.payload.concentration_started), true);
  }, results);

  runTest("disintegrate_kills_target_at_zero_hp_and_marks_disintegrated", () => {
    const casterId = "caster-spell-disintegrate-001";
    const combatId = "combat-spell-disintegrate-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["disintegrate"],
      extraParticipants: [{
        participant_id: "enemy-disintegrate-001",
        team: "monsters",
        current_hp: 40,
        max_hp: 40,
        armor_class: 12,
        position: { x: 2, y: 0 },
        dexterity_save_modifier: 0
      }]
    });

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("disintegrate")], {
        spellDamageRng: () => 1,
        spellSavingThrowFn: () => ({ final_total: 3 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "disintegrate",
        target_id: "enemy-disintegrate-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.target_results[0].damage_result.disintegrated, true);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const target = updatedCombat.participants.find((entry) => entry.participant_id === "enemy-disintegrate-001");
    assert.equal(String(target.life_state || "").toLowerCase(), "dead");
  }, results);

  runTest("harm_reduces_target_max_hp_by_damage_dealt_without_reducing_below_one", () => {
    const casterId = "caster-spell-harm-001";
    const combatId = "combat-spell-harm-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["harm"],
      extraParticipants: [{
        participant_id: "enemy-harm-001",
        team: "monsters",
        current_hp: 70,
        max_hp: 70,
        armor_class: 12,
        position: { x: 2, y: 0 },
        constitution_save_modifier: 0
      }]
    });

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("harm")], {
        spellDamageRng: () => 1,
        spellSavingThrowFn: () => ({ final_total: 2 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "harm",
        target_id: "enemy-harm-001"
      }
    });

    assert.equal(out.ok, true);
    const damageResult = out.payload.cast_spell.target_results[0].damage_result;
    assert.equal(damageResult.hitpoint_max_reduction, damageResult.final_damage);
    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const target = updatedCombat.participants.find((entry) => entry.participant_id === "enemy-harm-001");
    assert.equal(target.max_hp, 70 - damageResult.final_damage);
    assert.equal(target.current_hp, target.max_hp);
  }, results);

  runTest("feeblemind_blocks_future_spellcasting_and_penalizes_mental_saves", () => {
    const casterId = "caster-spell-feeblemind-001";
    const combatId = "combat-spell-feeblemind-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["feeblemind"],
      extraParticipants: [{
        participant_id: "enemy-feeblemind-001",
        team: "monsters",
        current_hp: 30,
        max_hp: 30,
        armor_class: 12,
        position: { x: 2, y: 0 },
        intelligence_save_modifier: 4,
        spellbook: { known_spell_ids: ["fire_bolt"] },
        spellcasting_ability: "intelligence",
        stats: {
          intelligence: 18,
          charisma: 16,
          wisdom: 10,
          constitution: 12,
          dexterity: 12
        }
      }]
    });

    const castOut = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("feeblemind"), getSpellEntry("fire_bolt")], {
        spellSavingThrowFn: () => ({ final_total: 2 })
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "feeblemind",
        target_id: "enemy-feeblemind-001"
      }
    });

    assert.equal(castOut.ok, true);
    const applied = castOut.payload.cast_spell.applied_conditions.find((entry) => entry.condition_type === "feeblemind");
    assert.equal(Boolean(applied), true);
    assert.equal(applied.metadata.blocks_spellcasting, true);

    const updatedCombat = manager.getCombatById(combatId).payload.combat;
    const target = updatedCombat.participants.find((entry) => entry.participant_id === "enemy-feeblemind-001");
    const saveOut = resolveSavingThrowOutcome({
      combat_state: updatedCombat,
      participant: target,
      save_ability: "intelligence",
      dc: 15,
      saving_throw_fn: ({ bonus_modifier }) => {
        assert.equal(bonus_modifier <= -9, true);
        return { final_total: 10 };
      }
    });
    assert.equal(saveOut.ok, true);

    updatedCombat.current_turn_participant_id = "enemy-feeblemind-001";
    manager.combats.set(combatId, updatedCombat);
    const blockedCast = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("fire_bolt")]),
      player_id: "enemy-feeblemind-001",
      combat_id: combatId,
      payload: {
        spell_id: "fire_bolt",
        target_id: casterId
      }
    });
    assert.equal(blockedCast.ok, false);
    assert.equal(blockedCast.error, "spellcasting is blocked by an active condition");
  }, results);

  runTest("resilient_sphere_applies_isolation_condition_on_failed_save", () => {
    const casterId = "caster-spell-sphere-001";
    const combatId = "combat-spell-sphere-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["resilient_sphere"]
    });

    const out = performCastSpellAction({
      combatManager: manager,
      combat_id: combatId,
      caster_id: casterId,
      target_id: "enemy-spell-001",
      spell: getSpellEntry("resilient_sphere"),
      saving_throw_fn: () => ({ final_total: 2 })
    });

    assert.equal(out.ok, true);
    const applied = out.payload.applied_conditions.find((entry) => entry.condition_type === "resilient_sphere");
    assert.equal(Boolean(applied), true);
    assert.equal(applied.metadata.blocks_move, true);
    assert.equal(applied.metadata.untargetable, true);
  }, results);

  runTest("maze_applies_isolation_condition_and_end_of_turn_escape_metadata", () => {
    const casterId = "caster-spell-maze-001";
    const combatId = "combat-spell-maze-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["maze"]
    });

    const out = performCastSpellAction({
      combatManager: manager,
      combat_id: combatId,
      caster_id: casterId,
      target_id: "enemy-spell-001",
      spell: getSpellEntry("maze")
    });

    assert.equal(out.ok, true);
    const applied = out.payload.applied_conditions.find((entry) => entry.condition_type === "maze");
    assert.equal(Boolean(applied), true);
    assert.equal(applied.metadata.end_of_turn_save_ability, "intelligence");
    assert.equal(applied.metadata.end_of_turn_save_dc, 20);
  }, results);

  runTest("sunburst_applies_blinded_condition_on_failed_save", () => {
    const casterId = "caster-spell-sunburst-001";
    const combatId = "combat-spell-sunburst-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["sunburst"]
    });

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("sunburst")], {
        spellSavingThrowFn: () => ({ final_total: 4 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "sunburst",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.saved, false);
    assert.equal(out.payload.cast_spell.damage_result.damage_type, "radiant");
    const applied = out.payload.cast_spell.applied_conditions.find((entry) => entry.condition_type === "blinded");
    assert.equal(Boolean(applied), true);
    assert.equal(applied.metadata.end_of_turn_save_ability, "constitution");
  }, results);

  runTest("globe_of_invulnerability_registers_self_centered_protection_zone", () => {
    const casterId = "caster-spell-globe-001";
    const combatId = "combat-spell-globe-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["globe_of_invulnerability"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    findParticipant(combat, casterId).position = { x: 2, y: 2 };
    manager.combats.set(combatId, combat);

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("globe_of_invulnerability")]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "globe_of_invulnerability",
        area_tiles: [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 2 }]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    assert.equal(out.payload.cast_spell.concentration_started.linked_effect_ids.length, 1);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.protection_rules.blocks_harmful_spells_up_to_level, 5);
  }, results);

  runTest("guardian_of_faith_registers_bounded_hostile_zone", () => {
    const casterId = "caster-spell-guardian-001";
    const combatId = "combat-spell-guardian-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["guardian_of_faith"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    findParticipant(combat, casterId).position = { x: 2, y: 2 };
    manager.combats.set(combatId, combat);

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("guardian_of_faith")]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "guardian_of_faith",
        area_tiles: [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 2 }]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.hostile_only, true);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.trigger_once_per_turn, true);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.damage_pool_remaining, 60);
  }, results);

  runTest("globe_of_invulnerability_blocks_harmful_spell_of_level_five_or_lower_from_outside", () => {
    const casterId = "caster-spell-globe-block-001";
    const combatId = "combat-spell-globe-block-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["globe_of_invulnerability", "fireball"],
      extraParticipants: [{
        participant_id: "globe-source-ally-001",
        name: "Globe Source Ally",
        team: "heroes",
        position: { x: 4, y: 4 }
      }]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const caster = findParticipant(combat, casterId);
    caster.team = "monsters";
    const globeSourceId = "globe-source-ally-001";
    const protectedTarget = findParticipant(combat, "ally-unrelated-001");
    protectedTarget.position = { x: 4, y: 5 };
    caster.position = { x: 7, y: 7 };
    combat.active_effects = [{
      effect_id: "effect-globe-test-001",
      type: "spell_active_globe_of_invulnerability",
      source: { participant_id: globeSourceId, event_id: null },
      target: { participant_id: globeSourceId },
      duration: { remaining_turns: 10, max_turns: 10 },
      tick_timing: "none",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: {
        spell_id: "globe_of_invulnerability",
        area_tiles: [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 5, y: 4 }],
        zone_behavior: {
          protection_rules: {
            blocks_harmful_spells_up_to_level: 5,
            only_from_outside: true
          }
        }
      }
    }];
    combat.turn_index = 0;
    combat.active_turn_participant_id = casterId;
    manager.combats.set(combatId, combat);

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("fireball")], {
        spellSavingThrowFn: () => ({ final_total: 4 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "fireball",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "target is protected from harmful spells");
    assert.equal(out.payload.gate_result.blocked_spell_level_max, 5);
    assert.equal(out.payload.gate_result.incoming_spell_level, 3);
  }, results);

  runTest("globe_of_invulnerability_does_not_block_higher_level_harmful_spell", () => {
    const casterId = "caster-spell-globe-pass-001";
    const combatId = "combat-spell-globe-pass-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["disintegrate"],
      extraParticipants: [{
        participant_id: "globe-source-ally-002",
        name: "Globe Source Ally",
        team: "heroes",
        position: { x: 4, y: 4 }
      }]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const caster = findParticipant(combat, casterId);
    caster.team = "monsters";
    const globeSourceId = "globe-source-ally-002";
    const protectedTarget = findParticipant(combat, "ally-unrelated-001");
    protectedTarget.position = { x: 4, y: 5 };
    caster.position = { x: 7, y: 7 };
    combat.active_effects = [{
      effect_id: "effect-globe-test-002",
      type: "spell_active_globe_of_invulnerability",
      source: { participant_id: globeSourceId, event_id: null },
      target: { participant_id: globeSourceId },
      duration: { remaining_turns: 10, max_turns: 10 },
      tick_timing: "none",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: {
        spell_id: "globe_of_invulnerability",
        area_tiles: [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 5, y: 4 }],
        zone_behavior: {
          protection_rules: {
            blocks_harmful_spells_up_to_level: 5,
            only_from_outside: true
          }
        }
      }
    }];
    combat.turn_index = 0;
    combat.active_turn_participant_id = casterId;
    manager.combats.set(combatId, combat);

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("disintegrate")], {
        spellSavingThrowFn: () => ({ final_total: 4 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "disintegrate",
        target_id: "ally-unrelated-001"
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.damage_result.damage_type, "force");
  }, results);

  runTest("wall_of_fire_registers_hazard_side_tiles_when_provided", () => {
    const casterId = "caster-spell-wall-fire-001";
    const combatId = "combat-spell-wall-fire-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["wall_of_fire"]
    });

    const out = performCastSpellAction({
      combatManager: manager,
      combat_id: combatId,
      caster_id: casterId,
      spell: getSpellEntry("wall_of_fire"),
      area_tiles: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }],
      hazard_area_tiles: [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }]
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.active_effects_added.length, 1);
    const zoneBehavior = out.payload.active_effects_added[0].modifiers.zone_behavior;
    assert.deepEqual(zoneBehavior.on_enter_damage.area_tiles, [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }]);
    assert.deepEqual(zoneBehavior.on_turn_start_damage.area_tiles, [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }]);
  }, results);

  runTest("wall_of_fire_can_derive_hazard_side_tiles_from_directional_choice", () => {
    const casterId = "caster-spell-wall-fire-side-001";
    const combatId = "combat-spell-wall-fire-side-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["wall_of_fire"]
    });

    const out = performCastSpellAction({
      combatManager: manager,
      combat_id: combatId,
      caster_id: casterId,
      spell: getSpellEntry("wall_of_fire"),
      area_tiles: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }],
      hazard_side: "north"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.active_effects_added.length, 1);
    const zoneBehavior = out.payload.active_effects_added[0].modifiers.zone_behavior;
    assert.deepEqual(zoneBehavior.on_enter_damage.area_tiles, [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }]);
    assert.deepEqual(zoneBehavior.on_turn_start_damage.area_tiles, [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }]);
  }, results);

  runTest("wall_of_fire_can_use_target_positions_as_fallback_area_tiles", () => {
    const casterId = "caster-spell-wall-fire-target-001";
    const targetId = "enemy-spell-001";
    const combatId = "combat-spell-wall-fire-target-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["wall_of_fire"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const target = combat.participants.find((entry) => String(entry && entry.participant_id || "") === targetId);
    target.position = { x: 2, y: 2 };
    manager.combats.set(combatId, combat);

    const out = performCastSpellAction({
      combatManager: manager,
      combat_id: combatId,
      caster_id: casterId,
      target_id: targetId,
      spell: getSpellEntry("wall_of_fire"),
      hazard_side: "north"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.active_effects_added.length, 1);
    assert.deepEqual(out.payload.active_effects_added[0].modifiers.area_tiles, [{ x: 2, y: 2 }]);
    assert.deepEqual(out.payload.active_effects_added[0].modifiers.zone_behavior.on_enter_damage.area_tiles, [{ x: 2, y: 1 }]);
  }, results);

  runTest("wall_of_force_registers_persistent_barrier_zone", () => {
    const casterId = "caster-spell-wall-force-001";
    const combatId = "combat-spell-wall-force-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["wall_of_force"]
    });

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("wall_of_force")]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "wall_of_force",
        area_tiles: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.protection_rules.blocks_hostile_attacks_across_tiles, true);
    assert.equal(out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.protection_rules.blocks_harmful_spells_across_tiles, true);
  }, results);

  runTest("wind_wall_can_apply_initial_save_damage_and_register_barrier_zone", () => {
    const casterId = "caster-spell-wind-wall-001";
    const combatId = "combat-spell-wind-wall-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["wind_wall"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    findParticipant(combat, "enemy-spell-001").position = { x: 2, y: 0 };
    manager.combats.set(combatId, combat);

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("wind_wall")], {
        spellSavingThrowFn: () => ({ final_total: 4 }),
        spellDamageRng: () => 0
      }),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "wind_wall",
        target_id: "enemy-spell-001",
        area_tiles: [{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.cast_spell.saved, false);
    assert.equal(out.payload.cast_spell.damage_result.damage_type, "bludgeoning");
    assert.equal(out.payload.cast_spell.active_effects_added.length, 1);
    const protectionRules = out.payload.cast_spell.active_effects_added[0].modifiers.zone_behavior.protection_rules;
    assert.equal(protectionRules.blocks_ranged_attacks_across_tiles, true);
    assert.equal(protectionRules.blocks_spell_attacks_across_tiles, true);
  }, results);

  runTest("wind_wall_blocks_spell_attack_across_line_tiles", () => {
    const casterId = "caster-spell-wind-wall-block-001";
    const combatId = "combat-spell-wind-wall-block-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["fire_bolt"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const caster = findParticipant(combat, casterId);
    const target = findParticipant(combat, "enemy-spell-001");
    caster.position = { x: 0, y: 0 };
    target.position = { x: 4, y: 0 };
    combat.active_effects = [{
      effect_id: "effect-wind-wall-test-001",
      type: "spell_active_wind_wall",
      source: { participant_id: "ally-unrelated-001", event_id: null },
      target: { participant_id: "ally-unrelated-001" },
      duration: { remaining_turns: 10, max_turns: 10 },
      tick_timing: "none",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: {
        spell_id: "wind_wall",
        area_tiles: [{ x: 2, y: 0 }],
        zone_behavior: {
          protection_rules: {
            blocks_spell_attacks_across_tiles: true
          }
        }
      }
    }];
    manager.combats.set(combatId, combat);

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("fire_bolt")]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "fire_bolt",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "target is protected from harmful spells");
    assert.equal(out.payload.gate_result.block_reason, "spell_attack_barrier");
  }, results);

  runTest("wall_of_force_blocks_harmful_spell_across_barrier_tiles", () => {
    const casterId = "caster-spell-wall-force-block-001";
    const combatId = "combat-spell-wall-force-block-001";
    const manager = createCombatReadyForSpell(combatId, casterId, {
      known_spell_ids: ["fireball"]
    });
    const combat = manager.getCombatById(combatId).payload.combat;
    const caster = findParticipant(combat, casterId);
    const target = findParticipant(combat, "enemy-spell-001");
    caster.position = { x: 0, y: 0 };
    target.position = { x: 4, y: 0 };
    combat.active_effects = [{
      effect_id: "effect-wall-force-test-001",
      type: "spell_active_wall_of_force",
      source: { participant_id: "ally-unrelated-001", event_id: null },
      target: { participant_id: "ally-unrelated-001" },
      duration: { remaining_turns: 10, max_turns: 10 },
      tick_timing: "none",
      stacking_rules: { mode: "refresh", max_stacks: 1 },
      modifiers: {
        spell_id: "wall_of_force",
        area_tiles: [{ x: 2, y: 0 }],
        zone_behavior: {
          protection_rules: {
            blocks_harmful_spells_across_tiles: true,
            blocks_hostile_attacks_across_tiles: true
          }
        }
      }
    }];
    manager.combats.set(combatId, combat);

    const out = processCombatCastSpellRequest({
      context: createCombatContext(manager, [getSpellEntry("fireball")]),
      player_id: casterId,
      combat_id: combatId,
      payload: {
        spell_id: "fireball",
        target_id: "enemy-spell-001"
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "target is protected from harmful spells");
    assert.equal(out.payload.gate_result.block_reason, "spell_barrier");
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
