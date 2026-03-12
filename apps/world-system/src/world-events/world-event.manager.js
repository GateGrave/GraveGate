"use strict";

const { createWorldEventRecord } = require("./world-event.schema");

class InMemoryWorldEventStore {
  constructor() {
    this.events = new Map();
  }

  save(eventRecord) {
    this.events.set(eventRecord.event_id, eventRecord);
    return eventRecord;
  }

  load(eventId) {
    if (!eventId) return null;
    return this.events.get(String(eventId)) || null;
  }

  list() {
    return Array.from(this.events.values());
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class WorldEventManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryWorldEventStore();
  }

  createWorldEvent(input) {
    const record = createWorldEventRecord(input);
    if (this.store.load(record.event_id)) {
      throw new Error("createWorldEvent requires unique event_id");
    }
    this.store.save(record);
    return clone(record);
  }

  getWorldEvent(event_id) {
    const found = this.store.load(event_id);
    return found ? clone(found) : null;
  }

  updateWorldEvent(event_id, updater) {
    const current = this.store.load(event_id);
    if (!current) return null;

    let patch;
    if (typeof updater === "function") {
      patch = updater(clone(current));
    } else {
      patch = updater || {};
    }

    const merged = {
      ...current,
      ...patch,
      event_id: current.event_id
    };

    const validated = createWorldEventRecord(merged);
    this.store.save(validated);
    return clone(validated);
  }

  closeWorldEvent(event_id, options) {
    const opts = options || {};
    const current = this.store.load(event_id);
    if (!current) return null;

    const requestedEndTime = opts.end_time || new Date().toISOString();
    const safeEndTime =
      new Date(requestedEndTime).getTime() < new Date(current.start_time).getTime()
        ? current.start_time
        : requestedEndTime;

    const next = this.updateWorldEvent(event_id, {
      active_flag: false,
      event_state: {
        ...(current.event_state || {}),
        status: opts.status || "closed"
      },
      end_time: safeEndTime
    });

    return next;
  }

  listActiveWorldEvents() {
    return this.store
      .list()
      .filter((eventRecord) => eventRecord.active_flag === true)
      .map(clone);
  }
}

module.exports = {
  InMemoryWorldEventStore,
  WorldEventManager
};
