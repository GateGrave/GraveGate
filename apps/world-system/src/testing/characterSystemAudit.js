"use strict";

const fs = require("fs");
const path = require("path");

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeReadDirRecursive(rootDir, currentDir, collector) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      safeReadDirRecursive(rootDir, fullPath, collector);
      continue;
    }

    collector.push(relPath.toLowerCase());
  }
}

function collectSourceFiles(srcRoot) {
  const files = [];
  if (!fs.existsSync(srcRoot)) {
    return files;
  }

  safeReadDirRecursive(srcRoot, srcRoot, files);
  return files;
}

function collectWorldExports(srcRoot) {
  try {
    const modulePath = path.join(srcRoot, "index.js");
    if (!fs.existsSync(modulePath)) {
      return [];
    }

    const loaded = require(modulePath);
    return Object.keys(loaded || {}).map((key) => String(key).toLowerCase());
  } catch (error) {
    return [];
  }
}

function findMatches(fileNames, exportNames, patterns) {
  const patternList = toArray(patterns).map((value) => String(value).toLowerCase());
  const matchedFiles = fileNames.filter((file) => patternList.some((pattern) => file.includes(pattern)));
  const matchedExports = exportNames.filter((name) => patternList.some((pattern) => name.includes(pattern)));

  return {
    files: matchedFiles,
    exports: matchedExports,
    count: matchedFiles.length + matchedExports.length
  };
}

function runCharacterSystemAudit(input) {
  const data = input || {};
  const srcRoot = data.src_root
    ? path.resolve(String(data.src_root))
    : path.resolve(__dirname, "..");

  const fileNames = collectSourceFiles(srcRoot);
  const exportNames = collectWorldExports(srcRoot);

  const capabilityChecks = [
    { capability: "character_creation", patterns: ["character", "createcharacter", "player_profile"] },
    { capability: "race_selection", patterns: ["race"] },
    { capability: "class_selection", patterns: ["class", "profession"] },
    { capability: "background", patterns: ["background"] },
    { capability: "stats", patterns: ["stat", "attribute"] },
    { capability: "level_progression", patterns: ["level", "xp", "progression"] },
    { capability: "multiclass", patterns: ["multiclass"] },
    { capability: "gestalt_progression", patterns: ["gestalt"] },
    { capability: "inventory", patterns: ["inventory", "item", "loot", "grantloottoinventory"] },
    { capability: "attunement", patterns: ["attunement"] },
    { capability: "item_framework_integration", patterns: ["item", "loot", "grant", "equipment"] }
  ];

  const foundModules = [];
  const missingModules = [];

  for (const check of capabilityChecks) {
    const hits = findMatches(fileNames, exportNames, check.patterns);

    if (hits.count > 0) {
      foundModules.push({
        capability: check.capability,
        matched_files: hits.files,
        matched_exports: hits.exports
      });
    } else {
      missingModules.push(check.capability);
    }
  }

  const likelyEntryPoints = [
    "index.js",
    "handlers.js",
    "loot/index.js",
    "crafting/index.js",
    "economy/index.js",
    "guild/index.js"
  ].filter((relPath) => fileNames.includes(relPath.toLowerCase()));

  const notes = [
    "Audit is heuristic and based on file/export name matching.",
    "A capability marked found may still be partial scaffolding.",
    "Character-specific models were not found as dedicated modules if listed as missing."
  ];

  return {
    ok: true,
    event_type: "character_system_audit_completed",
    payload: {
      found_modules: foundModules,
      missing_modules: missingModules,
      likely_entry_points: likelyEntryPoints,
      notes
    },
    error: null
  };
}

if (require.main === module) {
  const report = runCharacterSystemAudit();
  console.log(JSON.stringify(report, null, 2));
}

module.exports = {
  runCharacterSystemAudit
};
