"use strict";

const { rollAttackRoll, rollHealingRoll } = require("../dice");
const {
  getActiveConditionsForParticipant,
  participantHasCondition,
  applyConditionToCombatState,
  removeConditionFromCombatState,
  normalizeCombatControlConditions
} = require("../conditions/conditionHelpers");
const { applyDamageToCombatState } = require("../damage/apply-damage-to-combat-state");
const { DAMAGE_TYPES, isSupportedDamageType, normalizeDamageType } = require("../damage/damage-types");
const {
  startParticipantConcentration,
  resolveConcentrationDamageCheck
} = require("../concentration/concentrationState");
const {
  computeSpellAttackBonus,
  computeSpellSaveDc,
  getParticipantAbilityModifier,
  parseSpellRangeFeet,
  getSpellTargetType,
  resolveSpellActionCost,
  isCantripSpell,
  validateSpellKnown,
  validateSpellTargeting,
  validateSpellActionAvailability,
  consumeSpellAction,
  resolveSavingThrowOutcome,
  resolveTargetingProtectionOutcome
} = require("../spells/spellcastingHelpers");
const { createStatusEffect, addEffect, TICK_TIMING, STACKING_MODES } = require("../status-effects");
const { gridDistanceFeet } = require("../validation/validation-helpers");
const { validateHarmfulTargetingRestriction } = require("./hostileTargetingRules");
const { getParticipantIncapacitationType } = require("../conditions/conditionHelpers");
const { participantIsHeavilyObscured } = require("../effects/battlefieldEffectHelpers");

const BATTLEFIELD_SIZE = 9;

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

function participantHasFeatFlag(participant, flagKey) {
  const key = String(flagKey || "").trim();
  if (!key || !participant || typeof participant !== "object") {
    return false;
  }
  const featFlags = participant.feat_flags && typeof participant.feat_flags === "object"
    ? participant.feat_flags
    : participant.metadata && participant.metadata.feat_flags && typeof participant.metadata.feat_flags === "object"
      ? participant.metadata.feat_flags
      : {};
  return featFlags[key] === true;
}

function removeConditionTypeFromParticipant(combat, participantId, conditionType) {
  let nextCombat = clone(combat);
  const matches = (Array.isArray(nextCombat.conditions) ? nextCombat.conditions : []).filter((condition) => {
    return String(condition && condition.target_actor_id || "") === String(participantId || "") &&
      String(condition && condition.condition_type || "") === String(conditionType || "");
  });
  for (let index = 0; index < matches.length; index += 1) {
    const removed = removeConditionFromCombatState(nextCombat, matches[index].condition_id);
    if (!removed.ok) {
      return removed;
    }
    nextCombat = clone(removed.next_state);
  }
  return {
    ok: true,
    next_state: nextCombat,
    removed_count: matches.length
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
    nextCombat = clone(removed.next_state);
    removedCount += 1;
  }
  return {
    ok: true,
    next_state: nextCombat,
    removed_count: removedCount
  };
}

function isHarmfulSpellAgainstTarget(caster, target, spell) {
  if (!caster || !target || !spell || typeof spell !== "object") {
    return false;
  }
  if (String(caster.team || "") === String(target.team || "")) {
    return false;
  }
  if (spell.damage) {
    return true;
  }
  const attackOrSave = spell.attack_or_save && typeof spell.attack_or_save === "object"
    ? spell.attack_or_save
    : {};
  const resolutionType = String(attackOrSave.type || "none").trim().toLowerCase();
  if (resolutionType === "spell_attack" || resolutionType === "auto_hit" || resolutionType === "save") {
    return true;
  }
  const effect = spell.effect && typeof spell.effect === "object" ? spell.effect : {};
  if (effect.debuff_ref) {
    return true;
  }
  if (Array.isArray(effect.applied_conditions) && effect.applied_conditions.length > 0) {
    return true;
  }
  const statusHint = String(effect.status_hint || "").trim().toLowerCase();
  return ["outlined_for_advantage", "hold_person", "entangle", "no_reaction_until_next_turn"].includes(statusHint);
}

function ensureParticipantCanCast(combat, caster, actionCost, spell) {
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
  if (participantHasCondition(combat, caster.participant_id, "paralyzed")) {
    return failure("cast_spell_action_failed", "paralyzed participants cannot act", {
      combat_id: String(combat.combat_id || ""),
      caster_id: String(caster.participant_id || "")
    });
  }

  const availability = validateSpellActionAvailability(caster, actionCost, spell);
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
  if ([
    "cone_15ft",
    "cube_15ft",
    "line_100ft_5ft",
    "sphere_20ft",
    "sphere_10ft",
    "aura_15ft",
    "cylinder_20ft"
  ].includes(targetType)) {
    return success("spell_range_valid", {
      distance_feet: null,
      max_range_feet: parseSpellRangeFeet(spell.range),
      area_targeting: true
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

function normalizeTargetParticipantIds(casterId, spell, requestedTargetId, requestedTargetIds) {
  const targetType = getSpellTargetType(spell);
  if (targetType === "self") {
    return [String(casterId || "")];
  }
  const explicitIds = Array.isArray(requestedTargetIds) ? requestedTargetIds : [];
  const normalized = explicitIds
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (normalized.length > 0) {
    return Array.from(new Set(normalized));
  }
  const fallbackTargetId = String(requestedTargetId || "").trim();
  return fallbackTargetId ? [fallbackTargetId] : [];
}

function isInsideBounds(position) {
  if (!position || typeof position !== "object") {
    return false;
  }
  const x = Number(position.x);
  const y = Number(position.y);
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x < BATTLEFIELD_SIZE && y >= 0 && y < BATTLEFIELD_SIZE;
}

function isOccupiedByOtherParticipant(combat, targetId, position) {
  const participants = Array.isArray(combat && combat.participants) ? combat.participants : [];
  return participants.some((participant) => {
    if (String(participant && participant.participant_id || "") === String(targetId || "")) {
      return false;
    }
    const participantPosition = participant && participant.position && typeof participant.position === "object"
      ? participant.position
      : null;
    return participantPosition &&
      Number(participantPosition.x) === Number(position.x) &&
      Number(participantPosition.y) === Number(position.y);
  });
}

function computePushPath(casterPosition, targetPosition, tiles) {
  if (!casterPosition || !targetPosition) {
    return [];
  }
  const dx = Number(targetPosition.x) - Number(casterPosition.x);
  const dy = Number(targetPosition.y) - Number(casterPosition.y);
  const stepX = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
  const stepY = dy === 0 ? 0 : (dy > 0 ? 1 : -1);
  if (stepX === 0 && stepY === 0) {
    return [];
  }
  const steps = [];
  let currentX = Number(targetPosition.x);
  let currentY = Number(targetPosition.y);
  for (let index = 0; index < tiles; index += 1) {
    currentX += stepX;
    currentY += stepY;
    steps.push({ x: currentX, y: currentY });
  }
  return steps;
}

function resolveMovementPoolFeet(participant) {
  if (Number.isFinite(Number(participant && participant.movement_remaining))) {
    return Math.max(0, Number(participant.movement_remaining));
  }
  if (Number.isFinite(Number(participant && participant.movement_speed))) {
    return Math.max(0, Number(participant.movement_speed));
  }
  return 30;
}

function computeRetreatPath(sourcePosition, targetPosition, tiles) {
  if (!sourcePosition || !targetPosition) {
    return [];
  }
  const dx = Number(targetPosition.x) - Number(sourcePosition.x);
  const dy = Number(targetPosition.y) - Number(sourcePosition.y);
  const stepX = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
  const stepY = dy === 0 ? 0 : (dy > 0 ? 1 : -1);
  if (stepX === 0 && stepY === 0) {
    return [];
  }
  const steps = [];
  let currentX = Number(targetPosition.x);
  let currentY = Number(targetPosition.y);
  for (let index = 0; index < tiles; index += 1) {
    currentX += stepX;
    currentY += stepY;
    steps.push({ x: currentX, y: currentY });
  }
  return steps;
}

function resolveForcedMovementRider(combat, spell, caster, target) {
  const effect = spell && spell.effect && typeof spell.effect === "object" ? spell.effect : {};
  const statusHint = String(effect.status_hint || "").trim().toLowerCase();
  if (!["push_10_feet_on_fail", "flee_on_fail_using_reaction"].includes(statusHint)) {
    return success("spell_forced_movement_skipped", {
      next_combat: clone(combat),
      forced_movement_result: null
    });
  }
  if (!caster || !target || !caster.position || !target.position) {
    return success("spell_forced_movement_skipped", {
      next_combat: clone(combat),
      forced_movement_result: null
    });
  }

  const nextCombat = clone(combat);
  const targetId = String(target.participant_id || "");
  const targetIndex = Array.isArray(nextCombat.participants)
    ? nextCombat.participants.findIndex((entry) => String(entry && entry.participant_id || "") === targetId)
    : -1;
  if (targetIndex === -1) {
    return failure("cast_spell_action_failed", "forced movement target not found in combat");
  }

  const currentTarget = nextCombat.participants[targetIndex];
  const startPosition = currentTarget && currentTarget.position ? clone(currentTarget.position) : null;
  let path = [];
  if (statusHint === "push_10_feet_on_fail") {
    path = computePushPath(caster.position, currentTarget.position, 2);
  } else {
    const incapacitationType = getParticipantIncapacitationType(nextCombat, targetId);
    if (incapacitationType || currentTarget.reaction_available !== true) {
      return success("spell_forced_movement_skipped", {
        next_combat: nextCombat,
        forced_movement_result: {
          moved: false,
          blocked: false,
          reason: incapacitationType ? `cannot_react_${incapacitationType}` : "reaction_unavailable",
          from_position: startPosition,
          to_position: startPosition,
          tiles_moved: 0
        }
      });
    }
    const retreatTiles = Math.max(1, Math.floor(resolveMovementPoolFeet(currentTarget) / 5));
    path = computeRetreatPath(caster.position, currentTarget.position, retreatTiles);
  }
  let finalPosition = startPosition ? clone(startPosition) : null;
  let tilesMoved = 0;
  for (let index = 0; index < path.length; index += 1) {
    const candidate = path[index];
    if (!isInsideBounds(candidate) || isOccupiedByOtherParticipant(nextCombat, targetId, candidate)) {
      break;
    }
    finalPosition = clone(candidate);
    tilesMoved += 1;
  }

  if (!finalPosition || tilesMoved <= 0) {
    return success("spell_forced_movement_skipped", {
      next_combat: nextCombat,
      forced_movement_result: {
        moved: false,
        blocked: true,
        reason: "path_blocked",
        from_position: startPosition,
        to_position: startPosition,
        tiles_moved: 0
      }
    });
  }

  nextCombat.participants[targetIndex] = Object.assign({}, currentTarget, {
    position: clone(finalPosition),
    reaction_available: statusHint === "flee_on_fail_using_reaction" ? false : currentTarget.reaction_available
  });
  return success("spell_forced_movement_applied", {
    next_combat: nextCombat,
    forced_movement_result: {
      moved: true,
      blocked: false,
      reason: statusHint === "flee_on_fail_using_reaction" ? "reaction_forced_movement" : "spell_push",
      from_position: startPosition,
      to_position: clone(finalPosition),
      tiles_moved: tilesMoved
    }
  });
}

function validateTargetSelectionCount(spell, targetIds) {
  const targetType = getSpellTargetType(spell);
  const count = Array.isArray(targetIds) ? targetIds.length : 0;
  if (targetType === "self") {
    return count === 1
      ? success("spell_target_count_valid", { target_count: count })
      : failure("cast_spell_action_failed", "self-target spell requires exactly one target");
  }
  if (targetType === "single_target") {
    return count === 1
      ? success("spell_target_count_valid", { target_count: count })
      : failure("cast_spell_action_failed", "spell requires exactly one target");
  }
  if (targetType === "up_to_three_allies" || targetType === "up_to_three_enemies" || targetType === "single_or_split_target") {
    return count >= 1 && count <= 3
      ? success("spell_target_count_valid", { target_count: count })
      : failure("cast_spell_action_failed", "spell requires between 1 and 3 targets");
  }
  if ([
    "cone_15ft",
    "cube_15ft",
    "line_100ft_5ft",
    "sphere_20ft",
    "sphere_10ft",
    "aura_15ft",
    "cylinder_20ft"
  ].includes(targetType)) {
    return count >= 1
      ? success("spell_target_count_valid", { target_count: count })
      : failure("cast_spell_action_failed", "area spell requires at least one target");
  }
  return count === 1
    ? success("spell_target_count_valid", { target_count: count })
    : failure("cast_spell_action_failed", "spell requires a valid target");
}

function parseSpellDurationTurns(durationText) {
  const text = String(durationText || "").trim().toLowerCase();
  const match = text.match(/(\d+)\s*(round|rounds|minute|minutes|hour|hours)/);
  if (!match) {
    return 1;
  }
  const amount = Math.max(1, Number(match[1]));
  const unit = match[2];
  if (unit.startsWith("round")) {
    return amount;
  }
  if (unit.startsWith("minute")) {
    return amount * 10;
  }
  if (unit.startsWith("hour")) {
    return amount * 600;
  }
  return 1;
}

function shouldRegisterPersistentSpellEffect(spell) {
  if (!spell || typeof spell !== "object") {
    return false;
  }
  const durationText = String(spell.duration || "").trim().toLowerCase();
  if (!durationText || durationText === "instantaneous") {
    return false;
  }
  const targetType = getSpellTargetType(spell);
  const effect = spell.effect && typeof spell.effect === "object" ? spell.effect : {};
  return [
    "cone_15ft",
    "cube_15ft",
    "line_100ft_5ft",
    "sphere_20ft",
    "sphere_10ft",
    "aura_15ft",
    "cylinder_20ft"
  ].includes(targetType) || ["area", "aura"].includes(String(effect.targeting || "").trim().toLowerCase());
}

function normalizeAreaTiles(areaTiles) {
  const list = Array.isArray(areaTiles) ? areaTiles : [];
  return list
    .map((entry) => {
      const x = Number(entry && entry.x);
      const y = Number(entry && entry.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }
      return { x: Math.floor(x), y: Math.floor(y) };
    })
    .filter(Boolean);
}

function resolvePersistentZoneBehavior(spell, caster, targetIds) {
  const spellId = String(spell && (spell.spell_id || spell.id) || "").trim().toLowerCase();
  const saveAbility = spell && spell.attack_or_save && spell.attack_or_save.save_ability
    ? String(spell.attack_or_save.save_ability).trim().toLowerCase()
    : null;
  const saveDc = computeSpellSaveDc(caster, spell);
  const damage = spell && spell.damage && typeof spell.damage === "object" ? spell.damage : {};
  if (spellId === "grease") {
    return {
      terrain_kind: "difficult",
      on_enter_condition: {
        save_ability: "dexterity",
        save_dc: saveDc,
        condition_type: "prone",
        expiration_trigger: "manual",
        metadata: {
          source_spell_id: spellId
        }
      },
      on_turn_start_condition: {
        save_ability: "dexterity",
        save_dc: saveDc,
        condition_type: "prone",
        expiration_trigger: "manual",
        metadata: {
          source_spell_id: spellId
        }
      }
    };
  }
  if (spellId === "web") {
    return {
      terrain_kind: "difficult",
      on_enter_condition: {
        save_ability: "dexterity",
        save_dc: saveDc,
        condition_type: "restrained",
        expiration_trigger: "manual",
        metadata: {
          source_spell_id: spellId
        }
      },
      on_turn_start_condition: {
        save_ability: "dexterity",
        save_dc: saveDc,
        condition_type: "restrained",
        expiration_trigger: "manual",
        metadata: {
          source_spell_id: spellId
        }
      }
    };
  }
  if (spellId === "moonbeam") {
    return {
      on_enter_damage: {
        save_ability: saveAbility || "constitution",
        save_dc: saveDc,
        damage_formula: typeof damage.dice === "string" ? damage.dice : null,
        damage_type: normalizeDamageType(damage.damage_type),
        save_result: "half_damage_on_success"
      },
      on_turn_start_damage: {
        save_ability: saveAbility || "constitution",
        save_dc: saveDc,
        damage_formula: typeof damage.dice === "string" ? damage.dice : null,
        damage_type: normalizeDamageType(damage.damage_type),
        save_result: "half_damage_on_success"
      }
    };
  }
  if (spellId === "entangle") {
    return {
      terrain_kind: "difficult",
      save_ability: saveAbility,
      save_dc: saveDc,
      affected_target_ids: Array.isArray(targetIds) ? clone(targetIds) : []
    };
  }
  if (spellId === "spirit_guardians") {
    return {
      hostile_only: true,
      on_turn_start_damage: {
        save_ability: saveAbility || "wisdom",
        save_dc: saveDc,
        damage_formula: typeof damage.dice === "string" ? damage.dice : null,
        damage_type: normalizeDamageType(damage.damage_type),
        save_result: "half_damage_on_success"
      }
    };
  }
  return null;
}

function resolvePersistentSpellActiveEffect(combat, spell, caster, casterId, targetIds, areaTiles) {
  if (!shouldRegisterPersistentSpellEffect(spell)) {
    return success("spell_active_effect_skipped", {
      next_combat: clone(combat),
      active_effects_added: []
    });
  }

  const effectData = spell.effect && typeof spell.effect === "object" ? spell.effect : {};
  const spellId = String(spell.spell_id || spell.id || "").trim();
  const normalizedAreaTiles = normalizeAreaTiles(areaTiles);
  const zoneBehavior = resolvePersistentZoneBehavior(spell, caster, targetIds);
  const createdEffect = createStatusEffect({
    type: `spell_active_${spellId || "unknown"}`,
    source: {
      participant_id: String(casterId || ""),
      event_id: null
    },
    target: {
      participant_id: String(casterId || "")
    },
    duration: {
      remaining_turns: parseSpellDurationTurns(spell.duration),
      max_turns: parseSpellDurationTurns(spell.duration)
    },
    tick_timing: TICK_TIMING.NONE,
    stacking_rules: {
      mode: STACKING_MODES.REFRESH,
      max_stacks: 1
    },
    modifiers: {
      spell_id: spellId || null,
      spell_name: spell.name || null,
      target_type: getSpellTargetType(spell),
      target_ids: Array.isArray(targetIds) ? clone(targetIds) : [],
      area_tiles: normalizedAreaTiles,
      utility_ref: effectData.utility_ref || null,
      status_ref: effectData.status_ref || null,
      damage_ref: effectData.damage_ref || null,
      effect_targeting: effectData.targeting || null,
      zone_behavior: zoneBehavior ? clone(zoneBehavior) : null
    }
  });
  const added = addEffect(combat, createdEffect);
  if (!added.ok) {
    return failure("cast_spell_action_failed", "failed to register persistent spell effect");
  }

  return success("spell_active_effect_registered", {
    next_combat: clone(added.next_state),
    active_effects_added: added.effect ? [clone(added.effect)] : []
  });
}

function resolveSpellAttackRoll(input) {
  const attackRollFn = typeof input.attack_roll_fn === "function" ? input.attack_roll_fn : null;
  const combat = input.combat && typeof input.combat === "object" ? input.combat : null;
  const caster = input.caster && typeof input.caster === "object" ? input.caster : null;
  const target = input.target && typeof input.target === "object" ? input.target : null;
  const attackerConditions = combat && caster
    ? getActiveConditionsForParticipant(combat, caster.participant_id)
    : [];
  const targetConditions = combat && target
    ? getActiveConditionsForParticipant(combat, target.participant_id)
    : [];
  const targetIsMarked = targetConditions.some((condition) => String(condition && condition.condition_type || "") === "guiding_bolt_marked");
  const targetIsFaerieLit = targetConditions.some((condition) => String(condition && condition.condition_type || "") === "faerie_fire_lit");
  const targetIsRestrained = targetConditions.some((condition) => String(condition && condition.condition_type || "") === "restrained");
  const targetIsParalyzed = targetConditions.some((condition) => String(condition && condition.condition_type || "") === "paralyzed");
  const targetIsBlinded = targetConditions.some((condition) => String(condition && condition.condition_type || "") === "blinded");
  const targetIsInvisible = targetConditions.some((condition) => String(condition && condition.condition_type || "") === "invisible");
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
  const attackerIsBlinded = attackerConditions.some((condition) => String(condition && condition.condition_type || "") === "blinded");
  const attackerIsInvisible = attackerConditions.some((condition) => String(condition && condition.condition_type || "") === "invisible");
  const attackerIsFrightened = attackerConditions.some((condition) => String(condition && condition.condition_type || "") === "frightened");
  const attackerIsHeavilyObscured = participantIsHeavilyObscured(combat, caster);
  const targetIsHeavilyObscured = participantIsHeavilyObscured(combat, target);
  const attackerHasConditionDisadvantage = attackerConditions.some((condition) => {
    const metadata = condition && condition.metadata && typeof condition.metadata === "object" ? condition.metadata : {};
    return metadata.has_attack_disadvantage === true;
  });
  const attackerHasConditionAdvantage = attackerConditions.some((condition) => {
    const metadata = condition && condition.metadata && typeof condition.metadata === "object" ? condition.metadata : {};
    return metadata.has_attack_advantage === true;
  });
  const hasAdvantage =
    targetIsMarked ||
    targetIsFaerieLit ||
    targetIsRestrained ||
    targetIsParalyzed ||
    targetIsBlinded ||
    targetGrantsAttackAdvantage ||
    attackerIsInvisible ||
    attackerHasConditionAdvantage;
  const hasDisadvantage =
    targetIsInvisible ||
    targetImposesDisadvantage ||
    attackerIsPoisoned ||
    attackerIsRestrained ||
    attackerIsBlinded ||
    attackerIsHeavilyObscured ||
    attackerIsFrightened ||
    targetIsHeavilyObscured ||
    attackerHasConditionDisadvantage;
  if (attackRollFn) {
    const out = attackRollFn({
      caster: clone(input.caster),
      target: clone(input.target),
      spell: clone(input.spell),
      modifier: input.modifier,
      advantage: hasAdvantage && !hasDisadvantage,
      disadvantage: hasDisadvantage && !hasAdvantage
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
    advantage: hasAdvantage && !hasDisadvantage,
    disadvantage: hasDisadvantage && !hasAdvantage,
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

  const target = findParticipantById(combat && combat.participants || [], targetId);
  const baseDamageFormula = spell && spell.damage && spell.damage.dice ? String(spell.damage.dice) : "";
  const effect = spell && spell.effect && typeof spell.effect === "object" ? spell.effect : {};
  const targetCurrentHp = Number.isFinite(Number(target && target.current_hp)) ? Number(target.current_hp) : null;
  const targetMaxHp = Number.isFinite(Number(target && target.max_hp)) ? Number(target.max_hp) : null;
  const targetIsWounded = Number.isFinite(targetCurrentHp) && Number.isFinite(targetMaxHp) ? targetCurrentHp < targetMaxHp : false;
  const targetIsAtFullHp = Number.isFinite(targetCurrentHp) && Number.isFinite(targetMaxHp) ? targetCurrentHp >= targetMaxHp : false;
  const damageFormula = targetIsWounded && String(effect.damage_formula_when_target_wounded || "").trim()
    ? String(effect.damage_formula_when_target_wounded).trim()
    : targetIsAtFullHp && String(effect.damage_formula_when_target_full_hp || "").trim()
      ? String(effect.damage_formula_when_target_full_hp).trim()
      : baseDamageFormula;
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
  const caster = input.caster;

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
  const bonusRef = String(spell && spell.healing && spell.healing.bonus || "").trim().toLowerCase();
  const healingModifier = bonusRef === "spellcasting_ability_modifier"
    ? getParticipantAbilityModifier(caster, caster && caster.spellcasting_ability)
    : Number.isFinite(Number(spell && spell.healing && spell.healing.bonus))
      ? Number(spell.healing.bonus)
      : 0;
  const rolledHealing = Math.max(0, Number(roll.final_total || 0) + healingModifier);
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
      healing_modifier: healingModifier,
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
  } else if (statusHint === "outlined_for_advantage") {
    implicitConditions.push({
      condition_type: "faerie_fire_lit",
      duration: { remaining_triggers: 1 },
      expiration_trigger: "manual",
      metadata: {
        source: "spell_status_hint",
        status_hint: statusHint
      }
    });
  } else if (statusHint === "armor_of_agathys") {
    const retaliationDamage = Number.isFinite(Number(spell && spell.effect && spell.effect.retaliation_damage))
      ? Math.max(0, Math.floor(Number(spell.effect.retaliation_damage)))
      : 5;
    implicitConditions.push({
      condition_type: "armor_of_agathys",
      expiration_trigger: "manual",
      metadata: {
        source: "spell_status_hint",
        status_hint: statusHint,
        retaliation_damage: retaliationDamage,
        retaliation_damage_type: "cold",
        source_spell_id: spell.spell_id || spell.id || null
      }
    });
  } else if (statusHint === "heroism") {
    const heroismCaster = findParticipantById(combat.participants || [], casterId);
    const perTurnTempHp = Number.isFinite(Number(spell && spell.effect && spell.effect.start_of_turn_temporary_hitpoints))
      ? Math.max(0, Math.floor(Number(spell.effect.start_of_turn_temporary_hitpoints)))
      : Math.max(1, getParticipantAbilityModifier(heroismCaster, heroismCaster && heroismCaster.spellcasting_ability));
    implicitConditions.push({
      condition_type: "heroism",
      expiration_trigger: "manual",
      metadata: {
        source: "spell_status_hint",
        status_hint: statusHint,
        start_of_turn_temporary_hitpoints: perTurnTempHp,
        immunity_tags: ["frightened"],
        source_spell_id: spell.spell_id || spell.id || null
      }
    });
  } else if (statusHint === "aid") {
    const hitpointMaxBonus = Number.isFinite(Number(spell && spell.effect && spell.effect.hitpoint_max_bonus))
      ? Math.max(0, Math.floor(Number(spell.effect.hitpoint_max_bonus)))
      : 5;
    implicitConditions.push({
      condition_type: "aid",
      expiration_trigger: "manual",
      metadata: {
        source: "spell_status_hint",
        status_hint: statusHint,
        hitpoint_max_bonus: hitpointMaxBonus,
        source_spell_id: spell.spell_id || spell.id || null
      }
    });
  } else if (statusHint === "blur") {
    implicitConditions.push({
      condition_type: "blurred",
      expiration_trigger: "manual",
      metadata: {
        source: "spell_status_hint",
        status_hint: statusHint,
        attackers_have_disadvantage: true,
        source_spell_id: spell.spell_id || spell.id || null
      }
    });
  } else if (statusHint === "blindness") {
    const blindnessCaster = findParticipantById(combat.participants || [], casterId);
    implicitConditions.push({
      condition_type: "blinded",
      expiration_trigger: "manual",
      metadata: {
        source: "spell_status_hint",
        status_hint: statusHint,
        attackers_have_advantage: true,
        has_attack_disadvantage: true,
        end_of_turn_save_ability: "constitution",
        end_of_turn_save_dc: computeSpellSaveDc(blindnessCaster, spell),
        source_spell_id: spell.spell_id || spell.id || null
      }
    });
  } else if (statusHint === "longstrider") {
    const speedBonus = Number.isFinite(Number(spell && spell.effect && spell.effect.speed_bonus_feet))
      ? Math.max(0, Math.floor(Number(spell.effect.speed_bonus_feet)))
      : 10;
    implicitConditions.push({
      condition_type: "longstrider",
      expiration_trigger: "manual",
      metadata: {
        source: "spell_status_hint",
        status_hint: statusHint,
        speed_bonus_feet: speedBonus,
        source_spell_id: spell.spell_id || spell.id || null
      }
    });
  } else if (statusHint === "blade_ward") {
    implicitConditions.push({
      condition_type: "blade_ward",
      duration: { remaining_triggers: 1 },
      expiration_trigger: "start_of_source_turn",
      metadata: {
        source: "spell_status_hint",
        status_hint: statusHint,
        resistances: ["bludgeoning", "piercing", "slashing"],
        source_spell_id: spell.spell_id || spell.id || null
      }
    });
  } else if (statusHint === "sanctuary") {
    const sanctuaryCaster = findParticipantById(combat.participants || [], casterId);
    implicitConditions.push({
      condition_type: "sanctuary",
      expiration_trigger: "manual",
      metadata: {
        source: "spell_status_hint",
        status_hint: statusHint,
        blocks_attack_targeting: true,
        blocks_harmful_spell_targeting: true,
        targeting_save_ability: "wisdom",
        targeting_save_dc: computeSpellSaveDc(sanctuaryCaster, spell),
        breaks_on_harmful_action: true,
        source_spell_id: spell.spell_id || spell.id || null
      }
    });
  } else if (statusHint === "charm_person") {
    implicitConditions.push({
      condition_type: "charmed",
      expiration_trigger: "manual",
      metadata: {
        source: "spell_status_hint",
        status_hint: statusHint,
        cannot_target_actor_ids: [String(casterId || "")],
        source_spell_id: spell.spell_id || spell.id || null
      }
    });
  } else if (statusHint === "hold_person_disable") {
    const holdCaster = findParticipantById(combat.participants || [], casterId);
    implicitConditions.push({
      condition_type: "paralyzed",
      expiration_trigger: "manual",
      metadata: {
        source: "spell_status_hint",
        status_hint: statusHint,
        attackers_have_advantage: true,
        has_attack_disadvantage: true,
        end_of_turn_save_ability: "wisdom",
        end_of_turn_save_dc: computeSpellSaveDc(holdCaster, spell),
        source_spell_id: spell.spell_id || spell.id || null
      }
    });
  } else if (statusHint === "fear") {
    implicitConditions.push({
      condition_type: "frightened",
      expiration_trigger: "manual",
      metadata: {
        source: "spell_status_hint",
        status_hint: statusHint,
        source_spell_id: spell.spell_id || spell.id || null
      }
    });
  } else if (statusHint === "next_attack_disadvantage") {
    implicitConditions.push({
      condition_type: "next_attack_disadvantage",
      expiration_trigger: "manual",
      metadata: {
        source: "spell_status_hint",
        status_hint: statusHint,
        has_attack_disadvantage: true,
        consume_on_attack: true,
        source_spell_id: spell.spell_id || spell.id || null
      }
    });
  } else if (statusHint === "invisibility") {
    implicitConditions.push({
      condition_type: "invisible",
      expiration_trigger: "manual",
      metadata: {
        source: "spell_status_hint",
        status_hint: statusHint,
        attackers_have_disadvantage: true,
        has_attack_advantage: true,
        breaks_on_harmful_action: true,
        source_spell_id: spell.spell_id || spell.id || null
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
    if (applied.condition) {
      appliedConditions.push(clone(applied.condition));
    }
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

  if (defenseRef === "spell_shield_of_faith_ac_bonus") {
    const acBonus = Number.isFinite(Number(effect.ac_bonus)) ? Number(effect.ac_bonus) : 2;
    const beforeAc = Number.isFinite(target.armor_class) ? Number(target.armor_class) : 10;
    const conditionOut = resolveAppliedConditions(nextCombat, {
      effect: {
        applied_conditions: [{
          condition_type: "shield_of_faith",
          expiration_trigger: "manual",
          metadata: {
            armor_class_before: beforeAc,
            armor_class_after: beforeAc + acBonus,
            armor_class_bonus: acBonus,
            apply_armor_class_dynamically: true,
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
        armor_class_after: beforeAc + acBonus,
        dynamic_armor_class_bonus: acBonus
      },
      applied_conditions: clone(conditionOut.payload.applied_conditions)
    });
  }

  if (defenseRef === "spell_shield_ac_bonus") {
    const acBonus = Number.isFinite(Number(effect.ac_bonus)) ? Number(effect.ac_bonus) : 5;
    const beforeAc = Number.isFinite(target.armor_class) ? Number(target.armor_class) : 10;
    const conditionOut = resolveAppliedConditions(nextCombat, {
      effect: {
        applied_conditions: [{
          condition_type: "shield",
          expiration_trigger: "start_of_turn",
          metadata: {
            armor_class_bonus: acBonus,
            apply_armor_class_dynamically: true,
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
        armor_class_after: beforeAc + acBonus,
        dynamic_armor_class_bonus: acBonus
      },
      applied_conditions: clone(conditionOut.payload.applied_conditions)
    });
  }

  if (defenseRef === "spell_barkskin_minimum_ac") {
    const minimumAc = Number.isFinite(Number(effect.minimum_ac)) ? Number(effect.minimum_ac) : 16;
    const beforeAc = Number.isFinite(target.armor_class) ? Number(target.armor_class) : 10;
    const conditionOut = resolveAppliedConditions(nextCombat, {
      effect: {
        applied_conditions: [{
          condition_type: "barkskin",
          expiration_trigger: "manual",
          metadata: {
            armor_class_before: beforeAc,
            armor_class_after: Math.max(beforeAc, minimumAc),
            minimum_armor_class: minimumAc,
            apply_armor_class_dynamically: true,
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
        armor_class_after: Math.max(beforeAc, minimumAc),
        minimum_armor_class: minimumAc
      },
      applied_conditions: clone(conditionOut.payload.applied_conditions)
    });
  }

  return failure("cast_spell_action_failed", "spell defense effect is not supported yet", {
    defense_ref: defenseRef,
    spell_id: spell.spell_id || spell.id || null
  });
}

function computeEffectiveArmorClass(combat, target) {
  const baseArmorClass = Number.isFinite(Number(target && target.armor_class))
    ? Number(target.armor_class)
    : 10;
  const targetConditions = Array.isArray(combat && combat.conditions)
    ? combat.conditions.filter((condition) => String(condition && condition.target_actor_id || "") === String(target && target.participant_id || ""))
    : [];
  let armorClassBonus = 0;
  let minimumArmorClass = null;
  for (let index = 0; index < targetConditions.length; index += 1) {
    const metadata = targetConditions[index] && targetConditions[index].metadata && typeof targetConditions[index].metadata === "object"
      ? targetConditions[index].metadata
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
      minimumArmorClass = minimumArmorClass === null ? minimum : Math.max(minimumArmorClass, minimum);
    }
  }
  const totalArmorClass = baseArmorClass + armorClassBonus;
  return minimumArmorClass === null ? totalArmorClass : Math.max(totalArmorClass, minimumArmorClass);
}

function resolveVitalityEffect(combat, spell, targetId) {
  const effect = spell && spell.effect && typeof spell.effect === "object" ? spell.effect : {};
  const vitalityRef = effect.vitality_ref ? String(effect.vitality_ref).trim().toLowerCase() : "";
  const temporaryHitPoints = Number.isFinite(Number(effect.temporary_hitpoints))
    ? Math.max(0, Math.floor(Number(effect.temporary_hitpoints)))
    : 0;
  const hitpointMaxBonus = Number.isFinite(Number(effect.hitpoint_max_bonus))
    ? Math.max(0, Math.floor(Number(effect.hitpoint_max_bonus)))
    : 0;
  if (!vitalityRef && temporaryHitPoints <= 0 && hitpointMaxBonus <= 0) {
    return success("spell_vitality_effect_skipped", {
      next_combat: clone(combat),
      vitality_result: null
    });
  }

  const nextCombat = clone(combat);
  const target = findParticipantById(nextCombat.participants || [], targetId);
  if (!target) {
    return failure("cast_spell_action_failed", "vitality effect target not found in combat");
  }

  if (vitalityRef === "spell_false_life_temporary_hitpoints" || temporaryHitPoints > 0) {
    const beforeTempHp = Number.isFinite(Number(target.temporary_hitpoints))
      ? Math.max(0, Math.floor(Number(target.temporary_hitpoints)))
      : 0;
    const afterTempHp = Math.max(beforeTempHp, temporaryHitPoints);
    target.temporary_hitpoints = afterTempHp;
    return success("spell_vitality_effect_applied", {
      next_combat: nextCombat,
      vitality_result: {
        vitality_ref: vitalityRef || "spell_temporary_hitpoints",
        temporary_hp_before: beforeTempHp,
        temporary_hp_after: afterTempHp,
        temporary_hitpoints_granted: temporaryHitPoints
      }
    });
  }

  if (vitalityRef === "spell_aid_hitpoint_bonus" || hitpointMaxBonus > 0) {
    const beforeMaxHp = Number.isFinite(Number(target.max_hp)) ? Number(target.max_hp) : 0;
    const beforeHp = Number.isFinite(Number(target.current_hp)) ? Number(target.current_hp) : beforeMaxHp;
    target.max_hp = beforeMaxHp + hitpointMaxBonus;
    target.current_hp = beforeHp + hitpointMaxBonus;
    return success("spell_vitality_effect_applied", {
      next_combat: nextCombat,
      vitality_result: {
        vitality_ref: vitalityRef || "spell_hitpoint_max_bonus",
        hitpoint_max_bonus: hitpointMaxBonus,
        hp_before: beforeHp,
        hp_after: target.current_hp,
        hitpoint_max_before: beforeMaxHp,
        hitpoint_max_after: target.max_hp
      }
    });
  }

  return failure("cast_spell_action_failed", "spell vitality effect is not supported yet", {
    vitality_ref: vitalityRef || null,
    spell_id: spell.spell_id || spell.id || null
  });
}

function resolveSupportEffect(combat, spell, targetId, casterId) {
  const effect = spell && spell.effect && typeof spell.effect === "object" ? spell.effect : {};
  const buffRef = effect.buff_ref ? String(effect.buff_ref).trim().toLowerCase() : "";
  const debuffRef = effect.debuff_ref ? String(effect.debuff_ref).trim().toLowerCase() : "";
  const conditionType = buffRef === "spell_bless_attack_and_save_bonus"
    ? "bless"
    : debuffRef === "spell_bane_attack_and_save_penalty"
      ? "bane"
      : buffRef === "spell_resistance_save_bonus"
        ? "resistance"
      : null;

  if (!conditionType) {
    return success("spell_support_effect_skipped", {
      next_combat: clone(combat),
      applied_conditions: []
    });
  }

  const conditionOut = resolveAppliedConditions(combat, {
    effect: {
      applied_conditions: [{
        condition_type: conditionType,
        expiration_trigger: "manual",
        metadata: {
          source_spell_id: spell.spell_id || spell.id || null,
          dice_bonus: effect.dice_bonus || "1d4",
          saving_throw_bonus_dice: conditionType === "resistance" ? (effect.dice_bonus || "1d4") : undefined
        }
      }]
    }
  }, casterId, targetId, true);
  if (!conditionOut.ok) {
    return conditionOut;
  }

  return success("spell_support_effect_applied", {
    next_combat: clone(conditionOut.payload.next_combat),
    applied_conditions: clone(conditionOut.payload.applied_conditions)
  });
}

function resolveConditionRemovalEffect(combat, spell, targetId) {
  const effect = spell && spell.effect && typeof spell.effect === "object" ? spell.effect : {};
  const configured = Array.isArray(effect.remove_conditions) ? effect.remove_conditions : [];
  if (configured.length === 0) {
    return success("spell_condition_removal_skipped", {
      next_combat: clone(combat),
      removed_conditions: []
    });
  }

  let nextCombat = clone(combat);
  const targetConditions = Array.isArray(nextCombat.conditions) ? nextCombat.conditions : [];
  const removedConditions = [];
  for (let index = 0; index < configured.length; index += 1) {
    const wantedType = String(configured[index] || "").trim();
    if (!wantedType) {
      continue;
    }
    const matches = targetConditions.filter((condition) => {
      return String(condition && condition.target_actor_id || "") === String(targetId || "") &&
        String(condition && condition.condition_type || "") === wantedType;
    });
    for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
      const removed = removeConditionFromCombatState(nextCombat, matches[matchIndex].condition_id);
      if (!removed.ok) {
        return failure("cast_spell_action_failed", removed.error || "failed to remove spell condition");
      }
      nextCombat = clone(removed.next_state);
      if (removed.removed_condition) {
        removedConditions.push(clone(removed.removed_condition));
      }
    }
  }

  return success("spell_condition_removal_applied", {
    next_combat: nextCombat,
    removed_conditions: removedConditions
  });
}

function resolveNonDamagingTargetEffect(combat, spell, casterId, targetId) {
  const supportApplied = resolveSupportEffect(combat, spell, targetId, casterId);
  if (!supportApplied.ok) {
    return supportApplied;
  }
  let nextCombat = clone(supportApplied.payload.next_combat);
  let appliedConditions = clone(supportApplied.payload.applied_conditions || []);
  let vitalityResult = null;
  let defenseResult = null;

  if (appliedConditions.length === 0) {
    const vitalityApplied = resolveVitalityEffect(nextCombat, spell, targetId);
    if (!vitalityApplied.ok) {
      return vitalityApplied;
    }
    nextCombat = clone(vitalityApplied.payload.next_combat);
    vitalityResult = clone(vitalityApplied.payload.vitality_result);

    const directConditionsApplied = resolveAppliedConditions(nextCombat, spell, casterId, targetId, true);
    if (!directConditionsApplied.ok) {
      return directConditionsApplied;
    }
    nextCombat = clone(directConditionsApplied.payload.next_combat);
    appliedConditions = clone(directConditionsApplied.payload.applied_conditions || []);

    if (!vitalityResult && appliedConditions.length === 0) {
      const defenseApplied = resolveDefenseEffect(nextCombat, spell, targetId, casterId);
      if (!defenseApplied.ok) {
        return defenseApplied;
      }
      nextCombat = clone(defenseApplied.payload.next_combat);
      defenseResult = clone(defenseApplied.payload.defense_result);
      appliedConditions = clone(defenseApplied.payload.applied_conditions || []);
    }
  }

  const removedConditions = resolveConditionRemovalEffect(nextCombat, spell, targetId);
  if (!removedConditions.ok) {
    return removedConditions;
  }

  return success("spell_non_damage_target_effect_applied", {
    next_combat: clone(removedConditions.payload.next_combat),
    target_result: {
      target_id: String(targetId || ""),
      vitality_result: vitalityResult,
      defense_result: defenseResult,
      applied_conditions: appliedConditions,
      removed_conditions: clone(removedConditions.payload.removed_conditions || [])
    }
  });
}

function resolveMagicMissileProjectiles(input) {
  const combat = clone(input.combat);
  const targetIds = Array.isArray(input.target_ids) ? input.target_ids : [];
  const spell = input.spell;
  const projectiles = Number.isFinite(Number(spell && spell.effect && spell.effect.projectiles))
    ? Math.max(1, Math.floor(Number(spell.effect.projectiles)))
    : 3;
  const perProjectileFormula = String(spell && spell.effect && spell.effect.projectile_damage_dice || "1d4+1");
  const damageType = normalizeDamageType(input.damage_type_override || (spell && spell.damage && spell.damage.damage_type) || "force");
  const resultsByTarget = new Map();
  let nextCombat = combat;

  for (let index = 0; index < projectiles; index += 1) {
    const targetId = String(targetIds[index % targetIds.length] || "");
    if (!targetId) {
      continue;
    }
    const applied = applyDamageToCombatState({
      combat_state: nextCombat,
      target_participant_id: targetId,
      damage_type: damageType,
      damage_formula: perProjectileFormula,
      rng: input.damage_rng
    });
    nextCombat = applied.next_state;
    const prior = resultsByTarget.get(targetId) || {
      target_id: targetId,
      projectile_count: 0,
      final_damage: 0,
      projectile_results: []
    };
    prior.projectile_count += 1;
    prior.final_damage += Number(applied.damage_result && applied.damage_result.final_damage || 0);
    prior.projectile_results.push(clone(applied.damage_result));
    resultsByTarget.set(targetId, prior);
  }

  const targetResults = Array.from(resultsByTarget.values());
  const primary = targetResults[0] || null;
  return success("magic_missile_damage_applied", {
    next_combat: nextCombat,
    damage_result: primary ? {
      target_id: primary.target_id,
      damage_type: damageType,
      final_damage: primary.final_damage,
      projectile_count: primary.projectile_count,
      projectile_results: clone(primary.projectile_results)
    } : null,
    target_results: targetResults,
    damage_type: damageType
  });
}

function resolveSpellAttackProjectileConfig(spell) {
  const configuredProjectiles = Number(spell && spell.effect && spell.effect.projectiles);
  const rawDamageFormula = String(spell && spell.damage && spell.damage.dice || "").trim();
  const explicitProjectileFormula = String(spell && spell.effect && spell.effect.projectile_damage_dice || "").trim();
  const splitMatch = rawDamageFormula.match(/^(\d+)x(.+)$/i);
  const parsedProjectileCount = splitMatch ? Number(splitMatch[1]) : null;
  const parsedProjectileFormula = splitMatch ? String(splitMatch[2] || "").trim() : "";
  const projectileCount = Number.isFinite(configuredProjectiles)
    ? Math.max(1, Math.floor(configuredProjectiles))
    : Number.isFinite(parsedProjectileCount)
      ? Math.max(1, Math.floor(parsedProjectileCount))
      : 1;
  const projectileDamageFormula = explicitProjectileFormula || parsedProjectileFormula || rawDamageFormula;
  return {
    projectile_count: projectileCount,
    projectile_damage_formula: projectileDamageFormula
  };
}

function resolveSpellAttackProjectiles(input) {
  const combat = clone(input.combat);
  const caster = input.caster;
  const spell = input.spell;
  const targetIds = Array.isArray(input.target_ids) ? input.target_ids : [];
  const projectileConfig = resolveSpellAttackProjectileConfig(spell);
  if (!projectileConfig.projectile_damage_formula) {
    return failure("cast_spell_action_failed", "projectile spell damage formula is required");
  }

  let nextCombat = combat;
  const resultsByTarget = new Map();
  let latestConcentrationResult = null;

  for (let index = 0; index < projectileConfig.projectile_count; index += 1) {
    const targetId = String(targetIds[index % targetIds.length] || "");
    if (!targetId) {
      continue;
    }
    const target = findParticipantById(nextCombat.participants || [], targetId);
    if (!target) {
      return failure("cast_spell_action_failed", "projectile spell target not found in combat", {
        target_id: targetId
      });
    }
    const projectileSpell = clone(spell);
    projectileSpell.damage = Object.assign({}, projectileSpell.damage || {}, {
      dice: projectileConfig.projectile_damage_formula
    });
    const projectileOut = resolveSingleTargetSpellAttackEffect({
      combat: nextCombat,
      caster,
      caster_id: input.caster_id,
      target,
      target_id: targetId,
      spell: projectileSpell,
      attack_roll_fn: input.attack_roll_fn,
      attack_roll_rng: input.attack_roll_rng,
      damage_rng: input.damage_rng,
      damage_type: input.damage_type,
      concentration_save_rng: input.concentration_save_rng
    });
    if (!projectileOut.ok) {
      return projectileOut;
    }
    nextCombat = clone(projectileOut.payload.next_combat);
    const projectileResult = clone(projectileOut.payload.target_result);
    const prior = resultsByTarget.get(targetId) || {
      target_id: targetId,
      projectile_count: 0,
      hit_count: 0,
      miss_count: 0,
      final_damage: 0,
      damage_type: resolveConfiguredSpellDamageType(spell, input.damage_type),
      projectile_results: [],
      applied_conditions: []
    };
    prior.projectile_count += 1;
    prior.hit_count += projectileResult.hit ? 1 : 0;
    prior.miss_count += projectileResult.hit ? 0 : 1;
    prior.final_damage += Number(projectileResult.damage_result && projectileResult.damage_result.final_damage || 0);
    prior.projectile_results.push(projectileResult);
    if (Array.isArray(projectileResult.applied_conditions) && projectileResult.applied_conditions.length > 0) {
      prior.applied_conditions = prior.applied_conditions.concat(projectileResult.applied_conditions.map(clone));
    }
    resultsByTarget.set(targetId, prior);
    if (projectileResult.concentration_result) {
      latestConcentrationResult = clone(projectileResult.concentration_result);
    }
  }

  const targetResults = Array.from(resultsByTarget.values());
  const primary = targetResults[0] || null;
  const primaryProjectile = primary && Array.isArray(primary.projectile_results) ? primary.projectile_results[0] || null : null;
  return success("spell_attack_projectiles_resolved", {
    next_combat: nextCombat,
    target_results: targetResults,
    concentration_result: latestConcentrationResult,
    primary_result: primary ? {
      target_id: primary.target_id,
      attack_roll: primaryProjectile ? clone(primaryProjectile.attack_roll) : null,
      attack_total: primaryProjectile ? primaryProjectile.attack_total : null,
      target_armor_class: primaryProjectile ? primaryProjectile.target_armor_class : null,
      hit: primary.hit_count > 0,
      damage_result: primary.hit_count > 0 ? {
        target_id: primary.target_id,
        final_damage: primary.final_damage,
        damage_type: primary.damage_type,
        projectile_count: primary.projectile_count,
        hit_count: primary.hit_count,
        miss_count: primary.miss_count,
        projectile_results: clone(primary.projectile_results)
      } : null,
      applied_conditions: clone(primary.applied_conditions)
    } : null
  });
}

function resolveSingleTargetSpellAttackEffect(input) {
  const combat = clone(input.combat);
  const caster = input.caster;
  const target = input.target;
  const spell = input.spell;
  const targetId = String(target && target.participant_id || input.target_id || "");
  const attackBonus = computeSpellAttackBonus(caster);
  const attackRoll = resolveSpellAttackRoll({
    combat,
    caster,
    target,
    spell,
    modifier: attackBonus,
    attack_roll_fn: input.attack_roll_fn,
    attack_roll_rng: input.attack_roll_rng
  });
  if (!attackRoll.ok) {
    return failure("cast_spell_action_failed", attackRoll.error);
  }

  let nextCombat = combat;
  const targetArmorClass = computeEffectiveArmorClass(combat, target);
  const hit = attackRoll.payload.final_total >= targetArmorClass;
  let damageResult = null;
  let concentrationResult = null;
  if (hit && spell.damage) {
    const damageApplied = resolveSpellDamageMutation({
      combat: nextCombat,
      target_id: targetId,
      spell,
      damage_rng: input.damage_rng,
      damage_type_override: input.damage_type
    });
    if (!damageApplied.ok) {
      return damageApplied;
    }
    nextCombat = clone(damageApplied.payload.next_combat);
    damageResult = clone(damageApplied.payload.damage_result);
    const concentrationCheck = resolveConcentrationDamageCheck(
      nextCombat,
      targetId,
      damageResult.final_damage,
      input.concentration_save_rng
    );
    if (!concentrationCheck.ok) {
      return failure("cast_spell_action_failed", concentrationCheck.error || "failed to resolve concentration check");
    }
    nextCombat = clone(concentrationCheck.next_state);
    concentrationResult = clone(concentrationCheck.concentration_result);
  }

  const conditionsApplied = resolveAppliedConditions(nextCombat, spell, input.caster_id, targetId, hit);
  if (!conditionsApplied.ok) {
    return conditionsApplied;
  }
  nextCombat = clone(conditionsApplied.payload.next_combat);

  return success("spell_attack_target_effect_applied", {
    next_combat: nextCombat,
    target_result: {
      target_id: targetId,
      attack_roll: clone(attackRoll.payload.roll),
      attack_total: attackRoll.payload.final_total,
      target_armor_class: targetArmorClass,
      hit,
      damage_result: damageResult,
      applied_conditions: clone(conditionsApplied.payload.applied_conditions || []),
      concentration_result: concentrationResult
    }
  });
}

function resolveSingleTargetSaveSpellEffect(input) {
  const combat = clone(input.combat);
  const caster = input.caster;
  const target = input.target;
  const spell = input.spell;
  const targetId = String(target && target.participant_id || input.target_id || "");
  const attackOrSave = spell && spell.attack_or_save && typeof spell.attack_or_save === "object"
    ? spell.attack_or_save
    : {};
  const saveAbility = attackOrSave.save_ability || spell.save_type;
  const saveDc = computeSpellSaveDc(caster, spell);
  const saveOut = resolveSavingThrowOutcome({
    combat_state: combat,
    participant: target,
    save_ability: saveAbility,
    dc: saveDc,
    saving_throw_fn: input.saving_throw_fn,
    bonus_rng: input.saving_throw_bonus_rng
  });
  if (!saveOut.ok) {
    return failure("cast_spell_action_failed", saveOut.error);
  }

  let nextCombat = combat;
  let damageResult = null;
  let concentrationResult = null;
  let forcedMovementResult = null;
  if (spell.damage && !saveOut.payload.success) {
    const damageApplied = resolveSpellDamageMutation({
      combat: nextCombat,
      target_id: targetId,
      spell,
      damage_rng: input.damage_rng,
      damage_type_override: input.damage_type
    });
    if (!damageApplied.ok) {
      return damageApplied;
    }
    nextCombat = clone(damageApplied.payload.next_combat);
    damageResult = clone(damageApplied.payload.damage_result);
    const concentrationCheck = resolveConcentrationDamageCheck(
      nextCombat,
      targetId,
      damageResult.final_damage,
      input.concentration_save_rng
    );
    if (!concentrationCheck.ok) {
      return failure("cast_spell_action_failed", concentrationCheck.error || "failed to resolve concentration check");
    }
    nextCombat = clone(concentrationCheck.next_state);
    concentrationResult = clone(concentrationCheck.concentration_result);
  }

  const onSave = String(spell.save_outcome || "none").toLowerCase();
  if (spell.damage && saveOut.payload.success && onSave === "half") {
    const targetAfterSave = findParticipantById(nextCombat.participants || [], targetId);
    if (!targetAfterSave) {
      return failure("cast_spell_action_failed", "target missing after save resolution");
    }
    const originalDamage = resolveSpellDamageMutation({
      combat: nextCombat,
      target_id: targetId,
      spell,
      damage_rng: input.damage_rng,
      damage_type_override: input.damage_type
    });
    if (!originalDamage.ok) {
      return originalDamage;
    }
    const originalAmount = Number(originalDamage.payload.damage_result && originalDamage.payload.damage_result.final_damage || 0);
    const halfAmount = Math.floor(originalAmount / 2);
    const halfDamageApplied = applyDamageToCombatState({
      combat_state: nextCombat,
      target_participant_id: targetId,
      damage_type: resolveConfiguredSpellDamageType(spell, input.damage_type),
      damage_formula: null,
      flat_damage: halfAmount,
      rng: input.damage_rng
    });
    nextCombat = clone(halfDamageApplied.next_state);
    damageResult = clone(halfDamageApplied.damage_result);
    const concentrationCheck = resolveConcentrationDamageCheck(
      nextCombat,
      targetId,
      damageResult.final_damage,
      input.concentration_save_rng
    );
    if (!concentrationCheck.ok) {
      return failure("cast_spell_action_failed", concentrationCheck.error || "failed to resolve concentration check");
    }
    nextCombat = clone(concentrationCheck.next_state);
    concentrationResult = clone(concentrationCheck.concentration_result);
  }

  if (!saveOut.payload.success) {
    const currentCaster = findParticipantById(nextCombat.participants || [], input.caster_id) || caster;
    const currentTarget = findParticipantById(nextCombat.participants || [], targetId) || target;
    const forcedMovement = resolveForcedMovementRider(nextCombat, spell, currentCaster, currentTarget);
    if (!forcedMovement.ok) {
      return forcedMovement;
    }
    nextCombat = clone(forcedMovement.payload.next_combat);
    forcedMovementResult = forcedMovement.payload.forced_movement_result
      ? clone(forcedMovement.payload.forced_movement_result)
      : null;
  }

  const conditionsApplied = resolveAppliedConditions(nextCombat, spell, input.caster_id, targetId, !saveOut.payload.success);
  if (!conditionsApplied.ok) {
    return conditionsApplied;
  }
  nextCombat = clone(conditionsApplied.payload.next_combat);

  return success("spell_save_target_effect_applied", {
    next_combat: nextCombat,
    target_result: {
      target_id: targetId,
      save_result: clone(saveOut.payload),
      saved: Boolean(saveOut.payload.success),
      damage_result: damageResult,
      forced_movement_result: forcedMovementResult,
      applied_conditions: clone(conditionsApplied.payload.applied_conditions || []),
      concentration_result: concentrationResult
    }
  });
}

function resolveSingleTargetAutoHitSpellEffect(input) {
  const combat = clone(input.combat);
  const spell = input.spell;
  const targetId = String(input.target_id || (input.target && input.target.participant_id) || "");
  let nextCombat = combat;
  let damageResult = null;
  let concentrationResult = null;

  if (spell.damage) {
    const damageApplied = resolveSpellDamageMutation({
      combat: nextCombat,
      target_id: targetId,
      spell,
      damage_rng: input.damage_rng,
      damage_type_override: input.damage_type
    });
    if (!damageApplied.ok) {
      return damageApplied;
    }
    nextCombat = clone(damageApplied.payload.next_combat);
    damageResult = clone(damageApplied.payload.damage_result);
    const concentrationCheck = resolveConcentrationDamageCheck(
      nextCombat,
      targetId,
      damageResult.final_damage,
      input.concentration_save_rng
    );
    if (!concentrationCheck.ok) {
      return failure("cast_spell_action_failed", concentrationCheck.error || "failed to resolve concentration check");
    }
    nextCombat = clone(concentrationCheck.next_state);
    concentrationResult = clone(concentrationCheck.concentration_result);
  }

  const conditionsApplied = resolveAppliedConditions(nextCombat, spell, input.caster_id, targetId, true);
  if (!conditionsApplied.ok) {
    return conditionsApplied;
  }
  nextCombat = clone(conditionsApplied.payload.next_combat);

  return success("spell_auto_hit_target_effect_applied", {
    next_combat: nextCombat,
    target_result: {
      target_id: targetId,
      hit: true,
      damage_result: damageResult,
      applied_conditions: clone(conditionsApplied.payload.applied_conditions || []),
      concentration_result: concentrationResult
    }
  });
}

function resolveSingleTargetHealingSpellEffect(input) {
  const healingApplied = resolveHealingMutation({
    combat: input.combat,
    target_id: input.target_id || (input.target && input.target.participant_id) || null,
    spell: input.spell,
    caster: input.caster,
    healing_rng: input.healing_rng
  });
  if (!healingApplied.ok) {
    return healingApplied;
  }
  return success("spell_healing_target_effect_applied", {
    next_combat: clone(healingApplied.payload.next_combat),
    target_result: {
      target_id: String(input.target_id || (input.target && input.target.participant_id) || ""),
      healing_result: clone(healingApplied.payload.healing_result)
    }
  });
}

function performCastSpellAction(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;
  const casterId = data.caster_id;
  const spell = data.spell;
  const spellId = spell && (spell.spell_id || spell.id);
  const reactionMode = data.reaction_mode === true;
  const skipTurnValidation = data.skip_turn_validation === true;
  const warCasterReaction = data.war_caster_reaction === true;
  const targetIds = normalizeTargetParticipantIds(casterId, spell, data.target_id, data.target_ids);
  const targetId = targetIds[0] || null;

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

  const baseActionCost = resolveSpellActionCost(spell);
  let actionCost = baseActionCost;
  if (warCasterReaction) {
    if (!reactionMode) {
      return failure("cast_spell_action_failed", "war caster reaction requires reaction mode", {
        spell_id: String(spellId)
      });
    }
    if (!participantHasFeatFlag(caster, "war_caster")) {
      return failure("cast_spell_action_failed", "war caster feat is required for reaction spell substitution", {
        spell_id: String(spellId),
        caster_id: String(casterId)
      });
    }
    if (baseActionCost !== "action") {
      return failure("cast_spell_action_failed", "war caster reaction requires a 1 action spell", {
        spell_id: String(spellId),
        action_cost: baseActionCost
      });
    }
    if (getSpellTargetType(spell) !== "single_target") {
      return failure("cast_spell_action_failed", "war caster reaction requires a single target spell", {
        spell_id: String(spellId),
        target_type: getSpellTargetType(spell)
      });
    }
    actionCost = "reaction";
  } else if (reactionMode && baseActionCost !== "reaction") {
    return failure("cast_spell_action_failed", "reaction spell casting is not supported in this phase", {
      spell_id: String(spellId),
      action_cost: baseActionCost
    });
  } else if (actionCost === "reaction" && !reactionMode) {
    return failure("cast_spell_action_failed", "reaction spell casting is not supported in this phase", {
      spell_id: String(spellId)
    });
  }

  const actorValidation = ensureParticipantCanCast(combat, caster, actionCost, spell);
  if (!actorValidation.ok) {
    return actorValidation;
  }

  if (!skipTurnValidation && !(reactionMode && actionCost === "reaction")) {
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
  }

  const targetCountValidation = validateTargetSelectionCount(spell, targetIds);
  if (!targetCountValidation.ok) {
    return targetCountValidation;
  }
  const targets = targetIds.map((entry) => findParticipantById(combat.participants || [], entry));
  const target = targets[0] || null;
  if (targets.some((entry) => !entry)) {
    return failure("cast_spell_action_failed", "spell requires valid targets", {
      target_ids: clone(targetIds)
    });
  }
  for (let index = 0; index < targets.length; index += 1) {
    const targetValidation = validateSpellTargeting(spell, caster, targets[index]);
    if (!targetValidation.ok) {
      return failure("cast_spell_action_failed", targetValidation.error, targetValidation.payload);
    }
    const rangeValidation = validateSpellRange(caster, targets[index], spell);
    if (!rangeValidation.ok) {
      return rangeValidation;
    }
    if (isHarmfulSpellAgainstTarget(caster, targets[index], spell)) {
      const hostileTargeting = validateHarmfulTargetingRestriction(combat, casterId, targetIds[index], {
        condition_type: "charmed",
        error_message: "charmed participants cannot target the charmer with harmful spells"
      });
      if (!hostileTargeting.ok) {
        return failure("cast_spell_action_failed", hostileTargeting.error, {
          combat_id: String(combatId),
          caster_id: String(casterId),
          target_id: String(targetIds[index]),
          spell_id: String(spellId),
          gating_condition: hostileTargeting.payload && hostileTargeting.payload.gating_condition
            ? clone(hostileTargeting.payload.gating_condition)
            : null
        });
      }
    }
  }

  const harmfulSpell = targets.some((target) => isHarmfulSpellAgainstTarget(caster, target, spell));
  if (harmfulSpell) {
    const selfWardRemoved = removeConditionTypeFromParticipant(combat, casterId, "sanctuary");
    if (!selfWardRemoved.ok) {
      return failure("cast_spell_action_failed", selfWardRemoved.error || "failed to clear caster ward");
    }
    combat = clone(selfWardRemoved.next_state);
    const removedBreakingConditions = removeBreakOnHarmfulActionConditions(combat, casterId);
    if (!removedBreakingConditions.ok) {
      return failure("cast_spell_action_failed", removedBreakingConditions.error || "failed to clear harmful-action conditions");
    }
    combat = clone(removedBreakingConditions.next_state);
  }

  if (harmfulSpell && targets.length > 0) {
    const refreshedCaster = findParticipantById(combat.participants || [], casterId) || caster;
    for (let index = 0; index < targets.length; index += 1) {
      const refreshedTarget = findParticipantById(combat.participants || [], targetIds[index]) || targets[index];
      const targetingProtection = resolveTargetingProtectionOutcome({
        combat_state: combat,
        source_participant: refreshedCaster,
        target_participant: refreshedTarget,
        protection_kind: "harmful_spell",
        saving_throw_fn: data.targeting_save_fn,
        bonus_rng: data.targeting_save_bonus_rng
      });
      if (!targetingProtection.ok) {
        return failure("cast_spell_action_failed", targetingProtection.error || "failed to resolve targeting protection");
      }
      if (targetingProtection.payload.blocked) {
        return failure("cast_spell_action_failed", "target is protected from harmful spells", {
          combat_id: String(combatId),
          caster_id: String(casterId),
          target_id: String(targetIds[index]),
          spell_id: String(spellId),
          gate_result: clone(targetingProtection.payload.gate_result),
          gating_condition: clone(targetingProtection.payload.gating_condition)
        });
      }
    }
  }

  const casterIndex = combat.participants.findIndex((entry) => String(entry.participant_id || "") === String(casterId));
  if (casterIndex === -1) {
    return failure("cast_spell_action_failed", "caster not found in combat");
  }
  combat.participants[casterIndex] = consumeSpellAction(combat.participants[casterIndex], actionCost, spell);

  const attackOrSave = spell.attack_or_save && typeof spell.attack_or_save === "object"
    ? spell.attack_or_save
    : { type: "none" };
  const resolutionType = String(attackOrSave.type || "none");
  const configuredDamageType = resolveConfiguredSpellDamageType(spell, data.damage_type);
  const concentrationRequired = spell && spell.concentration === true;
  let resolutionPayload = {
    attack_roll: null,
    attack_total: null,
    target_armor_class: null,
    save_result: null,
    hit: null,
    saved: null,
    damage_result: null,
    healing_result: null,
    vitality_result: null,
    defense_result: null,
    applied_conditions: [],
    removed_conditions: [],
    active_effects_added: [],
    target_results: [],
    concentration_result: null,
    concentration_started: null,
    concentration_replaced: null,
    forced_movement_result: null
  };

  if (resolutionType === "spell_attack") {
    if (getSpellTargetType(spell) === "single_or_split_target" && Number(spell && spell.effect && spell.effect.projectiles) > 0) {
      const projectileOut = resolveSpellAttackProjectiles({
        combat,
        caster,
        caster_id: casterId,
        target_ids: targetIds,
        spell,
        attack_roll_fn: data.attack_roll_fn,
        attack_roll_rng: data.attack_roll_rng,
        damage_rng: data.damage_rng,
        damage_type: data.damage_type,
        concentration_save_rng: data.concentration_save_rng
      });
      if (!projectileOut.ok) {
        return projectileOut;
      }
      combat = clone(projectileOut.payload.next_combat);
      const primary = projectileOut.payload.primary_result;
      resolutionPayload.target_results = clone(projectileOut.payload.target_results);
      resolutionPayload.attack_roll = primary ? clone(primary.attack_roll) : null;
      resolutionPayload.attack_total = primary ? primary.attack_total : null;
      resolutionPayload.target_armor_class = primary ? primary.target_armor_class : null;
      resolutionPayload.hit = primary ? primary.hit : null;
      resolutionPayload.damage_result = primary ? clone(primary.damage_result) : null;
      resolutionPayload.applied_conditions = resolutionPayload.target_results.flatMap((entry) => Array.isArray(entry.applied_conditions) ? entry.applied_conditions : []);
      resolutionPayload.concentration_result = projectileOut.payload.concentration_result
        ? clone(projectileOut.payload.concentration_result)
        : null;
    } else {
    const targetResults = [];
    let latestConcentrationResult = null;
    for (let index = 0; index < targetIds.length; index += 1) {
      const targetEffect = resolveSingleTargetSpellAttackEffect({
        combat,
        caster,
        caster_id: casterId,
        target: findParticipantById(combat.participants || [], targetIds[index]) || targets[index],
        target_id: targetIds[index],
        spell,
        attack_roll_fn: data.attack_roll_fn,
        attack_roll_rng: data.attack_roll_rng,
        damage_rng: data.damage_rng,
        damage_type: data.damage_type,
        concentration_save_rng: data.concentration_save_rng
      });
      if (!targetEffect.ok) {
        return targetEffect;
      }
      combat = clone(targetEffect.payload.next_combat);
      targetResults.push(clone(targetEffect.payload.target_result));
      if (targetEffect.payload.target_result && targetEffect.payload.target_result.concentration_result) {
        latestConcentrationResult = clone(targetEffect.payload.target_result.concentration_result);
      }
    }
    const primary = targetResults[0] || null;
    resolutionPayload.target_results = targetResults;
    resolutionPayload.attack_roll = primary ? clone(primary.attack_roll) : null;
    resolutionPayload.attack_total = primary ? primary.attack_total : null;
    resolutionPayload.target_armor_class = primary ? primary.target_armor_class : null;
    resolutionPayload.hit = primary ? primary.hit : null;
    resolutionPayload.damage_result = primary ? clone(primary.damage_result) : null;
    resolutionPayload.applied_conditions = targetResults.flatMap((entry) => Array.isArray(entry.applied_conditions) ? entry.applied_conditions : []);
    resolutionPayload.concentration_result = latestConcentrationResult;
    }
  } else if (resolutionType === "save") {
    const targetResults = [];
    let latestConcentrationResult = null;
    for (let index = 0; index < targetIds.length; index += 1) {
      const targetEffect = resolveSingleTargetSaveSpellEffect({
        combat,
        caster,
        caster_id: casterId,
        target: findParticipantById(combat.participants || [], targetIds[index]) || targets[index],
        target_id: targetIds[index],
        spell,
        saving_throw_fn: data.saving_throw_fn,
        saving_throw_bonus_rng: data.saving_throw_bonus_rng,
        damage_rng: data.damage_rng,
        damage_type: data.damage_type,
        concentration_save_rng: data.concentration_save_rng
      });
      if (!targetEffect.ok) {
        return targetEffect;
      }
      combat = clone(targetEffect.payload.next_combat);
      targetResults.push(clone(targetEffect.payload.target_result));
      if (targetEffect.payload.target_result && targetEffect.payload.target_result.concentration_result) {
        latestConcentrationResult = clone(targetEffect.payload.target_result.concentration_result);
      }
    }
    const primary = targetResults[0] || null;
    resolutionPayload.target_results = targetResults;
    resolutionPayload.save_result = primary ? clone(primary.save_result) : null;
    resolutionPayload.saved = primary ? Boolean(primary.saved) : null;
    resolutionPayload.damage_result = primary ? clone(primary.damage_result) : null;
    resolutionPayload.forced_movement_result = primary ? clone(primary.forced_movement_result) : null;
    resolutionPayload.applied_conditions = targetResults.flatMap((entry) => Array.isArray(entry.applied_conditions) ? entry.applied_conditions : []);
    resolutionPayload.concentration_result = latestConcentrationResult;
  } else if (resolutionType === "auto_hit") {
    resolutionPayload.hit = true;
    if (getSpellTargetType(spell) === "single_or_split_target" && String(spellId) === "magic_missile") {
      const damageApplied = resolveMagicMissileProjectiles({
        combat,
        target_ids: targetIds,
        spell,
        damage_rng: data.damage_rng,
        damage_type_override: data.damage_type
      });
      if (!damageApplied.ok) {
        return damageApplied;
      }
      combat = clone(damageApplied.payload.next_combat);
      resolutionPayload.damage_result = clone(damageApplied.payload.damage_result);
      resolutionPayload.target_results = clone(damageApplied.payload.target_results);
      let latestConcentrationResult = null;
      for (let index = 0; index < resolutionPayload.target_results.length; index += 1) {
        const targetResult = resolutionPayload.target_results[index];
        const concentrationCheck = resolveConcentrationDamageCheck(
          combat,
          targetResult.target_id,
          targetResult.final_damage,
          data.concentration_save_rng
        );
        if (!concentrationCheck.ok) {
          return failure("cast_spell_action_failed", concentrationCheck.error || "failed to resolve concentration check");
        }
        combat = clone(concentrationCheck.next_state);
        if (concentrationCheck.concentration_result) {
          latestConcentrationResult = clone(concentrationCheck.concentration_result);
        }
      }
      resolutionPayload.concentration_result = latestConcentrationResult;
    } else {
      const targetResults = [];
      let latestConcentrationResult = null;
      for (let index = 0; index < targetIds.length; index += 1) {
        const targetEffect = resolveSingleTargetAutoHitSpellEffect({
          combat,
          caster_id: casterId,
          target: findParticipantById(combat.participants || [], targetIds[index]) || targets[index],
          target_id: targetIds[index],
          spell,
          damage_rng: data.damage_rng,
          damage_type: data.damage_type,
          concentration_save_rng: data.concentration_save_rng
        });
        if (!targetEffect.ok) {
          return targetEffect;
        }
        combat = clone(targetEffect.payload.next_combat);
        targetResults.push(clone(targetEffect.payload.target_result));
        if (targetEffect.payload.target_result && targetEffect.payload.target_result.concentration_result) {
          latestConcentrationResult = clone(targetEffect.payload.target_result.concentration_result);
        }
      }
      const primary = targetResults[0] || null;
      resolutionPayload.target_results = targetResults;
      resolutionPayload.damage_result = primary ? clone(primary.damage_result) : null;
      resolutionPayload.applied_conditions = targetResults.flatMap((entry) => Array.isArray(entry.applied_conditions) ? entry.applied_conditions : []);
      resolutionPayload.concentration_result = latestConcentrationResult;
    }
  } else if (spell.healing) {
    const targetResults = [];
    for (let index = 0; index < targetIds.length; index += 1) {
      const targetEffect = resolveSingleTargetHealingSpellEffect({
        combat,
        caster,
        target: findParticipantById(combat.participants || [], targetIds[index]) || targets[index],
        target_id: targetIds[index],
        spell,
        healing_rng: data.healing_rng
      });
      if (!targetEffect.ok) {
        return targetEffect;
      }
      combat = clone(targetEffect.payload.next_combat);
      targetResults.push(clone(targetEffect.payload.target_result));
    }
    resolutionPayload.target_results = targetResults;
    resolutionPayload.healing_result = targetResults[0] ? clone(targetResults[0].healing_result) : null;
  } else if (resolutionType === "none") {
    if (targetIds.length > 1) {
      const targetResults = [];
      for (let index = 0; index < targetIds.length; index += 1) {
        const targetEffect = resolveNonDamagingTargetEffect(combat, spell, casterId, targetIds[index]);
        if (!targetEffect.ok) {
          return targetEffect;
        }
        combat = clone(targetEffect.payload.next_combat);
        targetResults.push(clone(targetEffect.payload.target_result));
      }
      resolutionPayload.target_results = targetResults;
      resolutionPayload.applied_conditions = targetResults.flatMap((entry) => Array.isArray(entry.applied_conditions) ? entry.applied_conditions : []);
      resolutionPayload.removed_conditions = targetResults.flatMap((entry) => Array.isArray(entry.removed_conditions) ? entry.removed_conditions : []);
      resolutionPayload.vitality_result = targetResults[0] ? clone(targetResults[0].vitality_result) : null;
      resolutionPayload.defense_result = targetResults[0] ? clone(targetResults[0].defense_result) : null;
    } else {
      const targetEffect = resolveNonDamagingTargetEffect(combat, spell, casterId, targetId);
      if (!targetEffect.ok) {
        return targetEffect;
      }
      combat = clone(targetEffect.payload.next_combat);
      resolutionPayload.target_results = [clone(targetEffect.payload.target_result)];
      resolutionPayload.applied_conditions = clone(targetEffect.payload.target_result.applied_conditions || []);
      resolutionPayload.removed_conditions = clone(targetEffect.payload.target_result.removed_conditions || []);
      resolutionPayload.vitality_result = clone(targetEffect.payload.target_result.vitality_result);
      resolutionPayload.defense_result = clone(targetEffect.payload.target_result.defense_result);
    }
  } else {
    return failure("cast_spell_action_failed", "spell effect type is not supported yet", {
      spell_id: String(spellId),
      resolution_type: resolutionType
    });
  }

  if (!(resolutionType === "none" && targetIds.length > 1) && !(resolutionType === "none" && targetIds.length === 1 && resolutionPayload.removed_conditions.length > 0)) {
    const removedConditions = resolveConditionRemovalEffect(combat, spell, targetId);
    if (!removedConditions.ok) {
      return removedConditions;
    }
    combat = clone(removedConditions.payload.next_combat);
    resolutionPayload.removed_conditions = clone(removedConditions.payload.removed_conditions || []);
  }

  const activeEffectApplied = resolvePersistentSpellActiveEffect(combat, spell, caster, casterId, targetIds, data.area_tiles);
  if (!activeEffectApplied.ok) {
    return activeEffectApplied;
  }
  combat = clone(activeEffectApplied.payload.next_combat);
  resolutionPayload.active_effects_added = clone(activeEffectApplied.payload.active_effects_added || []);

  if (concentrationRequired) {
    const linkedRestorations = resolutionPayload.defense_result &&
      Array.isArray(resolutionPayload.defense_result.concentration_restorations)
      ? clone(resolutionPayload.defense_result.concentration_restorations)
      : [];
    const concentrationStart = startParticipantConcentration(combat, {
      participant_id: casterId,
      source_spell_id: spellId,
      target_actor_id: targetIds.length === 1 ? (targetId || null) : null,
      linked_condition_ids: resolutionPayload.applied_conditions.map((entry) => String(entry.condition_id || "")).filter(Boolean),
      linked_effect_ids: resolutionPayload.active_effects_added.map((entry) => String(entry.effect_id || "")).filter(Boolean),
      linked_restorations: linkedRestorations,
      started_at_round: Number.isFinite(Number(combat.round)) ? Number(combat.round) : 1
    });
    if (!concentrationStart.ok) {
      return failure("cast_spell_action_failed", concentrationStart.error || "failed to start concentration");
    }
    combat = clone(concentrationStart.next_state);
    resolutionPayload.concentration_started = clone(concentrationStart.concentration);
    resolutionPayload.concentration_replaced = clone(concentrationStart.replaced_concentration);
  }

  const normalizedConditions = normalizeCombatControlConditions(combat);
  if (!normalizedConditions.ok) {
    return failure("cast_spell_action_failed", normalizedConditions.error || "failed to normalize combat conditions");
  }
  combat = clone(normalizedConditions.next_state);

  combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
  combat.event_log.push({
    event_type: "cast_spell_action",
    timestamp: new Date().toISOString(),
    caster_id: String(casterId),
    target_id: targetId || null,
    target_ids: clone(targetIds),
    spell_id: String(spellId),
    spell_name: spell.name || null,
    action_cost: actionCost,
    spell_level: spell && spell.level !== undefined ? Number(spell.level) : null,
    is_cantrip: isCantripSpell(spell),
    reaction_mode: reactionMode,
    war_caster_reaction: warCasterReaction,
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
    vitality_result: resolutionPayload.vitality_result,
    defense_result: resolutionPayload.defense_result,
    applied_conditions: clone(resolutionPayload.applied_conditions),
    removed_conditions: clone(resolutionPayload.removed_conditions),
    active_effects_added: clone(resolutionPayload.active_effects_added),
    concentration_required: concentrationRequired,
    concentration_result: clone(resolutionPayload.concentration_result),
    concentration_started: clone(resolutionPayload.concentration_started),
    concentration_replaced: clone(resolutionPayload.concentration_replaced),
    forced_movement_result: clone(resolutionPayload.forced_movement_result),
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
    target_ids: clone(targetIds),
    spell_id: String(spellId),
    spell_name: spell.name || null,
    action_cost: actionCost,
    spell_level: spell && spell.level !== undefined ? Number(spell.level) : null,
    is_cantrip: isCantripSpell(spell),
    reaction_mode: reactionMode,
    war_caster_reaction: warCasterReaction,
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
    vitality_result: resolutionPayload.vitality_result,
    defense_result: resolutionPayload.defense_result,
    applied_conditions: clone(resolutionPayload.applied_conditions),
    removed_conditions: clone(resolutionPayload.removed_conditions),
    active_effects_added: clone(resolutionPayload.active_effects_added),
    target_results: clone(resolutionPayload.target_results),
    concentration_required: concentrationRequired,
    concentration_result: clone(resolutionPayload.concentration_result),
    concentration_started: clone(resolutionPayload.concentration_started),
    concentration_replaced: clone(resolutionPayload.concentration_replaced),
    forced_movement_result: clone(resolutionPayload.forced_movement_result),
    combat: clone(combat)
  });
}

module.exports = {
  performCastSpellAction
};
