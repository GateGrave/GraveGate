"use strict";

const { createCraftJobRecord } = require("./craft-job.schema");

class InMemoryCraftJobStore {
  constructor() {
    this.jobs = new Map();
  }

  save(job) {
    this.jobs.set(job.craft_job_id, job);
    return job;
  }

  load(craftJobId) {
    if (!craftJobId) return null;
    return this.jobs.get(String(craftJobId)) || null;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class CraftJobManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryCraftJobStore();
  }

  createCraftJob(input) {
    const record = createCraftJobRecord(input);
    this.store.save(record);
    return clone(record);
  }

  getCraftJob(craft_job_id) {
    const loaded = this.store.load(craft_job_id);
    return loaded ? clone(loaded) : null;
  }

  updateCraftProgress(craft_job_id, progressDelta) {
    const current = this.store.load(craft_job_id);
    if (!current) return null;
    if (current.status === "cancelled") {
      return clone(current);
    }
    if (current.status === "paused") {
      return clone(current);
    }
    if (current.status === "completed") {
      return clone(current);
    }

    const delta = Number(progressDelta);
    if (!Number.isFinite(delta)) {
      throw new Error("progress delta must be a number");
    }

    const nextProgress = Math.max(
      0,
      Math.min(current.required_progress, current.progress_value + Math.floor(delta))
    );
    const completed = nextProgress >= current.required_progress;

    const next = {
      ...current,
      progress_value: nextProgress,
      status: completed ? "completed" : current.status,
      updated_at: new Date().toISOString()
    };

    this.store.save(next);
    return clone(next);
  }

  pauseCraftJob(craft_job_id) {
    const current = this.store.load(craft_job_id);
    if (!current) return null;
    if (current.status === "completed" || current.status === "cancelled") {
      return clone(current);
    }

    const next = {
      ...current,
      status: "paused",
      updated_at: new Date().toISOString()
    };
    this.store.save(next);
    return clone(next);
  }

  resumeCraftJob(craft_job_id) {
    const current = this.store.load(craft_job_id);
    if (!current) return null;
    if (current.status === "completed" || current.status === "cancelled") {
      return clone(current);
    }

    const next = {
      ...current,
      status: "in_progress",
      updated_at: new Date().toISOString()
    };
    this.store.save(next);
    return clone(next);
  }

  cancelCraftJob(craft_job_id) {
    const current = this.store.load(craft_job_id);
    if (!current) return null;
    if (current.status === "completed") {
      return clone(current);
    }

    const next = {
      ...current,
      status: "cancelled",
      updated_at: new Date().toISOString()
    };
    this.store.save(next);
    return clone(next);
  }
}

module.exports = {
  InMemoryCraftJobStore,
  CraftJobManager
};

