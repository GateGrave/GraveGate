"use strict";

// This module validates whether a recipe can be crafted from inventory.
// It does not consume materials or mutate inventory.

function toSafeInteger(value) {
  if (!Number.isFinite(value)) return NaN;
  return Math.floor(value);
}

function readInventoryQuantityMap(inventory) {
  const map = new Map();
  const input = inventory || {};

  // Supported shape 1: { items: [ { item_id, quantity }, ... ] }
  const itemsArray = Array.isArray(input.items) ? input.items : null;
  if (itemsArray) {
    itemsArray.forEach((row) => {
      if (!row || typeof row !== "object") return;
      if (!row.item_id || String(row.item_id).trim() === "") return;
      const qty = toSafeInteger(row.quantity);
      if (!Number.isFinite(qty) || qty <= 0) return;
      const key = String(row.item_id);
      map.set(key, (map.get(key) || 0) + qty);
    });
    return map;
  }

  // Supported shape 2: [ { item_id, quantity }, ... ]
  if (Array.isArray(input)) {
    input.forEach((row) => {
      if (!row || typeof row !== "object") return;
      if (!row.item_id || String(row.item_id).trim() === "") return;
      const qty = toSafeInteger(row.quantity);
      if (!Number.isFinite(qty) || qty <= 0) return;
      const key = String(row.item_id);
      map.set(key, (map.get(key) || 0) + qty);
    });
    return map;
  }

  // Supported shape 3: { quantities: { item_id: number } }.
  const quantityObject = input.quantities && typeof input.quantities === "object"
    ? input.quantities
    : null;
  if (quantityObject) {
    Object.keys(quantityObject).forEach((itemId) => {
      const qty = toSafeInteger(quantityObject[itemId]);
      if (!Number.isFinite(qty) || qty <= 0) return;
      map.set(String(itemId), qty);
    });
    return map;
  }

  return map;
}

function normalizeMaterialRequirement(row, index) {
  if (!row || typeof row !== "object") {
    throw new Error("Material requirement must be an object at index " + index);
  }

  // Primary requirement format.
  if (row.item_id) {
    const quantity = toSafeInteger(row.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Material requirement quantity must be > 0 at index " + index);
    }
    return {
      requirement_type: "single",
      item_id: String(row.item_id),
      quantity
    };
  }

  // Future-safe optional format: one of many alternatives can satisfy this slot.
  if (Array.isArray(row.alternatives)) {
    if (row.alternatives.length === 0) {
      throw new Error("Material alternatives cannot be empty at index " + index);
    }

    const normalizedAlternatives = row.alternatives.map((alt, altIndex) => {
      if (!alt || typeof alt !== "object") {
        throw new Error(
          "Alternative material must be an object at index " + index + ":" + altIndex
        );
      }
      if (!alt.item_id || String(alt.item_id).trim() === "") {
        throw new Error(
          "Alternative material requires item_id at index " + index + ":" + altIndex
        );
      }
      const altQuantity = toSafeInteger(alt.quantity);
      if (!Number.isFinite(altQuantity) || altQuantity <= 0) {
        throw new Error(
          "Alternative material quantity must be > 0 at index " + index + ":" + altIndex
        );
      }

      return {
        item_id: String(alt.item_id),
        quantity: altQuantity
      };
    });

    return {
      requirement_type: "alternatives",
      alternatives: normalizedAlternatives
    };
  }

  throw new Error("Material requirement needs item_id or alternatives at index " + index);
}

function normalizeRequiredMaterials(recipe) {
  if (!recipe || typeof recipe !== "object") {
    throw new Error("Recipe object is required");
  }
  if (!Array.isArray(recipe.required_materials)) {
    throw new Error("Recipe required_materials array is required");
  }

  return recipe.required_materials.map((row, index) =>
    normalizeMaterialRequirement(row, index)
  );
}

function getMissingMaterials(recipe, inventory) {
  const requirements = normalizeRequiredMaterials(recipe);
  const inventoryMap = readInventoryQuantityMap(inventory);
  const missing = [];

  requirements.forEach((req) => {
    if (req.requirement_type === "single") {
      const owned = inventoryMap.get(req.item_id) || 0;
      if (owned < req.quantity) {
        missing.push({
          requirement_type: "single",
          item_id: req.item_id,
          required_quantity: req.quantity,
          owned_quantity: owned,
          missing_quantity: req.quantity - owned
        });
      }
      return;
    }

    // For alternatives: any one complete alternative satisfies the slot.
    let satisfied = false;
    req.alternatives.forEach((alt) => {
      if (satisfied) return;
      const owned = inventoryMap.get(alt.item_id) || 0;
      if (owned >= alt.quantity) {
        satisfied = true;
      }
    });

    if (!satisfied) {
      missing.push({
        requirement_type: "alternatives",
        alternatives: req.alternatives.map((alt) => ({
          item_id: alt.item_id,
          required_quantity: alt.quantity,
          owned_quantity: inventoryMap.get(alt.item_id) || 0
        }))
      });
    }
  });

  return missing;
}

function hasAllRequiredMaterials(recipe, inventory) {
  return getMissingMaterials(recipe, inventory).length === 0;
}

function validateRecipeMaterials(recipe, inventory) {
  try {
    const missingMaterials = getMissingMaterials(recipe, inventory);
    return {
      ok: missingMaterials.length === 0,
      recipe_id: recipe && recipe.recipe_id ? String(recipe.recipe_id) : null,
      missing_materials: missingMaterials
    };
  } catch (error) {
    return {
      ok: false,
      recipe_id: recipe && recipe.recipe_id ? String(recipe.recipe_id) : null,
      error: error.message,
      missing_materials: []
    };
  }
}

module.exports = {
  validateRecipeMaterials,
  getMissingMaterials,
  hasAllRequiredMaterials
};

