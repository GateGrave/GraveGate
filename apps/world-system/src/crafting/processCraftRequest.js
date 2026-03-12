"use strict";

const { mapContentRecipeToCraftRecipe } = require("./recipe-content.adapter");
const { canCraftRecipe } = require("./crafting-eligibility.validator");
const { validateRecipeMaterials } = require("./resource-requirements");
const { finalizeCraftWithResourceConsumption, ProcessedCraftFinalizationStore } = require("./craft-resource-consumption.flow");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(event_type, payload) {
  return {
    ok: true,
    event_type,
    payload: payload || {},
    error: null
  };
}

function failure(event_type, error, payload) {
  return {
    ok: false,
    event_type,
    payload: payload || {},
    error
  };
}

function loadPlayerCharacter(context, playerId) {
  const persistence = context && context.characterPersistence;
  if (!persistence || typeof persistence.listCharacters !== "function") {
    return null;
  }
  const listed = persistence.listCharacters();
  if (!listed || listed.ok !== true) {
    return null;
  }
  const rows = Array.isArray(listed.payload.characters) ? listed.payload.characters : [];
  return rows.find((entry) => String(entry && entry.player_id || "") === String(playerId || "")) || null;
}

function loadInventory(context, inventoryId) {
  const persistence = context && context.inventoryPersistence;
  if (!persistence || typeof persistence.loadInventoryById !== "function") {
    return null;
  }
  const loaded = persistence.loadInventoryById(inventoryId);
  if (!loaded || loaded.ok !== true) {
    return null;
  }
  return clone(loaded.payload.inventory);
}

function createInventoryService(inventoryPersistence) {
  if (!inventoryPersistence) {
    return null;
  }
  return {
    getInventory(inventoryId) {
      return inventoryPersistence.loadInventoryById(inventoryId);
    },
    saveInventory(inventory) {
      return inventoryPersistence.saveInventory(inventory);
    }
  };
}

function buildInventoryQuantities(inventory) {
  const quantities = {};
  const buckets = ["stackable_items", "equipment_items", "quest_items"];
  for (let i = 0; i < buckets.length; i += 1) {
    const bucket = buckets[i];
    const rows = Array.isArray(inventory && inventory[bucket]) ? inventory[bucket] : [];
    for (let j = 0; j < rows.length; j += 1) {
      const entry = rows[j];
      const itemId = String(entry && entry.item_id || "").trim();
      if (!itemId) continue;
      const quantity = Number.isFinite(Number(entry.quantity)) ? Math.max(1, Math.floor(Number(entry.quantity))) : 1;
      quantities[itemId] = (quantities[itemId] || 0) + quantity;
    }
  }
  return { quantities };
}

function resolveMappedRecipes(context) {
  if (!context || typeof context.loadContentBundle !== "function") {
    return [];
  }
  const loaded = context.loadContentBundle();
  if (!loaded || loaded.ok !== true) {
    return [];
  }
  const content = loaded.payload && loaded.payload.content ? loaded.payload.content : {};
  const recipes = Array.isArray(content.recipes) ? content.recipes : [];
  return recipes
    .map((entry) => {
      const mapped = mapContentRecipeToCraftRecipe(entry);
      return mapped.ok ? mapped.payload.recipe : null;
    })
    .filter(Boolean);
}

function isSupportedStarterRecipe(recipe) {
  return !recipe.required_profession && !recipe.required_tool && !recipe.required_station;
}

function summarizeRecipe(recipe, craftable, missingMaterials) {
  return {
    recipe_id: recipe.recipe_id,
    recipe_name: recipe.recipe_name,
    output_item_id: recipe.output_item_id,
    output_quantity: recipe.output_quantity,
    recipe_type: recipe.recipe_type || "crafting",
    difficulty: recipe.difficulty || "easy",
    craftable: craftable === true,
    required_materials: Array.isArray(recipe.required_materials) ? clone(recipe.required_materials) : [],
    missing_materials: Array.isArray(missingMaterials) ? clone(missingMaterials) : []
  };
}

function listCraftRecipesForPlayer(input) {
  const data = input || {};
  const context = data.context || {};
  const playerId = String(data.player_id || "").trim();
  if (!playerId) {
    return failure("player_craft_request_failed", "player_id is required");
  }

  const character = loadPlayerCharacter(context, playerId);
  if (!character || !character.inventory_id) {
    return failure("player_craft_request_failed", "player inventory is not available");
  }

  const inventory = loadInventory(context, character.inventory_id);
  if (!inventory) {
    return failure("player_craft_request_failed", "inventory not found");
  }

  const inventoryView = buildInventoryQuantities(inventory);
  const recipes = resolveMappedRecipes(context)
    .filter(isSupportedStarterRecipe)
    .map((recipe) => {
      const materialCheck = validateRecipeMaterials(recipe, inventoryView);
      return summarizeRecipe(recipe, materialCheck.ok === true, materialCheck.missing_materials || []);
    });

  return success("player_craft_recipes_loaded", {
    inventory_id: character.inventory_id,
    recipes
  });
}

function processCraftRecipeRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const playerId = String(data.player_id || "").trim();
  const recipeId = String(data.recipe_id || "").trim();
  if (!playerId) return failure("player_craft_request_failed", "player_id is required");
  if (!recipeId) return failure("player_craft_request_failed", "recipe_id is required");

  const character = loadPlayerCharacter(context, playerId);
  if (!character || !character.inventory_id) {
    return failure("player_craft_request_failed", "player inventory is not available");
  }
  const inventory = loadInventory(context, character.inventory_id);
  if (!inventory) {
    return failure("player_craft_request_failed", "inventory not found");
  }

  const recipe = resolveMappedRecipes(context).find((entry) => String(entry.recipe_id) === recipeId);
  if (!recipe) {
    return failure("player_craft_request_failed", "recipe not found", { recipe_id: recipeId });
  }
  if (!isSupportedStarterRecipe(recipe)) {
    return failure("player_craft_request_failed", "recipe is not supported in the current crafting slice", {
      recipe_id: recipeId
    });
  }

  const inventoryView = buildInventoryQuantities(inventory);
  const eligibility = canCraftRecipe({ professions: [], tools: [], stations: [], unlocked_recipe_ids: [] }, recipe, inventoryView);
  if (!eligibility.ok) {
    return failure("player_craft_request_failed", "recipe requirements not met", {
      recipe_id: recipeId,
      failure_reasons: eligibility.failure_reasons || []
    });
  }

  const inventoryService = createInventoryService(context.inventoryPersistence);
  const craftJob = {
    craft_job_id: String(data.craft_job_id || data.event_id || `craft-${playerId}-${recipeId}`),
    player_id: playerId,
    recipe_id: recipeId,
    progress_value: 1,
    required_progress: 1,
    status: "completed"
  };
  const processedFinalizationStore = context.processedCraftFinalizationStore || new ProcessedCraftFinalizationStore();
  const finalized = finalizeCraftWithResourceConsumption({
    event_id: data.event_id || null,
    craft_job: craftJob,
    recipe,
    inventoryService,
    inventory_id: character.inventory_id,
    owner_id: playerId,
    processedFinalizationStore
  });

  if (!finalized.ok) {
    return failure("player_craft_request_failed", finalized.payload && finalized.payload.reason ? finalized.payload.reason : (finalized.error || "craft finalization failed"), finalized.payload);
  }

  const refreshed = listCraftRecipesForPlayer({
    context,
    player_id: playerId
  });

  return success("player_craft_processed", {
    recipe: summarizeRecipe(recipe, true, []),
    result: finalized.payload || {},
    inventory_id: character.inventory_id,
    recipes: refreshed.ok ? refreshed.payload.recipes : []
  });
}

module.exports = {
  listCraftRecipesForPlayer,
  processCraftRecipeRequest
};
