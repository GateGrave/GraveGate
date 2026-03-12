"use strict";

const SEASONAL_EVENT_SCHEMA = {
  event_id: "string",
  season_code: "string",
  event_name: "string",
  event_definition: "object",
  start_time: "string (ISO date)",
  end_time: "string (ISO date)",
  participation_rules: "object",
  reward_variant_hooks: "object",
  recurrence_template: "object|null",
  retired_flag: "boolean",
  active_flag: "boolean",
  created_at: "string (ISO date)",
  updated_at: "string (ISO date)"
};

class InMemorySeasonalEventStore {
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

function ensureObject(value, fieldName) {
  const next = value || {};
  if (typeof next !== "object" || Array.isArray(next)) {
    throw new Error(fieldName + " must be an object");
  }
  return next;
}

function toIso(value, fieldName) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(fieldName + " must be a valid datetime");
  }
  return date.toISOString();
}

function createSeasonalEventRecord(input) {
  const data = input || {};
  if (!data.event_id || String(data.event_id).trim() === "") {
    throw new Error("createSeasonalEvent requires event_id");
  }
  if (!data.season_code || String(data.season_code).trim() === "") {
    throw new Error("createSeasonalEvent requires season_code");
  }
  if (!data.event_name || String(data.event_name).trim() === "") {
    throw new Error("createSeasonalEvent requires event_name");
  }
  if (!data.start_time) {
    throw new Error("createSeasonalEvent requires start_time");
  }
  if (!data.end_time) {
    throw new Error("createSeasonalEvent requires end_time");
  }

  const startTime = toIso(data.start_time, "start_time");
  const endTime = toIso(data.end_time, "end_time");
  if (new Date(endTime).getTime() < new Date(startTime).getTime()) {
    throw new Error("end_time must be greater than or equal to start_time");
  }

  const recurrenceTemplate =
    data.recurrence_template === null || data.recurrence_template === undefined
      ? null
      : ensureObject(data.recurrence_template, "recurrence_template");

  const now = new Date().toISOString();
  return {
    event_id: String(data.event_id),
    season_code: String(data.season_code),
    event_name: String(data.event_name),
    event_definition: ensureObject(data.event_definition, "event_definition"),
    start_time: startTime,
    end_time: endTime,
    participation_rules: ensureObject(data.participation_rules, "participation_rules"),
    reward_variant_hooks: ensureObject(data.reward_variant_hooks, "reward_variant_hooks"),
    recurrence_template: recurrenceTemplate,
    retired_flag: Boolean(data.retired_flag),
    active_flag: data.active_flag !== false,
    created_at: data.created_at || now,
    updated_at: data.updated_at || now
  };
}

class SeasonalEventManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemorySeasonalEventStore();
  }

  createSeasonalEvent(input) {
    const record = createSeasonalEventRecord(input);
    if (this.store.load(record.event_id)) {
      throw new Error("createSeasonalEvent requires unique event_id");
    }
    this.store.save(record);
    return clone(record);
  }

  getSeasonalEvent(event_id) {
    const found = this.store.load(event_id);
    return found ? clone(found) : null;
  }

  updateSeasonalEvent(event_id, updater) {
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
      event_id: current.event_id,
      created_at: current.created_at,
      updated_at: new Date().toISOString()
    };
    const validated = createSeasonalEventRecord(merged);
    this.store.save(validated);
    return clone(validated);
  }

  retireSeasonalEvent(event_id, options) {
    const opts = options || {};
    return this.updateSeasonalEvent(event_id, {
      retired_flag: true,
      active_flag: false,
      event_definition: {
        ...(this.getSeasonalEvent(event_id)?.event_definition || {}),
        retired_reason: opts.reason || "retired"
      }
    });
  }
}

function isSeasonalEventActiveWindow(eventRecord, atTime) {
  if (!eventRecord) return false;
  if (eventRecord.active_flag !== true) return false;
  if (eventRecord.retired_flag === true) return false;

  const now = atTime ? new Date(atTime) : new Date();
  if (Number.isNaN(now.getTime())) return false;

  const start = new Date(eventRecord.start_time);
  const end = new Date(eventRecord.end_time);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  return now.getTime() >= start.getTime() && now.getTime() <= end.getTime();
}

function getSeasonalRewardVariantHooks(eventRecord) {
  if (!eventRecord) return {};
  return clone(eventRecord.reward_variant_hooks || {});
}

function validateSeasonalParticipation(input) {
  const data = input || {};
  const eventRecord = data.eventRecord;
  const playerProfile = data.playerProfile || {};
  const atTime = data.at_time;

  if (!eventRecord || typeof eventRecord !== "object") {
    return {
      ok: false,
      event_type: "seasonal_participation_rejected",
      payload: { reason: "event_record_required" }
    };
  }

  if (!isSeasonalEventActiveWindow(eventRecord, atTime)) {
    return {
      ok: false,
      event_type: "seasonal_participation_rejected",
      payload: { reason: "event_not_active" }
    };
  }

  const rules = eventRecord.participation_rules || {};
  const minLevel = Number.isFinite(rules.min_level) ? Math.floor(rules.min_level) : null;
  const level = Number.isFinite(playerProfile.level) ? Math.floor(playerProfile.level) : 0;
  if (minLevel !== null && level < minLevel) {
    return {
      ok: false,
      event_type: "seasonal_participation_rejected",
      payload: {
        reason: "min_level_not_met",
        required_level: minLevel,
        player_level: level
      }
    };
  }

  return {
    ok: true,
    event_type: "seasonal_participation_allowed",
    payload: {
      event_id: eventRecord.event_id,
      player_id: playerProfile.player_id || null
    }
  };
}

module.exports = {
  SEASONAL_EVENT_SCHEMA,
  InMemorySeasonalEventStore,
  SeasonalEventManager,
  createSeasonalEventRecord,
  isSeasonalEventActiveWindow,
  validateSeasonalParticipation,
  getSeasonalRewardVariantHooks
};

