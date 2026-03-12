"use strict";

class ProcessedCraftCompletionStore {
  constructor() {
    this.processedByJobId = new Map();
  }

  isProcessed(craftJobId) {
    if (!craftJobId) return false;
    return this.processedByJobId.has(String(craftJobId));
  }

  markProcessed(craftJobId, payload) {
    if (!craftJobId) return;
    this.processedByJobId.set(String(craftJobId), payload || true);
  }

  getProcessedPayload(craftJobId) {
    if (!craftJobId) return null;
    return this.processedByJobId.get(String(craftJobId)) || null;
  }
}

const defaultProcessedCraftCompletionStore = new ProcessedCraftCompletionStore();

function normalizeOutputRow(row, index) {
  if (!row || typeof row !== "object") {
    throw new Error("Recipe output row must be an object at index " + index);
  }
  if (!row.item_id || String(row.item_id).trim() === "") {
    throw new Error("Recipe output row requires item_id at index " + index);
  }

  const quantityRaw = row.quantity !== undefined ? row.quantity : 1;
  const quantity = Math.floor(Number(quantityRaw));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Recipe output row requires quantity > 0 at index " + index);
  }

  return {
    item_id: String(row.item_id),
    quantity
  };
}

function normalizeRecipeOutputs(recipe) {
  if (!recipe || typeof recipe !== "object") {
    throw new Error("Recipe is required");
  }

  // Future-safe multi-output format.
  if (Array.isArray(recipe.outputs)) {
    if (recipe.outputs.length === 0) {
      throw new Error("Recipe outputs cannot be empty");
    }
    return recipe.outputs.map((row, index) => normalizeOutputRow(row, index));
  }

  // Standard single-output format.
  if (!recipe.output_item_id || String(recipe.output_item_id).trim() === "") {
    throw new Error("Recipe requires output_item_id or outputs");
  }
  const outputQuantity = Math.floor(
    Number(recipe.output_quantity !== undefined ? recipe.output_quantity : 1)
  );
  if (!Number.isFinite(outputQuantity) || outputQuantity <= 0) {
    throw new Error("Recipe output_quantity must be > 0");
  }

  return [
    {
      item_id: String(recipe.output_item_id),
      quantity: outputQuantity
    }
  ];
}

function validateCraftJobCompletion(craftJob) {
  if (!craftJob || typeof craftJob !== "object") {
    throw new Error("Craft job is required");
  }
  if (!craftJob.craft_job_id || String(craftJob.craft_job_id).trim() === "") {
    throw new Error("Craft job requires craft_job_id");
  }
  if (!craftJob.player_id || String(craftJob.player_id).trim() === "") {
    throw new Error("Craft job requires player_id");
  }
  if (!craftJob.recipe_id || String(craftJob.recipe_id).trim() === "") {
    throw new Error("Craft job requires recipe_id");
  }

  const progressValue = Math.floor(Number(craftJob.progress_value || 0));
  const requiredProgress = Math.floor(Number(craftJob.required_progress || 0));
  const completedByStatus = craftJob.status === "completed";
  const completedByProgress = Number.isFinite(progressValue) &&
    Number.isFinite(requiredProgress) &&
    progressValue >= requiredProgress;

  if (!completedByStatus && !completedByProgress) {
    throw new Error("Craft job is not complete yet");
  }
}

function resolveCraftCompletion(input, options) {
  const payload = input || {};
  const config = options || {};
  const allowDuplicate = config.allow_duplicate === true;
  const processedStore = config.processedStore || defaultProcessedCraftCompletionStore;

  try {
    const craftJob = payload.craft_job;
    const recipe = payload.recipe;
    validateCraftJobCompletion(craftJob);

    if (!recipe || typeof recipe !== "object") {
      return {
        ok: false,
        code: "MALFORMED_COMPLETION_PAYLOAD",
        error: "Completion payload requires recipe"
      };
    }

    if (String(craftJob.recipe_id) !== String(recipe.recipe_id)) {
      return {
        ok: false,
        code: "RECIPE_MISMATCH",
        error: "Craft job recipe_id does not match provided recipe"
      };
    }

    const craftJobId = String(craftJob.craft_job_id);
    if (!allowDuplicate && processedStore.isProcessed(craftJobId)) {
      return {
        ok: false,
        code: "DUPLICATE_COMPLETION",
        error: "Craft completion already processed for this job",
        craft_job_id: craftJobId,
        already_processed: true
      };
    }

    const outputs = normalizeRecipeOutputs(recipe);
    const totalOutputQuantity = outputs.reduce((sum, row) => sum + row.quantity, 0);

    const completionPayload = {
      event_type: "crafted_output_ready",
      craft_job_id: craftJobId,
      player_id: String(craftJob.player_id),
      recipe_id: String(recipe.recipe_id),
      outputs,
      total_output_quantity: totalOutputQuantity,
      source: "world.crafting",
      target_system: "world_state",
      created_at: new Date().toISOString()
    };

    if (!allowDuplicate) {
      processedStore.markProcessed(craftJobId, completionPayload);
    }

    return {
      ok: true,
      code: "CRAFT_COMPLETION_RESOLVED",
      completion_payload: completionPayload
    };
  } catch (error) {
    return {
      ok: false,
      code: "CRAFT_COMPLETION_REJECTED",
      error: error.message
    };
  }
}

module.exports = {
  ProcessedCraftCompletionStore,
  defaultProcessedCraftCompletionStore,
  resolveCraftCompletion
};

