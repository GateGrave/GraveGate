"use strict";

const { RECIPE_SCHEMA, createRecipeRecord } = require("./recipe.schema");
const { InMemoryRecipeStore, RecipeManager } = require("./recipe.manager");
const { mapContentRecipeToCraftRecipe } = require("./recipe-content.adapter");
const {
  validateRecipeMaterials,
  getMissingMaterials,
  hasAllRequiredMaterials
} = require("./resource-requirements");
const {
  CRAFT_JOB_SCHEMA,
  createCraftJobRecord
} = require("./craft-job.schema");
const {
  InMemoryCraftJobStore,
  CraftJobManager
} = require("./craft-job.manager");
const {
  canCraftRecipe,
  getCraftingFailureReasons
} = require("./crafting-eligibility.validator");
const {
  resolveCraftCheck,
  getCraftCheckModifiers
} = require("./crafting-check.resolver");
const {
  ProcessedCraftCompletionStore,
  defaultProcessedCraftCompletionStore,
  resolveCraftCompletion
} = require("./craft-completion.resolver");
const {
  ProcessedCraftFinalizationStore,
  finalizeCraftWithResourceConsumption
} = require("./craft-resource-consumption.flow");
const {
  CraftingLogger,
  SUPPORTED_CRAFT_EVENT_TYPES
} = require("./crafting-logger");
const {
  createCraftingSnapshot,
  restoreCraftingSnapshot
} = require("./crafting-snapshot");
const { CraftingSimulationRunner } = require("./testing/crafting-simulation-runner");

// Default in-memory manager for scaffolding usage.
const defaultRecipeManager = new RecipeManager();
const defaultCraftJobManager = new CraftJobManager();

function createRecipe(input) {
  return defaultRecipeManager.createRecipe(input);
}

function getRecipe(recipe_id, options) {
  return defaultRecipeManager.getRecipe(recipe_id, options);
}

function updateRecipe(recipe_id, updater) {
  return defaultRecipeManager.updateRecipe(recipe_id, updater);
}

function deleteRecipe(recipe_id) {
  return defaultRecipeManager.deleteRecipe(recipe_id);
}

function listRecipesByProfession(required_profession, options) {
  return defaultRecipeManager.listRecipesByProfession(required_profession, options);
}

function listRecipesByType(recipe_type, options) {
  return defaultRecipeManager.listRecipesByType(recipe_type, options);
}

function createCraftJob(input) {
  return defaultCraftJobManager.createCraftJob(input);
}

function getCraftJob(craft_job_id) {
  return defaultCraftJobManager.getCraftJob(craft_job_id);
}

function updateCraftProgress(craft_job_id, progressDelta) {
  return defaultCraftJobManager.updateCraftProgress(craft_job_id, progressDelta);
}

function pauseCraftJob(craft_job_id) {
  return defaultCraftJobManager.pauseCraftJob(craft_job_id);
}

function resumeCraftJob(craft_job_id) {
  return defaultCraftJobManager.resumeCraftJob(craft_job_id);
}

function cancelCraftJob(craft_job_id) {
  return defaultCraftJobManager.cancelCraftJob(craft_job_id);
}

module.exports = {
  RECIPE_SCHEMA,
  createRecipeRecord,
  mapContentRecipeToCraftRecipe,
  InMemoryRecipeStore,
  RecipeManager,
  defaultRecipeManager,
  createRecipe,
  getRecipe,
  updateRecipe,
  deleteRecipe,
  listRecipesByProfession,
  listRecipesByType,
  CRAFT_JOB_SCHEMA,
  createCraftJobRecord,
  InMemoryCraftJobStore,
  CraftJobManager,
  defaultCraftJobManager,
  createCraftJob,
  getCraftJob,
  updateCraftProgress,
  pauseCraftJob,
  resumeCraftJob,
  cancelCraftJob,
  validateRecipeMaterials,
  getMissingMaterials,
  hasAllRequiredMaterials,
  canCraftRecipe,
  getCraftingFailureReasons,
  resolveCraftCheck,
  getCraftCheckModifiers,
  ProcessedCraftCompletionStore,
  defaultProcessedCraftCompletionStore,
  resolveCraftCompletion,
  ProcessedCraftFinalizationStore,
  finalizeCraftWithResourceConsumption,
  CraftingLogger,
  SUPPORTED_CRAFT_EVENT_TYPES,
  createCraftingSnapshot,
  restoreCraftingSnapshot,
  CraftingSimulationRunner
};
