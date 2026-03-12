"use strict";

const { processCombatEventSafe } = require("../processing/process-combat-event-safe");
const { detectReactionTrigger } = require("./detect-reaction-trigger");
const { runReactionEngine } = require("./reaction-engine");
const { REACTION_EVENT_TYPES } = require("./trigger-types");

/**
 * Safe combat event processor for reaction triggers.
 * Keeps handling event-driven and lock-safe.
 * @param {object} input
 * @param {object} input.registry - CombatRegistry
 * @param {object} input.event - trigger event
 * @param {object} input.reaction_registry - ReactionRegistry
 * @param {Function} [input.decision_provider]
 * @param {number} [input.wait_ms]
 * @returns {Promise<object>}
 */
async function processReactionTriggerEvent(input) {
  return processCombatEventSafe({
    registry: input.registry,
    event: input.event,
    processEventFn: async ({ event, combatState }) => {
      const trigger = detectReactionTrigger(event);

      if (!trigger) {
        return {
          statePatch: {},
          output: {
            status: "ignored",
            emitted_events: [
              {
                event_type: REACTION_EVENT_TYPES.IGNORED,
                timestamp: new Date().toISOString(),
                payload: {
                  reason: "unsupported_trigger_event"
                }
              }
            ]
          }
        };
      }

      const engineResult = await runReactionEngine({
        combat_state: combatState,
        trigger_type: trigger.trigger_type,
        trigger_event: event,
        reaction_registry: input.reaction_registry,
        decision_provider: input.decision_provider,
        wait_ms: input.wait_ms || 10000
      });

      return {
        stateUpdater: () => engineResult.next_state,
        output: engineResult
      };
    }
  });
}

module.exports = {
  processReactionTriggerEvent
};
