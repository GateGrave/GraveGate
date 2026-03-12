"use strict";

const fs = require("fs");
const path = require("path");

function resolveAssetPath(inputPath) {
  if (!inputPath) {
    return "";
  }

  const absoluteInputPath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(process.cwd(), inputPath);

  if (fs.existsSync(absoluteInputPath)) {
    return inputPath;
  }

  const parentDirectory = path.dirname(absoluteInputPath);
  const requestedName = path.basename(absoluteInputPath);
  const requestedNameLower = requestedName.toLowerCase();
  const requestedStem = path.basename(absoluteInputPath, path.extname(absoluteInputPath)).toLowerCase();

  if (!fs.existsSync(parentDirectory)) {
    return inputPath;
  }

  const siblingNames = fs.readdirSync(parentDirectory);
  const exactCaseInsensitiveMatch = siblingNames.find((entry) => entry.toLowerCase() === requestedNameLower);
  if (exactCaseInsensitiveMatch) {
    return path.relative(process.cwd(), path.join(parentDirectory, exactCaseInsensitiveMatch));
  }

  const sameStemMatch = siblingNames.find((entry) => {
    const siblingStem = path.basename(entry, path.extname(entry)).toLowerCase();
    return siblingStem === requestedStem || siblingStem.startsWith(`${requestedStem}.`);
  });

  if (sameStemMatch) {
    return path.relative(process.cwd(), path.join(parentDirectory, sameStemMatch));
  }

  return inputPath;
}

module.exports = {
  resolveAssetPath
};
