"use strict";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isArray(value) {
  return Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => isString(entry));
}

function isSpellRuntimeSupport(value) {
  if (!isObject(value)) {
    return false;
  }
  const combatResolution = String(value.combat_resolution || "").trim().toLowerCase();
  const contentScope = String(value.content_scope || "").trim().toLowerCase();
  if (!["supported", "partial", "unsupported"].includes(combatResolution)) {
    return false;
  }
  if (!["combat", "utility", "mixed"].includes(contentScope)) {
    return false;
  }
  return isStringArray(value.resolver_tags) && value.resolver_tags.length > 0;
}

function isSpellMetadataObject(value) {
  return isObject(value) && isSpellRuntimeSupport(value.runtime_support);
}

function isRecipeMaterialsArray(value) {
  if (!Array.isArray(value)) {
    return false;
  }

  for (let i = 0; i < value.length; i += 1) {
    const row = value[i];
    if (!isObject(row)) {
      return false;
    }
    if (!isString(row.item_id)) {
      return false;
    }
    if (!isPositiveInteger(row.quantity)) {
      return false;
    }
  }

  return true;
}

const CONTENT_SCHEMAS = {
  race: {
    required: {
      id: isString,
      name: isString,
      stat_modifiers: isObject,
      features: isArray,
      metadata: isObject
    }
  },
  class: {
    required: {
      id: isString,
      name: isString,
      stat_modifiers: isObject,
      features: isArray,
      metadata: isObject
    }
  },
  background: {
    required: {
      id: isString,
      name: isString,
      stat_modifiers: isObject,
      features: isArray,
      metadata: isObject
    }
  },
  item: {
    required: {
      item_id: isString,
      name: isString,
      item_type: isString,
      stackable: (value) => typeof value === "boolean",
      metadata: isObject
    }
  },
  monster: {
    required: {
      monster_id: isString,
      name: isString,
      level: isNumber,
      max_hp: isNumber,
      armor_class: isNumber,
      attack_bonus: isNumber,
      damage: isNumber,
      loot_table_id: isString,
      metadata: isObject
    }
  },
  spell: {
    required: {
      spell_id: isString,
      name: isString,
      level: isNumber,
      school: isString,
      effect: isObject,
      metadata: isSpellMetadataObject
    }
  },
  feat: {
    required: {
      feat_id: isString,
      name: isString,
      description: isString,
      prerequisites: isObject,
      effects: isArray,
      metadata: isObject
    }
  },
  dungeon: {
    required: {
      dungeon_id: isString,
      name: isString,
      start_room_id: isString,
      rooms: isArray,
      metadata: isObject
    }
  },
  recipe: {
    required: {
      recipe_id: isString,
      name: isString,
      output_item_id: isString,
      output_quantity: isPositiveInteger,
      required_materials: isRecipeMaterialsArray,
      metadata: isObject
    }
  },
  npc_shop: {
    required: {
      vendor_id: isString,
      vendor_name: isString,
      stock_items: isArray,
      price_map: isObject,
      quantity_map: isObject,
      infinite_stock_items: isArray,
      metadata: isObject
    }
  }
};

function validateContentEntry(contentType, entry) {
  if (!isObject(entry)) {
    return {
      ok: false,
      error: "entry must be an object"
    };
  }

  const schema = CONTENT_SCHEMAS[contentType];
  if (!schema) {
    return {
      ok: false,
      error: "unknown content type schema: " + contentType
    };
  }

  const requiredKeys = Object.keys(schema.required);
  for (const key of requiredKeys) {
    const validator = schema.required[key];
    if (!validator(entry[key])) {
      return {
        ok: false,
        error: "invalid or missing field: " + key
      };
    }
  }

  return {
    ok: true,
    error: null
  };
}

module.exports = {
  CONTENT_SCHEMAS,
  validateContentEntry
};
