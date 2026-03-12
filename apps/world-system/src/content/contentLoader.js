"use strict";

const fs = require("fs");
const path = require("path");
const { validateContentEntry } = require("./contentSchemas");
const { validateCrossContentReferences } = require("./contentCrossValidation");

const CONTENT_DIRECTORY = path.join(__dirname, "data");
const FILE_MAP = {
  race: "Race.json",
  class: "Class.json",
  background: "Background.json",
  item: "Items.json",
  monster: "Monsters.json",
  spell: "Spells.json",
  dungeon: "Dungeons.json",
  recipe: "Recipes.json",
  npc_shop: "NpcShops.json"
};

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

function loadContentFile(contentType) {
  const fileName = FILE_MAP[contentType];
  if (!fileName) {
    return failure("content_file_load_failed", "unknown content type: " + contentType);
  }

  const filePath = path.join(CONTENT_DIRECTORY, fileName);
  let parsed;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    parsed = JSON.parse(raw);
  } catch (error) {
    return failure("content_file_load_failed", error.message, {
      content_type: contentType,
      file_path: filePath
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return failure("content_file_validation_failed", "content root must be an object", {
      content_type: contentType,
      file_path: filePath
    });
  }

  if (!Array.isArray(parsed.entries)) {
    return failure("content_file_validation_failed", "entries must be an array", {
      content_type: contentType,
      file_path: filePath
    });
  }

  const entries = parsed.entries;
  for (let i = 0; i < entries.length; i += 1) {
    const result = validateContentEntry(contentType, entries[i]);
    if (!result.ok) {
      return failure("content_file_validation_failed", result.error, {
        content_type: contentType,
        file_path: filePath,
        entry_index: i
      });
    }
  }

  return success("content_file_loaded", {
    content_type: contentType,
    schema_version: parsed.schema_version || 1,
    file_path: filePath,
    entries: clone(entries)
  });
}

function loadRaceContent() {
  return loadContentFile("race");
}

function loadClassContent() {
  return loadContentFile("class");
}

function loadBackgroundContent() {
  return loadContentFile("background");
}

function loadItemContent() {
  return loadContentFile("item");
}

function loadMonsterContent() {
  return loadContentFile("monster");
}

function loadSpellContent() {
  return loadContentFile("spell");
}

function loadDungeonContent() {
  return loadContentFile("dungeon");
}

function loadRecipeContent() {
  return loadContentFile("recipe");
}

function loadNpcShopContent() {
  return loadContentFile("npc_shop");
}

function loadStarterContentBundle() {
  const loaders = {
    races: loadRaceContent,
    classes: loadClassContent,
    backgrounds: loadBackgroundContent,
    items: loadItemContent,
    monsters: loadMonsterContent,
    spells: loadSpellContent,
    dungeons: loadDungeonContent,
    recipes: loadRecipeContent,
    npc_shops: loadNpcShopContent
  };

  const bundle = {};
  const errors = [];
  const keys = Object.keys(loaders);

  for (const key of keys) {
    const out = loaders[key]();
    if (!out.ok) {
      errors.push({
        key,
        error: out.error
      });
      continue;
    }

    bundle[key] = out.payload.entries;
  }

  if (errors.length > 0) {
    return failure("starter_content_bundle_load_failed", "one or more content files failed to load", {
      errors
    });
  }

  const crossValidation = validateCrossContentReferences(bundle);
  if (!crossValidation.ok) {
    return failure("starter_content_bundle_load_failed", "cross-content reference validation failed", {
      errors: crossValidation.payload.errors || []
    });
  }

  return success("starter_content_bundle_loaded", {
    content: bundle,
    cross_validation: crossValidation.payload
  });
}

module.exports = {
  CONTENT_DIRECTORY,
  FILE_MAP,
  loadContentFile,
  loadRaceContent,
  loadClassContent,
  loadBackgroundContent,
  loadItemContent,
  loadMonsterContent,
  loadSpellContent,
  loadDungeonContent,
  loadRecipeContent,
  loadNpcShopContent,
  loadStarterContentBundle
};
