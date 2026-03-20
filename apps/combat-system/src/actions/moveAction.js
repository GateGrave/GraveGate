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
const {
  getActiveAreaEffectsAtPosition: getSharedActiveAreaEffectsAtPosition,
  getActiveAreaEffectsCrossingLine: getSharedActiveAreaEffectsCrossingLine,
  areaEffectHasTriggeredForParticipantThisTurn,
  markAreaEffectTriggeredForParticipant,
  consumeAreaEffectDamagePool
} = require("../effects/battlefieldEffectHelpers");

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

function participantRemovesBattlefieldOccupancy(combat, participantId) {
  const conditions = getActiveConditionsForParticipant(combat, participantId);
  return conditions.some((condition) => {
    const metadata = condition && condition.metadata && typeof condition.metadata === "object" ? condition.metadata : {};
    const conditionType = String(condition && condition.condition_type || "");
    return metadata.removed_from_battlefield === true ||
      conditionType === "banished" ||
      conditionType === "maze";
  });
}

function isOccupiedByOtherParticipant(combat, participantId, position) {
  const participants = Array.isArray(combat && combat.participants) ? combat.participants : [];
  return participants.some((participant) => {
    if (String(participant && participant.participant_id || "") === String(participantId || "")) {
      return false;
    }
    if (participantRemovesBattlefieldOccupancy(combat, participant && participant.participant_id)) {
      return false;
    }
    const participantPosition = normalizePosition(participant && participant.position);
    return participantPosition &&
      participantPosition.x === Number(position && position.x) &&
      participantPosition.y === Number(position && position.y);
  });
}

function computePushPath(sourcePosition, targetPosition, tiles) {
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
  const path = [];
  let currentX = Number(targetPosition.x);
  let currentY = Number(targetPosition.y);
  for (let index = 0; index < tiles; index += 1) {
    currentX += stepX;
    currentY += stepY;
    path.push({ x: currentX, y: currentY });
  }
  return path;
}

function resolveZoneForcedMovement(combat, participantId, sourceParticipantId, forcedMovementConfig, saveOut) {
  if (!forcedMovementConfig || !saveOut || saveOut.payload.success === true) {
    return success("zone_forced_movement_skipped", {
      next_combat: clone(combat),
      forced_movement_result: null
    });
  }
  const nextCombat = clone(combat);
  const sourceParticipant = findParticipantById(nextCombat.participants || [], sourceParticipantId);
  const targetParticipant = findParticipantById(nextCombat.participants || [], participantId);
  if (!sourceParticipant || !sourceParticipant.position || !targetParticipant || !targetParticipant.position) {
    return success("zone_forced_movement_skipped", {
      next_combat: nextCombat,
      forced_movement_result: null
    });
  }
  const pushTiles = Math.max(0, Math.floor(Number(forcedMovementConfig.push_tiles) || 0));
  const path = computePushPath(sourceParticipant.position, targetParticipant.position, pushTiles);
  let finalPosition = clone(targetParticipant.position);
  let tilesMoved = 0;
  for (let index = 0; index < path.length; index += 1) {
    const candidate = path[index];
    if (!isInsideBounds(candidate.x, candidate.y) ||
      isOccupiedByOtherParticipant(nextCombat, participantId, candidate) ||
      movementCrossesImpassableBarrier(nextCombat, finalPosition, candidate)) {
      break;
    }
    finalPosition = clone(candidate);
    tilesMoved += 1;
  }
  if (tilesMoved <= 0) {
    return success("zone_forced_movement_skipped", {
      next_combat: nextCombat,
      forced_movement_result: {
        moved: false,
        blocked: true,
        from_position: clone(targetParticipant.position),
        to_position: clone(targetParticipant.position),
        tiles_moved: 0
      }
    });
  }
  const targetIndex = nextCombat.participants.findIndex((entry) => String(entry && entry.participant_id || "") === String(participantId || ""));
  nextCombat.participants[targetIndex] = Object.assign({}, targetParticipant, {
    position: clone(finalPosition)
  });
  return success("zone_forced_movement_applied", {
    next_combat: nextCombat,
    forced_movement_result: {
      moved: true,
      blocked: false,
      from_position: clone(targetParticipant.position),
      to_position: clone(finalPosition),
      tiles_moved: tilesMoved
    }
  });
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

function isMovementBlockingBarrierEffect(effect) {
  const modifiers = effect && effect.modifiers && typeof effect.modifiers === "object" ? effect.modifiers : {};
  const zoneBehavior = modifiers.zone_behavior && typeof modifiers.zone_behavior === "object"
    ? modifiers.zone_behavior
    : {};
  const protectionRules = zoneBehavior.protection_rules && typeof zoneBehavior.protection_rules === "object"
    ? zoneBehavior.protection_rules
    : {};
  return protectionRules.blocks_movement_across_tiles === true;
}

function movementCrossesImpassableBarrier(combat, fromPosition, toPosition) {
  const effects = getSharedActiveAreaEffectsCrossingLine(combat, fromPosition, toPosition);
  return effects.some((effect) => isMovementBlockingBarrierEffect(effect));
}

function enumerateMovementTiles(fromPosition, toPosition) {
  const start = normalizePosition(fromPosition);
  const end = normalizePosition(toPosition);
  if (!start || !end) {
    return [];
  }
  const tiles = [];
  let x = start.x;
  let y = start.y;
  const stepX = Math.sign(end.x - start.x);
  const stepY = Math.sign(end.y - start.y);
  while (x !== end.x || y !== end.y) {
    if (x !== end.x) {
      x += stepX;
    }
    if (y !== end.y) {
      y += stepY;
    }
    tiles.push({ x, y });
  }
  return tiles;
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

function participantHasMovementFreedom(combat, participantId) {
  const conditions = getActiveConditionsForParticipant(combat, participantId);
  return conditions.some((condition) => {
    const metadata = condition && condition.metadata && typeof condition.metadata === "object" ? condition.metadata : {};
    return metadata.ignore_difficult_terrain === true ||
      metadata.ignore_grappled_move_block === true ||
      metadata.ignore_restrained_move_block === true;
  });
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
    const enterForcedMovement = zoneBehavior.on_enter_forced_movement && typeof zoneBehavior.on_enter_forced_movement === "object"
      ? zoneBehavior.on_enter_forced_movement
      : null;
    if (!enterDamage && !enterCondition && !enterForcedMovement) {
      continue;
    }
    const foundParticipant = findParticipantById(nextCombat.participants || [], participantId);
    if (!foundParticipant) {
      continue;
    }
    const sourceParticipantId = effect && effect.source && effect.source.participant_id
      ? String(effect.source.participant_id)
      : null;
    const sourceParticipant = sourceParticipantId
      ? findParticipantById(nextCombat.participants || [], sourceParticipantId)
      : null;
    if (zoneBehavior.hostile_only === true && sourceParticipant) {
      if (String(sourceParticipant.team || "") === String(foundParticipant.team || "")) {
        continue;
      }
    }
    if (areaEffectHasTriggeredForParticipantThisTurn(effect, participantId, nextCombat)) {
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
    let forcedMovementResult = null;
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
    if (enterForcedMovement) {
      const forcedMovement = resolveZoneForcedMovement(
        nextCombat,
        participantId,
        effect && effect.source && effect.source.participant_id ? String(effect.source.participant_id) : null,
        enterForcedMovement,
        saveOut
      );
      if (!forcedMovement.ok) {
        return failure("move_action_failed", forcedMovement.error || "failed to resolve zone forced movement");
      }
      nextCombat = clone(forcedMovement.payload.next_combat);
      forcedMovementResult = forcedMovement.payload.forced_movement_result
        ? clone(forcedMovement.payload.forced_movement_result)
        : null;
    }
    zoneEffectResults.push({
      effect_id: String(effect && effect.effect_id || ""),
      spell_id: modifiers.spell_id || null,
      effect_type: effect && effect.type ? String(effect.type) : null,
      save_result: clone(saveOut.payload),
      damage_applied: damageApplied,
      applied_condition: appliedCondition,
      concentration_result: concentrationResult,
      forced_movement_result: forcedMovementResult
    });
    if (enterDamage || enterCondition || enterForcedMovement) {
      const marked = markAreaEffectTriggeredForParticipant(nextCombat, effect && effect.effect_id, participantId);
      nextCombat = clone(marked.combat);
      if (damageApplied && Number(damageApplied.final_damage || 0) > 0) {
        const pooled = consumeAreaEffectDamagePool(nextCombat, effect && effect.effect_id, Number(damageApplied.final_damage || 0));
        nextCombat = clone(pooled.combat);
      }
    }
  }
  return success("zone_entry_effects_resolved", {
    next_combat: nextCombat,
    zone_effect_results: zoneEffectResults
  });
}

function resolveZoneTraversalEffects(combat, participantId, traversedTiles, input) {
  let nextCombat = clone(combat);
  const zoneEffectResults = [];
  const tiles = Array.isArray(traversedTiles) ? traversedTiles : [];
  for (let tileIndex = 0; tileIndex < tiles.length; tileIndex += 1) {
    const tile = normalizePosition(tiles[tileIndex]);
    if (!tile) {
      continue;
    }
    const effects = getActiveAreaEffectsAtPosition(nextCombat, tile);
    for (let index = 0; index < effects.length; index += 1) {
      const effect = effects[index];
      const modifiers = effect && effect.modifiers && typeof effect.modifiers === "object" ? effect.modifiers : {};
      const zoneBehavior = modifiers.zone_behavior && typeof modifiers.zone_behavior === "object" ? modifiers.zone_behavior : {};
      const traverseDamage = zoneBehavior.on_traverse_damage_per_tile && typeof zoneBehavior.on_traverse_damage_per_tile === "object"
        ? zoneBehavior.on_traverse_damage_per_tile
        : null;
      if (!traverseDamage) {
        continue;
      }
      const applied = applyDamageToCombatState({
        combat_state: nextCombat,
        target_participant_id: participantId,
        damage_type: traverseDamage.damage_type,
        damage_formula: traverseDamage.damage_formula,
        flat_damage: Number.isFinite(Number(traverseDamage.flat_damage)) ? Number(traverseDamage.flat_damage) : null,
        rng: input.damage_rng
      });
      nextCombat = clone(applied.next_state);
      let concentrationResult = null;
      if (applied.damage_result && Number(applied.damage_result.final_damage || 0) > 0) {
        const concentrationCheck = resolveConcentrationDamageCheck(
          nextCombat,
          participantId,
          applied.damage_result.final_damage,
          typeof input.concentration_save_rng === "function" ? input.concentration_save_rng : null
        );
        if (concentrationCheck.ok) {
          nextCombat = clone(concentrationCheck.next_state);
          concentrationResult = concentrationCheck.concentration_result
            ? clone(concentrationCheck.concentration_result)
            : null;
        }
      }
      zoneEffectResults.push({
        effect_id: String(effect && effect.effect_id || ""),
        spell_id: modifiers.spell_id || null,
        effect_type: effect && effect.type ? String(effect.type) : null,
        traversed_tile: tile,
        damage_applied: applied.damage_result ? clone(applied.damage_result) : null,
        concentration_result: concentrationResult
      });
    }
  }

  return success("zone_traversal_effects_resolved", {
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
  const movementFreedom = participantHasMovementFreedom(combat, participantId);
  if (!movementFreedom && participantHasCondition(combat, participantId, "restrained")) {
    return failure("move_action_failed", "restrained participants cannot move", {
      combat_id: String(combatId),
      participant_id: String(participantId)
    });
  }
  if (!movementFreedom && participantHasCondition(combat, participantId, "grappled")) {
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

  const availability = validateParticipantActionAvailability(actor, ACTION_TYPES.MOVE, {
    combat_state: combat
  });
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
    if (participantRemovesBattlefieldOccupancy(combat, participant.participant_id)) {
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
  if (movementCrossesImpassableBarrier(combat, previousPosition, targetPosition)) {
    return failure("move_action_failed", "movement is blocked by an impassable barrier", {
      combat_id: String(combatId),
      participant_id: String(participantId),
      from_position: previousPosition,
      target_position: targetPosition
    });
  }
  const traversedTiles = enumerateMovementTiles(previousPosition, targetPosition);
  const areaEffectsAtDestination = getSharedActiveAreaEffectsAtPosition(combat, targetPosition, {
    trigger_keys: [
      "on_enter_damage",
      "on_enter_condition",
      "on_enter_forced_movement"
    ]
  });
  const baseMoveCostFeet = normalizeMoveCostFeet(previousPosition, targetPosition);
  const moveCostFeet = movementFreedom
    ? baseMoveCostFeet
    : resolveZoneMovementCostFeet(baseMoveCostFeet, areaEffectsAtDestination);
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
  const traversalResolution = resolveZoneTraversalEffects(combat, participantId, traversedTiles, input);
  if (!traversalResolution.ok) {
    return traversalResolution;
  }
  combat.conditions = traversalResolution.payload.next_combat.conditions;
  combat.participants = traversalResolution.payload.next_combat.participants;
  combat.active_effects = traversalResolution.payload.next_combat.active_effects;
  const zoneResolution = resolveZoneEntryEffects(combat, participantId, areaEffectsAtDestination, input);
  if (!zoneResolution.ok) {
    return zoneResolution;
  }
  combat.conditions = zoneResolution.payload.next_combat.conditions;
  combat.participants = zoneResolution.payload.next_combat.participants;
  combat.active_effects = zoneResolution.payload.next_combat.active_effects;
  const combinedZoneEffectResults = [
    ...clone(traversalResolution.payload.zone_effect_results || []),
    ...clone(zoneResolution.payload.zone_effect_results || [])
  ];
  combat.event_log.push({
    event_type: "move_action",
    timestamp: new Date().toISOString(),
    participant_id: String(participantId),
    from_position: previousPosition,
    to_position: clone(actorRef.position),
    movement_cost_feet: moveCostFeet,
    movement_remaining_after: actorRef.movement_remaining,
    zone_effect_results: combinedZoneEffectResults
  });
  combat.updated_at = new Date().toISOString();

  combatManager.combats.set(String(combatId), combat);

  return success("move_action_resolved", {
    combat_id: String(combatId),
    participant_id: String(participantId),
    from_position: previousPosition,
    to_position: clone(actorRef.position),
    movement_cost_feet: moveCostFeet,
    zone_effect_results: combinedZoneEffectResults,
    combat: clone(combat)
  });
}

module.exports = {
  BATTLEFIELD_SIZE,
  performMoveAction,
  normalizePosition
};
