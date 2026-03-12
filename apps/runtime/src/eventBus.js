"use strict";

function createError(message, context) {
  return {
    message,
    context: context || {}
  };
}

function toEventList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function isValidEventShape(event) {
  return Boolean(
    event &&
      typeof event === "object" &&
      typeof event.event_type === "string" &&
      event.event_type.trim() !== ""
  );
}

function createEventBus() {
  const handlersByType = new Map();

  function subscribe(event_type, handler) {
    if (!event_type || String(event_type).trim() === "") {
      return {
        ok: false,
        error: "event_type is required"
      };
    }

    if (typeof handler !== "function") {
      return {
        ok: false,
        error: "handler must be a function"
      };
    }

    const key = String(event_type);
    const handlers = handlersByType.get(key) || [];
    handlers.push(handler);
    handlersByType.set(key, handlers);

    return {
      ok: true,
      event_type: "event_bus_subscribed",
      payload: {
        event_type: key,
        handler_count: handlers.length
      },
      error: null,
      unsubscribe: function unsubscribe() {
        const current = handlersByType.get(key) || [];
        const next = current.filter((fn) => fn !== handler);
        handlersByType.set(key, next);
      }
    };
  }

  async function publish(event) {
    if (!isValidEventShape(event)) {
      return {
        ok: false,
        events_emitted: [],
        errors: [createError("event.event_type is required", { event })]
      };
    }

    const key = String(event.event_type);
    const handlers = handlersByType.get(key) || [];
    const emitted = [];
    const errors = [];

    for (let i = 0; i < handlers.length; i += 1) {
      const handler = handlers[i];

      try {
        const result = await Promise.resolve(handler(event));
        const returnedEvents = toEventList(result);

        returnedEvents.forEach((returnedEvent) => {
          if (!returnedEvent) return;
          if (!isValidEventShape(returnedEvent)) {
            errors.push(
              createError("handler returned invalid event shape", {
                event_type: key,
                handler_index: i
              })
            );
            return;
          }
          emitted.push(returnedEvent);
        });
      } catch (error) {
        errors.push(
          createError(error.message || "handler execution failed", {
            event_type: key,
            handler_index: i
          })
        );
      }
    }

    return {
      ok: errors.length === 0,
      events_emitted: emitted,
      errors
    };
  }

  return {
    subscribe,
    publish
  };
}

module.exports = {
  createEventBus
};
