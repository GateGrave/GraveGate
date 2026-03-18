"use strict";

const { resolveAttackAgainstCombatState } = require("../actions/attackAction");
const { canParticipantReact, consumeReaction } = require("../reactions/reactionState");

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

function findParticipantById(participants, participantId) {
  const list = Array.isArray(participants) ? participants : [];
  return list.find((entry) => String(entry && entry.participant_id || "") === String(participantId || "")) || null;
}

function areAdjacent(a, b) {
  if (!a || !b) {
    return false;
  }
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return dx + dy === 1;
}

function isLivingParticipant(participant) {
  const hp = Number(participant && participant.current_hp);
  return Number.isFinite(hp) && hp > 0;
}

function clearReadyAction(combat, participantId) {
  const list = Array.isArray(combat.participants) ? combat.participants : [];
  const index = list.findIndex((entry) => String(entry && entry.participant_id || "") === String(participantId || ""));
  if (index === -1) {
    return;
  }
  list[index] = Object.assign({}, list[index], {
    ready_action: null
  });
}

function resolveReadiedAttacksForMove(input) {
  const data = input || {};
  const combat = clone(data.combat);
  const moverId = String(data.mover_id || "").trim();
  const fromPosition = normalizePosition(data.from_position);
  const toPosition = normalizePosition(data.to_position);
  const attackRollFn = typeof data.attack_roll_fn === "function" ? data.attack_roll_fn : null;
  const damageRollFn = typeof data.damage_roll_fn === "function" ? data.damage_roll_fn : null;

  if (String(combat.status || "") !== "active" || !moverId || !fromPosition || !toPosition) {
    return success("ready_action_resolution_skipped", {
      combat,
      triggered_ready_attacks: []
    });
  }

  const mover = findParticipantById(combat.participants, moverId);
  if (!mover || !isLivingParticipant(mover)) {
    return success("ready_action_resolution_skipped", {
      combat,
      triggered_ready_attacks: []
    });
  }

  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  const triggered = [];
  const usedReactors = new Set();

  for (let index = 0; index < participants.length; index += 1) {
    const reactor = participants[index];
    if (!reactor || String(reactor.participant_id || "") === moverId) {
      continue;
    }
    if (String(reactor.team || "") === String(mover.team || "")) {
      continue;
    }
    if (!isLivingParticipant(reactor)) {
      continue;
    }

    const reactorId = String(reactor.participant_id || "");
    if (!reactorId || usedReactors.has(reactorId)) {
      continue;
    }

    const ready = reactor.ready_action && typeof reactor.ready_action === "object"
      ? reactor.ready_action
      : null;
    const triggerType = String(ready && ready.trigger_type || "").trim().toLowerCase();
    const actionType = String(ready && ready.action_type || "").trim().toLowerCase();
    const readyTargetId = String(ready && ready.target_id || "").trim();
    if (!ready || triggerType !== "enemy_enters_reach" || actionType !== "attack") {
      continue;
    }
    if (readyTargetId && readyTargetId !== moverId) {
      continue;
    }

    const reactorPosition = normalizePosition(reactor.position);
    if (!reactorPosition) {
      continue;
    }
    const enteredReach = areAdjacent(toPosition, reactorPosition) && !areAdjacent(fromPosition, reactorPosition);
    if (!enteredReach) {
      continue;
    }
    if (!canParticipantReact(combat, reactorId)) {
      continue;
    }

    usedReactors.add(reactorId);

    const consumed = consumeReaction(combat, reactorId);
    if (!consumed.ok) {
      continue;
    }
    combat.participants = consumed.next_state.participants;
    combat.event_log = consumed.next_state.event_log;
    combat.updated_at = consumed.next_state.updated_at;

    const attackOut = resolveAttackAgainstCombatState({
      combat,
      attacker_id: reactorId,
      target_id: moverId,
      attack_roll_fn: attackRollFn || undefined,
      damage_roll_fn: damageRollFn || undefined,
      skip_turn_validation: true,
      reaction_mode: true,
      log_event_type: "ready_attack"
    });
    if (!attackOut.ok) {
      clearReadyAction(combat, reactorId);
      continue;
    }

    combat.participants = clone(attackOut.payload.combat.participants);
    combat.conditions = clone(attackOut.payload.combat.conditions || []);
    combat.event_log = clone(attackOut.payload.combat.event_log || []);
    clearReadyAction(combat, reactorId);
    combat.event_log.push({
      event_type: "ready_action_triggered",
      timestamp: new Date().toISOString(),
      participant_id: reactorId,
      target_participant_id: moverId,
      action_type: "attack"
    });
    combat.updated_at = new Date().toISOString();

    triggered.push({
      reactor_participant_id: reactorId,
      target_participant_id: moverId,
      action_type: "attack",
      hit: Boolean(attackOut.payload.hit),
      damage_dealt: Number(attackOut.payload.damage_dealt || 0)
    });

    const movedAfterHit = findParticipantById(combat.participants, moverId);
    if (!movedAfterHit || !isLivingParticipant(movedAfterHit)) {
      break;
    }
  }

  return success("ready_action_resolution_completed", {
    combat,
    triggered_ready_attacks: triggered
  });
}

module.exports = {
  resolveReadiedAttacksForMove
};
