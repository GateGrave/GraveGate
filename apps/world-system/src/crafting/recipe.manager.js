"use strict";

const { createRecipeRecord } = require("./recipe.schema");

class InMemoryRecipeStore {
  constructor() {
    this.recipes = new Map();
  }

  save(recipe) {
    this.recipes.set(recipe.recipe_id, recipe);
    return recipe;
  }

  load(recipeId) {
    if (!recipeId) return null;
    return this.recipes.get(String(recipeId)) || null;
  }

  remove(recipeId) {
    if (!recipeId) return false;
    return this.recipes.delete(String(recipeId));
  }

  list() {
    return Array.from(this.recipes.values());
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class RecipeManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryRecipeStore();
  }

  createRecipe(input) {
    const record = createRecipeRecord(input);
    this.store.save(record);
    return clone(record);
  }

  getRecipe(recipe_id, options) {
    const loaded = this.store.load(recipe_id);
    if (!loaded) return null;

    const includeInactive = Boolean(options && options.includeInactive);
    if (!includeInactive && loaded.active_flag === false) {
      return null;
    }

    return clone(loaded);
  }

  updateRecipe(recipe_id, updater) {
    const current = this.store.load(recipe_id);
    if (!current) return null;

    let nextPatch;
    if (typeof updater === "function") {
      nextPatch = updater(clone(current));
    } else {
      nextPatch = updater || {};
    }

    const merged = {
      ...current,
      ...nextPatch,
      recipe_id: current.recipe_id,
      updated_at: new Date().toISOString()
    };

    // Reuse schema validation to keep data consistent after updates.
    const validated = createRecipeRecord(merged);
    this.store.save(validated);
    return clone(validated);
  }

  deleteRecipe(recipe_id) {
    return this.store.remove(recipe_id);
  }

  listRecipesByProfession(required_profession, options) {
    if (!required_profession || String(required_profession).trim() === "") {
      return [];
    }

    const includeInactive = Boolean(options && options.includeInactive);
    const profession = String(required_profession);

    return this.store
      .list()
      .filter((recipe) => recipe.required_profession === profession)
      .filter((recipe) => includeInactive || recipe.active_flag !== false)
      .map(clone);
  }

  listRecipesByType(recipe_type, options) {
    if (!recipe_type || String(recipe_type).trim() === "") {
      return [];
    }

    const includeInactive = Boolean(options && options.includeInactive);
    const type = String(recipe_type);

    return this.store
      .list()
      .filter((recipe) => recipe.recipe_type === type)
      .filter((recipe) => includeInactive || recipe.active_flag !== false)
      .map(clone);
  }
}

module.exports = {
  InMemoryRecipeStore,
  RecipeManager
};

