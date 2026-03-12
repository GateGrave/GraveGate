"use strict";

const fs = require("fs");
const path = require("path");
const { Jimp } = require("jimp");

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function getPixelOffset(width, x, y) {
  return ((y * width) + x) * 4;
}

function getPixelRgba(data, width, x, y) {
  const offset = getPixelOffset(width, x, y);
  return {
    r: data[offset],
    g: data[offset + 1],
    b: data[offset + 2],
    a: data[offset + 3]
  };
}

function setPixelAlpha(data, width, x, y, alpha) {
  const offset = getPixelOffset(width, x, y);
  data[offset + 3] = clampChannel(alpha);
}

function colorDistance(left, right) {
  const dr = left.r - right.r;
  const dg = left.g - right.g;
  const db = left.b - right.b;
  return Math.sqrt((dr * dr) + (dg * dg) + (db * db));
}

function sampleBackgroundColorFromCorners(bitmap) {
  const width = bitmap.width;
  const height = bitmap.height;
  const points = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: 0, y: height - 1 },
    { x: width - 1, y: height - 1 }
  ];

  const total = points.reduce((accumulator, point) => {
    const pixel = getPixelRgba(bitmap.data, width, point.x, point.y);
    accumulator.r += pixel.r;
    accumulator.g += pixel.g;
    accumulator.b += pixel.b;
    return accumulator;
  }, { r: 0, g: 0, b: 0 });

  return {
    r: clampChannel(total.r / points.length),
    g: clampChannel(total.g / points.length),
    b: clampChannel(total.b / points.length)
  };
}

function removeBackgroundColor(bitmap, options) {
  const tolerance = typeof options.tolerance === "number" ? options.tolerance : 40;
  const feather = typeof options.feather === "number" ? options.feather : 14;
  const background = options.background_color || sampleBackgroundColorFromCorners(bitmap);
  let clearedPixels = 0;

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const pixel = getPixelRgba(bitmap.data, bitmap.width, x, y);
      if (pixel.a === 0) {
        continue;
      }

      const distance = colorDistance(pixel, background);
      if (distance <= tolerance) {
        setPixelAlpha(bitmap.data, bitmap.width, x, y, 0);
        clearedPixels += 1;
        continue;
      }

      if (distance <= tolerance + feather) {
        const normalized = (distance - tolerance) / feather;
        const alpha = clampChannel(pixel.a * normalized);
        setPixelAlpha(bitmap.data, bitmap.width, x, y, alpha);
      }
    }
  }

  return {
    background_color: background,
    tolerance,
    feather,
    cleared_pixels: clearedPixels
  };
}

function despillChromaEdges(bitmap, options) {
  const spillBias = typeof options.spill_bias === "number" ? options.spill_bias : 16;
  let adjustedPixels = 0;

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const pixel = getPixelRgba(bitmap.data, bitmap.width, x, y);
      if (pixel.a === 0) {
        continue;
      }

      const dominantOther = Math.max(pixel.r, pixel.b);
      if (pixel.g > dominantOther + spillBias) {
        const offset = getPixelOffset(bitmap.width, x, y);
        bitmap.data[offset + 1] = clampChannel(dominantOther + Math.round(spillBias / 2));
        adjustedPixels += 1;
      }
    }
  }

  return {
    adjusted_pixels: adjustedPixels
  };
}

function suppressResidualChroma(bitmap, options) {
  const greenBias = typeof options.green_bias === "number" ? options.green_bias : 8;
  const alphaThreshold = typeof options.alpha_threshold === "number" ? options.alpha_threshold : 235;
  let clearedPixels = 0;
  let softenedPixels = 0;

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const pixel = getPixelRgba(bitmap.data, bitmap.width, x, y);
      if (pixel.a === 0) {
        continue;
      }

      const greenDominant = pixel.g > pixel.r + greenBias && pixel.g > pixel.b + greenBias;
      if (!greenDominant) {
        continue;
      }

      if (pixel.a < alphaThreshold) {
        setPixelAlpha(bitmap.data, bitmap.width, x, y, 0);
        clearedPixels += 1;
        continue;
      }

      const offset = getPixelOffset(bitmap.width, x, y);
      bitmap.data[offset + 3] = clampChannel(pixel.a * 0.75);
      softenedPixels += 1;
    }
  }

  return {
    cleared_pixels: clearedPixels,
    softened_pixels: softenedPixels
  };
}

function findOpaqueBounds(bitmap, alphaThreshold) {
  const threshold = typeof alphaThreshold === "number" ? alphaThreshold : 8;
  let minX = bitmap.width;
  let minY = bitmap.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const pixel = getPixelRgba(bitmap.data, bitmap.width, x, y);
      if (pixel.a <= threshold) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: (maxX - minX) + 1,
    height: (maxY - minY) + 1
  };
}

async function processTokenImage(options) {
  const inputPath = path.resolve(options.input_path);
  const outputPath = path.resolve(options.output_path);
  const targetSize = typeof options.target_size === "number" ? options.target_size : 280;
  const padding = typeof options.padding === "number" ? options.padding : 8;

  const image = await Jimp.read(inputPath);
  const cleanup = removeBackgroundColor(image.bitmap, {
    background_color: options.background_color,
    tolerance: options.tolerance,
    feather: options.feather
  });
  const despill = despillChromaEdges(image.bitmap, {
    spill_bias: options.spill_bias
  });
  const residualChroma = suppressResidualChroma(image.bitmap, {
    green_bias: options.green_bias,
    alpha_threshold: options.alpha_threshold
  });

  const bounds = findOpaqueBounds(image.bitmap, 8);
  let workingImage = image;

  if (bounds) {
    workingImage = workingImage.crop({
      x: bounds.x,
      y: bounds.y,
      w: bounds.width,
      h: bounds.height
    });
  }

  const innerSize = Math.max(1, targetSize - (padding * 2));
  workingImage = workingImage.scaleToFit({ w: innerSize, h: innerSize });

  const canvas = new Jimp({
    width: targetSize,
    height: targetSize,
    color: 0x00000000
  });

  const x = Math.round((targetSize - workingImage.bitmap.width) / 2);
  const y = Math.round((targetSize - workingImage.bitmap.height) / 2);
  canvas.composite(workingImage, x, y);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await canvas.write(outputPath);

  return {
    ok: true,
    input_path: inputPath,
    output_path: outputPath,
    background_color: cleanup.background_color,
    cleared_pixels: cleanup.cleared_pixels,
    despilled_pixels: despill.adjusted_pixels,
    residual_chroma_cleared_pixels: residualChroma.cleared_pixels,
    residual_chroma_softened_pixels: residualChroma.softened_pixels,
    target_size: targetSize
  };
}

module.exports = {
  colorDistance,
  sampleBackgroundColorFromCorners,
  removeBackgroundColor,
  despillChromaEdges,
  suppressResidualChroma,
  findOpaqueBounds,
  processTokenImage
};
