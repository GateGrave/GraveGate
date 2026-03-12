"use strict";

const { InventoryGrantAdapter } = require("../loot/grants/inventory-grant.adapter");
const { resolveCraftCompletion } = require("./craft-completion.resolver");
const { getMissingMaterials } = require("./resource-requirements");
const { createInventoryRecord } = require("../../../inventory-system/src/inventory.schema");
const {
  addItemToInventory: canonicalAddItemToInventory,
  removeItemFromInventory: canonicalRemoveItemFromInventory,
  normalizeInventoryShape: canonicalNormalizeInventoryShape
} = require("../../../inventory-system/src/mutationHelpers");

class ProcessedCraftFinalizationStore {
  constructor() {
    this.processed = new Set();
  }

  has(key) {
    if (!key) return false;
    return this.processed.has(String(key));
  }

  add(key) {
    if (!key) return;
    this.processed.add(String(key));
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFailure(reason, extra) {
  return {
    ok: false,
    event_type: "craft_finalize_failed",
    payload: {
      reason,
      ...(extra || {})
    }
  };
}

function isInventoryServiceValid(service) {
  return Boolean(
    service &&
      typeof service.getInventory === "function" &&
      typeof service.saveInventory === "function"
  );
}

function extractInventoryFromResult(result) {
  if (!result) return null;
  if (result.ok === true && result.payload && result.payload.inventory) {
    return result.payload.inventory;
  }
  if (result.ok === false) return null;
  if (typeof result === "object") return result;
  return null;
}

function resolveMutationHelpers(input) {
  const data = input || {};
  const injected = data.mutation_helpers && typeof data.mutation_helpers === "object"
    ? data.mutation_helpers
    : null;

  return {
    addItemToInventory:
      injected && typeof injected.addItemToInventory === "function"
        ? injected.addItemToInventory
        : canonicalAddItemToInventory,
    removeItemFromInventory:
      injected && typeof injected.removeItemFromInventory === "function"
        ? injected.removeItemFromInventory
        : canonicalRemoveItemFromInventory,
    normalizeInventoryShape:
      injected && typeof injected.normalizeInventoryShape === "function"
        ? injected.normalizeInventoryShape
        : canonicalNormalizeInventoryShape
  };
}

function normalizeRecipeRequirements(recipe) {
  if (!recipe || !Array.isArray(recipe.required_materials)) return [];

  return recipe.required_materials.map((row, index) => {
    if (!row || typeof row !== "object") {
      throw new Error("required_materials row must be object at index " + index);
    }
    if (row.item_id) {
      const quantity = Math.floor(Number(row.quantity));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("required_materials quantity must be > 0 at index " + index);
      }
      return { type: "single", item_id: String(row.item_id), quantity };
    }

    if (Array.isArray(row.alternatives)) {
      if (row.alternatives.length === 0) {
        throw new Error("required_materials alternatives cannot be empty at index " + index);
      }
      return {
        type: "alternatives",
        alternatives: row.alternatives.map((alt, altIndex) => {
          if (!alt || typeof alt !== "object" || !alt.item_id) {
            throw new Error("alternative requires item_id at index " + index + ":" + altIndex);
          }
          const quantity = Math.floor(Number(alt.quantity));
          if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error("alternative quantity must be > 0 at index " + index + ":" + altIndex);
          }
          return { item_id: String(alt.item_id), quantity };
        })
      };
    }

    throw new Error("required_materials requires item_id or alternatives at index " + index);
  });
}

function toRequirementInventoryView(inventory) {
  const quantities = {};

  const legacyEntries = Array.isArray(inventory?.item_entries) ? inventory.item_entries : [];
  legacyEntries.forEach((entry) => {
    if (!entry || !entry.item_id) return;
    const qty = Number.isFinite(entry.quantity) ? Math.floor(entry.quantity) : 1;
    if (qty <= 0) return;
    const key = String(entry.item_id);
    quantities[key] = (quantities[key] || 0) + qty;
  });

  const canonicalBuckets = ["stackable_items", "equipment_items", "quest_items"];
  canonicalBuckets.forEach((bucket) => {
    const entries = Array.isArray(inventory?.[bucket]) ? inventory[bucket] : [];
    entries.forEach((entry) => {
      if (!entry || !entry.item_id) return;
      const qty = Number.isFinite(entry.quantity) ? Math.floor(entry.quantity) : 1;
      if (qty <= 0) return;
      const key = String(entry.item_id);
      quantities[key] = (quantities[key] || 0) + qty;
    });
  });

  return { quantities };
}

function totalOwned(entries, itemId) {
  const rows = Array.isArray(entries) ? entries : [];
  return rows
    .filter((entry) => entry.item_id === itemId)
    .reduce((sum, entry) => {
      const quantity = Number.isFinite(entry.quantity) ? Math.floor(entry.quantity) : 1;
      return sum + Math.max(0, quantity);
    }, 0);
}

function consumeFromEntries(entries, itemId, quantity) {
  let remaining = quantity;
  for (const entry of entries) {
    if (entry.item_id !== itemId) continue;
    if (remaining <= 0) break;

    const entryQty = Number.isFinite(entry.quantity) ? Math.max(0, Math.floor(entry.quantity)) : 1;
    if (entryQty <= remaining) {
      entry.quantity = 0;
      remaining -= entryQty;
    } else {
      entry.quantity = entryQty - remaining;
      remaining = 0;
    }
  }

  return remaining === 0;
}

function consumeRequiredMaterials(inventory, recipe) {
  const requirements = normalizeRecipeRequirements(recipe);
  const working = clone(Array.isArray(inventory.item_entries) ? inventory.item_entries : []);
  const consumed = [];

  for (const req of requirements) {
    if (req.type === "single") {
      const ok = consumeFromEntries(working, req.item_id, req.quantity);
      if (!ok) {
        return { ok: false, reason: "consume_failed", item_id: req.item_id, quantity: req.quantity };
      }
      consumed.push({ item_id: req.item_id, quantity: req.quantity });
      continue;
    }

    // Alternative material choice: first alternative with enough quantity.
    const chosen = req.alternatives.find((alt) => totalOwned(working, alt.item_id) >= alt.quantity);
    if (!chosen) {
      return { ok: false, reason: "consume_alternative_failed", alternatives: req.alternatives };
    }

    const ok = consumeFromEntries(working, chosen.item_id, chosen.quantity);
    if (!ok) {
      return { ok: false, reason: "consume_alternative_failed", alternatives: req.alternatives };
    }
    consumed.push({ item_id: chosen.item_id, quantity: chosen.quantity, consumed_as_alternative: true });
  }

  return {
    ok: true,
    item_entries_after: working.filter((entry) => {
      const quantity = Number.isFinite(entry.quantity) ? Math.floor(entry.quantity) : 1;
      return quantity > 0;
    }),
    consumed_materials: consumed
  };
}

function consumeRequiredMaterialsCanonical(inventory, recipe, mutationHelpers) {
  const requirements = normalizeRecipeRequirements(recipe);
  const normalized = mutationHelpers.normalizeInventoryShape(clone(inventory));
  if (!normalized.ok) {
    return { ok: false, reason: "canonical_inventory_normalization_failed", normalize_result: normalized };
  }
  let working = normalized.payload.inventory;
  const consumed = [];

  for (const req of requirements) {
    if (req.type === "single") {
      const removeResult = mutationHelpers.removeItemFromInventory(working, req.item_id, req.quantity);
      if (!removeResult.ok) {
        return { ok: false, reason: "consume_failed", item_id: req.item_id, quantity: req.quantity };
      }
      working = removeResult.payload.inventory;

      consumed.push({ item_id: req.item_id, quantity: req.quantity });
      continue;
    }

    const view = toRequirementInventoryView(working);
    const chosen = req.alternatives.find((alt) => (Number(view.quantities[String(alt.item_id)] || 0) >= alt.quantity));
    if (!chosen) {
      return { ok: false, reason: "consume_alternative_failed", alternatives: req.alternatives };
    }

    const removeResult = mutationHelpers.removeItemFromInventory(working, chosen.item_id, chosen.quantity);
    if (!removeResult.ok) {
      return { ok: false, reason: "consume_alternative_failed", alternatives: req.alternatives };
    }
    working = removeResult.payload.inventory;

    consumed.push({ item_id: chosen.item_id, quantity: chosen.quantity, consumed_as_alternative: true });
  }

  return {
    ok: true,
    inventory_after: working,
    consumed_materials: consumed
  };
}

function grantOutputsToCanonicalInventory(input) {
  const data = input || {};
  const mutationHelpers = data.mutationHelpers;
  const normalized = mutationHelpers.normalizeInventoryShape(data.inventory);
  if (!normalized.ok) {
    return { ok: false, grant_results: [], grant_failure: { ok: false, reason: "inventory_normalize_failed" } };
  }
  let inventory = normalized.payload.inventory;
  const outputs = Array.isArray(data.outputs) ? data.outputs : [];
  const ownerId = data.owner_id || null;
  const grantResults = [];

  for (const output of outputs) {
    if (!output || !output.item_id) {
      grantResults.push({ item_id: null, quantity: 0, result: { ok: false, reason: "invalid_output" } });
      return { ok: false, grant_results: grantResults, grant_failure: { ok: false, reason: "invalid_output" } };
    }

    const quantity = Number.isFinite(output.quantity) ? Math.max(1, Math.floor(output.quantity)) : 1;
    const addResult = mutationHelpers.addItemToInventory(inventory, {
      item_id: String(output.item_id),
      item_name: output.item_name || String(output.item_id),
      item_type: output.item_type || "stackable",
      quantity,
      stackable: output.stackable !== false,
      owner_player_id: ownerId,
      metadata: {
        crafted_at: new Date().toISOString(),
        source: "crafting_output"
      }
    });
    if (!addResult.ok) {
      grantResults.push({ item_id: output.item_id, quantity, result: addResult });
      return { ok: false, grant_results: grantResults, grant_failure: addResult };
    }
    inventory = addResult.payload.inventory;

    grantResults.push({
      item_id: String(output.item_id),
      quantity,
      result: {
        ok: true,
        quantity_applied: quantity,
        mutation_result: addResult.payload.added || null
      }
    });
  }
  return { ok: true, grant_results: grantResults, inventory_after: inventory };
}

function finalizeCraftWithResourceConsumption(input) {
  const data = input || {};
  const worldStorage = data.worldStorage || null;
  const inventoryStore = data.inventoryStore || worldStorage?.inventories || null;
  const inventoryService = data.inventoryService || null;
  const itemStore = data.itemStore || worldStorage?.items || null;
  const processedStore = data.processedFinalizationStore || null;
  const mutationHelpers = resolveMutationHelpers(data);
  const allowDuplicate = data.allow_duplicate === true;

  if (!inventoryStore && !inventoryService) {
    return createFailure("inventory_store_required");
  }

  if (inventoryService && !isInventoryServiceValid(inventoryService)) {
    return createFailure("invalid_inventory_service");
  }

  const craftJob = data.craft_job;
  const recipe = data.recipe;
  if (!craftJob || !recipe) {
    return createFailure("craft_job_and_recipe_required");
  }

  const craft_job_id = String(craftJob.craft_job_id || "");
  if (!craft_job_id) {
    return createFailure("craft_job_id_required");
  }

  const finalizationKey =
    data.finalization_key ||
    data.event_id ||
    craft_job_id;

  if (!allowDuplicate && processedStore && typeof processedStore.has === "function") {
    if (processedStore.has(finalizationKey)) {
      return {
        ok: true,
        event_type: "craft_finalize_skipped",
        payload: {
          reason: "duplicate_finalization_attempt",
          finalization_key: String(finalizationKey),
          craft_job_id
        }
      };
    }
  }

  const completion = resolveCraftCompletion(
    { craft_job: craftJob, recipe },
    { allow_duplicate: true }
  );
  if (!completion.ok) {
    return createFailure("craft_completion_invalid", {
      completion_result: completion
    });
  }

  const inventory_id = data.inventory_id || `inv-${craftJob.player_id || "unknown"}`;
  let inventory;
  if (inventoryService) {
    inventory = extractInventoryFromResult(inventoryService.getInventory(inventory_id));
    if (!inventory) {
      inventory = createInventoryRecord({
        inventory_id,
        owner_type: "player",
        owner_id: craftJob.player_id || null
      });
    }
  } else {
    inventory = inventoryStore.loadInventory(inventory_id);
  }

  if (!inventory) {
    return createFailure("inventory_not_found", {
      inventory_id
    });
  }

  const missingMaterials = getMissingMaterials(recipe, toRequirementInventoryView(inventory));
  if (missingMaterials.length > 0) {
    return createFailure("insufficient_materials", {
      craft_job_id,
      inventory_id,
      missing_materials: missingMaterials
    });
  }

  const beforeInventory = clone(inventory);
  const consumption = inventoryService
    ? consumeRequiredMaterialsCanonical(inventory, recipe, mutationHelpers)
    : consumeRequiredMaterials(inventory, recipe);

  if (!consumption.ok) {
    return createFailure("material_consume_failed", {
      inventory_id,
      consume_result: consumption
    });
  }

  const consumedInventory = inventoryService
    ? consumption.inventory_after
    : {
      ...beforeInventory,
      item_entries: consumption.item_entries_after
    };

  try {
    if (inventoryService) {
      const saveResult = inventoryService.saveInventory(consumedInventory);
      if (saveResult && saveResult.ok === false) {
        return createFailure("material_consume_persist_failed", { save_result: saveResult });
      }
    } else {
      inventoryStore.saveInventory(consumedInventory);
    }
  } catch (error) {
    return createFailure("material_consume_persist_failed", {
      message: error.message
    });
  }

  const outputGrantAdapter = inventoryService
    ? null
    : (
      data.outputGrantAdapter ||
      (inventoryStore
        ? new InventoryGrantAdapter({
          inventoryStore,
          itemStore: itemStore || { loadItem: () => null }
        })
        : null)
    );

  if (!inventoryService && (!outputGrantAdapter || typeof outputGrantAdapter.addDropToInventory !== "function")) {
    try {
      if (inventoryService) {
        inventoryService.saveInventory(beforeInventory);
      } else {
        inventoryStore.saveInventory(beforeInventory);
      }
    } catch (rollbackError) {
      return createFailure("output_adapter_missing_and_rollback_failed", {
        rollback_error: rollbackError.message
      });
    }
    return createFailure("output_grant_adapter_required");
  }

  const outputs = completion.completion_payload.outputs || [];
  const grantResults = [];
  let grantFailure = null;

  if (inventoryService) {
    const workingInv = clone(consumedInventory);
    const canonicalGrant = grantOutputsToCanonicalInventory({
      inventory: workingInv,
      outputs,
      owner_id: craftJob.player_id,
      mutationHelpers
    });

    if (!canonicalGrant.ok) {
      grantFailure = canonicalGrant.grant_failure || { ok: false, reason: "canonical_output_grant_failed" };
      (canonicalGrant.grant_results || []).forEach((row) => {
        grantResults.push(row);
      });
    } else {
      canonicalGrant.grant_results.forEach((row) => {
        grantResults.push(row);
      });

      try {
        const saveResult = inventoryService.saveInventory(canonicalGrant.inventory_after);
        if (saveResult && saveResult.ok === false) {
          grantFailure = { ok: false, reason: "canonical_inventory_save_failed", save_result: saveResult };
        }
      } catch (error) {
        grantFailure = { ok: false, reason: "canonical_inventory_save_threw", message: error.message };
      }
    }
  } else {
    for (const output of outputs) {
      let grantResult;
      try {
        grantResult = outputGrantAdapter.addDropToInventory({
          inventory_id,
          owner_character_id: craftJob.player_id,
          drop: {
            item_id: output.item_id,
            quantity: output.quantity,
            drop_type: "crafted_output"
          }
        });
      } catch (error) {
        grantResult = {
          ok: false,
          reason: "output_grant_threw",
          message: error.message
        };
      }

      grantResults.push({
        item_id: output.item_id,
        quantity: output.quantity,
        result: grantResult
      });

      if (!grantResult || !grantResult.ok) {
        grantFailure = grantResult || { ok: false, reason: "unknown_output_grant_failure" };
        break;
      }
    }
  }

  if (grantFailure) {
    try {
      if (inventoryService) {
        inventoryService.saveInventory(beforeInventory);
      } else {
        inventoryStore.saveInventory(beforeInventory);
      }
      return createFailure("output_grant_failed_rolled_back", {
        craft_job_id,
        inventory_id,
        consumed_materials: consumption.consumed_materials,
        grant_results: grantResults,
        grant_failure: grantFailure,
        rollback_applied: true
      });
    } catch (rollbackError) {
      return createFailure("output_grant_failed_and_rollback_failed", {
        craft_job_id,
        inventory_id,
        consumed_materials: consumption.consumed_materials,
        grant_results: grantResults,
        grant_failure: grantFailure,
        rollback_error: rollbackError.message,
        rollback_applied: false
      });
    }
  }

  // Mark craft job finalization safely after output grant success.
  if (data.craftJobStore && typeof data.craftJobStore.load === "function" && typeof data.craftJobStore.save === "function") {
    const storedJob = data.craftJobStore.load(craft_job_id);
    if (storedJob) {
      data.craftJobStore.save({
        ...storedJob,
        status: "completed",
        finalized_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
  }

  if (!allowDuplicate && processedStore && typeof processedStore.add === "function") {
    processedStore.add(finalizationKey);
  }

  return {
    ok: true,
    event_type: "craft_finalize_success",
    payload: {
      finalization_key: String(finalizationKey),
      craft_job_id,
      player_id: String(craftJob.player_id),
      recipe_id: String(recipe.recipe_id),
      inventory_id,
      consumed_materials: consumption.consumed_materials,
      outputs_granted: completion.completion_payload.outputs,
      output_grant_results: grantResults,
      completion_payload: completion.completion_payload,
      finalized_at: new Date().toISOString()
    }
  };
}

module.exports = {
  ProcessedCraftFinalizationStore,
  finalizeCraftWithResourceConsumption
};
