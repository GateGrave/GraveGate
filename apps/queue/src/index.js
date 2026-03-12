"use strict";

const { isValidEvent } = require("../../../packages/shared-types");

// The queue is the single communication path between systems.
// Events are handled in FIFO order (first in, first out).
class EventQueue {
  constructor(logger) {
    this.items = [];
    this.logger = logger || null;
  }

  /**
   * Add one event to the end of the queue.
   * @param {object} event
   */
  enqueue(event) {
    if (!isValidEvent(event)) {
      if (this.logger) {
        this.logger.logError("queue_enqueue_validation", new Error("Invalid event object"), event);
      }
      throw new Error("EventQueue.enqueue received an invalid event object");
    }

    this.items.push(event);

    if (this.logger) {
      this.logger.logQueueEntry(event, this.size());
    }
  }

  /**
   * Remove one event from the front of the queue.
   * @returns {object|null}
   */
  dequeue() {
    return this.items.shift() || null;
  }

  /**
   * Current number of queued events.
   * @returns {number}
   */
  size() {
    return this.items.length;
  }

  /**
   * Process all events in order.
   * The router decides what handlers run for each event.
   * The logger records every event as it is processed.
   * @param {object} router
   * @param {object} context
   */
  processAll(router, context) {
    while (this.size() > 0) {
      const event = this.dequeue();
      const logger = context.logger || this.logger;

      try {
        const result = router.route(event, context) || {
          system: "unknown",
          generated_events: 0
        };

        if (logger) {
          logger.logProcessingResult(event, result);
        }
      } catch (error) {
        if (logger) {
          logger.logError("queue_process_event", error, event);
        }
        throw error;
      }
    }
  }
}

module.exports = {
  EventQueue
};
