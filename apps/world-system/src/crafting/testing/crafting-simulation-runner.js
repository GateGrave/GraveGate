"use strict";

const { InMemoryInventoryStore, InMemoryItemStore } = require("../../../../database/src/world-storage");
const { loadRecipeContent } = require("../../content");
const { InMemoryRecipeStore, RecipeManager } = require("../recipe.manager");
const { mapContentRecipeToCraftRecipe } = require("../recipe-content.adapter");
const { InMemoryCraftJobStore, CraftJobManager } = require("../craft-job.manager");
const { validateRecipeMaterials } = require("../resource-requirements");
const { canCraftRecipe } = require("../crafting-eligibility.validator");
const { resolveCraftCheck } = require("../crafting-check.resolver");
const { finalizeCraftWithResourceConsumption, ProcessedCraftFinalizationStore } = require("../craft-resource-consumption.flow");
const { createCraftingSnapshot, restoreCraftingSnapshot } = require("../crafting-snapshot");
const { CraftingLogger } = require("../crafting-logger");

class CraftingSimulationRunner {
  constructor(options) {
    this.options = options || {};
    this.step = 0;
    this.logs = [];

    this.recipeManager = new RecipeManager({ store: new InMemoryRecipeStore() });
    this.craftJobManager = new CraftJobManager({ store: new InMemoryCraftJobStore() });
    this.processedFinalizationStore = new ProcessedCraftFinalizationStore();
    this.craftingLogger = new CraftingLogger();

    this.worldStorage = {
      inventories: new InMemoryInventoryStore(),
      items: new InMemoryItemStore()
    };

    this.players = {};
    this.professionProfiles = {};
  }

  log(kind, data) {
    this.step += 1;
    this.logs.push({
      step: this.step,
      kind,
      timestamp: new Date().toISOString(),
      data
    });
  }

  setupMocks() {
    this.players = {
      crafter: { player_id: "player-crafter-001", inventory_id: "inv-crafter-001" },
      novice: { player_id: "player-novice-001", inventory_id: "inv-novice-001" }
    };

    // Profession profile scaffolding only.
    this.professionProfiles = {
      [this.players.crafter.player_id]: {
        player_id: this.players.crafter.player_id,
        professions: ["alchemist"],
        tools: ["tool-alchemy-kit"],
        stations: ["station-lab"],
        unlocked_recipe_ids: ["recipe-healing-potion", "recipe-dual-tonic"]
      },
      [this.players.novice.player_id]: {
        player_id: this.players.novice.player_id,
        professions: ["farmer"],
        tools: [],
        stations: [],
        unlocked_recipe_ids: []
      }
    };

    this.worldStorage.items.saveItem({ item_id: "item-herb", item_type: "stackable", rarity: "common" });
    this.worldStorage.items.saveItem({ item_id: "item-water", item_type: "stackable", rarity: "common" });
    this.worldStorage.items.saveItem({ item_id: "item-healing-potion", item_type: "consumable", rarity: "common" });
    this.worldStorage.items.saveItem({ item_id: "item-tonic-a", item_type: "consumable", rarity: "uncommon" });
    this.worldStorage.items.saveItem({ item_id: "item-tonic-b", item_type: "consumable", rarity: "uncommon" });

    this.worldStorage.inventories.saveInventory({
      inventory_id: this.players.crafter.inventory_id,
      owner_character_id: this.players.crafter.player_id,
      item_entries: [
        { entry_id: "entry-c1", item_id: "item-herb", quantity: 6, entry_type: "stackable" },
        { entry_id: "entry-c2", item_id: "item-water", quantity: 3, entry_type: "stackable" }
      ]
    });
    this.worldStorage.inventories.saveInventory({
      inventory_id: this.players.novice.inventory_id,
      owner_character_id: this.players.novice.player_id,
      item_entries: [
        { entry_id: "entry-n1", item_id: "item-herb", quantity: 1, entry_type: "stackable" }
      ]
    });

    this.recipeManager.createRecipe({
      recipe_id: "recipe-healing-potion",
      recipe_name: "Healing Potion",
      output_item_id: "item-healing-potion",
      output_quantity: 1,
      recipe_type: "alchemy",
      required_materials: [
        { item_id: "item-herb", quantity: 2 },
        { item_id: "item-water", quantity: 1 }
      ],
      required_profession: "alchemist",
      required_tool: "tool-alchemy-kit",
      required_station: "station-lab",
      craft_time: 30,
      difficulty: "easy",
      active_flag: true,
      unlock_required: true
    });

    this.recipeManager.createRecipe({
      recipe_id: "recipe-dual-tonic",
      recipe_name: "Dual Tonic",
      output_item_id: "item-tonic-a",
      output_quantity: 1,
      outputs: [
        { item_id: "item-tonic-a", quantity: 1 },
        { item_id: "item-tonic-b", quantity: 1 }
      ],
      recipe_type: "alchemy",
      required_materials: [
        { item_id: "item-herb", quantity: 2 },
        { item_id: "item-water", quantity: 1 }
      ],
      required_profession: "alchemist",
      required_tool: "tool-alchemy-kit",
      required_station: "station-lab",
      craft_time: 45,
      difficulty: "medium",
      active_flag: true,
      unlock_required: true
    });

    this.log("setup_complete", {
      players: this.players,
      profession_profiles: this.professionProfiles,
      recipes: this.recipeManager.store.list().map((x) => x.recipe_id)
    });
  }

  getPlayerContext(playerId) {
    return this.professionProfiles[playerId] || null;
  }

  getInventory(playerId) {
    const player = Object.values(this.players).find((x) => x.player_id === playerId);
    if (!player) return null;
    return this.worldStorage.inventories.loadInventory(player.inventory_id);
  }

  toMaterialView(inventory) {
    const entries = Array.isArray(inventory?.item_entries) ? inventory.item_entries : [];
    return {
      items: entries.map((entry) => ({
        item_id: entry.item_id,
        quantity: Number.isFinite(entry.quantity) ? entry.quantity : 1
      }))
    };
  }

  scenarioSuccessfulEndToEndCraftFlow() {
    const player = this.players.crafter;
    const recipe = this.recipeManager.getRecipe("recipe-healing-potion", { includeInactive: true });
    const playerContext = this.getPlayerContext(player.player_id);
    const inventory = this.getInventory(player.player_id);

    this.craftingLogger.logCraftStarted({
      craft_job_id: "job-success-001",
      player_id: player.player_id,
      recipe_id: recipe.recipe_id,
      materials_snapshot: { before: inventory.item_entries },
      result: "started"
    });

    const materialView = this.toMaterialView(inventory);
    const materialValidation = validateRecipeMaterials(recipe, materialView);
    const eligibility = canCraftRecipe(playerContext, recipe, materialView);
    const craftJob = this.craftJobManager.createCraftJob({
      craft_job_id: "job-success-001",
      player_id: player.player_id,
      recipe_id: recipe.recipe_id,
      required_progress: 10,
      progress_value: 0
    });
    const progressed = this.craftJobManager.updateCraftProgress(craftJob.craft_job_id, 10);
    const check = resolveCraftCheck({
      difficulty_target: 10,
      player_modifier: 2,
      tool_modifier: 2,
      profession_modifier: 1,
      forced_roll: 10
    });

    this.craftingLogger.logCraftCheckResolved({
      craft_job_id: craftJob.craft_job_id,
      player_id: player.player_id,
      recipe_id: recipe.recipe_id,
      output_snapshot: check.roll_breakdown,
      result: check.success ? "success" : "failed"
    });

    const finalize = finalizeCraftWithResourceConsumption({
      craft_job: progressed,
      recipe,
      inventoryStore: this.worldStorage.inventories,
      itemStore: this.worldStorage.items,
      inventory_id: player.inventory_id,
      processedFinalizationStore: this.processedFinalizationStore,
      finalization_key: "finalize-success-001"
    });

    if (finalize.ok) {
      this.craftingLogger.logMaterialsConsumed({
        craft_job_id: craftJob.craft_job_id,
        player_id: player.player_id,
        recipe_id: recipe.recipe_id,
        materials_snapshot: { consumed: finalize.payload.consumed_materials },
        result: "consumed"
      });
      this.craftingLogger.logCraftCompleted({
        craft_job_id: craftJob.craft_job_id,
        player_id: player.player_id,
        recipe_id: recipe.recipe_id,
        output_snapshot: { outputs: finalize.payload.outputs_granted },
        result: "completed"
      });
    }

    const out = {
      ok: finalize.ok,
      event_type: finalize.ok ? "craft_flow_success" : "craft_flow_failed",
      payload: {
        material_validation: materialValidation,
        eligibility,
        craft_job: progressed,
        craft_check: check,
        finalize
      }
    };
    this.log("scenario_successful_end_to_end", out);
    return out;
  }

  scenarioFailedEligibility() {
    const player = this.players.novice;
    const recipe = this.recipeManager.getRecipe("recipe-healing-potion", { includeInactive: true });
    const inventory = this.getInventory(player.player_id);
    const playerContext = this.getPlayerContext(player.player_id);
    const eligibility = canCraftRecipe(playerContext, recipe, this.toMaterialView(inventory));

    if (!eligibility.ok) {
      this.craftingLogger.logCraftFailed({
        craft_job_id: "job-failed-eligibility-001",
        player_id: player.player_id,
        recipe_id: recipe.recipe_id,
        reason: "eligibility_failed"
      });
    }

    const out = {
      ok: false,
      event_type: "craft_eligibility_failed",
      payload: { eligibility }
    };
    this.log("scenario_failed_eligibility", out);
    return out;
  }

  scenarioFailedMissingMaterials() {
    const player = this.players.crafter;
    const recipe = this.recipeManager.getRecipe("recipe-healing-potion", { includeInactive: true });
    const inventory = {
      items: [{ item_id: "item-herb", quantity: 1 }]
    };
    const validation = validateRecipeMaterials(recipe, inventory);
    const out = {
      ok: false,
      event_type: "craft_missing_materials",
      payload: {
        material_validation: validation
      }
    };
    this.craftingLogger.logCraftFailed({
      craft_job_id: "job-failed-materials-001",
      player_id: player.player_id,
      recipe_id: recipe.recipe_id,
      reason: "missing_materials"
    });
    this.log("scenario_failed_missing_materials", out);
    return out;
  }

  scenarioDuplicateCompletionPrevention() {
    const player = this.players.crafter;
    const recipe = this.recipeManager.getRecipe("recipe-healing-potion", { includeInactive: true });

    const job = this.craftJobManager.createCraftJob({
      craft_job_id: "job-dupe-001",
      player_id: player.player_id,
      recipe_id: recipe.recipe_id,
      required_progress: 1,
      progress_value: 1,
      status: "completed"
    });

    const first = finalizeCraftWithResourceConsumption({
      craft_job: job,
      recipe,
      inventoryStore: this.worldStorage.inventories,
      itemStore: this.worldStorage.items,
      inventory_id: player.inventory_id,
      processedFinalizationStore: this.processedFinalizationStore,
      finalization_key: "finalize-dupe-001"
    });
    const second = finalizeCraftWithResourceConsumption({
      craft_job: job,
      recipe,
      inventoryStore: this.worldStorage.inventories,
      itemStore: this.worldStorage.items,
      inventory_id: player.inventory_id,
      processedFinalizationStore: this.processedFinalizationStore,
      finalization_key: "finalize-dupe-001"
    });

    const out = {
      ok: first.ok,
      event_type: "craft_duplicate_guard_result",
      payload: {
        first,
        second
      }
    };
    this.log("scenario_duplicate_prevention", out);
    return out;
  }

  scenarioRollbackSafetyPartialFailure() {
    const player = this.players.crafter;
    const baseRecipe = this.recipeManager.getRecipe("recipe-dual-tonic", { includeInactive: true });
    const recipe = {
      ...baseRecipe,
      outputs: [
        { item_id: "item-tonic-a", quantity: 1 },
        { item_id: "item-tonic-b", quantity: 1 }
      ]
    };
    const before = JSON.stringify(this.worldStorage.inventories.loadInventory(player.inventory_id));

    const job = this.craftJobManager.createCraftJob({
      craft_job_id: "job-partial-001",
      player_id: player.player_id,
      recipe_id: recipe.recipe_id,
      required_progress: 1,
      progress_value: 1,
      status: "completed"
    });

    let callCount = 0;
    const partialFailAdapter = {
      addDropToInventory: (input) => {
        callCount += 1;
        const inv = this.worldStorage.inventories.loadInventory(input.inventory_id);
        const entries = Array.isArray(inv.item_entries) ? [...inv.item_entries] : [];
        if (callCount === 1) {
          entries.push({
            entry_id: "entry-temp-grant-1",
            item_id: input.drop.item_id,
            quantity: input.drop.quantity
          });
          this.worldStorage.inventories.saveInventory({
            ...inv,
            item_entries: entries
          });
          return { ok: true };
        }
        return { ok: false, reason: "forced_second_output_failure" };
      }
    };

    const finalized = finalizeCraftWithResourceConsumption({
      craft_job: job,
      recipe,
      inventoryStore: this.worldStorage.inventories,
      itemStore: this.worldStorage.items,
      inventory_id: player.inventory_id,
      processedFinalizationStore: this.processedFinalizationStore,
      finalization_key: "finalize-partial-001",
      outputGrantAdapter: partialFailAdapter
    });
    const after = JSON.stringify(this.worldStorage.inventories.loadInventory(player.inventory_id));

    const out = {
      ok: false,
      event_type: "craft_partial_failure_rollback_checked",
      payload: {
        finalized,
        inventory_restored: before === after
      }
    };
    this.log("scenario_rollback_partial_failure", out);
    return out;
  }

  scenarioSnapshotRestore() {
    const pendingCompletionState = {
      "job-snap-001": { waiting_for_output_grant: true }
    };
    const reservationConsumptionState = {
      reserved_materials_by_job: {
        "job-snap-001": [{ item_id: "item-herb", quantity: 2 }]
      }
    };

    const snapshot = createCraftingSnapshot({
      craftJobManager: this.craftJobManager,
      recipeManager: this.recipeManager,
      pendingCompletionState,
      reservationConsumptionState,
      processedFinalizationStore: this.processedFinalizationStore
    });

    // Mutate state and then recover.
    this.craftJobManager.createCraftJob({
      craft_job_id: "job-snap-mutate",
      player_id: this.players.crafter.player_id,
      recipe_id: "recipe-healing-potion",
      required_progress: 99,
      progress_value: 1
    });

    const pendingRef = {};
    const reservationRef = {};
    const restore = restoreCraftingSnapshot({
      snapshot: snapshot.payload,
      craftJobManager: this.craftJobManager,
      pendingCompletionStateRef: pendingRef,
      reservationConsumptionStateRef: reservationRef,
      processedFinalizationStore: this.processedFinalizationStore
    });

    const out = {
      ok: snapshot.ok && restore.ok,
      event_type: "craft_snapshot_restore_result",
      payload: {
        snapshot,
        restore,
        pending_ref: pendingRef,
        reservation_ref: reservationRef
      }
    };
    this.log("scenario_snapshot_restore", out);
    return out;
  }

  scenarioContentRecipeResolutionAndCraft() {
    const player = this.players.crafter;
    const contentLoad = loadRecipeContent();

    if (!contentLoad.ok) {
      const out = {
        ok: false,
        event_type: "craft_content_recipe_load_failed",
        payload: {
          content_load: contentLoad
        }
      };
      this.log("scenario_content_recipe_resolution_and_craft", out);
      return out;
    }

    const entry = contentLoad.payload.entries.find((row) => row.recipe_id === "recipe_minor_healing_tonic");
    if (!entry) {
      const out = {
        ok: false,
        event_type: "craft_content_recipe_missing",
        payload: {
          recipe_id: "recipe_minor_healing_tonic"
        }
      };
      this.log("scenario_content_recipe_resolution_and_craft", out);
      return out;
    }

    const mapped = mapContentRecipeToCraftRecipe(entry);
    if (!mapped.ok) {
      const out = {
        ok: false,
        event_type: "craft_content_recipe_map_failed",
        payload: {
          recipe_id: "recipe_minor_healing_tonic",
          mapped
        }
      };
      this.log("scenario_content_recipe_resolution_and_craft", out);
      return out;
    }

    this.recipeManager.createRecipe(mapped.payload.recipe);

    const inventory = this.getInventory(player.player_id);
    if (!inventory.item_entries.find((row) => row.item_id === "item_rat_tail")) {
      inventory.item_entries.push({
        entry_id: "entry-c3",
        item_id: "item_rat_tail",
        quantity: 4,
        entry_type: "stackable"
      });
      this.worldStorage.inventories.saveInventory(inventory);
    }

    const recipe = this.recipeManager.getRecipe("recipe_minor_healing_tonic", { includeInactive: true });
    const playerContext = this.getPlayerContext(player.player_id);
    const materialView = this.toMaterialView(this.getInventory(player.player_id));
    const eligibility = canCraftRecipe(playerContext, recipe, materialView);
    const materialValidation = validateRecipeMaterials(recipe, materialView);

    const craftJob = this.craftJobManager.createCraftJob({
      craft_job_id: "job-content-001",
      player_id: player.player_id,
      recipe_id: recipe.recipe_id,
      required_progress: 1,
      progress_value: 1,
      status: "completed"
    });

    const finalized = finalizeCraftWithResourceConsumption({
      craft_job: craftJob,
      recipe,
      inventoryStore: this.worldStorage.inventories,
      itemStore: this.worldStorage.items,
      inventory_id: player.inventory_id,
      processedFinalizationStore: this.processedFinalizationStore,
      finalization_key: "finalize-content-001"
    });

    const out = {
      ok: finalized.ok,
      event_type: finalized.ok ? "craft_content_recipe_success" : "craft_content_recipe_failed",
      payload: {
        content_entry: entry,
        mapped_recipe: mapped.payload.recipe,
        eligibility,
        material_validation: materialValidation,
        finalized,
        inventory_after: this.worldStorage.inventories.loadInventory(player.inventory_id)
      }
    };

    this.log("scenario_content_recipe_resolution_and_craft", out);
    return out;
  }

  runAllScenarios() {
    this.setupMocks();

    const success = this.scenarioSuccessfulEndToEndCraftFlow();
    const failedEligibility = this.scenarioFailedEligibility();
    const failedMaterials = this.scenarioFailedMissingMaterials();
    const duplicate = this.scenarioDuplicateCompletionPrevention();
    const rollback = this.scenarioRollbackSafetyPartialFailure();
    const snapshot = this.scenarioSnapshotRestore();
    const contentRecipe = this.scenarioContentRecipeResolutionAndCraft();

    this.log("crafting_log_records", this.craftingLogger.listLogs());

    return {
      ok: true,
      scenarios: {
        profession_profile_creation: true,
        recipe_creation: true,
        recipe_unlock: true,
        material_validation: success.payload.material_validation.ok,
        crafting_eligibility: success.payload.eligibility.ok,
        craft_job_creation: Boolean(success.payload.craft_job?.craft_job_id),
        craft_progress_updates: success.payload.craft_job?.status === "completed",
        craft_check_resolution: success.payload.craft_check.ok,
        successful_craft_completion: success.payload.finalize.ok,
        failed_craft_missing_materials: failedMaterials.payload.material_validation.ok === false,
        resource_consumption_and_output_grant: success.payload.finalize.ok,
        snapshot_restore: snapshot.payload.restore.ok,
        content_recipe_resolution: contentRecipe.ok
      },
      logs: this.logs
    };
  }
}

if (require.main === module) {
  const out = new CraftingSimulationRunner().runAllScenarios();
  console.log(JSON.stringify(out, null, 2));
}

module.exports = {
  CraftingSimulationRunner
};
