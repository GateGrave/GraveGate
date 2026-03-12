"use strict";

// Simple Phase 1 logger.
// It prints readable log lines and stores log entries in memory.
class EventLogger {
  constructor() {
    this.records = [];
  }

  /**
   * Internal helper to store and print a log entry.
   * @param {string} level
   * @param {string} message
   * @param {object} [details]
   */
  log(level, message, details) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      details: details || {}
    };

    this.records.push(entry);
    console.log(`[${level}] ${entry.timestamp} ${message}`);
  }

  /**
   * Log when an event enters the queue.
   * @param {object} event
   * @param {number} queueSize
   */
  logQueueEntry(event, queueSize) {
    this.log(
      "QUEUE",
      `Event queued: ${event.event_type} (${event.event_id}) size=${queueSize}`,
      {
        event_id: event.event_id,
        event_type: event.event_type,
        queue_size: queueSize
      }
    );
  }

  /**
   * Log which system the router selected.
   * @param {object} event
   * @param {string} system
   */
  logRoute(event, system) {
    this.log(
      "ROUTE",
      `Event routed to ${system}: ${event.event_type} (${event.event_id})`,
      {
        event_id: event.event_id,
        event_type: event.event_type,
        system
      }
    );
  }

  /**
   * Log the processing result for one event.
   * @param {object} event
   * @param {object} result
   */
  logProcessingResult(event, result) {
    this.log(
      "RESULT",
      `Processed ${event.event_type} (${event.event_id}) -> system=${result.system} generated=${result.generated_events}`,
      {
        event_id: event.event_id,
        event_type: event.event_type,
        system: result.system,
        generated_events: result.generated_events
      }
    );
  }

  /**
   * Log a basic processing error.
   * @param {string} stage
   * @param {Error} error
   * @param {object} [event]
   */
  logError(stage, error, event) {
    this.log("ERROR", `Stage=${stage} message=${error.message}`, {
      stage,
      error_message: error.message,
      event_id: event ? event.event_id : null,
      event_type: event ? event.event_type : null
    });
  }

  /**
   * Read all log entries.
   * @returns {object[]}
   */
  getRecords() {
    return [...this.records];
  }
}

module.exports = {
  EventLogger
};
