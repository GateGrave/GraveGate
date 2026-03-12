"use strict";

const { rollAttackRoll, rollHealingRoll } = require("../dice");
const { participantHasCondition, applyConditionToCombatState } = require("../conditions/conditionHelpers");
const { applyDamageToCombatState } = require("../damage/apply-damage-to-combat-state");
const { DAMAGE_TYPES, isSupportedDamageType, normalizeDamageType } = require("../damage/damage-types");
const {
  computeSpellAttackBonus,
  computeSpellSaveDc,
  parseSpellRangeFeet,
  getSpellTargetType,
  resolveSpellActionCost,
  validateSpellKnown,
  validateSpellTargeting,
  validateSpellActionAvailability,
  consumeSpellAction,
  resolveSavingThrowOutcome
} = require("../spells/spellcastingHelpers");
const { gridDistanceFeet } = require("../validation/validation-helpers");

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

function findParticipantById(participants, participantId) {
  return participants.find((entry) => String(entry.participant_id || "") === String(participantId || "")) || null;
}

function ensureParticipantCanCast(combat, caster, actionCost) {
  const casterHp = Number.isFinite(caster.current_hp) ? caster.current_hp : 0;
  if (casterHp <= 0) {
    return failure("cast_spell_action_failed", "defeated participants cannot act", {
      combat_id: String(combat.combat_id || ""),
      caster_id: String(caster.participant_id || ""),
      current_hp: casterHp
    });
  }
  if (participantHasCondition(combat, caster.participant_id, "stunned")) {
    return failure("cast_spell_action_failed", "stunned participants cannot act", {
      combat_id: String(combat.combat_id || ""),
      caster_id: String(caster.participant_id || "")
    });
  }

  const availability = validateSpellActionAvailability(caster, actionCost);
  if (!availability.ok) {
    return failure("cast_spell_action_failed", availability.error, {
      combat_id: String(combat.combat_id || ""),
      caster_id: String(caster.participant_id || ""),
      action_cost: actionCost
    });
  }

  return success("cast_spell_actor_valid");
}

function validateSpellRange(caster, target, spell) {
  const targetType = getSpellTargetType(spell);
  if (targetType === "self") {
    return success("spell_range_valid", {
      distance_feet: 0,
      max_range_feet: 0
    });
  }

  if (!caster || !target || !caster.position || !target.position) {
    return failure("cast_spell_action_failed", "spell target positions are required");
  }

  const distanceFeet = gridDistanceFeet(caster.position, target.position);
  const maxRangeFeet = parseSpellRangeFeet(spell.range);
  if (distanceFeet > maxRangeFeet) {
    return failure("cast_spell_action_failed", "target is out of spell range", {
      distance_feet: distanceFeet,
      max_range_feet: maxRangeFeet
    });
  }

  return success("spell_range_valid", {
    distance_feet: distanceFeet,
    max_range_feet: maxRangeFeet
  });
}

function normalizeTargetParticipantId(casterId, spell, requestedTargetId) {
  const targetType = getSpellTargetType(spell);
  if (targetType === "self") {
    return String(casterId || "");
  }
  return String(requestedTargetId || "");
}

function resolveSpellAttackRoll(input) {
  const attackRollFn = typeof input.attack_roll_fn === "function" ? input.attack_roll_fn : null;
  if (attackRollFn) {
    const out = attackRollFn({
      caster: clone(input.caster),
      target: clone(input.target),
      spell: clone(input.spell),
      modifier: input.modifier
    });
    const total = Number(out && out.final_total !== undefined ? out.final_total : out);
    if (!Number.isFinite(total)) {
      return {
        ok: false,
        error: "spell attack resolver returned a non-numeric result"
      };
    }
    return {
      ok: true,
      payload: {
        roll: out && out.final_total !== undefined ? out : { final_total: total },
        final_total: total
      },
      error: null
    };
  }

  const roll = rollAttackRoll({
    modifier: input.modifier,
    rng: input.attack_roll_rng
  });
  return {
    ok: true,
    payload: {
      roll,
      final_total: Number(roll.final_total)
    },
    error: null
  };
}

function resolveSpellDamageMutation(input) {
  const combat = input.combat;
  const targetId = input.target_id;
  const spell = input.spell;
  const damageType = normalizeDamageType(
    input.damage_type_override || (spell && spell.damage && spell.damage.damage_type)
  );
  if (!damageType || !isSupportedDamageType(damageType)) {
    return failure("cast_spell_action_failed", "spell damage type is not supported", {
      damage_type: damageType || null,
      supported_damage_types: Object.values(DAMAGE_TYPES)
    });
  }

  const damageFormula = spell && spell.damage && spell.damage.dice ? String(spell.damage.dice) : "";
  if (!damageFormula) {
    return failure("cast_spell_action_failed", "spell damage formula is required");
  }

  try {
    const applied = applyDamageToCombatState({
      combat_state: combat,
      target_participant_id: String(targetId),
      damage_type: damageType,
      damage_formula: damageFormula,
      rng: input.damage_rng
    });
    return success("spell_damage_applied", {
      next_combat: applied.next_state,
      damage_result: applied.damage_result
    });
  } catch (error) {
    return failure("cast_spell_action_failed", error.message || "failed to apply spell damage");
  }
}

function resolveConfiguredSpellDamageType(spell, overrideType) {
  return normalizeDamageType(
    overrideType || (spell && spell.damage && spell.damage.damage_type)
  );
}

function resolveHealingMutation(input) {
  const combat = clone(input.combat);
  const target = findParticipantById(combat.participants || [], input.target_id);
  const spell = input.spell;

  if (!target) {
    return failure("cast_spell_action_failed", "healing target not found in combat");
  }

  const healingFormula = spell && spell.healing && spell.healing.dice ? String(spell.healing.dice) : "";
  if (!healingFormula) {
    return failure("cast_spell_action_failed", "spell healing formula is required");
  }

  const roll = rollHealingRoll({
    formula: healingFormula,
    rng: input.healing_rng
  });
  const rolledHealing = Math.max(0, Number(roll.final_total || 0));
  const beforeHp = Number.isFinite(target.current_hp) ? target.current_hp : 0;
  const maxHp = Number.isFinite(target.max_hp) ? target.max_hp : beforeHp;
  const afterHp = Math.min(maxHp, beforeHp + rolledHealing);
  const healedFor = Math.max(0, afterHp - beforeHp);
  target.current_hp = afterHp;
  combat.updated_at = new Date().toISOString();

  return success("spell_healing_applied", {
    next_combat: combat,
    healing_result: {
      roll,
      healing_total: rolledHealing,
      healed_for: healedFor,
      hp_before: beforeHp,
      hp_after: afterHp
    }
  });
}

function resolveAppliedConditions(combat, spell, casterId, targetId, conditionGate) {
  let nextCombat = clone(combat);
  const appliedConditions = [];
  const configured = Array.isArray(spell && spell.applied_conditions)
    ? spell.applied_conditions
    : Array.isArray(spell && spell.effect && spell.effect.applied_conditions)
      ? spell.effect.applied_conditions
      : [];
  const statusHint = spell && spell.effect && spell.effect.status_hint
    ? String(spell.effect.status_hint).trim().toLowerCase()
    : "";
  const implicitConditions = [];

  if (statusHint === "no_reaction_until_next_turn") {
    implicitConditions.push({
      condition_type: "opportunity_attack_immunity",
      duration: { remaining_triggers: 1 },
      expiration_trigger: "start_of_turn",
      metadata: {
        source: "spell_status_hint",
        status_hint: statusHint
      }
    });
  } else if (statusHint === "next_attack_advantage") {
    implicitConditions.push({
      condition_type: "guiding_bolt_marked",
      duration: { remaining_triggers: 1 },
      expiration_trigger: "start_of_source_turn",
      metadata: {
        source: "spell_status_hint",
        status_hint: statusHint
      }
    });
  } else if (statusHint === "speed_reduced") {
    implicitConditions.push({
      condition_type: "speed_reduced",
      duration: { remaining_triggers: 1 },
      expiration_trigger: "start_of_source_turn",
      metadata: {
        source: "spell_status_hint",
        status_hint: statusHint,
        reduction_feet: 10
      }
    });
  }
  const allConfiguredConditions = configured.concat(implicitConditions);

  if (conditionGate === false) {
    return success("spell_conditions_skipped", {
      next_combat: nextCombat,
      applied_conditions: []
    });
  }

  for (let index = 0; index < allConfiguredConditions.length; index += 1) {
    const conditionConfig = allConfiguredConditions[index];
    if (!conditionConfig || typeof conditionConfig !== "object") {
      continue;
    }
    const applied = applyConditionToCombatState(nextCombat, {
      condition_type: conditionConfig.condition_type || conditionConfig.type,
      source_actor_id: String(casterId || ""),
      target_actor_id: String(targetId || ""),
      applied_at_round: Number.isFinite(nextCombat.round) ? nextCombat.round : 1,
      duration: conditionConfig.duration || null,
      expiration_trigger: conditionConfig.expiration_trigger || "manual",
      metadata: conditionConfig.metadata || {}
    });
    if (!applied.ok) {
      return failure("cast_spell_action_failed", applied.error || "failed to apply spell condition");
    }
    nextCombat = applied.next_state;
    appliedConditions.push(clone(applied.condition));
  }

  return success("spell_conditions_applied", {
    next_combat: nextCombat,
    applied_conditions: appliedConditions
  });
}

function resolveDefenseEffect(combat, spell, targetId, casterId) {
  const effect = spell && spell.effect && typeof spell.effect === "object" ? spell.effect : {};
  const defenseRef = effect.defense_ref ? String(effect.defense_ref).trim().toLowerCase() : "";
  if (!defenseRef) {
    return success("spell_defense_effect_skipped", {
      next_combat: clone(combat),
      defense_result: null,
      applied_conditions: []
    });
  }

  const nextCombat = clone(combat);
  const target = findParticipantById(nextCombat.participants || [], targetId);
  if (!target) {
    return failure("cast_spell_action_failed", "defense effect target not found in combat");
  }

  if (defenseRef === "spell_mage_armor_base_ac") {
    const dexterity = Number.isFinite(target && target.stats && target.stats.dexterity)
      ? Number(target.stats.dexterity)
      : 10;
    const dexModifier = Math.floor((dexterity - 10) / 2);
    const newArmorClass = 13 + dexModifier;
    const beforeAc = Number.isFinite(target.armor_class) ? Number(target.armor_class) : 10;
    target.armor_class = Math.max(beforeAc, newArmorClass);
    const conditionOut = resolveAppliedConditions(nextCombat, {
      effect: {
        applied_conditions: [{
          condition_type: "mage_armor",
          expiration_trigger: "manual",
          metadata: {
            armor_class_before: beforeAc,
            armor_class_after: target.armor_class,
            source_spell_id: spell.spell_id || spell.id || null
          }
        }]
      }
    }, casterId, targetId, true);
    if (!conditionOut.ok) {
      return conditionOut;
    }
    return success("spell_defense_effect_applied", {
      next_combat: clone(conditionOut.payload.next_combat),
      defense_result: {
        defense_ref: defenseRef,
        armor_class_before: beforeAc,
        armor_class_after: target.armor_class
      },
      applied_conditions: clone(conditionOut.payload.applied_conditions)
    });
  }

  return failure("cast_spell_action_failed", "spell defense effect is not supported yet", {
    defense_ref: defenseRef,
    spell_id: spell.spell_id || spell.id || null
  });
}

function performCastSpellAction(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;
  const casterId = data.caster_id;
  const spell = data.spell;
  const spellId = spell && (spell.spell_id || spell.id);
  const targetId = normalizeTargetParticipantId(casterId, spell, data.target_id);

  if (!combatManager) {
    return failure("cast_spell_action_failed", "combatManager is required");
  }
  if (!combatId) {
    return failure("cast_spell_action_failed", "combat_id is required");
  }
  if (!casterId) {
    return failure("cast_spell_action_failed", "caster_id is required");
  }
  if (!spell || typeof spell !== "object") {
    return failure("cast_spell_action_failed", "spell metadata is required");
  }
  if (!spellId) {
    return failure("cast_spell_action_failed", "spell_id is required");
  }

  const found = combatManager.getCombatById(combatId);
  if (!found.ok) {
    return failure("cast_spell_action_failed", "combat not found", {
      combat_id: String(combatId)
    });
  }

  let combat = clone(found.payload.combat);
  if (combat.status !== "active") {
    return failure("cast_spell_action_failed", "combat is not active", {
      combat_id: String(combatId),
      status: combat.status
    });
  }

  const caster = findParticipantById(combat.participants || [], casterId);
  if (!caster) {
    return failure("cast_spell_action_failed", "caster not found in combat", {
      combat_id: String(combatId),
      caster_id: String(casterId)
    });
  }

  if (!validateSpellKnown(caster, spellId)) {
    return failure("cast_spell_action_failed", "spell is not known by caster", {
      combat_id: String(combatId),
      caster_id: String(casterId),
      spell_id: String(spellId)
    });
  }

  const actionCost = resolveSpellActionCost(spell);
  if (actionCost === "reaction") {
    return failure("cast_spell_action_failed", "reaction spell casting is not supported in this phase", {
      spell_id: String(spellId)
    });
  }

  const actorValidation = ensureParticipantCanCast(combat, caster, actionCost);
  if (!actorValidation.ok) {
    return actorValidation;
  }

  const initiativeOrder = Array.isArray(combat.initiative_order) ? combat.initiative_order : [];
  const expectedActorId = initiativeOrder[combat.turn_index];
  if (!expectedActorId || String(expectedActorId) !== String(casterId)) {
    return failure("cast_spell_action_failed", "it is not the caster's turn", {
      combat_id: String(combatId),
      caster_id: String(casterId),
      expected_actor_id: expectedActorId || null,
      turn_index: combat.turn_index
    });
  }

  const target = findParticipantById(combat.participants || [], targetId);
  const targetValidation = validateSpellTargeting(spell, caster, target);
  if (!targetValidation.ok) {
    return failure("cast_spell_action_failed", targetValidation.error, targetValidation.payload);
  }

  const rangeValidation = validateSpellRange(caster, target, spell);
  if (!rangeValidation.ok) {
    return rangeValidation;
  }

  const casterIndex = combat.participants.findIndex((entry) => String(entry.participant_id || "") === String(casterId));
  if (casterIndex === -1) {
    return failure("cast_spell_action_failed", "caster not found in combat");
  }
  combat.participants[casterIndex] = consumeSpellAction(combat.participants[casterIndex], actionCost);

  const attackOrSave = spell.attack_or_save && typeof spell.attack_or_save === "object"
    ? spell.attack_or_save
    : { type: "none" };
  const resolutionType = String(attackOrSave.type || "none");
  const configuredDamageType = resolveConfiguredSpellDamageType(spell, data.damage_type);
  let resolutionPayload = {
    attack_roll: null,
    attack_total: null,
    target_armor_class: null,
    save_result: null,
    hit: null,
    saved: null,
    damage_result: null,
    healing_result: null,
    defense_result: null,
    applied_conditions: []
  };

  if (resolutionType === "spell_attack") {
    const attackBonus = computeSpellAttackBonus(caster);
    const attackRoll = resolveSpellAttackRoll({
      caster,
      target,
      spell,
      modifier: attackBonus,
      attack_roll_fn: data.attack_roll_fn,
      attack_roll_rng: data.attack_roll_rng
    });
    if (!attackRoll.ok) {
      return failure("cast_spell_action_failed", attackRoll.error);
    }

    const targetArmorClass = Number.isFinite(target.armor_class) ? target.armor_class : 10;
    const hit = attackRoll.payload.final_total >= targetArmorClass;
    resolutionPayload.attack_roll = clone(attackRoll.payload.roll);
    resolutionPayload.attack_total = attackRoll.payload.final_total;
    resolutionPayload.target_armor_class = targetArmorClass;
    resolutionPayload.hit = hit;

    if (hit && spell.damage) {
      const damageApplied = resolveSpellDamageMutation({
        combat,
        target_id: targetId,
        spell,
        damage_rng: data.damage_rng,
        damage_type_override: data.damage_type
      });
      if (!damageApplied.ok) {
        return damageApplied;
      }
      combat = clone(damageApplied.payload.next_combat);
      resolutionPayload.damage_result = clone(damageApplied.payload.damage_result);
    }

    const conditionsApplied = resolveAppliedConditions(combat, spell, casterId, targetId, hit);
    if (!conditionsApplied.ok) {
      return conditionsApplied;
    }
    combat = clone(conditionsApplied.payload.next_combat);
    resolutionPayload.applied_conditions = clone(conditionsApplied.payload.applied_conditions);
  } else if (resolutionType === "save") {
    const saveAbility = attackOrSave.save_ability || spell.save_type;
    const saveDc = computeSpellSaveDc(caster, spell);
    const saveOut = resolveSavingThrowOutcome({
      participant: target,
      save_ability: saveAbility,
      dc: saveDc,
      saving_throw_fn: data.saving_throw_fn
    });
    if (!saveOut.ok) {
      return failure("cast_spell_action_failed", saveOut.error);
    }
    resolutionPayload.save_result = clone(saveOut.payload);
    resolutionPayload.saved = Boolean(saveOut.payload.success);

    if (spell.damage && !saveOut.payload.success) {
      const damageApplied = resolveSpellDamageMutation({
        combat,
        target_id: targetId,
        spell,
        damage_rng: data.damage_rng,
        damage_type_override: data.damage_type
      });
      if (!damageApplied.ok) {
        return damageApplied;
      }
      combat = clone(damageApplied.payload.next_combat);
      resolutionPayload.damage_result = clone(damageApplied.payload.damage_result);
    }

    const onSave = String(spell.save_outcome || "none").toLowerCase();
    if (spell.damage && saveOut.payload.success && onSave === "half") {
      const targetAfterSave = findParticipantById(combat.participants || [], targetId);
      if (!targetAfterSave) {
        return failure("cast_spell_action_failed", "target missing after save resolution");
      }
      const originalDamage = resolveSpellDamageMutation({
        combat,
        target_id: targetId,
        spell,
        damage_rng: data.damage_rng,
        damage_type_override: data.damage_type
      });
      if (!originalDamage.ok) {
        return originalDamage;
      }
      combat = clone(originalDamage.payload.next_combat);
      const halfDamage = Math.floor(Number(originalDamage.payload.damage_result.final_damage || 0) / 2);
      const currentTarget = findParticipantById(combat.participants || [], targetId);
      const hpBeforeHalf = Number(currentTarget.current_hp) + Number(originalDamage.payload.damage_result.final_damage || 0);
      currentTarget.current_hp = Math.max(0, hpBeforeHalf - halfDamage);
      resolutionPayload.damage_result = Object.assign({}, clone(originalDamage.payload.damage_result), {
        final_damage: halfDamage,
        hp_before: hpBeforeHalf,
        hp_after: currentTarget.current_hp
      });
    }

    const conditionsApplied = resolveAppliedConditions(combat, spell, casterId, targetId, !saveOut.payload.success);
    if (!conditionsApplied.ok) {
      return conditionsApplied;
    }
    combat = clone(conditionsApplied.payload.next_combat);
    resolutionPayload.applied_conditions = clone(conditionsApplied.payload.applied_conditions);
  } else if (resolutionType === "auto_hit") {
    resolutionPayload.hit = true;
    if (spell.damage) {
      const damageApplied = resolveSpellDamageMutation({
        combat,
        target_id: targetId,
        spell,
        damage_rng: data.damage_rng,
        damage_type_override: data.damage_type
      });
      if (!damageApplied.ok) {
        return damageApplied;
      }
      combat = clone(damageApplied.payload.next_combat);
      resolutionPayload.damage_result = clone(damageApplied.payload.damage_result);
    }

    const conditionsApplied = resolveAppliedConditions(combat, spell, casterId, targetId, true);
    if (!conditionsApplied.ok) {
      return conditionsApplied;
    }
    combat = clone(conditionsApplied.payload.next_combat);
    resolutionPayload.applied_conditions = clone(conditionsApplied.payload.applied_conditions);
  } else if (spell.healing) {
    const healingApplied = resolveHealingMutation({
      combat,
      target_id: targetId,
      spell,
      healing_rng: data.healing_rng
    });
    if (!healingApplied.ok) {
      return healingApplied;
    }
    combat = clone(healingApplied.payload.next_combat);
    resolutionPayload.healing_result = clone(healingApplied.payload.healing_result);
  } else if (resolutionType === "none") {
    const defenseApplied = resolveDefenseEffect(combat, spell, targetId, casterId);
    if (!defenseApplied.ok) {
      return defenseApplied;
    }
    combat = clone(defenseApplied.payload.next_combat);
    resolutionPayload.defense_result = clone(defenseApplied.payload.defense_result);
    resolutionPayload.applied_conditions = clone(defenseApplied.payload.applied_conditions || []);
  } else {
    return failure("cast_spell_action_failed", "spell effect type is not supported yet", {
      spell_id: String(spellId),
      resolution_type: resolutionType
    });
  }

  combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
  combat.event_log.push({
    event_type: "cast_spell_action",
    timestamp: new Date().toISOString(),
    caster_id: String(casterId),
    target_id: targetId || null,
    spell_id: String(spellId),
    spell_name: spell.name || null,
    action_cost: actionCost,
    resolution_type: resolutionType,
    range: spell.range || null,
    target_type: getSpellTargetType(spell),
    attack_roll: resolutionPayload.attack_roll,
    attack_total: resolutionPayload.attack_total,
    target_armor_class: resolutionPayload.target_armor_class,
    save_result: resolutionPayload.save_result,
    hit: resolutionPayload.hit,
    saved: resolutionPayload.saved,
    damage_result: resolutionPayload.damage_result,
    healing_result: resolutionPayload.healing_result,
    defense_result: resolutionPayload.defense_result,
    applied_conditions: clone(resolutionPayload.applied_conditions),
    damage_type: resolutionPayload.damage_result
      ? resolutionPayload.damage_result.damage_type
      : (configuredDamageType || null)
  });
  combat.updated_at = new Date().toISOString();
  combatManager.combats.set(String(combatId), clone(combat));

  return success("cast_spell_action_resolved", {
    combat_id: String(combatId),
    caster_id: String(casterId),
    target_id: targetId || null,
    spell_id: String(spellId),
    spell_name: spell.name || null,
    action_cost: actionCost,
    resolution_type: resolutionType,
    damage_type: resolutionPayload.damage_result
      ? resolutionPayload.damage_result.damage_type
      : (configuredDamageType || null),
    attack_roll: resolutionPayload.attack_roll,
    attack_total: resolutionPayload.attack_total,
    target_armor_class: resolutionPayload.target_armor_class,
    save_result: resolutionPayload.save_result,
    hit: resolutionPayload.hit,
    saved: resolutionPayload.saved,
    damage_result: resolutionPayload.damage_result,
    healing_result: resolutionPayload.healing_result,
    defense_result: resolutionPayload.defense_result,
    applied_conditions: clone(resolutionPayload.applied_conditions),
    combat: clone(combat)
  });
}

module.exports = {
  performCastSpellAction
};
