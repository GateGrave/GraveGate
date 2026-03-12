"use strict";

const { REACTION_EVENT_TYPES } = require("./trigger-types");
const { buildReactionWindow, waitForReactionDecision } = require("./reaction-window");
const { nowIso } = require("./reaction-utils");

function consumeReactionAvailability(combatState, participantId) {
  const nextParticipants = combatState.participants.map((participant) => {
    if (participant.participant_id !== participantId) {
      return participant;
    }

    return {
      ...participant,
      reaction_available: false
    };
  });

  return {
    ...combatState,
    participants: nextParticipants,
    updated_at: nowIso()
  };
}

async function runReactionEngine(input) {
  const combatState = input.combat_state;
  const triggerType = input.trigger_type;
  const triggerEvent = input.trigger_event;
  const reactionRegistry = input.reaction_registry;
  const decisionProvider = input.decision_provider;
  const waitMs = Number(input.wait_ms || 10000);

  const candidates = reactionRegistry.getCandidatesForTrigger(triggerType, {
    combat_state: combatState,
    trigger_event: triggerEvent
  });

  if (candidates.length === 0) {
    return {
      status: "ignored",
      reason: "no_candidates",
      next_state: combatState,
      emitted_events: [
        {
          event_type: REACTION_EVENT_TYPES.IGNORED,
          timestamp: nowIso(),
          payload: {
            trigger_type: triggerType,
            reason: "no_candidates"
          }
        }
      ]
    };
  }

  const window = buildReactionWindow({
    combat_id: combatState.combat_id,
    trigger_type: triggerType,
    trigger_event_id: triggerEvent.event_id || null,
    wait_ms: waitMs,
    candidates
  });

  const emittedEvents = [
    {
      event_type: REACTION_EVENT_TYPES.WINDOW_OPENED,
      timestamp: nowIso(),
      payload: window
    }
  ];

  const decision = await waitForReactionDecision({
    window,
    decision_provider: decisionProvider,
    wait_ms: waitMs
  });

  if (!decision || decision.status === "declined") {
    emittedEvents.push({
      event_type: REACTION_EVENT_TYPES.DECLINED,
      timestamp: nowIso(),
      payload: {
        window_id: window.window_id,
        trigger_type: triggerType
      }
    });

    return {
      status: "declined",
      next_state: combatState,
      emitted_events: emittedEvents
    };
  }

  if (decision.status === "timeout") {
    emittedEvents.push({
      event_type: REACTION_EVENT_TYPES.TIMEOUT,
      timestamp: nowIso(),
      payload: {
        window_id: window.window_id,
        trigger_type: triggerType
      }
    });

    return {
      status: "timeout",
      next_state: combatState,
      emitted_events: emittedEvents
    };
  }

  const chosen = candidates.find(
    (candidate) =>
      candidate.reactor_participant_id === decision.reactor_participant_id &&
      candidate.reaction_type === decision.reaction_type
  );

  if (!chosen) {
    emittedEvents.push({
      event_type: REACTION_EVENT_TYPES.DECLINED,
      timestamp: nowIso(),
      payload: {
        window_id: window.window_id,
        trigger_type: triggerType,
        reason: "invalid_decision_choice"
      }
    });

    return {
      status: "declined",
      next_state: combatState,
      emitted_events: emittedEvents
    };
  }

  const reactionDefinition = reactionRegistry.getReaction(chosen.reaction_type);
  let nextState = consumeReactionAvailability(combatState, chosen.reactor_participant_id);

  emittedEvents.push({
    event_type: REACTION_EVENT_TYPES.USED,
    timestamp: nowIso(),
    payload: {
      window_id: window.window_id,
      trigger_type: triggerType,
      reaction_type: chosen.reaction_type,
      reactor_participant_id: chosen.reactor_participant_id
    }
  });

  if (reactionDefinition && typeof reactionDefinition.onUsed === "function") {
    const usedResult = reactionDefinition.onUsed({
      combat_state: nextState,
      trigger_event: triggerEvent,
      decision: {
        ...chosen
      }
    }) || {};

    if (usedResult.next_state) {
      nextState = usedResult.next_state;
    }

    if (Array.isArray(usedResult.emitted_events)) {
      emittedEvents.push(...usedResult.emitted_events);
    }
  }

  return {
    status: "used",
    next_state: nextState,
    emitted_events: emittedEvents
  };
}

module.exports = {
  consumeReactionAvailability,
  runReactionEngine
};
