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
const { resolveConcentrationDamageCheck } = require("../concentration/concentrationState");
const { processStartOfTurnEffects, processEndOfTurnEffects } = require("../status-effects/status-effect-helpers");
const { getActiveAreaEffectsAtPosition } = require("../effects/battlefieldEffectHelpers");

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
  const areaEffects = getActiveAreaEffectsAtPosition(nextCombat, participant.position);
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
    if (!turnStartDamage && !turnStartCondition) {
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
    if (turnStartDamage && turnStartDamage.damage_formula && turnStartDamage.damage_type) {
      if (saveOut.payload.success === true && String(turnStartDamage.save_result || "") === "half_damage_on_success") {
        const preview = applyDamageToCombatState({
          combat_state: nextCombat,
          target_participant_id: participantId,
          damage_type: turnStartDamage.damage_type,
          damage_formula: turnStartDamage.damage_formula,
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
      concentration_result: concentrationResult
    });
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
  const refreshedSelectedParticipant = findParticipantById(combatState.participants, selectedParticipant.participant_id);
  const activeConditions = getActiveConditionsForParticipant(combatState, selectedParticipant.participant_id);
  const movementAdjustments = calculateConditionAdjustedMovement(refreshedSelectedParticipant, activeConditions);
  if (movementAdjustments && refreshedSelectedParticipant) {
    refreshedSelectedParticipant.movement_remaining = movementAdjustments.movement_remaining;
  }
  const startOfTurnBoons = applyStartOfTurnConditionBoons(combatState, selectedParticipant.participant_id);
  combatState = clone(startOfTurnBoons.combat || combatState);
  const startOfTurnActiveEffects = resolveStartOfTurnActiveEffects(combatState, selectedParticipant.participant_id, data);
  combatState = clone(startOfTurnActiveEffects.combat || combatState);
  const expiredSourceTurn = expireConditionsForTrigger(combatState, {
    source_actor_id: selectedParticipant.participant_id,
    expiration_trigger: "start_of_source_turn"
  });
  if (expiredSourceTurn.ok) {
    combatState.conditions = expiredSourceTurn.next_state.conditions;
  }
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
