"use strict";

// Recipe definitions are static crafting metadata.
// They do not mutate inventory directly.
const RECIPE_SCHEMA = {
  recipe_id: "string",
  recipe_name: "string",
  output_item_id: "string",
  output_quantity: "number",
  recipe_type: "string",
  required_materials: "array",
  required_profession: "string|null",
  required_tool: "string|null",
  required_station: "string|null",
  craft_time: "number",
  difficulty: "string",
  active_flag: "boolean",
  updated_at: "string (ISO date)"
};

function normalizeRequiredMaterials(value) {
  if (!Array.isArray(value)) {
    throw new Error("createRecipe requires required_materials array");
  }

  return value.map((row) => {
    if (!row || typeof row !== "object") {
      throw new Error("createRecipe requires material rows to be objects");
    }
    if (!row.item_id || String(row.item_id).trim() === "") {
      throw new Error("createRecipe requires required_materials.item_id");
    }
    if (!Number.isFinite(row.quantity) || Math.floor(row.quantity) <= 0) {
      throw new Error("createRecipe requires required_materials.quantity > 0");
    }

    return {
      item_id: String(row.item_id),
      quantity: Math.floor(row.quantity)
    };
  });
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function createRecipeRecord(input) {
  const data = input || {};

  if (!data.recipe_id || String(data.recipe_id).trim() === "") {
    throw new Error("createRecipe requires recipe_id");
  }
  if (!data.recipe_name || String(data.recipe_name).trim() === "") {
    throw new Error("createRecipe requires recipe_name");
  }
  if (!data.output_item_id || String(data.output_item_id).trim() === "") {
    throw new Error("createRecipe requires output_item_id");
  }
  if (!Number.isFinite(data.output_quantity) || Math.floor(data.output_quantity) <= 0) {
    throw new Error("createRecipe requires output_quantity > 0");
  }
  if (!data.recipe_type || String(data.recipe_type).trim() === "") {
    throw new Error("createRecipe requires recipe_type");
  }
  if (!Number.isFinite(data.craft_time) || Math.floor(data.craft_time) < 0) {
    throw new Error("createRecipe requires craft_time >= 0");
  }
  if (!data.difficulty || String(data.difficulty).trim() === "") {
    throw new Error("createRecipe requires difficulty");
  }

  return {
    recipe_id: String(data.recipe_id),
    recipe_name: String(data.recipe_name),
    output_item_id: String(data.output_item_id),
    output_quantity: Math.floor(data.output_quantity),
    recipe_type: String(data.recipe_type),
    required_materials: normalizeRequiredMaterials(data.required_materials),
    required_profession: normalizeOptionalString(data.required_profession),
    required_tool: normalizeOptionalString(data.required_tool),
    required_station: normalizeOptionalString(data.required_station),
    craft_time: Math.floor(data.craft_time),
    difficulty: String(data.difficulty),
    active_flag: data.active_flag !== false,
    updated_at: data.updated_at || new Date().toISOString()
  };
}

module.exports = {
  RECIPE_SCHEMA,
  createRecipeRecord
};

