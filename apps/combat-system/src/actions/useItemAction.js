"use strict";

const { applyConditionToCombatState } = require("../conditions/conditionHelpers");
const { removeConditionFromCombatState } = require("../conditions/conditionHelpers");
const {
  ACTION_TYPES,
  consumeParticipantAction,
  normalizeActionCostValue,
  validateParticipantActionAvailability,
  validateParticipantActionContext
} = require("./actionEconomy");

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

function resolveTemporaryHitPoints(item) {
  const metadata = item && item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const useEffect = metadata.use_effect && typeof metadata.use_effect === "object" ? metadata.use_effect : {};
  const value = metadata.temporary_hitpoints !== undefined
    ? metadata.temporary_hitpoints
    : (metadata.temp_hp !== undefined ? metadata.temp_hp : (
      useEffect.temporary_hitpoints !== undefined
        ? useEffect.temporary_hitpoints
        : (useEffect.temp_hp !== undefined ? useEffect.temp_hp : item && item.temporary_hitpoints)
    ));
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function resolveItemAppliedConditions(item) {
  const metadata = item && item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const useEffect = metadata.use_effect && typeof metadata.use_effect === "object" ? metadata.use_effect : {};
  if (Array.isArray(useEffect.applied_conditions)) {
    return useEffect.applied_conditions;
  }
  return Array.isArray(metadata.applied_conditions) ? metadata.applied_conditions : [];
}

function resolveItemRemovedConditions(item) {
  const metadata = item && item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const useEffect = metadata.use_effect && typeof metadata.use_effect === "object" ? metadata.use_effect : {};
  if (Array.isArray(useEffect.remove_conditions)) {
    return useEffect.remove_conditions;
  }
  return Array.isArray(metadata.remove_conditions) ? metadata.remove_conditions : [];
}

function resolveItemHealAmount(item) {
  const metadata = item && item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const useEffect = metadata.use_effect && typeof metadata.use_effect === "object" ? metadata.use_effect : {};
  const value = useEffect.heal_amount !== undefined
    ? useEffect.heal_amount
    : item && item.heal_amount;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : 0;
}

function resolveItemHitpointMaxBonus(item) {
  const metadata = item && item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const useEffect = metadata.use_effect && typeof metadata.use_effect === "object" ? metadata.use_effect : {};
  const value = useEffect.hitpoint_max_bonus !== undefined
    ? useEffect.hitpoint_max_bonus
    : item && item.hitpoint_max_bonus;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function resolveItemActionCost(item) {
  const metadata = item && item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const useEffect = metadata.use_effect && typeof metadata.use_effect === "object" ? metadata.use_effect : {};
  return normalizeActionCostValue(
    useEffect.action_cost !== undefined ? useEffect.action_cost : metadata.action_cost,
    "action"
  );
}

function applyItemConditionsToCombatState(combat, item, sourceActorId, targetActorId) {
  const configured = resolveItemAppliedConditions(item);
  let nextCombat = clone(combat);
  const appliedConditions = [];

  for (let index = 0; index < configured.length; index += 1) {
    const conditionConfig = configured[index];
    if (!conditionConfig || typeof conditionConfig !== "object") {
      continue;
    }
    const applied = applyConditionToCombatState(nextCombat, {
      condition_type: conditionConfig.condition_type || conditionConfig.type,
      source_actor_id: String(sourceActorId || ""),
      target_actor_id: String(targetActorId || ""),
      applied_at_round: Number.isFinite(Number(nextCombat.round)) ? Number(nextCombat.round) : 1,
      duration: conditionConfig.duration || null,
      expiration_trigger: conditionConfig.expiration_trigger || "manual",
      metadata: conditionConfig.metadata || {}
    });
    if (!applied.ok) {
      return failure("use_item_action_failed", applied.error || "failed to apply combat item condition");
    }
    nextCombat = applied.next_state;
    if (applied.condition) {
      appliedConditions.push(clone(applied.condition));
    }
  }

  return success("combat_item_conditions_applied", {
    next_combat: nextCombat,
    applied_conditions: appliedConditions
  });
}

function removeItemConditionsFromCombatState(combat, item, targetActorId) {
  const configured = resolveItemRemovedConditions(item);
  if (configured.length === 0) {
    return success("combat_item_condition_removal_skipped", {
      next_combat: clone(combat),
      removed_conditions: []
    });
  }

  let nextCombat = clone(combat);
  const removedConditions = [];
  for (let index = 0; index < configured.length; index += 1) {
    const wantedType = String(configured[index] || "").trim();
    if (!wantedType) {
      continue;
    }
    const activeConditions = Array.isArray(nextCombat.conditions) ? nextCombat.conditions : [];
    const matches = activeConditions.filter((condition) => {
      return String(condition && condition.target_actor_id || "") === String(targetActorId || "") &&
        String(condition && condition.condition_type || "") === wantedType;
    });
    for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
      const removed = removeConditionFromCombatState(nextCombat, matches[matchIndex].condition_id);
      if (!removed.ok) {
        return failure("use_item_action_failed", removed.error || "failed to remove combat item condition");
      }
      nextCombat = removed.next_state;
      if (removed.removed_condition) {
        removedConditions.push(clone(removed.removed_condition));
      }
    }
  }

  return success("combat_item_condition_removal_applied", {
    next_combat: nextCombat,
    removed_conditions: removedConditions
  });
}

function useItemAction(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;
  const participantId = data.participant_id;
  const item = data.item || null;

  if (!combatManager) {
    return failure("use_item_action_failed", "combatManager is required");
  }
  if (!combatId) {
    return failure("use_item_action_failed", "combat_id is required");
  }
  if (!participantId) {
    return failure("use_item_action_failed", "participant_id is required");
  }
  if (!item || typeof item !== "object") {
    return failure("use_item_action_failed", "item is required");
  }

  const found = combatManager.getCombatById(combatId);
  if (!found.ok) {
    return failure("use_item_action_failed", "combat not found", {
      combat_id: String(combatId)
    });
  }

  const combat = clone(found.payload.combat);
  if (combat.status !== "active") {
    return failure("use_item_action_failed", "combat is not active", {
      combat_id: String(combatId),
      status: combat.status
    });
  }

  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  const actor = findParticipantById(participants, participantId);
  if (!actor) {
    return failure("use_item_action_failed", "participant not found in combat", {
      combat_id: String(combatId),
      participant_id: String(participantId)
    });
  }

  const actionCost = resolveItemActionCost(item);
  if (actionCost === "reaction") {
    return failure("use_item_action_failed", "reaction-cost combat item use is not supported on this command path", {
      combat_id: String(combatId),
      participant_id: String(participantId),
      action_cost: actionCost
    });
  }
  const contextValidation = validateParticipantActionContext(combat, actor, {
    participant_id: participantId
  });
  if (!contextValidation.ok) {
    return failure("use_item_action_failed", contextValidation.message, contextValidation.payload);
  }
  const availability = validateParticipantActionAvailability(actor, ACTION_TYPES.USE_ITEM, {
    action_cost: actionCost
  });
  if (!availability.ok) {
    return failure("use_item_action_failed", availability.error, availability.payload);
  }

  const healAmount = resolveItemHealAmount(item);
  const temporaryHitPoints = resolveTemporaryHitPoints(item);
  const hitpointMaxBonus = resolveItemHitpointMaxBonus(item);
  const hasConditions = resolveItemAppliedConditions(item).length > 0;
  const removedConditionTypes = resolveItemRemovedConditions(item);
  if ((!Number.isFinite(healAmount) || healAmount <= 0) && temporaryHitPoints <= 0 && hitpointMaxBonus <= 0 && !hasConditions && removedConditionTypes.length === 0) {
    return failure("use_item_action_failed", "combat item must provide a supported use effect", {
      combat_id: String(combatId),
      participant_id: String(participantId),
      item_type: item.item_type || null
    });
  }

  const beforeHp = Number.isFinite(actor.current_hp) ? actor.current_hp : 0;
  const maxHp = Number.isFinite(actor.max_hp) ? actor.max_hp : beforeHp;
  const maxHpAfterBonus = maxHp + hitpointMaxBonus;
  const beforeTempHp = Number.isFinite(actor.temporary_hitpoints) ? Math.max(0, Math.floor(actor.temporary_hitpoints)) : 0;
  const afterHp = Number.isFinite(healAmount) && healAmount > 0
    ? Math.min(maxHpAfterBonus, beforeHp + Math.floor(healAmount) + hitpointMaxBonus)
    : beforeHp + hitpointMaxBonus;
  const healedFor = Math.max(0, afterHp - beforeHp);
  const afterTempHp = temporaryHitPoints > 0 ? Math.max(beforeTempHp, temporaryHitPoints) : beforeTempHp;
  actor.max_hp = maxHpAfterBonus;
  actor.current_hp = afterHp;
  actor.temporary_hitpoints = afterTempHp;
  const conditionApplied = applyItemConditionsToCombatState(combat, item, participantId, participantId);
  if (!conditionApplied.ok) {
    return conditionApplied;
  }
  combat.conditions = conditionApplied.payload.next_combat.conditions;
  const conditionsRemoved = removeItemConditionsFromCombatState(combat, item, participantId);
  if (!conditionsRemoved.ok) {
    return conditionsRemoved;
  }
  combat.conditions = conditionsRemoved.payload.next_combat.conditions;
  const actorIndex = participants.findIndex((entry) => String(entry.participant_id || "") === String(participantId));
  if (actorIndex !== -1) {
    const consumed = consumeParticipantAction(actor, ACTION_TYPES.USE_ITEM, {
      action_cost: actionCost
    });
    if (!consumed.ok) {
      return failure("use_item_action_failed", consumed.error, consumed.payload);
    }
    consumed.payload.participant.current_hp = afterHp;
    consumed.payload.participant.temporary_hitpoints = afterTempHp;
    participants[actorIndex] = consumed.payload.participant;
  }

  combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
  combat.event_log.push({
    event_type: "use_item_action",
    timestamp: new Date().toISOString(),
    participant_id: String(participantId),
    item_id: item.item_id || null,
    action_cost: actionCost,
    item_type: item.item_type,
    heal_amount: Number.isFinite(healAmount) ? Math.floor(healAmount) : 0,
    hitpoint_max_bonus: hitpointMaxBonus,
    temporary_hitpoints_granted: temporaryHitPoints,
    applied_conditions: clone(conditionApplied.payload.applied_conditions),
    removed_conditions: clone(conditionsRemoved.payload.removed_conditions),
    healed_for: healedFor,
    hp_before: beforeHp,
    hp_after: afterHp,
    hitpoint_max_before: maxHp,
    hitpoint_max_after: maxHpAfterBonus,
    temporary_hp_before: beforeTempHp,
    temporary_hp_after: afterTempHp
  });
  combat.updated_at = new Date().toISOString();

  combatManager.combats.set(String(combatId), combat);

  return success("use_item_action_resolved", {
    combat_id: String(combatId),
    participant_id: String(participantId),
    item_id: item.item_id || null,
    action_cost: actionCost,
    hp_before: beforeHp,
    hp_after: afterHp,
    healed_for: healedFor,
    hitpoint_max_bonus: hitpointMaxBonus,
    temporary_hp_before: beforeTempHp,
    temporary_hp_after: afterTempHp,
    temporary_hitpoints_granted: temporaryHitPoints,
    applied_conditions: clone(conditionApplied.payload.applied_conditions),
    removed_conditions: clone(conditionsRemoved.payload.removed_conditions),
    combat: clone(combat)
  });
}

module.exports = {
  useItemAction
};
