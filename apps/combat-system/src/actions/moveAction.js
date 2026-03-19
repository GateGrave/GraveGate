"use strict";

const BATTLEFIELD_SIZE = 9;
const {
  ACTION_TYPES,
  consumeParticipantAction,
  normalizeMoveCostFeet,
  validateParticipantActionAvailability,
  validateParticipantActionContext
} = require("./actionEconomy");
const {
  participantHasCondition,
  getActiveConditionsForParticipant,
  normalizeCombatControlConditions,
  applyConditionToCombatState
} = require("../conditions/conditionHelpers");
const { gridDistanceFeet } = require("../validation/validation-helpers");
const { resolveSavingThrowOutcome } = require("../spells/spellcastingHelpers");
const { applyDamageToCombatState } = require("../damage/apply-damage-to-combat-state");
const { resolveConcentrationDamageCheck } = require("../concentration/concentrationState");

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
  return participants.find((p) => String(p.participant_id) === String(participantId)) || null;
}

function isInsideBounds(x, y) {
  return x >= 0 && x < BATTLEFIELD_SIZE && y >= 0 && y < BATTLEFIELD_SIZE;
}

function normalizePosition(position) {
  if (!position || typeof position !== "object") {
    return null;
  }
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return {
    x: Math.floor(x),
    y: Math.floor(y)
  };
}

function findFrightenedMovementBlocker(combat, participantId, currentPosition, targetPosition) {
  const activeConditions = getActiveConditionsForParticipant(combat, participantId);
  const frightenedConditions = activeConditions.filter((condition) => {
    return String(condition && condition.condition_type || "") === "frightened";
  });
  const participants = Array.isArray(combat && combat.participants) ? combat.participants : [];
  for (let index = 0; index < frightenedConditions.length; index += 1) {
    const condition = frightenedConditions[index];
    const sourceId = String(condition && condition.source_actor_id || "").trim();
    if (!sourceId) {
      continue;
    }
    const source = findParticipantById(participants, sourceId);
    if (!source || !source.position) {
      continue;
    }
    const sourceHp = Number.isFinite(Number(source.current_hp)) ? Number(source.current_hp) : 0;
    if (sourceHp <= 0) {
      continue;
    }
    const currentDistance = gridDistanceFeet(currentPosition, source.position);
    const nextDistance = gridDistanceFeet(targetPosition, source.position);
    if (Number.isFinite(currentDistance) && Number.isFinite(nextDistance) && nextDistance < currentDistance) {
      return {
        source,
        current_distance_feet: currentDistance,
        next_distance_feet: nextDistance
      };
    }
  }
  return null;
}

function getAreaEffectTiles(effect) {
  const modifiers = effect && effect.modifiers && typeof effect.modifiers === "object" ? effect.modifiers : {};
  return Array.isArray(modifiers.area_tiles) ? modifiers.area_tiles : [];
}

function positionMatchesTile(position, tile) {
  return Number(position && position.x) === Number(tile && tile.x) &&
    Number(position && position.y) === Number(tile && tile.y);
}

function getActiveAreaEffectsAtPosition(combat, position) {
  const effects = Array.isArray(combat && combat.active_effects) ? combat.active_effects : [];
  return effects.filter((effect) => getAreaEffectTiles(effect).some((tile) => positionMatchesTile(position, tile)));
}

function resolveZoneMovementCostFeet(baseCostFeet, areaEffects) {
  const effects = Array.isArray(areaEffects) ? areaEffects : [];
  const hasDifficultZone = effects.some((effect) => {
    const modifiers = effect && effect.modifiers && typeof effect.modifiers === "object" ? effect.modifiers : {};
    const zoneBehavior = modifiers.zone_behavior && typeof modifiers.zone_behavior === "object" ? modifiers.zone_behavior : {};
    return zoneBehavior.terrain_kind === "difficult";
  });
  return hasDifficultZone ? Math.max(baseCostFeet, 10) : baseCostFeet;
}

function resolveZoneEntryEffects(combat, participantId, areaEffects, input) {
  let nextCombat = clone(combat);
  const zoneEffectResults = [];
  const effects = Array.isArray(areaEffects) ? areaEffects : [];
  for (let index = 0; index < effects.length; index += 1) {
    const effect = effects[index];
    const modifiers = effect && effect.modifiers && typeof effect.modifiers === "object" ? effect.modifiers : {};
    const zoneBehavior = modifiers.zone_behavior && typeof modifiers.zone_behavior === "object" ? modifiers.zone_behavior : {};
    const enterDamage = zoneBehavior.on_enter_damage && typeof zoneBehavior.on_enter_damage === "object"
      ? zoneBehavior.on_enter_damage
      : null;
    const enterCondition = zoneBehavior.on_enter_condition && typeof zoneBehavior.on_enter_condition === "object"
      ? zoneBehavior.on_enter_condition
      : null;
    if (!enterDamage && !enterCondition) {
      continue;
    }
    const foundParticipant = findParticipantById(nextCombat.participants || [], participantId);
    if (!foundParticipant) {
      continue;
    }
    const saveOut = resolveSavingThrowOutcome({
      combat_state: nextCombat,
      participant: foundParticipant,
      save_ability: String(
        (enterDamage && enterDamage.save_ability) ||
        (enterCondition && enterCondition.save_ability) ||
        "dexterity"
      ).trim().toLowerCase(),
      dc: Number(
        (enterDamage && enterDamage.save_dc) ||
        (enterCondition && enterCondition.save_dc) ||
        10
      ),
      saving_throw_fn: input.saving_throw_fn,
      bonus_rng: input.saving_throw_bonus_rng
    });
    if (!saveOut.ok) {
      return failure("move_action_failed", saveOut.error || "failed to resolve zone entry saving throw");
    }
    let damageApplied = null;
    let concentrationResult = null;
    if (enterDamage) {
      if (saveOut.payload.success === true && String(enterDamage.save_result || "") === "half_damage_on_success") {
        const preview = applyDamageToCombatState({
          combat_state: nextCombat,
          target_participant_id: participantId,
          damage_type: enterDamage.damage_type,
          damage_formula: enterDamage.damage_formula,
          flat_damage: Number.isFinite(Number(enterDamage.flat_damage)) ? Number(enterDamage.flat_damage) : null,
          rng: input.damage_rng
        });
        const halfAmount = Math.floor(Number(preview.damage_result && preview.damage_result.final_damage || 0) / 2);
        if (halfAmount > 0) {
          const appliedHalf = applyDamageToCombatState({
            combat_state: nextCombat,
            target_participant_id: participantId,
            damage_type: enterDamage.damage_type,
            damage_formula: null,
            flat_damage: halfAmount,
            rng: input.damage_rng
          });
          nextCombat = clone(appliedHalf.next_state);
          damageApplied = clone(appliedHalf.damage_result);
        } else {
          damageApplied = {
            final_damage: 0,
            damage_type: enterDamage.damage_type
          };
        }
      } else if (!saveOut.payload.success) {
        const damageAppliedResult = applyDamageToCombatState({
          combat_state: nextCombat,
          target_participant_id: participantId,
          damage_type: enterDamage.damage_type,
          damage_formula: enterDamage.damage_formula,
          flat_damage: Number.isFinite(Number(enterDamage.flat_damage)) ? Number(enterDamage.flat_damage) : null,
          rng: input.damage_rng
        });
        nextCombat = clone(damageAppliedResult.next_state);
        damageApplied = clone(damageAppliedResult.damage_result);
      }
      if (damageApplied && Number(damageApplied.final_damage || 0) > 0) {
        const concentrationCheck = resolveConcentrationDamageCheck(
          nextCombat,
          participantId,
          damageApplied.final_damage,
          typeof input.concentration_save_rng === "function" ? input.concentration_save_rng : null
        );
        if (concentrationCheck.ok) {
          nextCombat = clone(concentrationCheck.next_state);
          concentrationResult = concentrationCheck.concentration_result
            ? clone(concentrationCheck.concentration_result)
            : null;
        }
      }
    }
    let appliedCondition = null;
    if (enterCondition && !saveOut.payload.success) {
      const applied = applyConditionToCombatState(nextCombat, {
        condition_type: enterCondition.condition_type,
        source_actor_id: effect && effect.source && effect.source.participant_id ? String(effect.source.participant_id) : null,
        target_actor_id: participantId,
        expiration_trigger: enterCondition.expiration_trigger || "manual",
        metadata: enterCondition.metadata && typeof enterCondition.metadata === "object"
          ? clone(enterCondition.metadata)
          : {}
      });
      if (!applied.ok) {
        return failure("move_action_failed", applied.error || "failed to apply zone entry condition");
      }
      nextCombat = clone(applied.next_state);
      appliedCondition = applied.condition ? clone(applied.condition) : null;
    }
    zoneEffectResults.push({
      effect_id: String(effect && effect.effect_id || ""),
      spell_id: modifiers.spell_id || null,
      effect_type: effect && effect.type ? String(effect.type) : null,
      save_result: clone(saveOut.payload),
      damage_applied: damageApplied,
      applied_condition: appliedCondition,
      concentration_result: concentrationResult
    });
  }
  return success("zone_entry_effects_resolved", {
    next_combat: nextCombat,
    zone_effect_results: zoneEffectResults
  });
}

function performMoveAction(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;
  const participantId = data.participant_id;
  const targetPosition = normalizePosition(data.target_position);

  if (!combatManager) {
    return failure("move_action_failed", "combatManager is required");
  }
  if (!combatId) {
    return failure("move_action_failed", "combat_id is required");
  }
  if (!participantId) {
    return failure("move_action_failed", "participant_id is required");
  }
  if (!targetPosition) {
    return failure("move_action_failed", "target_position with numeric x and y is required");
  }

  const found = combatManager.getCombatById(combatId);
  if (!found.ok) {
    return failure("move_action_failed", "combat not found", {
      combat_id: String(combatId)
    });
  }

  const combat = clone(found.payload.combat);
  if (combat.status !== "active") {
    return failure("move_action_failed", "combat is not active", {
      combat_id: String(combatId),
      status: combat.status
    });
  }

  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  const actor = findParticipantById(participants, participantId);
  if (!actor) {
    return failure("move_action_failed", "participant not found in combat", {
      combat_id: String(combatId),
      participant_id: String(participantId)
    });
  }

  const contextValidation = validateParticipantActionContext(combat, actor, {
    participant_id: participantId,
    verb: "move"
  });
  if (!contextValidation.ok) {
    return failure("move_action_failed", contextValidation.message, contextValidation.payload);
  }
  if (participantHasCondition(combat, participantId, "restrained")) {
    return failure("move_action_failed", "restrained participants cannot move", {
      combat_id: String(combatId),
      participant_id: String(participantId)
    });
  }
  if (participantHasCondition(combat, participantId, "grappled")) {
    return failure("move_action_failed", "grappled participants cannot move", {
      combat_id: String(combatId),
      participant_id: String(participantId)
    });
  }
  const currentPosition = normalizePosition(actor.position) || { x: 0, y: 0 };
  const frightenedBlocker = findFrightenedMovementBlocker(combat, participantId, currentPosition, targetPosition);
  if (frightenedBlocker) {
    return failure("move_action_failed", "frightened participants cannot move closer to the source of fear", {
      combat_id: String(combatId),
      participant_id: String(participantId),
      fear_source_actor_id: String(frightenedBlocker.source.participant_id || ""),
      current_distance_feet: frightenedBlocker.current_distance_feet,
      next_distance_feet: frightenedBlocker.next_distance_feet
    });
  }

  const availability = validateParticipantActionAvailability(actor, ACTION_TYPES.MOVE);
  if (!availability.ok) {
    return failure("move_action_failed", availability.error, availability.payload);
  }

  if (!isInsideBounds(targetPosition.x, targetPosition.y)) {
    return failure("move_action_failed", "target position is out of battlefield bounds", {
      combat_id: String(combatId),
      target_position: targetPosition,
      battlefield_size: BATTLEFIELD_SIZE
    });
  }

  const occupied = participants.some((participant) => {
    if (String(participant.participant_id) === String(participantId)) {
      return false;
    }
    const position = normalizePosition(participant.position);
    if (!position) return false;
    return position.x === targetPosition.x && position.y === targetPosition.y;
  });

  if (occupied) {
    return failure("move_action_failed", "target tile is occupied", {
      combat_id: String(combatId),
      target_position: targetPosition
    });
  }

  const previousPosition = currentPosition;
  const areaEffectsAtDestination = getActiveAreaEffectsAtPosition(combat, targetPosition);
  const moveCostFeet = resolveZoneMovementCostFeet(
    normalizeMoveCostFeet(previousPosition, targetPosition),
    areaEffectsAtDestination
  );
  const consumedMovement = consumeParticipantAction(actor, ACTION_TYPES.MOVE, {
    move_cost_feet: moveCostFeet
  });
  if (!consumedMovement.ok) {
    return failure("move_action_failed", consumedMovement.error, consumedMovement.payload);
  }
  let actorRef = actor;
  const actorIndex = participants.findIndex((entry) => String(entry.participant_id || "") === String(participantId));
  if (actorIndex !== -1) {
    participants[actorIndex] = consumedMovement.payload.participant;
    actorRef = participants[actorIndex];
  }
  actorRef.position = {
    x: targetPosition.x,
    y: targetPosition.y
  };

  combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
  const normalizedConditions = normalizeCombatControlConditions(combat);
  if (normalizedConditions.ok) {
    combat.conditions = normalizedConditions.next_state.conditions;
  }
  const zoneResolution = resolveZoneEntryEffects(combat, participantId, areaEffectsAtDestination, input);
  if (!zoneResolution.ok) {
    return zoneResolution;
  }
  combat.conditions = zoneResolution.payload.next_combat.conditions;
  combat.event_log.push({
    event_type: "move_action",
    timestamp: new Date().toISOString(),
    participant_id: String(participantId),
    from_position: previousPosition,
    to_position: clone(actorRef.position),
    movement_cost_feet: moveCostFeet,
    movement_remaining_after: actorRef.movement_remaining,
    zone_effect_results: clone(zoneResolution.payload.zone_effect_results || [])
  });
  combat.updated_at = new Date().toISOString();

  combatManager.combats.set(String(combatId), combat);

  return success("move_action_resolved", {
    combat_id: String(combatId),
    participant_id: String(participantId),
    from_position: previousPosition,
    to_position: clone(actorRef.position),
    movement_cost_feet: moveCostFeet,
    zone_effect_results: clone(zoneResolution.payload.zone_effect_results || []),
    combat: clone(combat)
  });
}

module.exports = {
  BATTLEFIELD_SIZE,
  performMoveAction,
  normalizePosition
};
