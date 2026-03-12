"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function listCraftJobsFromManager(craftJobManager) {
  const store = craftJobManager?.store;
  if (!store?.jobs || !(store.jobs instanceof Map)) return [];
  return Array.from(store.jobs.values()).map(clone);
}

function listRecipesFromManager(recipeManager) {
  const store = recipeManager?.store;
  if (!store || typeof store.list !== "function") return [];
  return clone(store.list());
}

function clearCraftJobManager(craftJobManager) {
  const store = craftJobManager?.store;
  if (store?.jobs instanceof Map) {
    store.jobs.clear();
  }
}

function createCraftingSnapshot(input) {
  const data = input || {};
  const craftJobManager = data.craftJobManager;
  const recipeManager = data.recipeManager || null;

  if (!craftJobManager) {
    return {
      ok: false,
      event_type: "crafting_snapshot_failed",
      payload: {
        reason: "craft_job_manager_required"
      }
    };
  }

  const craftJobs = listCraftJobsFromManager(craftJobManager);
  const activeCraftJobs = craftJobs.filter((job) =>
    job.status === "in_progress" || job.status === "paused"
  );

  const recipeIds = new Set(craftJobs.map((job) => String(job.recipe_id)));
  const recipeReferences = recipeManager
    ? listRecipesFromManager(recipeManager)
      .filter((recipe) => recipeIds.has(String(recipe.recipe_id)))
      .map((recipe) => ({
        recipe_id: recipe.recipe_id,
        recipe_name: recipe.recipe_name || null,
        output_item_id: recipe.output_item_id || null,
        output_quantity: recipe.output_quantity || null,
        active_flag: recipe.active_flag !== false
      }))
    : Array.from(recipeIds).map((recipeId) => ({ recipe_id: recipeId }));

  const pendingCompletionState = data.pendingCompletionState
    ? clone(data.pendingCompletionState)
    : {};

  const reservationConsumptionState = data.reservationConsumptionState
    ? clone(data.reservationConsumptionState)
    : {
      processed_finalization_keys:
        data.processedFinalizationStore?.processed instanceof Set
          ? Array.from(data.processedFinalizationStore.processed.values())
          : []
    };

  return {
    ok: true,
    event_type: "crafting_snapshot_created",
    payload: {
      snapshot_id: `craft-snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      created_at: new Date().toISOString(),
      craft_jobs: craftJobs,
      active_craft_jobs: activeCraftJobs,
      recipe_references: recipeReferences,
      pending_completion_state: pendingCompletionState,
      reservation_consumption_state: reservationConsumptionState
    }
  };
}

function restoreCraftingSnapshot(input) {
  const data = input || {};
  const snapshot = data.snapshot;
  const craftJobManager = data.craftJobManager;

  if (!snapshot || typeof snapshot !== "object") {
    return {
      ok: false,
      event_type: "crafting_snapshot_restore_failed",
      payload: {
        reason: "snapshot_object_required"
      }
    };
  }

  if (!Array.isArray(snapshot.craft_jobs) || !Array.isArray(snapshot.recipe_references)) {
    return {
      ok: false,
      event_type: "crafting_snapshot_restore_failed",
      payload: {
        reason: "snapshot_missing_required_arrays"
      }
    };
  }

  if (!craftJobManager) {
    return {
      ok: false,
      event_type: "crafting_snapshot_restore_failed",
      payload: {
        reason: "craft_job_manager_required"
      }
    };
  }

  clearCraftJobManager(craftJobManager);
  snapshot.craft_jobs.forEach((job) => {
    craftJobManager.store.save(clone(job));
  });

  if (data.pendingCompletionStateRef && typeof data.pendingCompletionStateRef === "object") {
    Object.keys(data.pendingCompletionStateRef).forEach((key) => delete data.pendingCompletionStateRef[key]);
    const nextPending = snapshot.pending_completion_state || {};
    Object.keys(nextPending).forEach((key) => {
      data.pendingCompletionStateRef[key] = clone(nextPending[key]);
    });
  }

  if (data.reservationConsumptionStateRef && typeof data.reservationConsumptionStateRef === "object") {
    Object.keys(data.reservationConsumptionStateRef).forEach((key) => delete data.reservationConsumptionStateRef[key]);
    const nextReservation = snapshot.reservation_consumption_state || {};
    Object.keys(nextReservation).forEach((key) => {
      data.reservationConsumptionStateRef[key] = clone(nextReservation[key]);
    });
  }

  if (
    data.processedFinalizationStore &&
    data.processedFinalizationStore.processed instanceof Set
  ) {
    data.processedFinalizationStore.processed.clear();
    const keys = snapshot.reservation_consumption_state?.processed_finalization_keys;
    if (Array.isArray(keys)) {
      keys.forEach((key) => data.processedFinalizationStore.processed.add(String(key)));
    }
  }

  return {
    ok: true,
    event_type: "crafting_snapshot_restored",
    payload: {
      restored_at: new Date().toISOString(),
      counts: {
        craft_jobs: snapshot.craft_jobs.length,
        active_craft_jobs: Array.isArray(snapshot.active_craft_jobs) ? snapshot.active_craft_jobs.length : 0,
        recipe_references: snapshot.recipe_references.length
      }
    }
  };
}

module.exports = {
  createCraftingSnapshot,
  restoreCraftingSnapshot
};

