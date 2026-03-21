"use strict";

const {
  expireConditionsForTrigger,
  getActiveConditionsForParticipant,
  removeConditionFromCombatState,
  normalizeCombatControlConditions,
  applyConditionToCombatState
} = require("../conditions/conditionHelpers");
const { resetReactionForParticipant } = require("../reactions/reactionState");
const { resolveSavingThrowOutcome } = require("../spells/spellcastingHelpers");
const { initializeParticipantSpellcastingTurnState } = require("../spells/spellcastingHelpers");
const { applyDamageToCombatState } = require("../damage/apply-damage-to-combat-state");
const { resolveConcentrationDamageCheck, clearParticipantConcentration } = require("../concentration/concentrationState");
const { resolveAttackAgainstCombatState } = require("../actions/attackAction");
const { processStartOfTurnEffects, processEndOfTurnEffects } = require("../status-effects/status-effect-helpers");
const {
  getActiveAreaEffectsAtPosition,
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

function isInsideBounds(position) {
  return position &&
    Number(position.x) >= 0 &&
    Number(position.x) < 9 &&
    Number(position.y) >= 0 &&
    Number(position.y) < 9;
}

function isOccupiedByOtherParticipant(combat, participantId, position) {
  const participants = Array.isArray(combat && combat.participants) ? combat.participants : [];
  return participants.some((participant) => {
    if (String(participant && participant.participant_id || "") === String(participantId || "")) {
      return false;
    }
    return Number(participant && participant.position && participant.position.x) === Number(position && position.x) &&
      Number(participant && participant.position && participant.position.y) === Number(position && position.y);
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

function rollConfusionTurnBehavior(input) {
  const rollFn = input && typeof input.confusion_roll_fn === "function"
    ? input.confusion_roll_fn
    : null;
  if (rollFn) {
    const rolled = rollFn();
    const total = Number(rolled && rolled.final_total !== undefined ? rolled.final_total : rolled);
    if (Number.isFinite(total)) {
      return {
        final_total: Math.max(1, Math.min(10, Math.floor(total)))
      };
    }
  }
  return {
    final_total: Math.floor(Math.random() * 10) + 1
  };
}

function selectConfusionTargetIndex(adjacentTargets, participant, roll, input) {
  if (!Array.isArray(adjacentTargets) || adjacentTargets.length <= 0) {
    return 0;
  }
  const rngFn = input && typeof input.confusion_target_rng === "function"
    ? input.confusion_target_rng
    : null;
  if (rngFn) {
    const rolled = Number(rngFn({
      adjacent_targets: adjacentTargets,
      participant,
      roll
    }));
    if (Number.isFinite(rolled)) {
      if (rolled >= 0 && rolled < 1) {
        return Math.max(0, Math.min(adjacentTargets.length - 1, Math.floor(rolled * adjacentTargets.length)));
      }
      return Math.abs(Math.floor(rolled)) % adjacentTargets.length;
    }
  }
  return Math.floor(Math.random() * adjacentTargets.length);
}

function selectConfusionDirectionIndex(participant, roll, input) {
  const rngFn = input && typeof input.confusion_direction_rng === "function"
    ? input.confusion_direction_rng
    : null;
  if (rngFn) {
    const rolled = Number(rngFn({
      participant,
      roll
    }));
    if (Number.isFinite(rolled)) {
      if (rolled >= 0 && rolled < 1) {
        return Math.max(0, Math.min(7, Math.floor(rolled * 8)));
      }
      return Math.abs(Math.floor(rolled)) % 8;
    }
  }
  return Math.floor(Math.random() * 8);
}

function resolveRandomDirectionPosition(combat, participantId, origin, tiles, directionIndex) {
  const directions = [
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: -1, y: 1 },
    { x: -1, y: 0 },
    { x: -1, y: -1 }
  ];
  const direction = directions[Math.max(0, Math.min(directions.length - 1, directionIndex))] || directions[0];
  let current = clone(origin);
  let movedTiles = 0;
  for (let index = 0; index < tiles; index += 1) {
    const candidate = {
      x: Number(current.x) + Number(direction.x),
      y: Number(current.y) + Number(direction.y)
    };
    if (!isInsideBounds(candidate) || isOccupiedByOtherParticipant(combat, participantId, candidate)) {
      break;
    }
    current = clone(candidate);
    movedTiles += 1;
  }
  return {
    position: current,
    tiles_moved: movedTiles
  };
}

function getAdjacentConfusionTargets(combat, participantId) {
  const participant = findParticipantById(combat.participants || [], participantId);
  if (!participant || !participant.position) {
    return [];
  }
  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  return participants.filter((entry) => {
    if (!entry || String(entry.participant_id || "") === String(participantId || "")) {
      return false;
    }
    const hp = Number.isFinite(Number(entry.current_hp)) ? Number(entry.current_hp) : 0;
    if (hp <= 0 || !entry.position) {
      return false;
    }
    const dx = Math.abs(Number(entry.position.x) - Number(participant.position.x));
    const dy = Math.abs(Number(entry.position.y) - Number(participant.position.y));
    return Math.max(dx, dy) <= 1;
  });
}

function activateConfusionTurnBehavior(combat, participantId, input) {
  let nextCombat = clone(combat);
  const activeConditions = getActiveConditionsForParticipant(nextCombat, participantId);
  const confusionCondition = activeConditions.find((condition) => {
    return String(condition && condition.condition_type || "") === "confusion";
  });
  if (!confusionCondition) {
    return {
      combat: nextCombat,
      confusion_result: null
    };
  }

  const participant = findParticipantById(nextCombat.participants || [], participantId);
  if (!participant) {
    return {
      combat: nextCombat,
      confusion_result: null
    };
  }
  const participantHp = Number.isFinite(Number(participant.current_hp)) ? Number(participant.current_hp) : 0;
  if (participantHp <= 0) {
    return {
      combat: nextCombat,
      confusion_result: null
    };
  }

  const roll = rollConfusionTurnBehavior(input);
  const total = Number(roll && roll.final_total);
  if (total >= 9) {
    return {
      combat: nextCombat,
      confusion_result: {
        roll,
        outcome: "normal"
      }
    };
  }

  if (total >= 7) {
    const adjacentTargets = getAdjacentConfusionTargets(nextCombat, participantId);
    if (adjacentTargets.length <= 0) {
      const applied = applyConditionToCombatState(nextCombat, {
        condition_type: "confusion_no_action",
        source_actor_id: confusionCondition.source_actor_id ? String(confusionCondition.source_actor_id) : null,
        target_actor_id: participantId,
        expiration_trigger: "end_of_turn",
        metadata: {
          source: "confusion_turn_behavior",
          status_hint: "confusion",
          blocks_action: true,
          blocks_bonus_action: true,
          blocks_move: true,
          set_movement_remaining_to_zero: true,
          source_spell_id: confusionCondition.metadata && confusionCondition.metadata.source_spell_id || null
        }
      });
      if (applied.ok) {
        nextCombat = clone(applied.next_state);
      }
      return {
        combat: nextCombat,
        confusion_result: {
          roll,
          outcome: "no_valid_attack_target"
        }
      };
    }
    const selected = adjacentTargets[selectConfusionTargetIndex(adjacentTargets, participant, roll, input)];
    const attackOut = resolveAttackAgainstCombatState({
      combat: nextCombat,
      attacker_id: participantId,
      target_id: selected.participant_id,
      attack_roll_fn: input && typeof input.attack_roll_fn === "function" ? input.attack_roll_fn : null,
      damage_roll_fn: input && typeof input.damage_roll_fn === "function" ? input.damage_roll_fn : null,
      damage_roll_rng: input && typeof input.damage_rng === "function" ? input.damage_rng : null,
      targeting_save_fn: input && typeof input.targeting_save_fn === "function" ? input.targeting_save_fn : null,
      targeting_save_bonus_rng: input && typeof input.targeting_save_bonus_rng === "function" ? input.targeting_save_bonus_rng : null,
      concentration_save_rng: input && typeof input.concentration_save_rng === "function" ? input.concentration_save_rng : null
    });
    if (!attackOut.ok) {
      return {
        combat: nextCombat,
        confusion_result: {
          roll,
          outcome: "failed_attack_resolution",
          error: attackOut.error || null
        }
      };
    }
    nextCombat = clone(attackOut.payload.combat);
    return {
      combat: nextCombat,
      confusion_result: {
        roll,
        outcome: "random_melee_attack",
        target_id: String(selected.participant_id || ""),
        attack_result: {
          hit: attackOut.payload.hit === true,
          damage_dealt: Number(attackOut.payload.damage_dealt || 0)
        }
      }
    };
  }

  if (total === 1 && participant.position) {
    const participantIndex = nextCombat.participants.findIndex((entry) => String(entry && entry.participant_id || "") === String(participantId || ""));
    const movementRemaining = Number.isFinite(Number(participant.movement_remaining))
      ? Number(participant.movement_remaining)
      : Number.isFinite(Number(participant.movement_speed))
        ? Number(participant.movement_speed)
        : 30;
    const directionIndex = selectConfusionDirectionIndex(participant, roll, input);
    const randomMove = resolveRandomDirectionPosition(nextCombat, participantId, participant.position, Math.max(0, Math.floor(movementRemaining / 5)), directionIndex);
    if (participantIndex >= 0) {
      nextCombat.participants[participantIndex] = Object.assign({}, nextCombat.participants[participantIndex], {
        position: clone(randomMove.position),
        movement_remaining: 0
      });
      nextCombat.updated_at = new Date().toISOString();
    }
    const applied = applyConditionToCombatState(nextCombat, {
      condition_type: "confusion_wandered",
      source_actor_id: confusionCondition.source_actor_id ? String(confusionCondition.source_actor_id) : null,
      target_actor_id: participantId,
      expiration_trigger: "end_of_turn",
      metadata: {
        source: "confusion_turn_behavior",
        status_hint: "confusion",
        blocks_action: true,
        blocks_bonus_action: true,
        blocks_move: true,
        set_movement_remaining_to_zero: true,
        source_spell_id: confusionCondition.metadata && confusionCondition.metadata.source_spell_id || null
      }
    });
    if (applied.ok) {
      nextCombat = clone(applied.next_state);
    }
    return {
      combat: nextCombat,
      confusion_result: {
        roll,
        outcome: "wander_randomly",
        to_position: clone(randomMove.position),
        tiles_moved: randomMove.tiles_moved
      }
    };
  }

  const blocked = applyConditionToCombatState(nextCombat, {
    condition_type: "confusion_no_action",
    source_actor_id: confusionCondition.source_actor_id ? String(confusionCondition.source_actor_id) : null,
    target_actor_id: participantId,
    expiration_trigger: "end_of_turn",
    metadata: {
      source: "confusion_turn_behavior",
      status_hint: "confusion",
      blocks_action: true,
      blocks_bonus_action: true,
      blocks_move: true,
      set_movement_remaining_to_zero: true,
      source_spell_id: confusionCondition.metadata && confusionCondition.metadata.source_spell_id || null
    }
  });
  if (blocked.ok) {
    nextCombat = clone(blocked.next_state);
  }
  return {
    combat: nextCombat,
    confusion_result: {
      roll,
      outcome: "no_action"
    }
  };
}

function resolveAreaEffectForcedMovement(combat, participantId, sourceParticipantId, forcedMovementConfig, saveOut) {
  if (!forcedMovementConfig || !saveOut || saveOut.payload.success === true) {
    return {
      combat: clone(combat),
      forced_movement_result: null
    };
  }
  const nextCombat = clone(combat);
  const sourceParticipant = findParticipantById(nextCombat.participants || [], sourceParticipantId);
  const targetParticipant = findParticipantById(nextCombat.participants || [], participantId);
  if (!sourceParticipant || !sourceParticipant.position || !targetParticipant || !targetParticipant.position) {
    return {
      combat: nextCombat,
      forced_movement_result: null
    };
  }
  const pushTiles = Math.max(0, Math.floor(Number(forcedMovementConfig.push_tiles) || 0));
  const path = computePushPath(sourceParticipant.position, targetParticipant.position, pushTiles);
  let finalPosition = clone(targetParticipant.position);
  let tilesMoved = 0;
  for (let index = 0; index < path.length; index += 1) {
    const candidate = path[index];
    if (!isInsideBounds(candidate) || isOccupiedByOtherParticipant(nextCombat, participantId, candidate)) {
      break;
    }
    finalPosition = clone(candidate);
    tilesMoved += 1;
  }
  if (tilesMoved <= 0) {
    return {
      combat: nextCombat,
      forced_movement_result: {
        moved: false,
        blocked: true,
        from_position: clone(targetParticipant.position),
        to_position: clone(targetParticipant.position),
        tiles_moved: 0
      }
    };
  }
  const participantIndex = nextCombat.participants.findIndex((entry) => String(entry && entry.participant_id || "") === String(participantId || ""));
  nextCombat.participants[participantIndex] = Object.assign({}, targetParticipant, {
    position: clone(finalPosition)
  });
  return {
    combat: nextCombat,
    forced_movement_result: {
      moved: true,
      blocked: false,
      from_position: clone(targetParticipant.position),
      to_position: clone(finalPosition),
      tiles_moved: tilesMoved
    }
  };
}

function activatePreparedStartOfTurnConditions(combat, participantId) {
  let nextCombat = clone(combat);
  const activeConditions = getActiveConditionsForParticipant(nextCombat, participantId);
  const pendingTrueStrike = activeConditions.filter((condition) => {
    return String(condition && condition.condition_type || "") === "true_strike_pending";
  });
  const activatedConditions = [];

  for (let index = 0; index < pendingTrueStrike.length; index += 1) {
    const condition = pendingTrueStrike[index];
    const metadata = condition && condition.metadata && typeof condition.metadata === "object"
      ? condition.metadata
      : {};
    const preparedTargetActorId = String(metadata.prepared_target_actor_id || "").trim();
    if (!preparedTargetActorId) {
      continue;
    }
    const removed = removeConditionFromCombatState(nextCombat, condition.condition_id);
    if (!removed.ok) {
      continue;
    }
    nextCombat = clone(removed.next_state);
    const applied = applyConditionToCombatState(nextCombat, {
      condition_type: "true_strike_advantage",
      source_actor_id: participantId,
      target_actor_id: participantId,
      expiration_trigger: "end_of_turn",
      duration: {
        remaining_triggers: 1
      },
      metadata: {
        source: "true_strike_pending",
        source_spell_id: metadata.source_spell_id || null,
        has_attack_advantage: true,
        consume_on_attack: true,
        applies_against_actor_ids: [preparedTargetActorId]
      }
    });
    if (!applied.ok) {
      continue;
    }
    nextCombat = clone(applied.next_state);
    if (applied.condition) {
      activatedConditions.push(clone(applied.condition));
    }
  }

  return {
    combat: nextCombat,
    activated_conditions: activatedConditions
  };
}

function activatePendingCommandConditions(combat, participantId) {
  let nextCombat = clone(combat);
  const activeConditions = getActiveConditionsForParticipant(nextCombat, participantId);
  const pendingCommands = activeConditions.filter((condition) => {
    return String(condition && condition.condition_type || "") === "command_pending";
  });
  const activatedConditions = [];

  for (let index = 0; index < pendingCommands.length; index += 1) {
    const condition = pendingCommands[index];
    const metadata = condition && condition.metadata && typeof condition.metadata === "object"
      ? condition.metadata
      : {};
    const commandWord = String(metadata.command_word || "").trim().toLowerCase();
    const removed = removeConditionFromCombatState(nextCombat, condition.condition_id);
    if (!removed.ok) {
      continue;
    }
    nextCombat = clone(removed.next_state);
    if (commandWord !== "grovel" && commandWord !== "halt") {
      continue;
    }

    const obeyCondition = {
      condition_type: commandWord === "grovel" ? "command_grovel" : "command_halt",
      source_actor_id: condition.source_actor_id ? String(condition.source_actor_id) : null,
      target_actor_id: participantId,
      expiration_trigger: "end_of_turn",
      metadata: {
        source: "command_pending",
        status_hint: "command_forced_action",
        command_word: commandWord,
        blocks_action: true,
        blocks_bonus_action: true,
        blocks_move: true,
        set_movement_remaining_to_zero: true,
        source_spell_id: metadata.source_spell_id || null
      }
    };
    const obeyApplied = applyConditionToCombatState(nextCombat, obeyCondition);
    if (!obeyApplied.ok) {
      continue;
    }
    nextCombat = clone(obeyApplied.next_state);
    if (obeyApplied.condition) {
      activatedConditions.push(clone(obeyApplied.condition));
    }

    if (commandWord === "grovel") {
      const proneApplied = applyConditionToCombatState(nextCombat, {
        condition_type: "prone",
        source_actor_id: condition.source_actor_id ? String(condition.source_actor_id) : null,
        target_actor_id: participantId,
        expiration_trigger: "manual",
        metadata: {
          source: "command_pending",
          status_hint: "command_forced_action",
          command_word: commandWord,
          source_spell_id: metadata.source_spell_id || null
        }
      });
      if (proneApplied.ok) {
        nextCombat = clone(proneApplied.next_state);
        if (proneApplied.condition) {
          activatedConditions.push(clone(proneApplied.condition));
        }
      }
    }
  }

  return {
    combat: nextCombat,
    activated_conditions: activatedConditions
  };
}

function resolveStartOfTurnActiveEffects(combat, participantId, input) {
  const participant = findParticipantById(combat.participants || [], participantId);
  const participantHp = Number.isFinite(Number(participant && participant.current_hp))
    ? Number(participant.current_hp)
    : 0;
  if (!participant || participantHp <= 0 || !participant.position) {
    return {
      combat,
      active_effect_results: []
    };
  }

  let nextCombat = clone(combat);
  const areaEffects = getActiveAreaEffectsAtPosition(nextCombat, participant.position, {
    trigger_keys: [
      "on_turn_start_damage",
      "on_turn_start_condition",
      "on_turn_start_concentration_save",
      "on_turn_start_forced_movement"
    ]
  });
  const activeEffectResults = [];

  for (let index = 0; index < areaEffects.length; index += 1) {
    const currentParticipant = findParticipantById(nextCombat.participants || [], participantId);
    const currentHp = Number.isFinite(Number(currentParticipant && currentParticipant.current_hp))
      ? Number(currentParticipant.current_hp)
      : 0;
    if (!currentParticipant || currentHp <= 0) {
      break;
    }

    const effect = areaEffects[index];
    const modifiers = effect && effect.modifiers && typeof effect.modifiers === "object" ? effect.modifiers : {};
    const zoneBehavior = modifiers.zone_behavior && typeof modifiers.zone_behavior === "object" ? modifiers.zone_behavior : {};
    const turnStartDamage = zoneBehavior.on_turn_start_damage && typeof zoneBehavior.on_turn_start_damage === "object"
      ? zoneBehavior.on_turn_start_damage
      : null;
    const turnStartCondition = zoneBehavior.on_turn_start_condition && typeof zoneBehavior.on_turn_start_condition === "object"
      ? zoneBehavior.on_turn_start_condition
      : null;
    const turnStartForcedMovement = zoneBehavior.on_turn_start_forced_movement && typeof zoneBehavior.on_turn_start_forced_movement === "object"
      ? zoneBehavior.on_turn_start_forced_movement
      : null;
    const turnStartConcentrationSave = zoneBehavior.on_turn_start_concentration_save &&
      typeof zoneBehavior.on_turn_start_concentration_save === "object"
      ? zoneBehavior.on_turn_start_concentration_save
      : null;
    if (!turnStartDamage && !turnStartCondition && !turnStartConcentrationSave && !turnStartForcedMovement) {
      continue;
    }

    const sourceParticipantId = effect && effect.source && effect.source.participant_id
      ? String(effect.source.participant_id)
      : null;
    const sourceParticipant = sourceParticipantId
      ? findParticipantById(nextCombat.participants || [], sourceParticipantId)
      : null;
    if (zoneBehavior.hostile_only === true && sourceParticipant) {
      if (String(sourceParticipant.team || "") === String(currentParticipant.team || "")) {
        continue;
      }
    }
    if (areaEffectHasTriggeredForParticipantThisTurn(effect, participantId, nextCombat)) {
      continue;
    }

    const saveOut = resolveSavingThrowOutcome({
      combat_state: nextCombat,
      participant: currentParticipant,
      save_ability: String(
        (turnStartDamage && turnStartDamage.save_ability) ||
        (turnStartCondition && turnStartCondition.save_ability) ||
        "wisdom"
      ).trim().toLowerCase(),
      dc: Number(
        (turnStartDamage && turnStartDamage.save_dc) ||
        (turnStartCondition && turnStartCondition.save_dc) ||
        10
      ),
      saving_throw_fn: typeof input.saving_throw_fn === "function" ? input.saving_throw_fn : null,
      bonus_rng: typeof input.bonus_rng === "function" ? input.bonus_rng : null
    });
    if (!saveOut.ok) {
      continue;
    }

    let damageApplied = null;
    let appliedCondition = null;
    let concentrationZoneResult = null;
    let forcedMovementResult = null;
    if (
      turnStartDamage &&
      turnStartDamage.damage_type &&
      (
        String(turnStartDamage.damage_formula || "").trim() ||
        Number.isFinite(Number(turnStartDamage.flat_damage))
      )
    ) {
      if (saveOut.payload.success === true && String(turnStartDamage.save_result || "") === "half_damage_on_success") {
        const preview = applyDamageToCombatState({
          combat_state: nextCombat,
          target_participant_id: participantId,
          damage_type: turnStartDamage.damage_type,
          damage_formula: turnStartDamage.damage_formula,
          flat_damage: Number.isFinite(Number(turnStartDamage.flat_damage)) ? Number(turnStartDamage.flat_damage) : null,
          rng: typeof input.damage_rng === "function" ? input.damage_rng : null
        });
        const halfAmount = Math.floor(Number(preview.damage_result && preview.damage_result.final_damage || 0) / 2);
        if (halfAmount > 0) {
          const appliedHalf = applyDamageToCombatState({
            combat_state: nextCombat,
            target_participant_id: participantId,
            damage_type: turnStartDamage.damage_type,
            damage_formula: null,
            flat_damage: halfAmount,
            rng: typeof input.damage_rng === "function" ? input.damage_rng : null
          });
          nextCombat = clone(appliedHalf.next_state);
          damageApplied = clone(appliedHalf.damage_result);
        } else {
          damageApplied = {
            final_damage: 0,
            damage_type: turnStartDamage.damage_type
          };
        }
      } else if (saveOut.payload.success !== true) {
        const applied = applyDamageToCombatState({
          combat_state: nextCombat,
          target_participant_id: participantId,
          damage_type: turnStartDamage.damage_type,
          damage_formula: turnStartDamage.damage_formula,
          flat_damage: Number.isFinite(Number(turnStartDamage.flat_damage)) ? Number(turnStartDamage.flat_damage) : null,
          rng: typeof input.damage_rng === "function" ? input.damage_rng : null
        });
        nextCombat = clone(applied.next_state);
        damageApplied = clone(applied.damage_result);
      }
    }
    if (turnStartCondition && saveOut.payload.success !== true) {
      const applied = applyConditionToCombatState(nextCombat, {
        condition_type: turnStartCondition.condition_type,
        source_actor_id: sourceParticipantId,
        target_actor_id: participantId,
        expiration_trigger: turnStartCondition.expiration_trigger || "manual",
        metadata: turnStartCondition.metadata && typeof turnStartCondition.metadata === "object"
          ? clone(turnStartCondition.metadata)
          : {}
      });
      if (applied.ok) {
        nextCombat = clone(applied.next_state);
        appliedCondition = applied.condition ? clone(applied.condition) : null;
      }
    }
    if (turnStartForcedMovement) {
      const forcedMovement = resolveAreaEffectForcedMovement(
        nextCombat,
        participantId,
        sourceParticipantId,
        turnStartForcedMovement,
        saveOut
      );
      nextCombat = clone(forcedMovement.combat);
      forcedMovementResult = forcedMovement.forced_movement_result
        ? clone(forcedMovement.forced_movement_result)
        : null;
    }

    if (turnStartConcentrationSave && saveOut.payload.success !== true) {
      const concentrationState = currentParticipant && currentParticipant.concentration && typeof currentParticipant.concentration === "object"
        ? currentParticipant.concentration
        : null;
      if (concentrationState && concentrationState.is_concentrating === true) {
        const cleared = clearParticipantConcentration(nextCombat, participantId, "zone_failed_save");
        if (cleared.ok) {
          nextCombat = clone(cleared.next_state);
          concentrationZoneResult = {
            participant_id: String(participantId || ""),
            concentration_broken: true,
            save_result: clone(saveOut.payload),
            removed_condition_ids: Array.isArray(cleared.removed_condition_ids) ? clone(cleared.removed_condition_ids) : [],
            removed_effect_ids: Array.isArray(cleared.removed_effect_ids) ? clone(cleared.removed_effect_ids) : [],
            reason: "zone_failed_save"
          };
        }
      }
    }

    let concentrationResult = null;
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

    activeEffectResults.push({
      effect_id: String(effect && effect.effect_id || ""),
      spell_id: modifiers.spell_id || null,
      source_actor_id: sourceParticipantId,
      save_result: clone(saveOut.payload),
      damage_applied: damageApplied,
      applied_condition: appliedCondition,
      concentration_result: concentrationResult,
      concentration_zone_result: concentrationZoneResult,
      forced_movement_result: forcedMovementResult
      });
      const marked = markAreaEffectTriggeredForParticipant(nextCombat, effect && effect.effect_id, participantId);
      nextCombat = clone(marked.combat);
      if (damageApplied && Number(damageApplied.final_damage || 0) > 0) {
        const pooled = consumeAreaEffectDamagePool(nextCombat, effect && effect.effect_id, Number(damageApplied.final_damage || 0));
        nextCombat = clone(pooled.combat);
      }
    }

  return {
    combat: nextCombat,
    active_effect_results: activeEffectResults
  };
}

function applyStartOfTurnConditionBoons(combat, participantId) {
  const participant = findParticipantById(combat.participants || [], participantId);
  if (!participant) {
    return {
      combat,
      temporary_hitpoints_granted: 0,
      applied_boon_conditions: []
    };
  }

  const activeConditions = getActiveConditionsForParticipant(combat, participantId);
  let temporaryHitpointsGranted = 0;
  const appliedBoonConditions = [];
  for (let index = 0; index < activeConditions.length; index += 1) {
    const condition = activeConditions[index];
    const metadata = condition && condition.metadata && typeof condition.metadata === "object"
      ? condition.metadata
      : {};
    const configuredTempHp = Number(
      metadata.start_of_turn_temporary_hitpoints !== undefined
        ? metadata.start_of_turn_temporary_hitpoints
        : metadata.temporary_hitpoints_each_turn
    );
    if (!Number.isFinite(configuredTempHp) || configuredTempHp <= 0) {
      continue;
    }
    const normalized = Math.max(0, Math.floor(configuredTempHp));
    const before = Number.isFinite(Number(participant.temporary_hitpoints))
      ? Math.max(0, Math.floor(Number(participant.temporary_hitpoints)))
      : 0;
    const after = Math.max(before, normalized);
    if (after > before) {
      participant.temporary_hitpoints = after;
      temporaryHitpointsGranted += (after - before);
    }
    appliedBoonConditions.push(String(condition.condition_type || ""));
  }

  return {
    combat,
    temporary_hitpoints_granted: temporaryHitpointsGranted,
    applied_boon_conditions: appliedBoonConditions
  };
}

function calculateConditionAdjustedMovement(participant, activeConditions) {
  const baseMovement = Number(participant && participant.movement_speed);
  if (!Number.isFinite(baseMovement)) {
    return null;
  }
  const conditions = Array.isArray(activeConditions) ? activeConditions : [];
  let speedBonus = 0;
  let speedPenalty = 0;

  for (let index = 0; index < conditions.length; index += 1) {
    const condition = conditions[index];
    const metadata = condition && condition.metadata && typeof condition.metadata === "object"
      ? condition.metadata
      : {};
    if (String(condition && condition.condition_type || "") === "speed_reduced") {
      const reduction = Number(metadata.reduction_feet);
      speedPenalty += Number.isFinite(reduction) ? Math.max(0, reduction) : 10;
    }
    const bonus = Number(
      metadata.speed_bonus_feet !== undefined
        ? metadata.speed_bonus_feet
        : metadata.movement_bonus_feet
    );
    if (Number.isFinite(bonus) && bonus > 0) {
      speedBonus += Math.floor(bonus);
    }
    const penalty = Number(metadata.speed_penalty_feet);
    if (Number.isFinite(penalty) && penalty > 0) {
      speedPenalty += Math.floor(penalty);
    }
    if (metadata.blocks_move === true || metadata.set_movement_remaining_to_zero === true) {
      return {
        movement_remaining: 0,
        speed_bonus: speedBonus,
        speed_penalty: speedPenalty
      };
    }
  }

  return {
    movement_remaining: Math.max(0, baseMovement + speedBonus - speedPenalty),
    speed_bonus: speedBonus,
    speed_penalty: speedPenalty
  };
}

function resolveEndOfTurnConditionSaves(combat, participantId, savingThrowFn, bonusRng) {
  const participant = findParticipantById(combat.participants || [], participantId);
  const participantHp = Number.isFinite(Number(participant && participant.current_hp))
    ? Number(participant.current_hp)
    : 0;
  if (!participant || participantHp <= 0) {
    return {
      combat,
      save_results: [],
      removed_conditions: []
    };
  }

  let nextCombat = clone(combat);
  const activeConditions = getActiveConditionsForParticipant(nextCombat, participantId);
  const saveResults = [];
  const removedConditions = [];

  for (let index = 0; index < activeConditions.length; index += 1) {
    const condition = activeConditions[index];
    const metadata = condition && condition.metadata && typeof condition.metadata === "object"
      ? condition.metadata
      : {};
    const saveAbility = String(metadata.end_of_turn_save_ability || "").trim().toLowerCase();
    const dc = Number(metadata.end_of_turn_save_dc);
    if (!saveAbility || !Number.isFinite(dc)) {
      continue;
    }

    const saveOut = resolveSavingThrowOutcome({
      combat_state: nextCombat,
      participant,
      save_ability: saveAbility,
      dc,
      saving_throw_fn: savingThrowFn,
      bonus_rng: bonusRng
    });
    if (!saveOut.ok) {
      continue;
    }
    saveResults.push({
      condition_id: String(condition.condition_id || ""),
      condition_type: String(condition.condition_type || ""),
      save_ability: saveAbility,
      dc,
      success: saveOut.payload.success === true,
      roll: clone(saveOut.payload.roll)
    });
    if (String(metadata.status_hint || "").trim().toLowerCase() === "flesh_to_stone") {
      const nextConditions = Array.isArray(nextCombat.conditions) ? [...nextCombat.conditions] : [];
      const conditionIndex = nextConditions.findIndex((entry) => String(entry && entry.condition_id || "") === String(condition.condition_id || ""));
      if (conditionIndex >= 0) {
        const currentMetadata = nextConditions[conditionIndex] && nextConditions[conditionIndex].metadata && typeof nextConditions[conditionIndex].metadata === "object"
          ? nextConditions[conditionIndex].metadata
          : {};
        const failures = Math.max(0, Math.floor(Number(currentMetadata.flesh_to_stone_failures || 0))) + (saveOut.payload.success === true ? 0 : 1);
        const successes = Math.max(0, Math.floor(Number(currentMetadata.flesh_to_stone_successes || 0))) + (saveOut.payload.success === true ? 1 : 0);
        const failThreshold = Math.max(1, Math.floor(Number(currentMetadata.petrify_on_failures || 3)));
        const successThreshold = Math.max(1, Math.floor(Number(currentMetadata.release_on_successes || 3)));
        if (successes >= successThreshold) {
          const removed = removeConditionFromCombatState(nextCombat, condition.condition_id);
          if (removed.ok) {
            nextCombat = clone(removed.next_state);
            if (removed.removed_condition) {
              removedConditions.push(clone(removed.removed_condition));
            }
          }
          continue;
        }
        if (failures >= failThreshold) {
          const removed = removeConditionFromCombatState(nextCombat, condition.condition_id);
          if (removed.ok) {
            nextCombat = clone(removed.next_state);
            if (removed.removed_condition) {
              removedConditions.push(clone(removed.removed_condition));
            }
          }
          const petrifiedApplied = applyConditionToCombatState(nextCombat, {
            condition_type: "petrified",
            source_actor_id: condition.source_actor_id ? String(condition.source_actor_id) : null,
            target_actor_id: participantId,
            expiration_trigger: "manual",
            metadata: {
              source: "flesh_to_stone_progression",
              status_hint: "flesh_to_stone_petrified",
              attackers_have_advantage: true,
              has_attack_disadvantage: true,
              blocks_action: true,
              blocks_bonus_action: true,
              blocks_reaction: true,
              blocks_move: true,
              save_penalty_by_ability: {
                strength: 100,
                dexterity: 100
              },
              source_spell_id: currentMetadata.source_spell_id || null
            }
          });
          if (petrifiedApplied.ok) {
            nextCombat = clone(petrifiedApplied.next_state);
          }
          continue;
        }
        nextConditions[conditionIndex] = Object.assign({}, nextConditions[conditionIndex], {
          metadata: Object.assign({}, currentMetadata, {
            flesh_to_stone_failures: failures,
            flesh_to_stone_successes: successes
          })
        });
        nextCombat = Object.assign({}, nextCombat, {
          conditions: nextConditions,
          updated_at: new Date().toISOString()
        });
      }
      continue;
    }
    if (saveOut.payload.success === true) {
      const removed = removeConditionFromCombatState(nextCombat, condition.condition_id);
      if (!removed.ok) {
        continue;
      }
      nextCombat = clone(removed.next_state);
      if (removed.removed_condition) {
        removedConditions.push(clone(removed.removed_condition));
      }
    }
  }

  return {
    combat: nextCombat,
    save_results: saveResults,
    removed_conditions: removedConditions
  };
}

// Stage 1 next-turn flow:
// - validate combat exists and is active
// - advance turn index
// - wrap round at end of initiative list
// - skip defeated participants (current_hp <= 0)
// - log turn advancement
function nextTurn(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;

  if (!combatManager) {
    return failure("combat_next_turn_failed", "combatManager is required");
  }
  if (!combatId || String(combatId).trim() === "") {
    return failure("combat_next_turn_failed", "combat_id is required");
  }

  const found = combatManager.getCombatById(combatId);
  if (!found.ok) {
    return failure("combat_next_turn_failed", "combat not found", {
      combat_id: String(combatId)
    });
  }

  const combat = clone(found.payload.combat);
  if (combat.status !== "active") {
    return failure("combat_next_turn_failed", "combat is not active", {
      combat_id: String(combatId),
      status: combat.status
    });
  }

  const initiativeOrder = Array.isArray(combat.initiative_order) ? combat.initiative_order : [];
  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  if (initiativeOrder.length === 0) {
    return failure("combat_next_turn_failed", "initiative_order is empty", {
      combat_id: String(combatId)
    });
  }

  const orderLength = initiativeOrder.length;
  const previousTurnIndex = Number.isFinite(combat.turn_index) ? combat.turn_index : 0;
  const previousActorId = initiativeOrder[previousTurnIndex] || null;
  const endOfTurnSaves = previousActorId
    ? resolveEndOfTurnConditionSaves(
        combat,
        previousActorId,
        typeof data.saving_throw_fn === "function" ? data.saving_throw_fn : null,
        typeof data.bonus_rng === "function" ? data.bonus_rng : null
      )
    : {
        combat,
        save_results: [],
        removed_conditions: []
      };
  let combatState = clone(endOfTurnSaves.combat || combat);
  const endOfTurnEffects = previousActorId
    ? processEndOfTurnEffects(combatState, previousActorId)
    : { ok: true, next_state: combatState, processed_effects: [], expired_effects: [] };
  if (endOfTurnEffects.ok) {
    combatState = clone(endOfTurnEffects.next_state);
  }
  const expiredEndOfTurn = previousActorId
    ? expireConditionsForTrigger(combatState, {
        participant_id: previousActorId,
        expiration_trigger: "end_of_turn"
      })
    : {
        ok: true,
        expired_conditions: [],
        next_state: combatState
      };
  if (expiredEndOfTurn.ok) {
    combatState.conditions = expiredEndOfTurn.next_state.conditions;
  }
  let nextIndex = previousTurnIndex;
  let nextRound = Number.isFinite(combat.round) ? Math.max(1, Math.floor(combat.round)) : 1;

  let selectedParticipant = null;
  let tries = 0;
  while (tries < orderLength) {
    nextIndex += 1;
    if (nextIndex >= orderLength) {
      nextIndex = 0;
      nextRound += 1;
    }

    const candidateId = initiativeOrder[nextIndex];
    const candidate = findParticipantById(combatState.participants || [], candidateId);
    const candidateHp = candidate && Number.isFinite(candidate.current_hp) ? candidate.current_hp : 0;
    if (candidate && candidateHp > 0) {
      selectedParticipant = candidate;
      break;
    }

    tries += 1;
  }

  if (!selectedParticipant) {
    return failure("combat_next_turn_failed", "no valid participant found for next turn", {
      combat_id: String(combatId)
    });
  }

  combatState.turn_index = nextIndex;
  combatState.round = nextRound;
  // Dodge lasts until the start of this participant's next turn.
  const dodgeCleared = selectedParticipant.is_dodging === true;
  const readyCleared = Boolean(selectedParticipant.ready_action);
  selectedParticipant.is_dodging = false;
  selectedParticipant.ready_action = null;
  selectedParticipant.action_available = true;
  selectedParticipant.bonus_action_available = true;
  selectedParticipant.hasted_action_available = false;
  Object.assign(selectedParticipant, initializeParticipantSpellcastingTurnState(selectedParticipant));
  const movementSpeed = Number(selectedParticipant.movement_speed);
  if (Number.isFinite(movementSpeed)) {
    selectedParticipant.movement_remaining = movementSpeed;
  }
  const reactionReset = resetReactionForParticipant(combatState, selectedParticipant.participant_id);
  if (reactionReset.ok) {
    combatState.participants = reactionReset.next_state.participants;
  }
  const startOfTurnEffects = processStartOfTurnEffects(combatState, selectedParticipant.participant_id);
  if (startOfTurnEffects.ok) {
    combatState = clone(startOfTurnEffects.next_state);
  }
  const expiredStartOfTurn = expireConditionsForTrigger(combatState, {
    participant_id: selectedParticipant.participant_id,
    expiration_trigger: "start_of_turn"
  });
  if (expiredStartOfTurn.ok) {
    combatState.conditions = expiredStartOfTurn.next_state.conditions;
  }
  const commandActivation = activatePendingCommandConditions(combatState, selectedParticipant.participant_id);
  combatState = clone(commandActivation.combat || combatState);
  const startOfTurnBoons = applyStartOfTurnConditionBoons(combatState, selectedParticipant.participant_id);
  combatState = clone(startOfTurnBoons.combat || combatState);
  const startOfTurnActiveEffects = resolveStartOfTurnActiveEffects(combatState, selectedParticipant.participant_id, data);
  combatState = clone(startOfTurnActiveEffects.combat || combatState);
  const confusionActivation = activateConfusionTurnBehavior(combatState, selectedParticipant.participant_id, data);
  combatState = clone(confusionActivation.combat || combatState);
  const refreshedSelectedParticipant = findParticipantById(combatState.participants, selectedParticipant.participant_id);
  const activeConditions = getActiveConditionsForParticipant(combatState, selectedParticipant.participant_id);
  const movementAdjustments = calculateConditionAdjustedMovement(refreshedSelectedParticipant, activeConditions);
  if (movementAdjustments && refreshedSelectedParticipant) {
    refreshedSelectedParticipant.movement_remaining = movementAdjustments.movement_remaining;
    refreshedSelectedParticipant.hasted_action_available = activeConditions.some((condition) => {
      return String(condition && condition.condition_type || "") === "haste";
    });
  }
  const expiredSourceTurn = expireConditionsForTrigger(combatState, {
    source_actor_id: selectedParticipant.participant_id,
    expiration_trigger: "start_of_source_turn"
  });
  if (expiredSourceTurn.ok) {
    combatState.conditions = expiredSourceTurn.next_state.conditions;
  }
  const preparedConditionActivation = activatePreparedStartOfTurnConditions(combatState, selectedParticipant.participant_id);
  combatState = clone(preparedConditionActivation.combat || combatState);
  const normalizedConditions = normalizeCombatControlConditions(combatState);
  if (normalizedConditions.ok) {
    combatState.conditions = normalizedConditions.next_state.conditions;
  }
  combatState.event_log = Array.isArray(combatState.event_log) ? combatState.event_log : [];
  combatState.event_log.push({
    event_type: "turn_advanced",
    timestamp: new Date().toISOString(),
    details: {
      from_turn_index: previousTurnIndex,
      to_turn_index: nextIndex,
      round: nextRound,
      active_participant_id: selectedParticipant.participant_id,
      previous_actor_id: previousActorId,
      dodge_cleared: dodgeCleared,
      ready_cleared: readyCleared,
      reaction_reset: true,
      movement_bonus_applied: movementAdjustments ? movementAdjustments.speed_bonus : 0,
      movement_penalty_applied: movementAdjustments ? movementAdjustments.speed_penalty : 0,
      temporary_hitpoints_granted: startOfTurnBoons.temporary_hitpoints_granted,
      applied_boon_conditions: startOfTurnBoons.applied_boon_conditions,
      command_activated_conditions: commandActivation.activated_conditions,
      confusion_turn_result: confusionActivation.confusion_result,
      activated_conditions: preparedConditionActivation.activated_conditions,
      active_effect_results: startOfTurnActiveEffects.active_effect_results,
      start_of_turn_effects: startOfTurnEffects.ok ? startOfTurnEffects.processed_effects : [],
      end_of_turn_effects: endOfTurnEffects.ok ? endOfTurnEffects.processed_effects : [],
      expired_effect_ids: []
        .concat(startOfTurnEffects.ok ? startOfTurnEffects.expired_effects.map((effect) => effect.effect_id) : [])
        .concat(endOfTurnEffects.ok ? endOfTurnEffects.expired_effects.map((effect) => effect.effect_id) : []),
      end_of_turn_save_results: endOfTurnSaves.save_results,
      expired_condition_ids: expiredStartOfTurn.ok
        ? expiredStartOfTurn.expired_conditions
          .concat(expiredSourceTurn.ok ? expiredSourceTurn.expired_conditions : [])
          .concat(expiredEndOfTurn.ok ? expiredEndOfTurn.expired_conditions : [])
          .concat(endOfTurnSaves.removed_conditions)
          .map((condition) => condition.condition_id)
        : []
    }
  });
  combatState.updated_at = new Date().toISOString();

  combatManager.combats.set(String(combatId), combatState);

  return success("combat_turn_advanced", {
    combat_id: String(combatId),
    round: combatState.round,
    turn_index: combatState.turn_index,
    active_participant_id: selectedParticipant.participant_id,
    dodge_cleared: dodgeCleared,
    ready_cleared: readyCleared,
    combat: clone(combatState)
  });
}

module.exports = {
  nextTurn
};
