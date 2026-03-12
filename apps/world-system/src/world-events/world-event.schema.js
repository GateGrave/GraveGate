"use strict";

const WORLD_EVENT_SCHEMA = {
  event_id: "string",
  event_name: "string",
  event_type: "string",
  event_scope: "string",
  event_state: "object",
  start_time: "string (ISO date)",
  end_time: "string (ISO date)|null",
  participation_rules: "object",
  reward_rules: "object",
  active_flag: "boolean"
};

function ensureObject(value, fieldName) {
  const next = value || {};
  if (typeof next !== "object" || Array.isArray(next)) {
    throw new Error(fieldName + " must be an object");
  }
  return next;
}

function toIsoTimeOrNull(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(fieldName + " must be a valid datetime");
  }
  return date.toISOString();
}

function createWorldEventRecord(input) {
  const data = input || {};

  if (!data.event_id || String(data.event_id).trim() === "") {
    throw new Error("createWorldEvent requires event_id");
  }
  if (!data.event_name || String(data.event_name).trim() === "") {
    throw new Error("createWorldEvent requires event_name");
  }
  if (!data.event_type || String(data.event_type).trim() === "") {
    throw new Error("createWorldEvent requires event_type");
  }
  if (!data.event_scope || String(data.event_scope).trim() === "") {
    throw new Error("createWorldEvent requires event_scope");
  }

  const startTime = toIsoTimeOrNull(data.start_time || new Date().toISOString(), "start_time");
  const endTime = toIsoTimeOrNull(data.end_time, "end_time");
  if (endTime && startTime && new Date(endTime).getTime() < new Date(startTime).getTime()) {
    throw new Error("end_time must be greater than or equal to start_time");
  }

  return {
    event_id: String(data.event_id),
    event_name: String(data.event_name),
    event_type: String(data.event_type),
    event_scope: String(data.event_scope),
    event_state: ensureObject(data.event_state, "event_state"),
    start_time: startTime,
    end_time: endTime,
    participation_rules: ensureObject(data.participation_rules, "participation_rules"),
    reward_rules: ensureObject(data.reward_rules, "reward_rules"),
    active_flag: data.active_flag !== false
  };
}

module.exports = {
  WORLD_EVENT_SCHEMA,
  createWorldEventRecord
};

