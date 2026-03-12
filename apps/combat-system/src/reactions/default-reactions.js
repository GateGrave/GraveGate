"use strict";

const { REACTION_TRIGGER_TYPES, REACTION_EVENT_TYPES } = require("./trigger-types");
const { findParticipantById, isAdjacent } = require("./reaction-utils");

const OPPORTUNITY_ATTACK = "opportunity_attack";
const COUNTERSPELL_REACTION = "counterspell_reaction";
const PROTECT_ALLY_REACTION = "protect_ally_reaction";

function buildOpportunityAttackCandidates(context) {
  const combatState = context.combat_state;
  const triggerEvent = context.trigger_event;
  const payload = triggerEvent.payload || {};
  const moverId = payload.moving_participant_id;
  const from = payload.from_position;
  const to = payload.to_position;

  return combatState.participants
    .filter((participant) => participant.participant_id !== moverId)
    .filter((participant) => participant.reaction_available === true)
    .filter((participant) => isAdjacent(participant.position, from))
    .filter((participant) => !isAdjacent(participant.position, to))
    .map((participant) => ({
      reactor_participant_id: participant.participant_id,
      metadata: {
        target_participant_id: moverId
      }
    }));
}

function onOpportunityAttackUsed(context) {
  const decision = context.decision;
  const triggerEvent = context.trigger_event;
  const targetId = decision.metadata?.target_participant_id ||
    triggerEvent.payload?.moving_participant_id ||
    null;

  return {
    emitted_events: [
      {
        event_type: REACTION_EVENT_TYPES.OPPORTUNITY_ATTACK_DECLARED,
        timestamp: new Date().toISOString(),
        payload: {
          reactor_participant_id: decision.reactor_participant_id,
          target_participant_id: targetId,
          trigger_event_id: triggerEvent.event_id || null
        }
      }
    ]
  };
}

function buildCounterspellCandidates(context) {
  const combatState = context.combat_state;
  const casterId = context.trigger_event.payload?.caster_participant_id;

  return combatState.participants
    .filter((participant) => participant.participant_id !== casterId)
    .filter((participant) => participant.reaction_available === true)
    .map((participant) => ({
      reactor_participant_id: participant.participant_id,
      metadata: {
        target_participant_id: casterId
      }
    }));
}

function buildProtectAllyCandidates(context) {
  const combatState = context.combat_state;
  const targetId = context.trigger_event.payload?.target_participant_id;
  const ally = findParticipantById(combatState, targetId);

  if (!ally) {
    return [];
  }

  return combatState.participants
    .filter((participant) => participant.participant_id !== targetId)
    .filter((participant) => participant.reaction_available === true)
    .filter((participant) => ally.team_id && participant.team_id === ally.team_id)
    .map((participant) => ({
      reactor_participant_id: participant.participant_id,
      metadata: {
        protected_ally_id: targetId
      }
    }));
}

function createDefaultReactionDefinitions() {
  return [
    {
      reaction_type: OPPORTUNITY_ATTACK,
      supported_triggers: [REACTION_TRIGGER_TYPES.ENEMY_LEAVES_MELEE_RANGE],
      buildCandidates: buildOpportunityAttackCandidates,
      onUsed: onOpportunityAttackUsed
    },
    {
      reaction_type: COUNTERSPELL_REACTION,
      supported_triggers: [REACTION_TRIGGER_TYPES.SPELL_CAST],
      buildCandidates: buildCounterspellCandidates
    },
    {
      reaction_type: PROTECT_ALLY_REACTION,
      supported_triggers: [REACTION_TRIGGER_TYPES.ALLY_ATTACKED],
      buildCandidates: buildProtectAllyCandidates
    }
  ];
}

module.exports = {
  OPPORTUNITY_ATTACK,
  COUNTERSPELL_REACTION,
  PROTECT_ALLY_REACTION,
  createDefaultReactionDefinitions
};
