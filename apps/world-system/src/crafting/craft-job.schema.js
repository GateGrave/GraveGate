"use strict";

const CRAFT_JOB_SCHEMA = {
  craft_job_id: "string",
  player_id: "string",
  recipe_id: "string",
  progress_value: "number",
  required_progress: "number",
  status: "in_progress|paused|cancelled|completed",
  started_at: "string (ISO date)",
  updated_at: "string (ISO date)"
};

function toNonNegativeInt(value, fieldName) {
  const num = Number(value);
  if (!Number.isFinite(num) || Math.floor(num) < 0) {
    throw new Error(fieldName + " must be a non-negative number");
  }
  return Math.floor(num);
}

function createCraftJobRecord(input) {
  const data = input || {};

  if (!data.craft_job_id || String(data.craft_job_id).trim() === "") {
    throw new Error("createCraftJob requires craft_job_id");
  }
  if (!data.player_id || String(data.player_id).trim() === "") {
    throw new Error("createCraftJob requires player_id");
  }
  if (!data.recipe_id || String(data.recipe_id).trim() === "") {
    throw new Error("createCraftJob requires recipe_id");
  }

  const instantComplete = data.instant_complete === true;
  const requiredProgress = instantComplete
    ? 0
    : toNonNegativeInt(
      data.required_progress !== undefined ? data.required_progress : 1,
      "required_progress"
    );
  const inputProgress = toNonNegativeInt(
    data.progress_value !== undefined ? data.progress_value : 0,
    "progress_value"
  );
  const progressValue = Math.min(inputProgress, requiredProgress);

  const status = instantComplete || requiredProgress === 0 || progressValue >= requiredProgress
    ? "completed"
    : (data.status || "in_progress");

  if (!["in_progress", "paused", "cancelled", "completed"].includes(status)) {
    throw new Error("status must be one of: in_progress, paused, cancelled, completed");
  }

  const now = new Date().toISOString();
  return {
    craft_job_id: String(data.craft_job_id),
    player_id: String(data.player_id),
    recipe_id: String(data.recipe_id),
    progress_value: progressValue,
    required_progress: requiredProgress,
    status,
    started_at: data.started_at || now,
    updated_at: data.updated_at || now
  };
}

module.exports = {
  CRAFT_JOB_SCHEMA,
  createCraftJobRecord
};

