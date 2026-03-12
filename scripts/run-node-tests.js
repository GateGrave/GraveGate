"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function parseArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (!found) return "";
  return found.slice(prefix.length);
}

function parseList(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function walkFiles(startPath, out) {
  const stats = fs.statSync(startPath);
  if (stats.isFile()) {
    out.push(startPath);
    return;
  }

  const children = fs.readdirSync(startPath);
  for (const child of children) {
    const childPath = path.join(startPath, child);
    walkFiles(childPath, out);
  }
}

function toSlashPath(inputPath) {
  return inputPath.replace(/\\/g, "/");
}

function findTestFiles(repoRoot, includePaths) {
  const allFiles = [];
  for (const includePath of includePaths) {
    const absolute = path.resolve(repoRoot, includePath);
    if (!fs.existsSync(absolute)) {
      continue;
    }
    walkFiles(absolute, allFiles);
  }

  return allFiles
    .map((filePath) => path.relative(repoRoot, filePath))
    .filter((filePath) => filePath.endsWith(".test.js"))
    .sort();
}

function runNodeTest(repoRoot, relativeTestPath) {
  const fullPath = path.resolve(repoRoot, relativeTestPath);
  const out = spawnSync(process.execPath, [fullPath], {
    stdio: "inherit"
  });

  return out.status === 0;
}

function main() {
  const repoRoot = process.cwd();
  const includeArg = parseArg("include");
  const containsArg = parseArg("contains");
  const excludeArg = parseArg("exclude");

  const includePaths = parseList(includeArg);
  const containsParts = parseList(containsArg);
  const excludeParts = parseList(excludeArg);

  if (includePaths.length === 0) {
    console.error("No --include paths provided.");
    process.exit(1);
  }

  const candidateTests = findTestFiles(repoRoot, includePaths);

  const filteredTests = candidateTests.filter((testPath) => {
    const normalized = toSlashPath(testPath).toLowerCase();

    const containsOk =
      containsParts.length === 0 ||
      containsParts.every((part) => normalized.includes(part.toLowerCase()));
    if (!containsOk) return false;

    const excluded = excludeParts.some((part) => normalized.includes(part.toLowerCase()));
    if (excluded) return false;

    return true;
  });

  if (filteredTests.length === 0) {
    console.log("No matching test files found.");
    process.exit(0);
  }

  console.log(`Running ${filteredTests.length} test file(s)...`);

  const failed = [];
  for (const testPath of filteredTests) {
    console.log(`\n=== ${testPath} ===`);
    const ok = runNodeTest(repoRoot, testPath);
    if (!ok) {
      failed.push(testPath);
    }
  }

  if (failed.length > 0) {
    console.error("\nTest failures:");
    for (const failedPath of failed) {
      console.error(`- ${failedPath}`);
    }
    process.exit(1);
  }

  console.log("\nAll selected tests passed.");
}

main();
