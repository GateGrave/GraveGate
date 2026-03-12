"use strict";

const fs = require("fs");
const path = require("path");

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

function collectCharacterRelatedFiles(srcRoot) {
  if (!fs.existsSync(srcRoot)) {
    return [];
  }

  const found = [];

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      const relPath = path.relative(srcRoot, fullPath).replace(/\\/g, "/");
      const lower = relPath.toLowerCase();
      if (lower.includes("character") || lower.includes("inventory") || lower.includes("progress")) {
        found.push(relPath);
      }
    }
  }

  walk(srcRoot);
  return found;
}

function getWorldExports(srcRoot) {
  try {
    const modulePath = path.join(srcRoot, "index.js");
    if (!fs.existsSync(modulePath)) {
      return {};
    }

    return require(modulePath);
  } catch (error) {
    return {};
  }
}

function extractCharacterObject(candidateResult) {
  if (!candidateResult || typeof candidateResult !== "object") {
    return null;
  }

  if (candidateResult.character && typeof candidateResult.character === "object") {
    return candidateResult.character;
  }

  if (candidateResult.payload && candidateResult.payload.character && typeof candidateResult.payload.character === "object") {
    return candidateResult.payload.character;
  }

  return null;
}

function getMissingCharacterFields(character) {
  const required = [
    "character_id",
    "name",
    "race",
    "class",
    "level",
    "stats",
    "inventory"
  ];

  const missing = [];
  for (const field of required) {
    if (field === "inventory") {
      const hasInventoryRef = character && (character.inventory || character.inventory_id);
      if (!hasInventoryRef) {
        missing.push("inventory");
      }
      continue;
    }

    if (!character || character[field] === undefined || character[field] === null || character[field] === "") {
      missing.push(field);
    }
  }

  return missing;
}

function runCharacterCreationFlowCheck(input) {
  const data = input || {};
  const srcRoot = data.src_root
    ? path.resolve(String(data.src_root))
    : path.resolve(__dirname, "..");

  const worldExports = getWorldExports(srcRoot);
  const exportNames = Object.keys(worldExports || {});
  const characterRelatedFiles = collectCharacterRelatedFiles(srcRoot);

  const likelyEntryPoints = exportNames.filter((name) => name.toLowerCase().includes("character"));
  const hasDirectCharacterCreator = typeof worldExports.createCharacter === "function";

  if (!hasDirectCharacterCreator) {
    return failure("character_creation_flow_check_failed", "No direct character creation module/export found", {
      found_modules: characterRelatedFiles,
      missing_modules: [
        "createCharacter export",
        "dedicated character schema/model for full player character fields"
      ],
      likely_entry_points: likelyEntryPoints,
      notes: [
        "Current world-system exposes character-related handlers but not a direct createCharacter API.",
        "Flow check did not invent a new character system by design."
      ]
    });
  }

  let creationResult;
  try {
    creationResult = worldExports.createCharacter({
      character_id: "char-check-001",
      name: "Check Hero",
      race: "human",
      class: "fighter",
      level: 1,
      stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      inventory_id: "inv-check-001"
    });
  } catch (error) {
    return failure("character_creation_flow_check_failed", "Character creator threw an error", {
      likely_entry_points: likelyEntryPoints,
      notes: [error.message]
    });
  }

  const character = extractCharacterObject(creationResult);
  if (!character) {
    return failure("character_creation_flow_check_failed", "Character creator did not return a character object", {
      likely_entry_points: likelyEntryPoints,
      notes: ["Expected result.character or result.payload.character"]
    });
  }

  const missingFields = getMissingCharacterFields(character);
  if (missingFields.length > 0) {
    return failure("character_creation_flow_check_failed", "Character object is missing required gameplay fields", {
      missing_fields: missingFields,
      likely_entry_points: likelyEntryPoints,
      found_modules: characterRelatedFiles
    });
  }

  return success("character_creation_flow_check_completed", {
    found_modules: characterRelatedFiles,
    missing_modules: [],
    likely_entry_points: likelyEntryPoints,
    notes: ["Character creation flow appears usable for test gameplay object assembly."],
    character_preview: character
  });
}

if (require.main === module) {
  const out = runCharacterCreationFlowCheck();
  console.log(JSON.stringify(out, null, 2));
}

module.exports = {
  runCharacterCreationFlowCheck
};
