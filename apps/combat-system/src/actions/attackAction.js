"use strict";

const {
  ACTION_TYPES,
  consumeParticipantAction,
  validateParticipantActionAvailability
} = require("./actionEconomy");
const {
  getActiveConditionsForParticipant,
  participantHasCondition,
  removeConditionFromCombatState
} = require("../conditions/conditionHelpers");

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
  return success("attack_actor_valid");
}

function resolveAttackRoll(input) {
  const data = input || {};
  const attacker = data.attacker;
  const target = data.target;
  const combat = data.combat;
  const attackRollFn = data.attackRollFn;
  const targetConditions = getActiveConditionsForParticipant(combat, target && target.participant_id);
  const targetIsMarked = targetConditions.some((condition) => String(condition && condition.condition_type || "") === "guiding_bolt_marked");

  const targetIsDodging = target && target.is_dodging === true;
  if (!targetIsDodging && !targetIsMarked) {
    const roll = Number(attackRollFn(attacker, target, combat));
    return {
      ok: Number.isFinite(roll),
      roll_mode: "normal",
      roll_values: [roll],
      final_roll: roll
    };
  }

  if (targetIsMarked && !targetIsDodging) {
    const rollA = Number(attackRollFn(attacker, target, combat));
    const rollB = Number(attackRollFn(attacker, target, combat));
    const bothValid = Number.isFinite(rollA) && Number.isFinite(rollB);
    return {
      ok: bothValid,
      roll_mode: "advantage",
      roll_values: [rollA, rollB],
      final_roll: Math.max(rollA, rollB),
      consumed_target_condition_type: "guiding_bolt_marked"
    };
  }

  if (targetIsMarked && targetIsDodging) {
    const roll = Number(attackRollFn(attacker, target, combat));
    return {
      ok: Number.isFinite(roll),
      roll_mode: "normal",
      roll_values: [roll],
      final_roll: roll,
      consumed_target_condition_type: "guiding_bolt_marked"
    };
  }

  // Simple dodge rule: attacks vs dodging target use disadvantage (lower of two rolls).
  const rollA = Number(attackRollFn(attacker, target, combat));
  const rollB = Number(attackRollFn(attacker, target, combat));
  const bothValid = Number.isFinite(rollA) && Number.isFinite(rollB);
  return {
    ok: bothValid,
    roll_mode: "disadvantage",
    roll_values: [rollA, rollB],
    final_roll: Math.min(rollA, rollB)
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

  const attackRollResult = resolveAttackRoll({
    attacker,
    target,
    combat,
    attackRollFn
  });
  if (!attackRollResult.ok) {
    return failure("attack_action_failed", "attack_roll_fn returned a non-numeric value");
  }
  const attackRoll = attackRollResult.final_roll;

  const attackBonus = Number.isFinite(attacker.attack_bonus) ? attacker.attack_bonus : 0;
  const targetArmorClass = Number.isFinite(target.armor_class) ? target.armor_class : 10;
  const attackTotal = attackRoll + attackBonus;
  const hit = attackTotal >= targetArmorClass;
  let updatedCombat = combat;

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

  let damageDealt = 0;
  if (hit) {
    const rawDamage = Number(damageRollFn(attacker, target, combat));
    if (!Number.isFinite(rawDamage)) {
      return failure("attack_action_failed", "damage_roll_fn returned a non-numeric value");
    }
    damageDealt = Math.max(0, Math.floor(rawDamage));

    const targetCurrentHp = Number.isFinite(target.current_hp) ? target.current_hp : 0;
    target.current_hp = Math.max(0, targetCurrentHp - damageDealt);
  }
  if (!reactionMode) {
    const attackerIndex = participants.findIndex((entry) => String(entry.participant_id || "") === String(attackerId));
    if (attackerIndex !== -1) {
      const consumed = consumeParticipantAction(attacker, ACTION_TYPES.ATTACK);
      if (!consumed.ok) {
        return failure("attack_action_failed", consumed.error, consumed.payload);
      }
      updatedCombat.participants[attackerIndex] = consumed.payload.participant;
    }
  }

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
    attack_total: attackTotal,
    target_armor_class: targetArmorClass,
    hit,
    damage_dealt: damageDealt,
    target_hp_after: target.current_hp,
    reaction_mode: reactionMode,
    consumed_target_condition_type: attackRollResult.consumed_target_condition_type || null
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
    attack_total: attackTotal,
    target_armor_class: targetArmorClass,
    damage_dealt: damageDealt,
    target_hp_after: target.current_hp,
    combat: clone(updatedCombat)
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
    damage_roll_fn: data.damage_roll_fn
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
