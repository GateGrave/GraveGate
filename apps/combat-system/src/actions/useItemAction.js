"use strict";

const {
  ACTION_TYPES,
  consumeParticipantAction,
  validateParticipantActionAvailability
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

  const actorHp = Number.isFinite(actor.current_hp) ? actor.current_hp : 0;
  if (actorHp <= 0) {
    return failure("use_item_action_failed", "defeated participants cannot act", {
      combat_id: String(combatId),
      participant_id: String(participantId),
      current_hp: actorHp
    });
  }

  const initiativeOrder = Array.isArray(combat.initiative_order) ? combat.initiative_order : [];
  const expectedActorId = initiativeOrder[combat.turn_index];
  if (!expectedActorId || String(expectedActorId) !== String(participantId)) {
    return failure("use_item_action_failed", "it is not the participant's turn", {
      combat_id: String(combatId),
      participant_id: String(participantId),
      expected_actor_id: expectedActorId || null,
      turn_index: combat.turn_index
    });
  }
  const availability = validateParticipantActionAvailability(actor, ACTION_TYPES.USE_ITEM, {
    allow_bonus_action: false
  });
  if (!availability.ok) {
    return failure("use_item_action_failed", availability.error, availability.payload);
  }

  if (String(item.item_type) !== "consumable") {
    return failure("use_item_action_failed", "only consumable items are supported", {
      combat_id: String(combatId),
      participant_id: String(participantId),
      item_type: item.item_type || null
    });
  }

  const healAmount = Number(item.heal_amount);
  if (!Number.isFinite(healAmount) || healAmount <= 0) {
    return failure("use_item_action_failed", "heal_amount must be a positive number", {
      combat_id: String(combatId),
      participant_id: String(participantId)
    });
  }

  const beforeHp = Number.isFinite(actor.current_hp) ? actor.current_hp : 0;
  const maxHp = Number.isFinite(actor.max_hp) ? actor.max_hp : beforeHp;
  const afterHp = Math.min(maxHp, beforeHp + Math.floor(healAmount));
  const healedFor = Math.max(0, afterHp - beforeHp);
  actor.current_hp = afterHp;
  const actorIndex = participants.findIndex((entry) => String(entry.participant_id || "") === String(participantId));
  if (actorIndex !== -1) {
    const consumed = consumeParticipantAction(actor, ACTION_TYPES.USE_ITEM);
    if (!consumed.ok) {
      return failure("use_item_action_failed", consumed.error, consumed.payload);
    }
    consumed.payload.participant.current_hp = afterHp;
    participants[actorIndex] = consumed.payload.participant;
  }

  combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
  combat.event_log.push({
    event_type: "use_item_action",
    timestamp: new Date().toISOString(),
    participant_id: String(participantId),
    item_id: item.item_id || null,
    item_type: item.item_type,
    heal_amount: Math.floor(healAmount),
    healed_for: healedFor,
    hp_before: beforeHp,
    hp_after: afterHp
  });
  combat.updated_at = new Date().toISOString();

  combatManager.combats.set(String(combatId), combat);

  return success("use_item_action_resolved", {
    combat_id: String(combatId),
    participant_id: String(participantId),
    item_id: item.item_id || null,
    hp_before: beforeHp,
    hp_after: afterHp,
    healed_for: healedFor,
    combat: clone(combat)
  });
}

module.exports = {
  useItemAction
};
