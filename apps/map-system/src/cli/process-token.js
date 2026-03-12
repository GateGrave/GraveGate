"use strict";

const path = require("path");
const { processTokenImage } = require("../tokens/token-image-processor");

function parseArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

async function main() {
  const inputArg = parseArg("input");
  const outputArg = parseArg("output");
  const toleranceArg = parseArg("tolerance");
  const sizeArg = parseArg("size");

  if (!inputArg || !outputArg) {
    console.error("Missing required args: --input=<path> and --output=<path>");
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const result = await processTokenImage({
    input_path: path.resolve(repoRoot, inputArg),
    output_path: path.resolve(repoRoot, outputArg),
    tolerance: toleranceArg ? Number(toleranceArg) : 40,
    target_size: sizeArg ? Number(sizeArg) : 280
  });

  console.log(JSON.stringify(result, null, 2));
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
