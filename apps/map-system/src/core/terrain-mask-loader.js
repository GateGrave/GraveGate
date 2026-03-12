"use strict";

const fs = require("fs");
const path = require("path");
const { Jimp } = require("jimp");
const terrainMaskPalettes = require("../../data/terrain/terrain-mask-palettes.json");
const { resolveAssetPath } = require("./asset-path-utils");

function normalizeHexColor(value) {
  return String(value || "").trim().toUpperCase();
}

function parseHexColor(value) {
  const normalized = normalizeHexColor(value).replace("#", "");
  if (!/^[0-9A-F]{6}$/.test(normalized)) {
    return null;
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function colorDistance(left, right) {
  const dr = left.r - right.r;
  const dg = left.g - right.g;
  const db = left.b - right.b;
  return Math.sqrt((dr * dr) + (dg * dg) + (db * db));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeUniqueByCoordinate(primaryList, secondaryList) {
  const merged = new Map();

  [].concat(primaryList || [], secondaryList || []).forEach((entry) => {
    merged.set(`${entry.x},${entry.y}`, entry);
  });

  return Array.from(merged.values());
}

function loadTerrainMaskPalette(options) {
  const paletteId = options && options.palette_id
    ? String(options.palette_id)
    : "mspaint_basic";
  const customPath = options && options.palette_path
    ? path.resolve(process.cwd(), options.palette_path)
    : "";

  let source = terrainMaskPalettes;
  if (customPath) {
    source = JSON.parse(fs.readFileSync(customPath, "utf8"));
  }

  const palettes = Array.isArray(source.palettes) ? source.palettes : [];
  const palette = palettes.find((entry) => String(entry.palette_id) === paletteId);
  if (!palette) {
    throw new Error(`unknown terrain mask palette: ${paletteId}`);
  }

  return {
    palette_id: palette.palette_id,
    name: palette.name || palette.palette_id,
    description: palette.description || "",
    entries: (palette.entries || []).map((entry) => ({
      hex: normalizeHexColor(entry.hex),
      label: entry.label || entry.terrain_type || "",
      terrain_type: entry.terrain_type || "open",
      rgb: parseHexColor(entry.hex)
    })).filter((entry) => entry.rgb)
  };
}

function getTerrainMaskMetrics(map, bitmap) {
  const widthPx = map.asset && Number.isFinite(map.asset.render_width_px)
    ? Number(map.asset.render_width_px)
    : bitmap.width;
  const heightPx = map.asset && Number.isFinite(map.asset.render_height_px)
    ? Number(map.asset.render_height_px)
    : bitmap.height;
  const gridOriginX = map.asset && Number.isFinite(map.asset.grid_origin_x)
    ? Number(map.asset.grid_origin_x)
    : 0;
  const gridOriginY = map.asset && Number.isFinite(map.asset.grid_origin_y)
    ? Number(map.asset.grid_origin_y)
    : 0;
  const gridWidthPx = map.asset && Number.isFinite(map.asset.grid_width_px)
    ? Number(map.asset.grid_width_px)
    : widthPx;
  const gridHeightPx = map.asset && Number.isFinite(map.asset.grid_height_px)
    ? Number(map.asset.grid_height_px)
    : heightPx;

  return {
    grid_origin_x: gridOriginX,
    grid_origin_y: gridOriginY,
    tile_width_px: gridWidthPx / map.grid.width,
    tile_height_px: gridHeightPx / map.grid.height
  };
}

function getBitmapPixel(bitmap, x, y) {
  const safeX = Math.max(0, Math.min(bitmap.width - 1, x));
  const safeY = Math.max(0, Math.min(bitmap.height - 1, y));
  const offset = ((safeY * bitmap.width) + safeX) * 4;
  return {
    r: bitmap.data[offset],
    g: bitmap.data[offset + 1],
    b: bitmap.data[offset + 2],
    a: bitmap.data[offset + 3]
  };
}

function matchPaletteEntry(pixel, palette, tolerance) {
  let best = null;

  palette.entries.forEach((entry) => {
    const distance = colorDistance(pixel, entry.rgb);
    if (distance > tolerance) {
      return;
    }

    if (!best || distance < best.distance) {
      best = {
        entry,
        distance
      };
    }
  });

  return best ? best.entry : null;
}

function sampleTileMaskEntry(bitmap, metrics, tile, palette, tolerance) {
  const centerX = metrics.grid_origin_x + ((tile.x + 0.5) * metrics.tile_width_px);
  const centerY = metrics.grid_origin_y + ((tile.y + 0.5) * metrics.tile_height_px);
  const offsetX = Math.max(1, Math.floor(metrics.tile_width_px * 0.16));
  const offsetY = Math.max(1, Math.floor(metrics.tile_height_px * 0.16));
  const samplePoints = [
    { x: Math.round(centerX), y: Math.round(centerY) },
    { x: Math.round(centerX - offsetX), y: Math.round(centerY) },
    { x: Math.round(centerX + offsetX), y: Math.round(centerY) },
    { x: Math.round(centerX), y: Math.round(centerY - offsetY) },
    { x: Math.round(centerX), y: Math.round(centerY + offsetY) }
  ];
  const counts = new Map();

  samplePoints.forEach((point) => {
    const pixel = getBitmapPixel(bitmap, point.x, point.y);
    if (pixel.a === 0) {
      return;
    }

    const match = matchPaletteEntry(pixel, palette, tolerance);
    if (!match) {
      return;
    }

    const key = `${match.hex}:${match.terrain_type}`;
    counts.set(key, {
      count: (counts.get(key) ? counts.get(key).count : 0) + 1,
      entry: match
    });
  });

  const ranked = Array.from(counts.values()).sort((left, right) => right.count - left.count);
  return ranked.length > 0 ? ranked[0].entry : null;
}

function buildTerrainEntriesFromMaskBitmap(map, bitmap, options) {
  const palette = loadTerrainMaskPalette({
    palette_id: options && options.palette_id
      ? options.palette_id
      : (map.asset && map.asset.terrain_mask_palette_id) || "mspaint_basic",
    palette_path: options && options.palette_path
      ? options.palette_path
      : (map.asset && map.asset.terrain_mask_palette_path) || ""
  });
  const tolerance = Number.isFinite(options && options.color_tolerance)
    ? Number(options.color_tolerance)
    : (map.asset && Number.isFinite(map.asset.terrain_mask_color_tolerance)
      ? Number(map.asset.terrain_mask_color_tolerance)
      : 24);
  const metrics = getTerrainMaskMetrics(map, bitmap);
  const terrain = [];
  const counts = {};
  let unmatchedTiles = 0;

  for (let y = 0; y < map.grid.height; y += 1) {
    for (let x = 0; x < map.grid.width; x += 1) {
      const entry = sampleTileMaskEntry(bitmap, metrics, { x, y }, palette, tolerance);
      if (!entry) {
        unmatchedTiles += 1;
        continue;
      }

      counts[entry.terrain_type] = (counts[entry.terrain_type] || 0) + 1;
      if (entry.terrain_type === "open") {
        continue;
      }

      terrain.push({
        x,
        y,
        terrain_type: entry.terrain_type,
        mask_color: entry.hex,
        mask_generated: true
      });
    }
  }

  return {
    terrain,
    summary: {
      palette_id: palette.palette_id,
      tile_count: map.grid.width * map.grid.height,
      generated_terrain_tiles: terrain.length,
      unmatched_tiles: unmatchedTiles,
      terrain_type_counts: counts
    }
  };
}

async function buildTerrainEntriesFromMaskPath(map, options) {
  const requestedPath = options && options.mask_path
    ? options.mask_path
    : (map.asset && map.asset.terrain_mask_path) || "";
  if (!requestedPath) {
    return {
      terrain: [],
      summary: null
    };
  }

  const resolvedMaskPath = resolveAssetPath(requestedPath);
  const absoluteMaskPath = path.resolve(process.cwd(), resolvedMaskPath);
  if (!fs.existsSync(absoluteMaskPath)) {
    throw new Error(`terrain mask not found: ${requestedPath}`);
  }

  const image = await Jimp.read(absoluteMaskPath);
  const built = buildTerrainEntriesFromMaskBitmap(map, image.bitmap, options);

  return {
    terrain: built.terrain,
    summary: {
      ...built.summary,
      mask_path: resolvedMaskPath
    }
  };
}

async function applyTerrainMaskToMap(map, options) {
  const built = await buildTerrainEntriesFromMaskPath(map, options);
  if (!built.summary) {
    return map;
  }

  const nextMap = clone(map);
  nextMap.terrain = mergeUniqueByCoordinate(built.terrain, nextMap.terrain || []);
  nextMap.terrain_mask_summary = built.summary;
  return nextMap;
}

module.exports = {
  normalizeHexColor,
  parseHexColor,
  loadTerrainMaskPalette,
  getTerrainMaskMetrics,
  buildTerrainEntriesFromMaskBitmap,
  buildTerrainEntriesFromMaskPath,
  applyTerrainMaskToMap
};
