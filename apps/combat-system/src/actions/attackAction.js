"use strict";

const {
  ACTION_TYPES,
  consumeParticipantAction,
  validateParticipantActionAvailability
} = require("./actionEconomy");
const {
  getActiveConditionsForParticipant,
  applyConditionToCombatState,
  participantHasCondition,
  removeConditionFromCombatState,
  normalizeCombatControlConditions
} = require("../conditions/conditionHelpers");
const { resolveConcentrationDamageCheck } = require("../concentration/concentrationState");
const { applyDamageToCombatState } = require("../damage/apply-damage-to-combat-state");
const { DAMAGE_TYPES, isSupportedDamageType, normalizeDamageType } = require("../damage/damage-types");
const {
  rollConditionDiceModifier,
  resolveTargetingProtectionOutcome
} = require("../spells/spellcastingHelpers");
const { gridDistanceFeet } = require("../validation/validation-helpers");
const { validateHarmfulTargetingRestriction } = require("./hostileTargetingRules");
const { participantIsHeavilyObscured } = require("../effects/battlefieldEffectHelpers");

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

function defaultAttackRoll() {
  return Math.floor(Math.random() * 20) + 1;
}

function defaultDamageRoll(attacker) {
  const value = Number(attacker.damage);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function findParticipantById(participants, participantId) {
  return participants.find((p) => String(p.participant_id) === String(participantId)) || null;
}

function toStringOrNull(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function participantHasFeat(participant, featId) {
  const wanted = String(featId || "").trim().toLowerCase();
  if (!wanted || !participant || typeof participant !== "object") {
    return false;
  }
  const feats = Array.isArray(participant.feats) ? participant.feats : [];
  if (feats.some((entry) => String(entry || "").trim().toLowerCase() === wanted)) {
    return true;
  }
  const featFlags = participant.feat_flags && typeof participant.feat_flags === "object"
    ? participant.feat_flags
    : participant.metadata && participant.metadata.feat_flags && typeof participant.metadata.feat_flags === "object"
      ? participant.metadata.feat_flags
      : {};
  return featFlags[wanted] === true;
}

function computeEffectiveArmorClass(combat, target) {
  const baseArmorClass = Number.isFinite(Number(target && target.armor_class))
    ? Number(target.armor_class)
    : 10;
  const activeConditions = getActiveConditionsForParticipant(combat, target && target.participant_id);
  let armorClassBonus = 0;
  let minimumArmorClass = null;

  for (let index = 0; index < activeConditions.length; index += 1) {
    const condition = activeConditions[index];
    const metadata = condition && condition.metadata && typeof condition.metadata === "object"
      ? condition.metadata
      : {};
    if (metadata.apply_armor_class_dynamically !== true) {
      continue;
    }
    const bonus = Number(metadata.armor_class_bonus);
    if (Number.isFinite(bonus)) {
      armorClassBonus += bonus;
    }
    const minimum = Number(
      metadata.minimum_armor_class !== undefined
        ? metadata.minimum_armor_class
        : metadata.armor_class_minimum
    );
    if (Number.isFinite(minimum)) {
      minimumArmorClass = minimumArmorClass === null
        ? minimum
        : Math.max(minimumArmorClass, minimum);
    }
  }

  const totalArmorClass = baseArmorClass + armorClassBonus;
  return minimumArmorClass === null ? totalArmorClass : Math.max(totalArmorClass, minimumArmorClass);
}

function removeConditionTypeFromParticipant(combat, participantId, conditionType) {
  let nextCombat = clone(combat);
  const activeConditions = getActiveConditionsForParticipant(nextCombat, participantId);
  const matching = activeConditions.filter((condition) => {
    return String(condition && condition.condition_type || "") === String(conditionType || "");
  });
  for (let index = 0; index < matching.length; index += 1) {
    const removed = removeConditionFromCombatState(nextCombat, matching[index].condition_id);
    if (!removed.ok) {
      return removed;
    }
    nextCombat = removed.next_state;
  }
  return {
    ok: true,
    next_state: nextCombat,
    removed_count: matching.length
  };
}

function removeBreakOnHarmfulActionConditions(combat, participantId) {
  let nextCombat = clone(combat);
  const activeConditions = getActiveConditionsForParticipant(nextCombat, participantId);
  const toRemove = activeConditions.filter((condition) => {
    const metadata = condition && condition.metadata && typeof condition.metadata === "object"
      ? condition.metadata
      : {};
    return metadata.breaks_on_harmful_action === true;
  });
  let removedCount = 0;
  for (let index = 0; index < toRemove.length; index += 1) {
    const condition = toRemove[index];
    if (!condition || !condition.condition_id) {
      continue;
    }
    const removed = removeConditionFromCombatState(nextCombat, condition.condition_id);
    if (!removed.ok) {
      return removed;
    }
    nextCombat = removed.next_state;
    removedCount += 1;
  }
  return {
    ok: true,
    next_state: nextCombat,
    removed_count: removedCount
  };
}

function resolveAttackDamageProfile(attacker, input) {
  const readiness = attacker && attacker.readiness && typeof attacker.readiness === "object"
    ? attacker.readiness
    : {};
  const weaponProfile = readiness.weapon_profile && typeof readiness.weapon_profile === "object"
    ? readiness.weapon_profile
    : {};
  const weapon = weaponProfile.weapon && typeof weaponProfile.weapon === "object"
    ? weaponProfile.weapon
    : {};
  const explicitFormula = toStringOrNull(input && input.damage_formula);
  const explicitType = normalizeDamageType(input && input.damage_type);
  const attackerFormula = toStringOrNull(attacker && attacker.damage_formula);
  const attackerType = normalizeDamageType(attacker && attacker.damage_type);
  const weaponFormula = toStringOrNull(weapon.damage_dice);
  const weaponType = normalizeDamageType(weapon.damage_type);
  const fallbackDamage = Number.isFinite(Number(attacker && attacker.damage)) ? Math.max(0, Math.floor(Number(attacker.damage))) : 0;

  const damageFormula = explicitFormula || attackerFormula || weaponFormula || "0";
  const damageType = explicitType || attackerType || weaponType || DAMAGE_TYPES.BLUDGEONING;

  return {
    damage_formula: damageFormula,
    damage_type: isSupportedDamageType(damageType) ? damageType : DAMAGE_TYPES.BLUDGEONING,
    flat_modifier: explicitFormula || attackerFormula || weaponFormula ? 0 : fallbackDamage,
    bonus_damage_effects: Array.isArray(attacker && attacker.magical_on_hit_effects)
      ? attacker.magical_on_hit_effects
          .filter((entry) => entry && typeof entry === "object")
          .map((entry) => ({
            item_id: toStringOrNull(entry.item_id),
            item_name: toStringOrNull(entry.item_name),
            damage_dice: toStringOrNull(entry.damage_dice),
            damage_type: normalizeDamageType(entry.damage_type) || DAMAGE_TYPES.FORCE
          }))
          .filter((entry) => entry.damage_dice && isSupportedDamageType(entry.damage_type))
      : []
  };
}

function computeAttackRangeProfile(attacker, target, input) {
  const readiness = attacker && attacker.readiness && typeof attacker.readiness === "object"
    ? attacker.readiness
    : {};
  const weaponProfile = readiness.weapon_profile && typeof readiness.weapon_profile === "object"
    ? readiness.weapon_profile
    : {};
  const weapon = weaponProfile.weapon && typeof weaponProfile.weapon === "object"
    ? weaponProfile.weapon
    : {};
  const weaponClass = String(weaponProfile.weapon_class || weaponProfile.class_id || "").trim().toLowerCase();
  const properties = Array.isArray(weapon.properties)
    ? weapon.properties.map((entry) => String(entry || "").trim().toLowerCase())
    : [];
  const explicitRange = Number(input && input.max_range_feet);
  const normalRange = Number(weapon && weapon.range && weapon.range.normal);
  const maxRangeFeet = Number.isFinite(explicitRange)
    ? explicitRange
    : Number.isFinite(normalRange)
      ? normalRange
      : properties.includes("reach")
        ? 10
        : 5;
  const distanceFeet = attacker && target && attacker.position && target.position
    ? gridDistanceFeet(attacker.position, target.position)
    : null;
  const attackMode = weaponClass.includes("ranged") || (Number.isFinite(distanceFeet) && distanceFeet > 5 && maxRangeFeet > 5)
    ? "ranged"
    : "melee";

  return {
    max_range_feet: maxRangeFeet,
    distance_feet: distanceFeet,
    attack_mode: attackMode
  };
}

function validateActorCanAttack(combat, attacker, options) {
  const settings = options || {};
  const attackerHp = Number.isFinite(attacker.current_hp) ? attacker.current_hp : 0;
  if (attackerHp <= 0) {
    return failure("attack_action_failed", settings.reaction_mode ? "defeated participants cannot react" : "defeated participants cannot act", {
      combat_id: String(combat.combat_id || ""),
      attacker_id: String(attacker.participant_id || ""),
      current_hp: attackerHp
    });
  }
  if (participantHasCondition(combat, attacker.participant_id, "stunned")) {
    return failure("attack_action_failed", settings.reaction_mode ? "stunned participants cannot react" : "stunned participants cannot act", {
      combat_id: String(combat.combat_id || ""),
      attacker_id: String(attacker.participant_id || "")
    });
  }
  if (participantHasCondition(combat, attacker.participant_id, "paralyzed")) {
    return failure("attack_action_failed", settings.reaction_mode ? "paralyzed participants cannot react" : "paralyzed participants cannot act", {
      combat_id: String(combat.combat_id || ""),
      attacker_id: String(attacker.participant_id || "")
    });
  }
  return success("attack_actor_valid");
}

function resolveAttackRoll(input) {
  const data = input || {};
  const attacker = data.attacker;
  const target = data.target;
  const combat = data.combat;
  const attackRollFn = data.attackRollFn;
  const attackerConditions = getActiveConditionsForParticipant(combat, attacker && attacker.participant_id);
  const targetConditions = getActiveConditionsForParticipant(combat, target && target.participant_id);
  const targetIsMarked = targetConditions.some((condition) => String(condition && condition.condition_type || "") === "guiding_bolt_marked");
  const targetIsFaerieLit = targetConditions.some((condition) => String(condition && condition.condition_type || "") === "faerie_fire_lit");
  const targetIsRestrained = targetConditions.some((condition) => String(condition && condition.condition_type || "") === "restrained");
  const targetIsParalyzed = targetConditions.some((condition) => String(condition && condition.condition_type || "") === "paralyzed");
  const targetGrantsAttackAdvantage = targetConditions.some((condition) => {
    const metadata = condition && condition.metadata && typeof condition.metadata === "object" ? condition.metadata : {};
    return metadata.attackers_have_advantage === true;
  });
  const targetImposesDisadvantage = targetConditions.some((condition) => {
    const metadata = condition && condition.metadata && typeof condition.metadata === "object" ? condition.metadata : {};
    return metadata.attackers_have_disadvantage === true;
  });
  const attackerIsPoisoned = attackerConditions.some((condition) => String(condition && condition.condition_type || "") === "poisoned");
  const attackerIsRestrained = attackerConditions.some((condition) => String(condition && condition.condition_type || "") === "restrained");
  const attackerIsProne = attackerConditions.some((condition) => String(condition && condition.condition_type || "") === "prone");
  const attackerIsBlinded = attackerConditions.some((condition) => String(condition && condition.condition_type || "") === "blinded");
  const attackerIsInvisible = attackerConditions.some((condition) => String(condition && condition.condition_type || "") === "invisible");
  const attackerIsFrightened = attackerConditions.some((condition) => String(condition && condition.condition_type || "") === "frightened");
  const targetIsProne = targetConditions.some((condition) => String(condition && condition.condition_type || "") === "prone");
  const targetIsBlinded = targetConditions.some((condition) => String(condition && condition.condition_type || "") === "blinded");
  const targetIsInvisible = targetConditions.some((condition) => String(condition && condition.condition_type || "") === "invisible");
  const attackerIsHeavilyObscured = participantIsHeavilyObscured(combat, attacker);
  const targetIsHeavilyObscured = participantIsHeavilyObscured(combat, target);
  const attackerHasConditionDisadvantage = attackerConditions.some((condition) => {
    const metadata = condition && condition.metadata && typeof condition.metadata === "object" ? condition.metadata : {};
    return metadata.has_attack_disadvantage === true;
  });
  const attackerHasConditionAdvantage = attackerConditions.some((condition) => {
    const metadata = condition && condition.metadata && typeof condition.metadata === "object" ? condition.metadata : {};
    return metadata.has_attack_advantage === true;
  });
  const consumedAttackerCondition = attackerConditions.find((condition) => {
    const metadata = condition && condition.metadata && typeof condition.metadata === "object" ? condition.metadata : {};
    return metadata.consume_on_attack === true && (metadata.has_attack_disadvantage === true || metadata.has_attack_advantage === true);
  }) || null;
  const attackerHasHelpedAttack = attackerConditions.some((condition) => {
    return String(condition && condition.condition_type || "") === "helped_attack";
  });
  const targetProneAdvantage = targetIsProne && data.attack_mode === "melee" && Number(data.distance_feet) <= 5;
  const targetProneDisadvantage = targetIsProne && data.attack_mode === "ranged";
  const targetHasAttackAdvantage =
    targetIsMarked ||
    targetIsFaerieLit ||
    targetIsRestrained ||
    targetIsParalyzed ||
    targetIsBlinded ||
    targetGrantsAttackAdvantage ||
    targetProneAdvantage ||
    attackerIsInvisible ||
    attackerHasConditionAdvantage ||
    attackerHasHelpedAttack;
  const attackerHasAttackDisadvantage =
    attackerIsPoisoned ||
    attackerIsRestrained ||
    attackerIsProne ||
    attackerIsBlinded ||
    attackerIsHeavilyObscured ||
    attackerIsFrightened ||
    targetIsInvisible ||
    targetIsHeavilyObscured ||
    targetImposesDisadvantage ||
    attackerHasConditionDisadvantage ||
    targetProneDisadvantage;

  const targetIsDodging = target && target.is_dodging === true;
  if (!targetIsDodging && !targetHasAttackAdvantage && !attackerHasAttackDisadvantage) {
    const roll = Number(attackRollFn(attacker, target, combat));
    return {
      ok: Number.isFinite(roll),
      roll_mode: "normal",
      roll_values: [roll],
      final_roll: roll
    };
  }

  const hasAdvantage = targetHasAttackAdvantage;
  const hasDisadvantage = targetIsDodging || attackerHasAttackDisadvantage;

  if (hasAdvantage && !hasDisadvantage) {
    const rollA = Number(attackRollFn(attacker, target, combat));
    const rollB = Number(attackRollFn(attacker, target, combat));
    const bothValid = Number.isFinite(rollA) && Number.isFinite(rollB);
    return {
      ok: bothValid,
      roll_mode: "advantage",
      roll_values: [rollA, rollB],
      final_roll: Math.max(rollA, rollB),
      consumed_target_condition_type: targetIsMarked ? "guiding_bolt_marked" : null,
      consumed_attacker_condition_type: attackerHasHelpedAttack ? "helped_attack" : null,
      consumed_attacker_condition_id: consumedAttackerCondition ? String(consumedAttackerCondition.condition_id || "") : null
    };
  }

  if (hasAdvantage && hasDisadvantage) {
    const roll = Number(attackRollFn(attacker, target, combat));
    return {
      ok: Number.isFinite(roll),
      roll_mode: "normal",
      roll_values: [roll],
      final_roll: roll,
      consumed_target_condition_type: targetIsMarked ? "guiding_bolt_marked" : null,
      consumed_attacker_condition_type: attackerHasHelpedAttack ? "helped_attack" : null,
      consumed_attacker_condition_id: consumedAttackerCondition ? String(consumedAttackerCondition.condition_id || "") : null
    };
  }

  const rollA = Number(attackRollFn(attacker, target, combat));
  const rollB = Number(attackRollFn(attacker, target, combat));
  const bothValid = Number.isFinite(rollA) && Number.isFinite(rollB);
  return {
    ok: bothValid,
    roll_mode: "disadvantage",
    roll_values: [rollA, rollB],
    final_roll: Math.min(rollA, rollB),
    consumed_attacker_condition_type: attackerHasHelpedAttack ? "helped_attack" : null,
    consumed_attacker_condition_id: consumedAttackerCondition ? String(consumedAttackerCondition.condition_id || "") : null
  };
}

function resolveAttackAgainstCombatState(input) {
  const data = input || {};
  const combat = clone(data.combat);
  const attackerId = data.attacker_id;
  const targetId = data.target_id;
  const attackRollFn = typeof data.attack_roll_fn === "function" ? data.attack_roll_fn : defaultAttackRoll;
  const damageRollFn = typeof data.damage_roll_fn === "function" ? data.damage_roll_fn : defaultDamageRoll;
  const skipTurnValidation = data.skip_turn_validation === true;
  const logEventType = data.log_event_type || "attack_action";
  const reactionMode = data.reaction_mode === true;

  if (combat.status !== "active") {
    return failure("attack_action_failed", "combat is not active", {
      combat_id: String(combat.combat_id || ""),
      status: combat.status
    });
  }

  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  const attacker = findParticipantById(participants, attackerId);
  const target = findParticipantById(participants, targetId);

  if (!attacker) {
    return failure("attack_action_failed", "attacker not found in combat", {
      combat_id: String(combat.combat_id || ""),
      attacker_id: String(attackerId)
    });
  }
  if (!target) {
    return failure("attack_action_failed", "target not found in combat", {
      combat_id: String(combat.combat_id || ""),
      target_id: String(targetId)
    });
  }
  const attackerValidation = validateActorCanAttack(combat, attacker, {
    reaction_mode: reactionMode
  });
  if (!attackerValidation.ok) {
    return attackerValidation;
  }
  const targetHp = Number.isFinite(target.current_hp) ? target.current_hp : 0;
  if (targetHp <= 0) {
    return failure("attack_action_failed", "target is already defeated", {
      combat_id: String(combat.combat_id || ""),
      target_id: String(targetId),
      current_hp: targetHp
    });
  }
  const hostileTargeting = validateHarmfulTargetingRestriction(combat, attackerId, targetId, {
    condition_type: "charmed",
    error_message: "charmed participants cannot make harmful attacks against the charmer"
  });
  if (!hostileTargeting.ok) {
    return failure("attack_action_failed", hostileTargeting.error, {
      combat_id: String(combat.combat_id || ""),
      attacker_id: String(attackerId),
      target_id: String(targetId),
      gating_condition: hostileTargeting.payload && hostileTargeting.payload.gating_condition
        ? clone(hostileTargeting.payload.gating_condition)
        : null
    });
  }
  const rangeProfile = computeAttackRangeProfile(attacker, target, data);
  if (Number.isFinite(rangeProfile.distance_feet) && rangeProfile.distance_feet > rangeProfile.max_range_feet) {
    return failure("attack_action_failed", "target is out of attack range", {
      combat_id: String(combat.combat_id || ""),
      attacker_id: String(attackerId),
      target_id: String(targetId),
      attack_mode: rangeProfile.attack_mode,
      distance_feet: rangeProfile.distance_feet,
      max_range_feet: rangeProfile.max_range_feet
    });
  }

  if (!skipTurnValidation) {
    const initiativeOrder = Array.isArray(combat.initiative_order) ? combat.initiative_order : [];
    const expectedActorId = initiativeOrder[combat.turn_index];
    if (!expectedActorId || String(expectedActorId) !== String(attackerId)) {
      return failure("attack_action_failed", "it is not the attacker's turn", {
        combat_id: String(combat.combat_id || ""),
        attacker_id: String(attackerId),
        expected_actor_id: expectedActorId || null,
        turn_index: combat.turn_index
      });
    }
  }
  if (!reactionMode) {
    const availability = validateParticipantActionAvailability(attacker, ACTION_TYPES.ATTACK);
    if (!availability.ok) {
      return failure("attack_action_failed", availability.error, availability.payload);
    }
  }

  let updatedCombat = combat;
  const removedSelfWard = removeConditionTypeFromParticipant(updatedCombat, attackerId, "sanctuary");
  if (!removedSelfWard.ok) {
    return failure("attack_action_failed", removedSelfWard.error || "failed to clear attacker ward");
  }
  updatedCombat = removedSelfWard.next_state;
  const removedBreakingConditions = removeBreakOnHarmfulActionConditions(updatedCombat, attackerId);
  if (!removedBreakingConditions.ok) {
    return failure("attack_action_failed", removedBreakingConditions.error || "failed to clear harmful-action conditions");
  }
  updatedCombat = removedBreakingConditions.next_state;

  const refreshedAttacker = findParticipantById(updatedCombat.participants || [], attackerId) || attacker;
  const refreshedTarget = findParticipantById(updatedCombat.participants || [], targetId) || target;
  const targetingProtection = resolveTargetingProtectionOutcome({
    combat_state: updatedCombat,
    source_participant: refreshedAttacker,
    target_participant: refreshedTarget,
    protection_kind: "attack",
    saving_throw_fn: data.targeting_save_fn,
    bonus_rng: data.targeting_save_bonus_rng
  });
  if (!targetingProtection.ok) {
    return failure("attack_action_failed", targetingProtection.error || "failed to resolve targeting protection");
  }
  if (targetingProtection.payload.blocked) {
    return failure("attack_action_failed", "target is protected from hostile attacks", {
      combat_id: String(combat.combat_id || ""),
      attacker_id: String(attackerId),
      target_id: String(targetId),
      gate_result: clone(targetingProtection.payload.gate_result),
      gating_condition: clone(targetingProtection.payload.gating_condition)
    });
  }

  const attackRollResult = resolveAttackRoll({
    attacker: refreshedAttacker,
    target: refreshedTarget,
    combat: updatedCombat,
    attack_mode: rangeProfile.attack_mode,
    distance_feet: rangeProfile.distance_feet,
    attackRollFn
  });
  if (!attackRollResult.ok) {
    return failure("attack_action_failed", "attack_roll_fn returned a non-numeric value");
  }
  const attackRoll = attackRollResult.final_roll;

  const attackBonus = Number.isFinite(refreshedAttacker.attack_bonus) ? refreshedAttacker.attack_bonus : 0;
  const conditionBonus = rollConditionDiceModifier({
    combat_state: updatedCombat,
    participant_id: attackerId,
    positive_condition: "bless",
    negative_condition: "bane",
    rng: data.condition_bonus_rng
  });
  const targetArmorClass = computeEffectiveArmorClass(updatedCombat, refreshedTarget);
  const attackTotal = attackRoll + attackBonus + conditionBonus.total;
  const hit = attackTotal >= targetArmorClass;

  if (attackRollResult.consumed_target_condition_type) {
    const targetConditions = getActiveConditionsForParticipant(updatedCombat, targetId);
    const consumedCondition = targetConditions.find((condition) => {
      return String(condition && condition.condition_type || "") === String(attackRollResult.consumed_target_condition_type);
    });
    if (consumedCondition && consumedCondition.condition_id) {
      const removed = removeConditionFromCombatState(updatedCombat, consumedCondition.condition_id);
      if (removed.ok) {
        updatedCombat = removed.next_state;
      }
    }
  }
  if (attackRollResult.consumed_attacker_condition_type) {
    const attackerConditions = getActiveConditionsForParticipant(updatedCombat, attackerId);
    const consumedCondition = attackerConditions.find((condition) => {
      return String(condition && condition.condition_type || "") === String(attackRollResult.consumed_attacker_condition_type);
    });
    if (consumedCondition && consumedCondition.condition_id) {
      const removed = removeConditionFromCombatState(updatedCombat, consumedCondition.condition_id);
      if (removed.ok) {
        updatedCombat = removed.next_state;
      }
    }
  }
  if (attackRollResult.consumed_attacker_condition_id) {
    const removed = removeConditionFromCombatState(updatedCombat, attackRollResult.consumed_attacker_condition_id);
    if (removed.ok) {
      updatedCombat = removed.next_state;
    }
  }

  let damageDealt = 0;
  let damageResult = null;
  let bonusDamageResults = [];
  let reactiveDamageResults = [];
  let concentrationResult = null;
  const meleeAttack = isMeleeAttack(attacker, target);
  if (hit) {
    const updatedTarget = findParticipantById(updatedCombat.participants || [], targetId);
    if (!updatedTarget) {
      return failure("attack_action_failed", "target not found in combat", {
        combat_id: String(combat.combat_id || ""),
        target_id: String(targetId)
      });
    }
    const damageProfile = resolveAttackDamageProfile(refreshedAttacker, data);
    let damageApplied;
    if (typeof data.damage_roll_fn === "function") {
      const rawDamage = Number(damageRollFn(attacker, target, combat));
      if (!Number.isFinite(rawDamage)) {
        return failure("attack_action_failed", "damage_roll_fn returned a non-numeric value");
      }
      damageApplied = applyDamageToCombatState({
        combat_state: updatedCombat,
        target_participant_id: String(targetId),
        damage_type: damageProfile.damage_type,
        damage_formula: "0",
        flat_modifier: Math.max(0, Math.floor(rawDamage))
      });
    } else {
      damageApplied = applyDamageToCombatState({
        combat_state: updatedCombat,
        target_participant_id: String(targetId),
        damage_type: damageProfile.damage_type,
        damage_formula: damageProfile.damage_formula,
        flat_modifier: damageProfile.flat_modifier,
        rng: data.damage_roll_rng
      });
    }
    updatedCombat = damageApplied.next_state;
    damageDealt = Number(damageApplied.damage_result && damageApplied.damage_result.final_damage) || 0;
    damageResult = clone(damageApplied.damage_result);
    const bonusDamageEffects = Array.isArray(damageProfile.bonus_damage_effects)
      ? damageProfile.bonus_damage_effects
      : [];
    for (let effectIndex = 0; effectIndex < bonusDamageEffects.length; effectIndex += 1) {
      const effect = bonusDamageEffects[effectIndex];
      const bonusApplied = applyDamageToCombatState({
        combat_state: updatedCombat,
        target_participant_id: String(targetId),
        damage_type: effect.damage_type,
        damage_formula: effect.damage_dice,
        rng: data.damage_roll_rng
      });
      updatedCombat = bonusApplied.next_state;
      const finalDamage = Number(bonusApplied.damage_result && bonusApplied.damage_result.final_damage) || 0;
      damageDealt += finalDamage;
      bonusDamageResults.push(Object.assign({}, clone(bonusApplied.damage_result), {
        source_item_id: effect.item_id || null,
        source_item_name: effect.item_name || null
      }));
    }
    const concentrationCheck = resolveConcentrationDamageCheck(updatedCombat, targetId, damageDealt, data.concentration_save_rng);
    if (!concentrationCheck.ok) {
      return failure("attack_action_failed", concentrationCheck.error || "failed to resolve concentration check");
    }
    updatedCombat = concentrationCheck.next_state;
    concentrationResult = concentrationCheck.concentration_result || null;

    const reactiveDamageOut = resolveReactiveDamageEffects({
      combat: updatedCombat,
      attacker_id: attackerId,
      target_id: targetId,
      trigger: "melee_hit_taken",
      attack_was_melee: meleeAttack,
      target_damage_result: damageResult,
      damage_rng: data.damage_roll_rng,
      concentration_save_rng: data.concentration_save_rng
    });
    if (!reactiveDamageOut.ok) {
      return reactiveDamageOut;
    }
    updatedCombat = clone(reactiveDamageOut.payload.next_state);
    reactiveDamageResults = clone(reactiveDamageOut.payload.reactive_damage_results || []);
  }
  const mobileProtection = applyMobileOpportunityAttackProtection(updatedCombat, attacker, target, meleeAttack);
  if (!mobileProtection.ok) {
    return mobileProtection;
  }
  updatedCombat = clone(mobileProtection.payload.next_state);
  const normalizedConditions = normalizeCombatControlConditions(updatedCombat);
  if (!normalizedConditions.ok) {
    return failure("attack_action_failed", normalizedConditions.error || "failed to normalize combat conditions");
  }
  updatedCombat = clone(normalizedConditions.next_state);
  if (!reactionMode) {
    const attackerIndex = participants.findIndex((entry) => String(entry.participant_id || "") === String(attackerId));
    if (attackerIndex !== -1) {
      const updatedAttacker = findParticipantById(updatedCombat.participants || [], attackerId) || attacker;
      const consumed = consumeParticipantAction(updatedAttacker, ACTION_TYPES.ATTACK);
      if (!consumed.ok) {
        return failure("attack_action_failed", consumed.error, consumed.payload);
      }
      updatedCombat.participants[attackerIndex] = consumed.payload.participant;
    }
  }

  const finalTarget = findParticipantById(updatedCombat.participants || [], targetId);
  const finalTargetHp = Number.isFinite(finalTarget && finalTarget.current_hp) ? finalTarget.current_hp : 0;

  updatedCombat.event_log = Array.isArray(updatedCombat.event_log) ? updatedCombat.event_log : [];
  updatedCombat.event_log.push({
    event_type: logEventType,
    timestamp: new Date().toISOString(),
    attacker_id: String(attackerId),
    target_id: String(targetId),
    attack_roll: attackRoll,
    attack_roll_mode: attackRollResult.roll_mode,
    attack_roll_values: clone(attackRollResult.roll_values),
    attack_bonus: attackBonus,
    condition_bonus: conditionBonus.total,
    bless_roll: clone(conditionBonus.positive_roll),
    bane_roll: clone(conditionBonus.negative_roll),
    attack_total: attackTotal,
    target_armor_class: targetArmorClass,
    attack_mode: rangeProfile.attack_mode,
    max_range_feet: rangeProfile.max_range_feet,
    distance_feet: rangeProfile.distance_feet,
    damage_type: hit ? resolveAttackDamageProfile(attacker, data).damage_type : null,
    hit,
    damage_dealt: damageDealt,
    damage_result: clone(damageResult),
    bonus_damage_results: clone(bonusDamageResults),
    reactive_damage_results: clone(reactiveDamageResults),
    target_hp_after: finalTargetHp,
    reaction_mode: reactionMode,
    consumed_target_condition_type: attackRollResult.consumed_target_condition_type || null,
    consumed_attacker_condition_type: attackRollResult.consumed_attacker_condition_type || null,
    consumed_attacker_condition_id: attackRollResult.consumed_attacker_condition_id || null,
    concentration_result: clone(concentrationResult)
  });
  updatedCombat.updated_at = new Date().toISOString();

  return success("attack_action_resolved", {
    combat_id: String(updatedCombat.combat_id || ""),
    attacker_id: String(attackerId),
    target_id: String(targetId),
    hit,
    attack_roll: attackRoll,
    attack_roll_mode: attackRollResult.roll_mode,
    attack_roll_values: clone(attackRollResult.roll_values),
    attack_bonus: attackBonus,
    condition_bonus: conditionBonus.total,
    attack_total: attackTotal,
    target_armor_class: targetArmorClass,
    attack_mode: rangeProfile.attack_mode,
    max_range_feet: rangeProfile.max_range_feet,
    distance_feet: rangeProfile.distance_feet,
    damage_type: hit ? resolveAttackDamageProfile(attacker, data).damage_type : null,
    damage_dealt: damageDealt,
    damage_result: clone(damageResult),
    bonus_damage_results: clone(bonusDamageResults),
    reactive_damage_results: clone(reactiveDamageResults),
    target_hp_after: finalTargetHp,
    concentration_result: clone(concentrationResult),
    combat: clone(updatedCombat)
  });
}

function isMeleeAttack(attacker, target) {
  if (!attacker || !target || !attacker.position || !target.position) {
    return false;
  }
  return gridDistanceFeet(attacker.position, target.position) <= 5;
}

function applyMobileOpportunityAttackProtection(combat, attacker, target, wasMeleeAttack) {
  if (!wasMeleeAttack || !participantHasFeat(attacker, "mobile")) {
    return success("mobile_opportunity_attack_protection_skipped", {
      next_state: combat,
      applied_condition: null
    });
  }

  const applied = applyConditionToCombatState(combat, {
    condition_type: "opportunity_attack_immunity",
    source_actor_id: String(attacker.participant_id || ""),
    target_actor_id: String(attacker.participant_id || ""),
    applied_at_round: Number.isFinite(Number(combat.round)) ? Number(combat.round) : 1,
    expiration_trigger: "start_of_turn",
    metadata: {
      source: "mobile_feat",
      blocked_reactor_id: String(target && target.participant_id || "") || null
    }
  });
  if (!applied.ok) {
    return failure("attack_action_failed", applied.error || "failed to apply mobile opportunity attack protection");
  }
  return success("mobile_opportunity_attack_protection_applied", {
    next_state: applied.next_state,
    applied_condition: clone(applied.condition)
  });
}

function resolveReactiveDamageEffects(input) {
  const combat = clone(input.combat);
  const attacker = findParticipantById(combat.participants || [], input.attacker_id);
  const target = findParticipantById(combat.participants || [], input.target_id);
  if (!attacker || !target || input.attack_was_melee !== true) {
    return success("attack_reactive_damage_skipped", {
      next_state: combat,
      reactive_damage_results: []
    });
  }

  let nextCombat = combat;
  const effects = [];
  const targetReactiveEffects = Array.isArray(target.magical_reactive_effects)
    ? target.magical_reactive_effects
    : [];
  for (let index = 0; index < targetReactiveEffects.length; index += 1) {
    const effect = targetReactiveEffects[index];
    if (!effect || String(effect.trigger || "").trim().toLowerCase() !== String(input.trigger || "").trim().toLowerCase()) {
      continue;
    }
    effects.push({
      source_item_id: effect.item_id || null,
      source_item_name: effect.item_name || null,
      damage_formula: String(effect.damage_dice || "0"),
      flat_modifier: Number(effect.flat_modifier || 0),
      damage_type: normalizeDamageType(effect.damage_type) || DAMAGE_TYPES.FORCE
    });
  }

  const armorOfAgathys = getActiveConditionsForParticipant(nextCombat, input.target_id).find((condition) => {
    return String(condition && condition.condition_type || "") === "armor_of_agathys";
  });
  const tempHpBefore = input.target_damage_result && Number.isFinite(Number(input.target_damage_result.temporary_hp_before))
    ? Number(input.target_damage_result.temporary_hp_before)
    : 0;
  const tempHpAfter = input.target_damage_result && Number.isFinite(Number(input.target_damage_result.temporary_hp_after))
    ? Number(input.target_damage_result.temporary_hp_after)
    : 0;
  if (armorOfAgathys && tempHpBefore > 0) {
    const metadata = armorOfAgathys.metadata && typeof armorOfAgathys.metadata === "object" ? armorOfAgathys.metadata : {};
    const retaliationDamage = Number(metadata.retaliation_damage || 0);
    effects.push({
      source_condition_id: armorOfAgathys.condition_id || null,
      source_condition_type: "armor_of_agathys",
      damage_formula: "0",
      flat_modifier: Number.isFinite(retaliationDamage) ? Math.max(0, Math.floor(retaliationDamage)) : 0,
      damage_type: normalizeDamageType(metadata.retaliation_damage_type) || DAMAGE_TYPES.COLD
    });
  }

  const reactiveDamageResults = [];
  for (let effectIndex = 0; effectIndex < effects.length; effectIndex += 1) {
    const effect = effects[effectIndex];
    const applied = applyDamageToCombatState({
      combat_state: nextCombat,
      target_participant_id: String(input.attacker_id),
      damage_type: effect.damage_type,
      damage_formula: effect.damage_formula,
      flat_modifier: effect.flat_modifier,
      rng: input.damage_rng
    });
    nextCombat = applied.next_state;
    const finalDamage = Number(applied.damage_result && applied.damage_result.final_damage) || 0;
    const concentrationCheck = resolveConcentrationDamageCheck(nextCombat, input.attacker_id, finalDamage, input.concentration_save_rng);
    if (!concentrationCheck.ok) {
      return failure("attack_action_failed", concentrationCheck.error || "failed to resolve reactive concentration check");
    }
    nextCombat = concentrationCheck.next_state;
    reactiveDamageResults.push(Object.assign({}, clone(applied.damage_result), {
      source_item_id: effect.source_item_id || null,
      source_item_name: effect.source_item_name || null,
      source_condition_id: effect.source_condition_id || null,
      source_condition_type: effect.source_condition_type || null,
      concentration_result: clone(concentrationCheck.concentration_result || null)
    }));
  }

  if (armorOfAgathys && tempHpBefore > 0 && tempHpAfter <= 0 && armorOfAgathys.condition_id) {
    const removed = removeConditionFromCombatState(nextCombat, armorOfAgathys.condition_id);
    if (removed.ok) {
      nextCombat = removed.next_state;
    }
  }

  return success("attack_reactive_damage_resolved", {
    next_state: nextCombat,
    reactive_damage_results: reactiveDamageResults
  });
}

// Stage 1 simple attack flow (no advanced gameplay rules yet).
function performAttackAction(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;
  const attackerId = data.attacker_id;
  const targetId = data.target_id;

  if (!combatManager) {
    return failure("attack_action_failed", "combatManager is required");
  }
  if (!combatId) {
    return failure("attack_action_failed", "combat_id is required");
  }
  if (!attackerId) {
    return failure("attack_action_failed", "attacker_id is required");
  }
  if (!targetId) {
    return failure("attack_action_failed", "target_id is required");
  }

  const found = combatManager.getCombatById(combatId);
  if (!found.ok) {
    return failure("attack_action_failed", "combat not found", { combat_id: String(combatId) });
  }

  const out = resolveAttackAgainstCombatState({
    combat: found.payload.combat,
    attacker_id: attackerId,
    target_id: targetId,
    attack_roll_fn: data.attack_roll_fn,
    damage_roll_fn: data.damage_roll_fn,
    targeting_save_fn: data.targeting_save_fn,
    targeting_save_bonus_rng: data.targeting_save_bonus_rng,
    concentration_save_rng: data.concentration_save_rng,
    condition_bonus_rng: data.condition_bonus_rng
  });
  if (!out.ok) {
    return out;
  }

  combatManager.combats.set(String(combatId), clone(out.payload.combat));
  return out;
}

module.exports = {
  performAttackAction,
  resolveAttackAgainstCombatState
};
