"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createOrchestrator(options) {
  const cfg = options || {};
  const eventBus = cfg.eventBus;
  const maxEvents = Number.isFinite(cfg.max_events)
    ? Math.max(1, Math.floor(cfg.max_events))
    : 1000;
  const applyEventToState =
    typeof cfg.applyEventToState === "function"
      ? cfg.applyEventToState
      : function defaultApply(state, event) {
          const next = state || {};
          const processedByType = next.processed_by_type || {};
          const key = String(event.event_type);
          processedByType[key] = (processedByType[key] || 0) + 1;
          return {
            ...next,
            processed_by_type: processedByType
          };
        };

  if (!eventBus || typeof eventBus.publish !== "function") {
    throw new Error("createOrchestrator requires eventBus.publish");
  }

  async function run(initialEvent, initialState) {
    if (!initialEvent || typeof initialEvent !== "object" || !initialEvent.event_type) {
      return {
        ok: false,
        events_processed: [],
        final_state: {
          halted_reason: "invalid_initial_event",
          max_events: maxEvents
        }
      };
    }

    const eventsToProcess = [initialEvent];
    const processed = [];
    const errors = [];
    let state = initialState && typeof initialState === "object" ? clone(initialState) : {};

    while (eventsToProcess.length > 0) {
      if (processed.length >= maxEvents) {
        return {
          ok: false,
          events_processed: processed,
          final_state: {
            ...state,
            halted_reason: "max_events_reached",
            max_events: maxEvents,
            errors
          }
        };
      }

      const event = eventsToProcess.shift();
      processed.push(clone(event));

      state = await Promise.resolve(applyEventToState(state, event));

      const publishResult = await eventBus.publish(event);
      if (!publishResult.ok && Array.isArray(publishResult.errors)) {
        errors.push(...publishResult.errors);
      }

      const emitted = Array.isArray(publishResult.events_emitted)
        ? publishResult.events_emitted
        : [];

      emitted.forEach((emittedEvent) => {
        eventsToProcess.push(emittedEvent);
      });
    }

    return {
      ok: errors.length === 0,
      events_processed: processed,
      final_state: {
        ...state,
        halted_reason: "completed",
        max_events: maxEvents,
        errors
      }
    };
  }

  return {
    run
  };
}

module.exports = {
  createOrchestrator
};
