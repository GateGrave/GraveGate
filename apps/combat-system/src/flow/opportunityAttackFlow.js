"use strict";

const { resolveAttackAgainstCombatState } = require("../actions/attackAction");
const { participantHasCondition } = require("../conditions/conditionHelpers");
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
  return list.find((participant) => String(participant && participant.participant_id || "") === String(participantId || "")) || null;
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

function resolveOpportunityAttacksForMove(input) {
  const data = input || {};
  const combat = clone(data.combat);
  const moverId = String(data.mover_id || "").trim();
  const fromPosition = normalizePosition(data.from_position);
  const toPosition = normalizePosition(data.to_position);
  const voluntaryMovement = data.voluntary_movement !== false;
  const attackRollFn = typeof data.attack_roll_fn === "function" ? data.attack_roll_fn : null;
  const damageRollFn = typeof data.damage_roll_fn === "function" ? data.damage_roll_fn : null;

  if (String(combat.status || "") !== "active" || !moverId || !fromPosition || !toPosition || !voluntaryMovement) {
    return success("opportunity_attack_resolution_skipped", {
      combat,
      triggered_attacks: []
    });
  }

  const mover = findParticipantById(combat.participants, moverId);
  if (!mover || !isLivingParticipant(mover)) {
    return success("opportunity_attack_resolution_skipped", {
      combat,
      triggered_attacks: []
    });
  }
  if (participantHasCondition(combat, moverId, "opportunity_attack_immunity")) {
    return success("opportunity_attack_resolution_skipped", {
      combat,
      triggered_attacks: []
    });
  }

  const reactors = [];
  const usedReactors = new Set();
  const participants = Array.isArray(combat.participants) ? combat.participants : [];
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
    const reactorPosition = normalizePosition(reactor.position);
    if (!areAdjacent(fromPosition, reactorPosition)) {
      continue;
    }
    if (areAdjacent(toPosition, reactorPosition)) {
      continue;
    }
    const reactorId = String(reactor.participant_id || "");
    if (!reactorId || usedReactors.has(reactorId) || !canParticipantReact(combat, reactorId)) {
      continue;
    }

    usedReactors.add(reactorId);
    const reactionConsumed = consumeReaction(combat, reactorId);
    if (!reactionConsumed.ok) {
      continue;
    }
    combat.participants = reactionConsumed.next_state.participants;
    combat.event_log = reactionConsumed.next_state.event_log;

    const attackOut = resolveAttackAgainstCombatState({
      combat,
      attacker_id: reactorId,
      target_id: moverId,
      attack_roll_fn: attackRollFn,
      damage_roll_fn: damageRollFn,
      skip_turn_validation: true,
      reaction_mode: true,
      log_event_type: "opportunity_attack"
    });
    if (!attackOut.ok) {
      continue;
    }

    combat.participants = attackOut.payload.combat.participants;
    combat.event_log = attackOut.payload.combat.event_log;
    combat.updated_at = attackOut.payload.combat.updated_at;
    reactors.push({
      reactor_participant_id: reactorId,
      target_participant_id: moverId,
      hit: Boolean(attackOut.payload.hit),
      damage_dealt: Number(attackOut.payload.damage_dealt || 0)
    });

    const currentMover = findParticipantById(combat.participants, moverId);
    if (!currentMover || !isLivingParticipant(currentMover)) {
      break;
    }
  }

  return success("opportunity_attack_resolution_completed", {
    combat,
    triggered_attacks: reactors
  });
}

module.exports = {
  resolveOpportunityAttacksForMove
};
