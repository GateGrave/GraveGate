"use strict";

const fs = require("fs");
const path = require("path");
const { processTokenImage } = require("../tokens/token-image-processor");

function toChoiceId(fileName) {
  return fileName.replace(/\.[^.]+$/, "").toLowerCase();
}

function toLabel(choiceId) {
  return choiceId
    .split(/[-_]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function loadCatalog(catalogPath) {
  if (!fs.existsSync(catalogPath)) {
    return { tokens: [] };
  }

  return JSON.parse(fs.readFileSync(catalogPath, "utf8"));
}

function saveCatalog(catalogPath, catalog) {
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

async function main() {
  const repoRoot = process.cwd();
  const playersRoot = path.resolve(repoRoot, "apps/map-system/assets/tokens/players");
  const processedRoot = path.resolve(playersRoot, "processed");
  const catalogPath = path.resolve(repoRoot, "apps/map-system/data/tokens/player-token-catalog.json");

  fs.mkdirSync(processedRoot, { recursive: true });

  const rawFiles = fs.readdirSync(playersRoot)
    .filter((entry) => entry.toLowerCase().endsWith(".png"))
    .sort();

  const catalog = loadCatalog(catalogPath);
  const existingById = new Map((catalog.tokens || []).map((entry) => [entry.token_choice_id, entry]));
  const processed = [];

  for (const fileName of rawFiles) {
    const inputPath = path.join(playersRoot, fileName);
    const outputFileName = `${fileName.replace(/\.png$/i, "")}.cleaned.png`;
    const outputPath = path.join(processedRoot, outputFileName);

    const result = await processTokenImage({
      input_path: inputPath,
      output_path: outputPath
    });

    const tokenChoiceId = toChoiceId(fileName);
    const previous = existingById.get(tokenChoiceId) || {};
    existingById.set(tokenChoiceId, {
      token_choice_id: tokenChoiceId,
      label: previous.label || toLabel(tokenChoiceId),
      category: "players",
      file_name: fileName,
      processed_file_name: `processed/${outputFileName}`,
      shape: previous.shape || "circle",
      badge_text: previous.badge_text || "",
      notes: previous.notes || "Batch-processed player token."
    });

    processed.push({
      token_choice_id: tokenChoiceId,
      file_name: fileName,
      processed_file_name: `processed/${outputFileName}`,
      cleared_pixels: result.cleared_pixels,
      despilled_pixels: result.despilled_pixels
    });
  }

  const nextCatalog = {
    tokens: Array.from(existingById.values()).sort((left, right) => left.token_choice_id.localeCompare(right.token_choice_id))
  };
  saveCatalog(catalogPath, nextCatalog);

  console.log(JSON.stringify({
    ok: true,
    processed_count: processed.length,
    processed
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = {
  main
};
