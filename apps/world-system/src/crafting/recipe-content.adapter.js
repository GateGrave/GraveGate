"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {},
    error: null
  };
}

function failure(eventType, message, payload) {
  return {
    ok: false,
    event_type: eventType,
    payload: payload || {},
    error: message
  };
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return String(value);
}

function mapContentRecipeToCraftRecipe(contentRecipe) {
  const entry = contentRecipe || {};

  if (!entry.recipe_id || String(entry.recipe_id).trim() === "") {
    return failure("recipe_content_map_failed", "recipe_id is required");
  }
  if (!entry.name || String(entry.name).trim() === "") {
    return failure("recipe_content_map_failed", "name is required");
  }
  if (!entry.output_item_id || String(entry.output_item_id).trim() === "") {
    return failure("recipe_content_map_failed", "output_item_id is required");
  }

  const outputQuantity = Number(entry.output_quantity);
  if (!Number.isFinite(outputQuantity) || Math.floor(outputQuantity) <= 0) {
    return failure("recipe_content_map_failed", "output_quantity must be greater than 0", {
      recipe_id: String(entry.recipe_id)
    });
  }

  if (!Array.isArray(entry.required_materials)) {
    return failure("recipe_content_map_failed", "required_materials must be an array", {
      recipe_id: String(entry.recipe_id)
    });
  }

  const metadata = entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};

  return success("recipe_content_mapped", {
    recipe: {
      recipe_id: String(entry.recipe_id),
      recipe_name: String(entry.name),
      output_item_id: String(entry.output_item_id),
      output_quantity: Math.floor(outputQuantity),
      recipe_type: String(metadata.recipe_type || "crafting"),
      required_materials: clone(entry.required_materials),
      required_profession: normalizeOptionalString(metadata.required_profession),
      required_tool: normalizeOptionalString(metadata.required_tool),
      required_station: normalizeOptionalString(metadata.required_station),
      craft_time: Number.isFinite(Number(metadata.craft_time))
        ? Math.max(0, Math.floor(Number(metadata.craft_time)))
        : 30,
      difficulty: String(metadata.difficulty || "easy"),
      active_flag: metadata.active_flag !== false
    }
  });
}

module.exports = {
  mapContentRecipeToCraftRecipe
};
