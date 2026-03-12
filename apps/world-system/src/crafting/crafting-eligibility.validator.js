"use strict";

const { getMissingMaterials } = require("./resource-requirements");

function asSet(value) {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.map((entry) => String(entry)));
}

function hasRecipeUnlockRequirement(recipe) {
  return recipe && (
    recipe.unlock_required === true ||
    recipe.requires_unlock === true ||
    recipe.recipe_unlock_required === true
  );
}

function getCraftingFailureReasons(playerContext, recipe, inventory) {
  const failures = [];

  if (!recipe || typeof recipe !== "object") {
    failures.push({
      code: "RECIPE_NOT_FOUND",
      message: "Recipe is missing."
    });
    return failures;
  }

  if (recipe.active_flag === false) {
    failures.push({
      code: "RECIPE_INACTIVE",
      message: "Recipe is inactive."
    });
  }

  if (!playerContext || typeof playerContext !== "object") {
    failures.push({
      code: "INVALID_PLAYER_CONTEXT",
      message: "Player context is missing or malformed."
    });
    return failures;
  }

  const professions = asSet(playerContext.professions);
  const tools = asSet(playerContext.tools);
  const stations = asSet(playerContext.stations);
  const unlockedRecipeIds = asSet(playerContext.unlocked_recipe_ids);

  if (recipe.required_profession) {
    const neededProfession = String(recipe.required_profession);
    if (!professions.has(neededProfession)) {
      failures.push({
        code: "MISSING_PROFESSION",
        message: "Player does not have the required profession.",
        required_profession: neededProfession
      });
    }
  }

  if (hasRecipeUnlockRequirement(recipe)) {
    const recipeId = String(recipe.recipe_id || "");
    if (!recipeId || !unlockedRecipeIds.has(recipeId)) {
      failures.push({
        code: "MISSING_RECIPE_UNLOCK",
        message: "Recipe is not unlocked for this player.",
        recipe_id: recipeId || null
      });
    }
  }

  if (recipe.required_tool) {
    const neededTool = String(recipe.required_tool);
    if (!tools.has(neededTool)) {
      failures.push({
        code: "MISSING_TOOL",
        message: "Player does not have the required crafting tool.",
        required_tool: neededTool
      });
    }
  }

  if (recipe.required_station) {
    const neededStation = String(recipe.required_station);
    if (!stations.has(neededStation)) {
      failures.push({
        code: "MISSING_STATION",
        message: "Player is not at the required crafting station.",
        required_station: neededStation
      });
    }
  }

  try {
    const missingMaterials = getMissingMaterials(recipe, inventory);
    if (missingMaterials.length > 0) {
      failures.push({
        code: "MISSING_MATERIALS",
        message: "Player does not have all required materials.",
        missing_materials: missingMaterials
      });
    }
  } catch (error) {
    failures.push({
      code: "MATERIAL_VALIDATION_ERROR",
      message: error.message
    });
  }

  return failures;
}

function canCraftRecipe(playerContext, recipe, inventory) {
  const failureReasons = getCraftingFailureReasons(playerContext, recipe, inventory);
  return {
    ok: failureReasons.length === 0,
    recipe_id: recipe && recipe.recipe_id ? String(recipe.recipe_id) : null,
    failure_reasons: failureReasons
  };
}

module.exports = {
  canCraftRecipe,
  getCraftingFailureReasons
};

