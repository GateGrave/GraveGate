"use strict";

const { performAttackAction } = require("../actions/attackAction");
const { performMoveAction } = require("../actions/moveAction");
const { participantHasCondition } = require("../conditions/conditionHelpers");
const { resolveOpportunityAttacksForMove } = require("../flow/opportunityAttackFlow");
const { resolveReadiedAttacksForMove } = require("../flow/readyActionFlow");

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
  const list = Array.isArray(participants) ? participants : [];
  return list.find((entry) => String(entry.participant_id || "") === String(participantId || "")) || null;
}

function getActiveParticipant(combat) {
  const order = Array.isArray(combat && combat.initiative_order) ? combat.initiative_order : [];
  const turnIndex = Number.isFinite(combat && combat.turn_index) ? combat.turn_index : 0;
  const participantId = order[turnIndex];
  if (!participantId) {
    return null;
  }
  return findParticipantById(combat && combat.participants, participantId);
}

function isLivingParticipant(participant) {
  const hp = participant && Number.isFinite(participant.current_hp) ? Number(participant.current_hp) : 0;
  return hp > 0;
}

function isAiControlledParticipant(participant) {
  if (!participant || typeof participant !== "object") {
    return false;
  }
  const metadata = participant.metadata && typeof participant.metadata === "object" ? participant.metadata : {};
  if (metadata.ai_controlled === false) {
    return false;
  }
  if (metadata.ai_controlled === true) {
    return true;
  }
  if (metadata.owner_player_id) {
    return false;
  }
  const team = String(participant.team || "").trim().toLowerCase();
  if (["monsters", "monster", "enemy", "enemies", "team_b"].includes(team)) {
    return true;
  }
  if (["heroes", "hero", "party", "player", "players", "ally", "allies", "team_a"].includes(team)) {
    return false;
  }
  return false;
}

function tileDistance(fromPosition, toPosition) {
  if (!fromPosition || !toPosition) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(
    Math.abs(Number(fromPosition.x || 0) - Number(toPosition.x || 0)),
    Math.abs(Number(fromPosition.y || 0) - Number(toPosition.y || 0))
  );
}

function estimateRecentThreatScore(combat, actorId, targetId) {
  const log = Array.isArray(combat && combat.event_log) ? combat.event_log : [];
  let score = 0;
  for (let index = log.length - 1; index >= 0 && index >= log.length - 8; index -= 1) {
    const entry = log[index];
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const isAttack = entry.event_type === "attack_action" || entry.event_type === "opportunity_attack";
    const isSpell = entry.event_type === "cast_spell_action";
    if (!isAttack && !isSpell) {
      continue;
    }
    const sourceId = isSpell ? entry.caster_id : entry.attacker_id;
    const victimId = entry.target_id;
    if (String(sourceId || "") !== String(targetId || "")) {
      continue;
    }
    if (String(victimId || "") !== String(actorId || "")) {
      continue;
    }
    if (isAttack) {
      score += Number(entry.damage_dealt || 0);
    } else if (entry.damage_result && Number.isFinite(Number(entry.damage_result.final_damage))) {
      score += Number(entry.damage_result.final_damage);
    }
  }
  return score;
}

function scoreTarget(combat, actor, target) {
  const distance = tileDistance(actor.position, target.position);
  const recentThreat = estimateRecentThreatScore(combat, actor.participant_id, target.participant_id);
  const lowHpBonus = Math.max(0, 20 - Number(target.current_hp || 0));
  return (40 - (distance * 6)) + (recentThreat * 2) + lowHpBonus;
}

function chooseBestHostileTarget(combat, actor) {
  const participants = Array.isArray(combat && combat.participants) ? combat.participants : [];
  const candidates = participants.filter((entry) => {
    return entry &&
      String(entry.participant_id || "") !== String(actor.participant_id || "") &&
      String(entry.team || "") !== String(actor.team || "") &&
      isLivingParticipant(entry);
  });
  if (candidates.length === 0) {
    return null;
  }

  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const score = scoreTarget(combat, actor, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function getMoveCandidatesTowardTarget(actor, target) {
  const dx = Math.sign(Number(target.position.x || 0) - Number(actor.position.x || 0));
  const dy = Math.sign(Number(target.position.y || 0) - Number(actor.position.y || 0));
  const base = {
    x: Number(actor.position.x || 0),
    y: Number(actor.position.y || 0)
  };

  const candidates = [];
  const preferredSteps = [
    { x: base.x + dx, y: base.y + dy },
    { x: base.x + dx, y: base.y },
    { x: base.x, y: base.y + dy },
    { x: base.x + dx, y: base.y - dy },
    { x: base.x - dx, y: base.y + dy }
  ];

  const seen = new Set();
  for (let index = 0; index < preferredSteps.length; index += 1) {
    const step = preferredSteps[index];
    const key = String(step.x) + ":" + String(step.y);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push(step);
  }
  return candidates;
}

function appendAiWaitEvent(combatManager, combatId, actorId, reason) {
  const loaded = combatManager.getCombatById(combatId);
  if (!loaded.ok) {
    return;
  }
  const combat = loaded.payload.combat;
  combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
  combat.event_log.push({
    event_type: "monster_ai_wait",
    timestamp: new Date().toISOString(),
    actor_id: String(actorId || ""),
    reason: String(reason || "no_valid_action")
  });
  combat.updated_at = new Date().toISOString();
  combatManager.combats.set(String(combatId), combat);
}

function resolveMonsterAiTurn(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;

  if (!combatManager) {
    return failure("monster_ai_turn_failed", "combatManager is required");
  }
  if (!combatId || String(combatId).trim() === "") {
    return failure("monster_ai_turn_failed", "combat_id is required");
  }

  const loaded = combatManager.getCombatById(String(combatId));
  if (!loaded.ok) {
    return failure("monster_ai_turn_failed", loaded.error || "combat not found", {
      combat_id: String(combatId)
    });
  }

  const combat = loaded.payload.combat;
  if (String(combat.status || "") !== "active") {
    return failure("monster_ai_turn_failed", "combat is not active", {
      combat_id: String(combatId),
      status: combat.status || null
    });
  }

  const actor = getActiveParticipant(combat);
  if (!actor) {
    return failure("monster_ai_turn_failed", "active participant not found", {
      combat_id: String(combatId)
    });
  }
  if (!isAiControlledParticipant(actor)) {
    return failure("monster_ai_turn_failed", "active participant is not AI controlled", {
      combat_id: String(combatId),
      participant_id: String(actor.participant_id || "")
    });
  }
  if (!isLivingParticipant(actor)) {
    return failure("monster_ai_turn_failed", "active AI participant is defeated", {
      combat_id: String(combatId),
      participant_id: String(actor.participant_id || "")
    });
  }
  if (participantHasCondition(combat, actor.participant_id, "stunned") || participantHasCondition(combat, actor.participant_id, "paralyzed")) {
    const reason = participantHasCondition(combat, actor.participant_id, "paralyzed") ? "paralyzed" : "stunned";
    appendAiWaitEvent(combatManager, combatId, actor.participant_id, reason);
    return success("monster_ai_turn_resolved", {
      combat_id: String(combatId),
      actor_id: String(actor.participant_id || ""),
      action_type: "wait",
      reason
    });
  }

  const target = chooseBestHostileTarget(combat, actor);
  if (!target) {
    appendAiWaitEvent(combatManager, combatId, actor.participant_id, "no_hostile_target");
    return success("monster_ai_turn_resolved", {
      combat_id: String(combatId),
      actor_id: String(actor.participant_id || ""),
      action_type: "wait",
      reason: "no_hostile_target"
    });
  }

  if (tileDistance(actor.position, target.position) <= 1) {
    const attacked = performAttackAction({
      combatManager,
      combat_id: String(combatId),
      attacker_id: actor.participant_id,
      target_id: target.participant_id,
      attack_roll_fn: data.attack_roll_fn,
      damage_roll_fn: data.damage_roll_fn
    });
    if (!attacked.ok) {
      return failure("monster_ai_turn_failed", attacked.error || "failed to resolve AI attack", attacked.payload);
    }
    return success("monster_ai_turn_resolved", {
      combat_id: String(combatId),
      actor_id: String(actor.participant_id || ""),
      target_id: String(target.participant_id || ""),
      action_type: "attack",
      attack: clone(attacked.payload)
    });
  }

  const candidates = getMoveCandidatesTowardTarget(actor, target);
  for (let index = 0; index < candidates.length; index += 1) {
    const attempted = performMoveAction({
      combatManager,
      combat_id: String(combatId),
      participant_id: actor.participant_id,
      target_position: candidates[index]
    });
    if (!attempted.ok) {
      continue;
    }

    const opportunityAttacks = resolveOpportunityAttacksForMove({
      combat: attempted.payload.combat,
      mover_id: actor.participant_id,
      from_position: attempted.payload.from_position,
      to_position: attempted.payload.to_position,
      voluntary_movement: true,
      attack_roll_fn: data.opportunity_attack_roll_fn,
      damage_roll_fn: data.opportunity_damage_roll_fn
    });
    if (!opportunityAttacks.ok) {
      return failure(
        "monster_ai_turn_failed",
        opportunityAttacks.error || "failed to resolve opportunity attacks after AI move",
        opportunityAttacks.payload
      );
    }
    const readyReactions = resolveReadiedAttacksForMove({
      combat: opportunityAttacks.payload.combat,
      mover_id: actor.participant_id,
      from_position: attempted.payload.from_position,
      to_position: attempted.payload.to_position,
      attack_roll_fn: data.opportunity_attack_roll_fn,
      damage_roll_fn: data.opportunity_damage_roll_fn
    });
    if (!readyReactions.ok) {
      return failure(
        "monster_ai_turn_failed",
        readyReactions.error || "failed to resolve readied reactions after AI move",
        readyReactions.payload
      );
    }
    combatManager.combats.set(String(combatId), clone(readyReactions.payload.combat));

    return success("monster_ai_turn_resolved", {
      combat_id: String(combatId),
      actor_id: String(actor.participant_id || ""),
      target_id: String(target.participant_id || ""),
      action_type: "move",
      move: Object.assign({}, clone(attempted.payload), {
        combat: clone(readyReactions.payload.combat)
      }),
      reactions: {
        opportunity_attacks: clone(opportunityAttacks.payload.triggered_attacks),
        ready_attacks: clone(readyReactions.payload.triggered_ready_attacks)
      }
    });
  }

  appendAiWaitEvent(combatManager, combatId, actor.participant_id, "no_path_step");
  return success("monster_ai_turn_resolved", {
    combat_id: String(combatId),
    actor_id: String(actor.participant_id || ""),
    target_id: String(target.participant_id || ""),
    action_type: "wait",
    reason: "no_path_step"
  });
}

module.exports = {
  getActiveParticipant,
  isAiControlledParticipant,
  resolveMonsterAiTurn
};
