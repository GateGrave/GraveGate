"use strict";

const SUPPORTED_CRAFT_EVENT_TYPES = new Set([
  "craft_started",
  "craft_progressed",
  "craft_check_resolved",
  "craft_completed",
  "craft_failed",
  "materials_consumed"
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class CraftingLogger {
  constructor() {
    this.records = [];
  }

  log(record) {
    const data = record && typeof record === "object" ? record : {};
    const eventType = data.event_type ? String(data.event_type) : null;
    const validType = eventType && SUPPORTED_CRAFT_EVENT_TYPES.has(eventType);

    const entry = {
      timestamp: new Date().toISOString(),
      craft_job_id: data.craft_job_id ? String(data.craft_job_id) : null,
      player_id: data.player_id ? String(data.player_id) : null,
      recipe_id: data.recipe_id ? String(data.recipe_id) : null,
      event_type: validType ? eventType : "craft_failed",
      materials_snapshot:
        data.materials_snapshot && typeof data.materials_snapshot === "object"
          ? clone(data.materials_snapshot)
          : null,
      output_snapshot:
        data.output_snapshot && typeof data.output_snapshot === "object"
          ? clone(data.output_snapshot)
          : null,
      result: data.result ? String(data.result) : validType ? "logged" : "invalid_payload"
    };

    this.records.push(entry);
    return clone(entry);
  }

  logCraftStarted(input) {
    const payload = input?.payload || input || {};
    return this.log({
      ...payload,
      event_type: "craft_started"
    });
  }

  logCraftProgressed(input) {
    const payload = input?.payload || input || {};
    return this.log({
      ...payload,
      event_type: "craft_progressed"
    });
  }

  logCraftCheckResolved(input) {
    const payload = input?.payload || input || {};
    return this.log({
      ...payload,
      event_type: "craft_check_resolved"
    });
  }

  logCraftCompleted(input) {
    const payload = input?.payload || input || {};
    return this.log({
      ...payload,
      event_type: "craft_completed"
    });
  }

  logCraftFailed(input) {
    const payload = input?.payload || input || {};
    return this.log({
      ...payload,
      event_type: "craft_failed",
      result: payload.result || payload.reason || "failed"
    });
  }

  logMaterialsConsumed(input) {
    const payload = input?.payload || input || {};
    return this.log({
      ...payload,
      event_type: "materials_consumed"
    });
  }

  listLogs() {
    return clone(this.records);
  }

  clearLogs() {
    this.records = [];
  }
}

module.exports = {
  CraftingLogger,
  SUPPORTED_CRAFT_EVENT_TYPES
};

