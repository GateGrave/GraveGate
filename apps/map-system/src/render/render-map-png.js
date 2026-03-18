"use strict";

const fs = require("fs");
const path = require("path");
const { Jimp, loadFont, rgbaToInt } = require("jimp");
const { SANS_16_BLACK, SANS_16_WHITE } = require("@jimp/plugin-print/fonts");
const { assertValidMapState } = require("../schema/map-state.schema");
const { OVERLAY_KINDS } = require("../constants");
const { buildTokenVisualProfile } = require("../tokens/token-catalog");
const { resolveAssetPath } = require("../core/asset-path-utils");
const { normalizeDebugFlags } = require("../interaction/debug-flags");
const {
  buildTerrainVisualTiles,
  getCoverDebugLabel,
  buildTerrainDebugLabel,
  buildEdgeWallVisuals,
  getSelectionMarkerVisual,
  buildMarkerDebugEntries
} = require("./render-visuals");

function readPngDimensions(absolutePath) {
  const header = fs.readFileSync(absolutePath);
  if (header.length < 24) {
    return null;
  }

  const pngSignature = "89504e470d0a1a0a";
  if (header.subarray(0, 8).toString("hex") !== pngSignature) {
    return null;
  }

  return {
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20)
  };
}

function readImageDimensions(absolutePath) {
  if (path.extname(absolutePath).toLowerCase() !== ".png") {
    return null;
  }

  return readPngDimensions(absolutePath);
}

function getRenderMetrics(map) {
  const fallbackWidth = map.grid.width * map.grid.tile_size;
  const fallbackHeight = map.grid.height * map.grid.tile_size;
  const resolvedBaseImagePath = map.asset && map.asset.base_image_path
    ? resolveAssetPath(map.asset.base_image_path)
    : "";
  const absoluteBaseImagePath = resolvedBaseImagePath
    ? path.resolve(process.cwd(), resolvedBaseImagePath)
    : "";
  const imageDimensions = absoluteBaseImagePath && fs.existsSync(absoluteBaseImagePath)
    ? readImageDimensions(absoluteBaseImagePath)
    : null;
  const widthPx = map.asset && Number.isFinite(map.asset.render_width_px)
    ? Number(map.asset.render_width_px)
    : (imageDimensions && Number.isFinite(imageDimensions.width) ? imageDimensions.width : fallbackWidth);
  const heightPx = map.asset && Number.isFinite(map.asset.render_height_px)
    ? Number(map.asset.render_height_px)
    : (imageDimensions && Number.isFinite(imageDimensions.height) ? imageDimensions.height : fallbackHeight);
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
    width_px: widthPx,
    height_px: heightPx,
    tile_width_px: gridWidthPx / map.grid.width,
    tile_height_px: gridHeightPx / map.grid.height,
    grid_origin_x: gridOriginX,
    grid_origin_y: gridOriginY,
    base_image_path: absoluteBaseImagePath
  };
}

function parseHexColor(hex, opacity) {
  const normalized = String(hex || "#000000").replace("#", "").trim();
  const safe = normalized.length === 6 ? normalized : "000000";
  const r = Number.parseInt(safe.slice(0, 2), 16);
  const g = Number.parseInt(safe.slice(2, 4), 16);
  const b = Number.parseInt(safe.slice(4, 6), 16);
  const a = Math.max(0, Math.min(255, Math.round((typeof opacity === "number" ? opacity : 1) * 255)));
  return rgbaToInt(r, g, b, a);
}

function fileExists(assetPath) {
  return assetPath && fs.existsSync(assetPath);
}

async function createCanvas(width, height, color) {
  return new Jimp({
    width,
    height,
    color
  });
}

async function loadFonts() {
  const [fontBlack, fontWhite] = await Promise.all([
    loadFont(SANS_16_BLACK),
    loadFont(SANS_16_WHITE)
  ]);

  return { fontBlack, fontWhite };
}

function tileRect(metrics, tile) {
  return {
    x: Math.round(metrics.grid_origin_x + (tile.x * metrics.tile_width_px)),
    y: Math.round(metrics.grid_origin_y + (tile.y * metrics.tile_height_px)),
    width: Math.round(metrics.tile_width_px),
    height: Math.round(metrics.tile_height_px)
  };
}

async function drawFilledRect(image, rect, hex, opacity) {
  const overlay = await createCanvas(rect.width, rect.height, parseHexColor(hex, opacity));
  image.composite(overlay, rect.x, rect.y);
}

async function drawRectBorder(image, rect, hex, thickness) {
  const safeThickness = Math.max(1, Math.round(thickness || 2));
  await drawFilledRect(image, { x: rect.x, y: rect.y, width: rect.width, height: safeThickness }, hex, 1);
  await drawFilledRect(image, { x: rect.x, y: rect.y + rect.height - safeThickness, width: rect.width, height: safeThickness }, hex, 1);
  await drawFilledRect(image, { x: rect.x, y: rect.y, width: safeThickness, height: rect.height }, hex, 1);
  await drawFilledRect(image, { x: rect.x + rect.width - safeThickness, y: rect.y, width: safeThickness, height: rect.height }, hex, 1);
}

function getPlateWidth(text, minWidth, maxWidth) {
  const safeText = String(text || "");
  const estimated = 14 + (safeText.length * 10);
  return Math.max(minWidth, Math.min(maxWidth, estimated));
}

function selectFontByHex(fonts, hex) {
  const normalized = String(hex || "").replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return fonts.fontWhite;
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (r * 0.299) + (g * 0.587) + (b * 0.114);
  return luminance >= 150 ? fonts.fontBlack : fonts.fontWhite;
}

async function drawTextPlate(image, fonts, options) {
  const text = String(options && options.text || "").trim();
  if (!text) {
    return;
  }

  const width = getPlateWidth(
    text,
    Math.max(18, Math.round(options.min_width || 18)),
    Math.max(18, Math.round(options.max_width || 64))
  );
  const height = Math.max(16, Math.round(options.height || 18));
  const rect = {
    x: Math.round(options.x || 0),
    y: Math.round(options.y || 0),
    width,
    height
  };
  const fill = options.fill || "#111827";
  const textColor = options.text_color || "#ffffff";

  await drawFilledRect(image, rect, fill, typeof options.opacity === "number" ? options.opacity : 0.92);
  if (options.border) {
    await drawRectBorder(image, rect, options.border, options.border_thickness || 1);
  }

  image.print({
    font: selectFontByHex(fonts, textColor),
    x: Math.max(rect.x + 2, rect.x + Math.round((rect.width - ((text.length * 8) + 2)) / 2)),
    y: rect.y + Math.max(0, Math.round((rect.height - 16) / 2)),
    text,
    maxWidth: Math.max(1, rect.width - 4),
    maxHeight: rect.height
  });
}

async function renderGridLines(image, map, metrics) {
  const stroke = parseHexColor("#000000", 0.18);

  for (let x = 0; x <= map.grid.width; x += 1) {
    const position = Math.round(metrics.grid_origin_x + (x * metrics.tile_width_px));
    const line = await createCanvas(1, metrics.height_px, stroke);
    image.composite(line, position, 0);
  }

  for (let y = 0; y <= map.grid.height; y += 1) {
    const position = Math.round(metrics.grid_origin_y + (y * metrics.tile_height_px));
    const line = await createCanvas(metrics.width_px, 1, stroke);
    image.composite(line, 0, position);
  }
}

async function drawLineSegment(image, startX, startY, endX, endY, hex, opacity, thickness) {
  const safeThickness = Math.max(1, Math.round(thickness || 2));
  const steps = Math.max(Math.abs(endX - startX), Math.abs(endY - startY), 1);
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(startX + (((endX - startX) * step) / steps));
    const y = Math.round(startY + (((endY - startY) * step) / steps));
    await drawFilledRect(image, {
      x: x - Math.floor(safeThickness / 2),
      y: y - Math.floor(safeThickness / 2),
      width: safeThickness,
      height: safeThickness
    }, hex, opacity);
  }
}

async function drawSelectionMarkerEmblem(image, rect, icon, stroke) {
  const left = rect.x + 8;
  const right = rect.x + rect.width - 8;
  const top = rect.y + 8;
  const bottom = rect.y + rect.height - 8;
  const centerX = rect.x + Math.round(rect.width / 2);
  const centerY = rect.y + Math.round(rect.height / 2);

  if (icon === "exit") {
    await drawLineSegment(image, left, top + 4, centerX + 4, centerY, stroke, 1, 3);
    await drawLineSegment(image, left, bottom - 4, centerX + 4, centerY, stroke, 1, 3);
    await drawLineSegment(image, centerX + 2, centerY, right - 2, centerY, stroke, 1, 3);
    return;
  }

  if (icon === "door") {
    await drawLineSegment(image, centerX - 4, top, centerX - 4, bottom, stroke, 1, 3);
    await drawLineSegment(image, centerX + 4, top + 4, centerX + 4, bottom - 4, stroke, 1, 2);
    await drawFilledRect(image, { x: centerX + 7, y: centerY - 2, width: 4, height: 4 }, stroke, 1);
    return;
  }

  if (icon === "chest") {
    const box = {
      x: centerX - 12,
      y: centerY - 9,
      width: 24,
      height: 18
    };
    await drawRectBorder(image, box, stroke, 2);
    await drawLineSegment(image, box.x, box.y + 6, box.x + box.width, box.y + 6, stroke, 1, 2);
    await drawFilledRect(image, { x: centerX - 2, y: centerY - 1, width: 4, height: 6 }, stroke, 1);
    return;
  }

  if (icon === "trap") {
    await drawLineSegment(image, centerX, top, left + 2, bottom, stroke, 1, 3);
    await drawLineSegment(image, centerX, top, right - 2, bottom, stroke, 1, 3);
    await drawLineSegment(image, left + 2, bottom, right - 2, bottom, stroke, 1, 3);
    await drawFilledRect(image, { x: centerX - 2, y: centerY - 2, width: 4, height: 8 }, stroke, 1);
    return;
  }

  if (icon === "shrine") {
    await drawLineSegment(image, centerX, top, left + 4, centerY, stroke, 1, 3);
    await drawLineSegment(image, left + 4, centerY, centerX, bottom, stroke, 1, 3);
    await drawLineSegment(image, centerX, bottom, right - 4, centerY, stroke, 1, 3);
    await drawLineSegment(image, right - 4, centerY, centerX, top, stroke, 1, 3);
    await drawFilledRect(image, { x: centerX - 3, y: centerY - 3, width: 6, height: 6 }, stroke, 1);
    return;
  }

  if (icon === "lore") {
    await drawRectBorder(image, { x: centerX - 12, y: centerY - 10, width: 24, height: 20 }, stroke, 2);
    await drawLineSegment(image, centerX, centerY - 10, centerX, centerY + 10, stroke, 1, 2);
    await drawLineSegment(image, centerX - 8, centerY - 4, centerX - 2, centerY - 4, stroke, 1, 2);
    await drawLineSegment(image, centerX + 2, centerY - 4, centerX + 8, centerY - 4, stroke, 1, 2);
    return;
  }

  if (icon === "lever") {
    await drawLineSegment(image, centerX - 5, bottom, centerX - 5, centerY - 2, stroke, 1, 3);
    await drawLineSegment(image, centerX - 5, centerY - 2, centerX + 7, centerY - 10, stroke, 1, 3);
    await drawFilledRect(image, { x: centerX + 6, y: centerY - 12, width: 6, height: 6 }, stroke, 1);
    await drawLineSegment(image, centerX - 12, bottom, centerX + 2, bottom, stroke, 1, 3);
    return;
  }

  if (icon === "object") {
    await drawRectBorder(image, { x: centerX - 10, y: centerY - 10, width: 20, height: 20 }, stroke, 2);
    await drawFilledRect(image, { x: centerX - 3, y: centerY - 3, width: 6, height: 6 }, stroke, 1);
    return;
  }

  if (icon === "encounter") {
    await drawLineSegment(image, centerX, top, left + 4, centerY, stroke, 1, 3);
    await drawLineSegment(image, left + 4, centerY, centerX, bottom, stroke, 1, 3);
    await drawLineSegment(image, centerX, bottom, right - 4, centerY, stroke, 1, 3);
    await drawLineSegment(image, right - 4, centerY, centerX, top, stroke, 1, 3);
    await drawLineSegment(image, centerX, top + 7, centerX, centerY + 2, stroke, 1, 3);
    await drawFilledRect(image, { x: centerX - 2, y: centerY + 6, width: 4, height: 4 }, stroke, 1);
    return;
  }

  if (icon === "path") {
    await drawFilledRect(image, { x: left + 2, y: centerY - 3, width: 6, height: 6 }, stroke, 0.95);
    await drawFilledRect(image, { x: centerX - 3, y: centerY - 3, width: 6, height: 6 }, stroke, 0.95);
    await drawFilledRect(image, { x: right - 8, y: centerY - 3, width: 6, height: 6 }, stroke, 0.95);
  }
}

async function renderTerrainSemantics(image, map, metrics) {
  const tiles = buildTerrainVisualTiles(map);

  for (const tile of tiles) {
    const rect = tileRect(metrics, tile);
    const inset = Math.max(4, Math.round(Math.min(rect.width, rect.height) * 0.12));
    const innerRect = {
      x: rect.x + inset,
      y: rect.y + inset,
      width: Math.max(6, rect.width - (inset * 2)),
      height: Math.max(6, rect.height - (inset * 2))
    };
    const centerX = rect.x + Math.round(rect.width / 2);
    const centerY = rect.y + Math.round(rect.height / 2);

    if (Number.isFinite(Number(tile.movement_cost)) && Number(tile.movement_cost) > 1 && tile.blocks_movement !== true) {
      await drawFilledRect(image, innerRect, "#8c6a35", 0.14);
      await drawLineSegment(image, innerRect.x + 3, innerRect.y + innerRect.height - 4, innerRect.x + Math.round(innerRect.width * 0.45), innerRect.y + 4, "#8c6a35", 0.46, 2);
      await drawLineSegment(image, innerRect.x + Math.round(innerRect.width * 0.3), innerRect.y + innerRect.height - 4, innerRect.x + Math.round(innerRect.width * 0.75), innerRect.y + 4, "#8c6a35", 0.46, 2);
      await drawLineSegment(image, innerRect.x + Math.round(innerRect.width * 0.6), innerRect.y + innerRect.height - 4, innerRect.x + innerRect.width - 3, innerRect.y + 4, "#8c6a35", 0.46, 2);
    }

    if (tile.blocks_movement === true) {
      await drawFilledRect(image, innerRect, "#0f172a", 0.12);
      await drawRectBorder(image, innerRect, "#0f172a", 2);
    }

    if (tile.blocks_sight === true) {
      await drawLineSegment(image, innerRect.x + 4, centerY, innerRect.x + innerRect.width - 4, centerY, "#334155", 0.72, 3);
    }

    if (tile.is_hazard === true) {
      const hazardRect = {
        x: innerRect.x + Math.round(innerRect.width * 0.22),
        y: innerRect.y + Math.round(innerRect.height * 0.22),
        width: Math.max(8, Math.round(innerRect.width * 0.56)),
        height: Math.max(8, Math.round(innerRect.height * 0.56))
      };
      await drawRectBorder(image, hazardRect, "#ff9f0a", 2);
      await drawFilledRect(image, {
        x: centerX - 4,
        y: centerY - 4,
        width: 8,
        height: 8
      }, "#ff9f0a", 0.88);
    }

    if (tile.cover_level) {
      await drawFilledRect(image, {
        x: rect.x + rect.width - 18,
        y: rect.y + rect.height - 18,
        width: 14,
        height: 14
      }, "#2563eb", 0.82);
    }
  }
}

async function renderFilledOverlays(image, map, metrics) {
  for (const overlay of (map.overlays || []).filter((entry) => entry.kind !== OVERLAY_KINDS.SELECTION)) {
    const fill = overlay.color || "#34c759";
    const opacity = typeof overlay.opacity === "number" ? overlay.opacity : 0.3;

    for (const tile of overlay.tiles || []) {
      await drawFilledRect(image, tileRect(metrics, tile), fill, opacity);
    }
  }
}

async function renderSelectionOverlays(image, map, metrics, fonts) {
  for (const overlay of (map.overlays || []).filter((entry) => entry.kind === OVERLAY_KINDS.SELECTION)) {
    const stroke = overlay.color || "#ffd60a";

    for (const tile of overlay.tiles || []) {
      const rect = tileRect(metrics, tile);
      const inset = 5;
      const selectionRect = {
        x: rect.x + inset,
        y: rect.y + inset,
        width: Math.max(1, rect.width - (inset * 2)),
        height: Math.max(1, rect.height - (inset * 2))
      };
      const visual = getSelectionMarkerVisual(tile.marker_style || (overlay.metadata && overlay.metadata.marker_style));

      await drawFilledRect(
        image,
        selectionRect,
        stroke,
        typeof overlay.opacity === "number" ? overlay.opacity : visual.fill_opacity
      );
      await drawRectBorder(image, selectionRect, stroke, visual.border_thickness);

      if (visual.style === "target") {
        const centerX = selectionRect.x + Math.round(selectionRect.width / 2);
        const centerY = selectionRect.y + Math.round(selectionRect.height / 2);
        await drawLineSegment(image, centerX, selectionRect.y + 8, centerX, selectionRect.y + 22, stroke, 1, 3);
        await drawLineSegment(image, centerX, selectionRect.y + selectionRect.height - 8, centerX, selectionRect.y + selectionRect.height - 22, stroke, 1, 3);
        await drawLineSegment(image, selectionRect.x + 8, centerY, selectionRect.x + 22, centerY, stroke, 1, 3);
        await drawLineSegment(image, selectionRect.x + selectionRect.width - 8, centerY, selectionRect.x + selectionRect.width - 22, centerY, stroke, 1, 3);
      } else {
        await drawSelectionMarkerEmblem(image, selectionRect, visual.icon, stroke);
      }

      if (visual.show_badge !== false && tile.label) {
        const badgeWidth = getPlateWidth(tile.label, 22, Math.max(22, selectionRect.width - 12));
        await drawTextPlate(image, fonts, {
          x: selectionRect.x + selectionRect.width - badgeWidth - 4,
          y: selectionRect.y + 4,
          text: tile.label,
          fill: stroke,
          text_color: "#111111",
          min_width: 22,
          max_width: Math.max(22, selectionRect.width - 12),
          height: 18
        });
      }
    }
  }
}

async function renderDebugOverlays(image, map, metrics, fonts) {
  const debugFlags = normalizeDebugFlags(map && map.render_debug);
  const terrainTiles = buildTerrainVisualTiles(map);

  if (debugFlags.coords === true) {
    for (let y = 0; y < map.grid.height; y += 1) {
      for (let x = 0; x < map.grid.width; x += 1) {
        const rect = tileRect(metrics, { x, y });
        await drawTextPlate(image, fonts, {
          x: rect.x + 4,
          y: rect.y + 4,
          text: `${x},${y}`,
          fill: "#0f172a",
          text_color: "#ffffff",
          min_width: 22,
          max_width: Math.max(22, rect.width - 8),
          height: 16,
          opacity: 0.8
        });
      }
    }
  }

  if (debugFlags.terrain === true) {
    for (const tile of terrainTiles) {
      const label = buildTerrainDebugLabel(tile);
      if (!label) {
        continue;
      }
      const rect = tileRect(metrics, tile);
      await drawTextPlate(image, fonts, {
        x: rect.x + 4,
        y: rect.y + rect.height - 20,
        text: label,
        fill: "#7c3aed",
        text_color: "#ffffff",
        min_width: 26,
        max_width: Math.max(26, rect.width - 8),
        height: 16,
        opacity: 0.84
      });
    }
  }

  if (debugFlags.markers === true) {
    for (const entry of buildMarkerDebugEntries(map)) {
      const rect = tileRect(metrics, entry);
      const plateWidth = getPlateWidth(entry.label, 34, Math.max(34, rect.width - 8));
      await drawTextPlate(image, fonts, {
        x: rect.x + rect.width - plateWidth - 4,
        y: rect.y + 4,
        text: entry.label,
        fill: "#0f766e",
        text_color: "#ffffff",
        min_width: 34,
        max_width: Math.max(34, rect.width - 8),
        height: 16,
        opacity: 0.9
      });
    }
  }

  if (debugFlags.cover === true) {
    for (const tile of terrainTiles) {
      const label = getCoverDebugLabel(tile.cover_level);
      if (!label) {
        continue;
      }
      const rect = tileRect(metrics, tile);
      await drawTextPlate(image, fonts, {
        x: rect.x + rect.width - 28,
        y: rect.y + rect.height - 20,
        text: label,
        fill: "#2563eb",
        text_color: "#ffffff",
        min_width: 22,
        max_width: 28,
        height: 16,
        opacity: 0.9
      });
    }
  }

  if (debugFlags.walls === true) {
    for (const segment of buildEdgeWallVisuals(map)) {
      const startX = Math.round(metrics.grid_origin_x + (segment.start.x * metrics.tile_width_px));
      const startY = Math.round(metrics.grid_origin_y + (segment.start.y * metrics.tile_height_px));
      const endX = Math.round(metrics.grid_origin_x + (segment.end.x * metrics.tile_width_px));
      const endY = Math.round(metrics.grid_origin_y + (segment.end.y * metrics.tile_height_px));
      await drawLineSegment(
        image,
        startX,
        startY,
        endX,
        endY,
        segment.blocks_sight === true ? "#06b6d4" : "#fb7185",
        1,
        4
      );
    }
  }
}

async function buildCircularTokenImage(assetPath, tokenSize, ringHex) {
  const source = await Jimp.read(assetPath);
  source.cover({ w: tokenSize - 6, h: tokenSize - 6 });
  source.circle();

  const framed = await createCanvas(tokenSize, tokenSize, 0x00000000);
  const ring = await createCanvas(tokenSize, tokenSize, parseHexColor(ringHex, 1));
  ring.circle();
  framed.composite(ring, 0, 0);
  framed.composite(source, 3, 3);
  return framed;
}

async function renderTokens(image, map, metrics, fonts) {
  for (const token of (map.tokens || [])) {
    const visualProfile = buildTokenVisualProfile(token);
    const x = metrics.grid_origin_x + (token.position.x * metrics.tile_width_px);
    const y = metrics.grid_origin_y + (token.position.y * metrics.tile_height_px);
    const insetRatio = visualProfile.asset_path ? 0.04 : 0.1;
    const baseTileSize = Math.min(metrics.tile_width_px, metrics.tile_height_px);
    const inset = Math.round(baseTileSize * insetRatio);
    const tokenSize = Math.max(1, Math.round(baseTileSize - (inset * 2)));
    const fill = visualProfile.color || (token.token_type === "enemy" ? "#c62828" : "#1e88e5");
    const borderColor = visualProfile.border_color || "#ffffff";
    const imageBorderColor = visualProfile.image_border_color || "#d4af37";
    const badgeColor = visualProfile.badge_color || "#4aa3ff";
    const badgeText = visualProfile.badge_text ? String(visualProfile.badge_text) : "";
    const badgeTextColor = visualProfile.badge_text_color || "#ffffff";
    const label = visualProfile.label ? String(visualProfile.label) : "";
    const labelPlateColor = visualProfile.label_plate_color || "#111827";
    const labelTextColor = visualProfile.label_text_color || "#ffffff";
    const activeOutlineColor = visualProfile.active_tile_color || "";
    const tokenX = Math.round(x + ((metrics.tile_width_px - tokenSize) / 2));
    const tokenY = Math.round(y + ((metrics.tile_height_px - tokenSize) / 2));
    const resolvedAssetPath = visualProfile.asset_path
      ? path.resolve(process.cwd(), resolveAssetPath(visualProfile.asset_path))
      : "";
    const activeOutlinePadding = 5;
    const topBadgeWidth = getPlateWidth(badgeText, 26, Math.max(26, Math.round(metrics.tile_width_px) - 8));

    if (activeOutlineColor) {
      if (visualProfile.shape === "square") {
        const outlineRect = {
          x: Math.round(tokenX - activeOutlinePadding),
          y: Math.round(tokenY - activeOutlinePadding),
          width: Math.round(tokenSize + (activeOutlinePadding * 2)),
          height: Math.round(tokenSize + (activeOutlinePadding * 2))
        };
        await drawRectBorder(image, outlineRect, activeOutlineColor, 3);
      } else {
        const outlineSize = tokenSize + (activeOutlinePadding * 2);
        const outline = await createCanvas(outlineSize, outlineSize, parseHexColor(activeOutlineColor, 1));
        outline.circle();
        image.composite(outline, tokenX - activeOutlinePadding, tokenY - activeOutlinePadding);
      }
    }

    if (fileExists(resolvedAssetPath)) {
      const tokenImage = await buildCircularTokenImage(resolvedAssetPath, tokenSize, imageBorderColor);
      image.composite(tokenImage, tokenX, tokenY);
    } else {
      const fallback = await createCanvas(tokenSize, tokenSize, parseHexColor(fill, 0.92));
      fallback.circle();
      image.composite(fallback, tokenX, tokenY);
      const border = await createCanvas(tokenSize, tokenSize, parseHexColor(borderColor, 1));
      border.circle();
      border.composite(fallback, 3, 3);
      image.composite(border, tokenX, tokenY);
    }

    if (badgeText) {
      await drawTextPlate(image, fonts, {
        x: Math.round(x + ((metrics.tile_width_px - topBadgeWidth) / 2)),
        y: Math.round(y + 2),
        text: badgeText,
        fill: badgeColor,
        text_color: badgeTextColor,
        min_width: 26,
        max_width: Math.max(26, Math.round(metrics.tile_width_px) - 8),
        height: 18
      });
    }

    if (label) {
      const plateWidth = getPlateWidth(label, 20, Math.max(20, Math.round(metrics.tile_width_px) - 8));
      await drawTextPlate(image, fonts, {
        x: Math.round(x + ((metrics.tile_width_px - plateWidth) / 2)),
        y: Math.round(y + metrics.tile_height_px - 22),
        text: label,
        fill: labelPlateColor,
        text_color: labelTextColor,
        min_width: 20,
        max_width: Math.max(20, Math.round(metrics.tile_width_px) - 8),
        height: 18
      });
    }
  }
}

async function renderMapPng(mapState, options) {
  assertValidMapState(mapState);
  const map = mapState;
  const metrics = getRenderMetrics(map);
  const outputPath = options && options.output_path
    ? path.resolve(options.output_path)
    : path.resolve(process.cwd(), "apps/map-system/output/map.snapshot.png");
  const fonts = await loadFonts();
  const canvas = fileExists(metrics.base_image_path)
    ? await Jimp.read(metrics.base_image_path)
    : await createCanvas(metrics.width_px, metrics.height_px, 0xf2f2f2ff);

  if (canvas.bitmap.width !== metrics.width_px || canvas.bitmap.height !== metrics.height_px) {
    canvas.resize({ w: metrics.width_px, h: metrics.height_px });
  }

  await renderTerrainSemantics(canvas, map, metrics);
  await renderFilledOverlays(canvas, map, metrics);

  const shouldShowGrid = options && options.show_grid === false
    ? false
    : !(map.asset && map.asset.has_embedded_grid === true);
  if (shouldShowGrid) {
    await renderGridLines(canvas, map, metrics);
  }

  await renderTokens(canvas, map, metrics, fonts);
  await renderSelectionOverlays(canvas, map, metrics, fonts);
  await renderDebugOverlays(canvas, map, metrics, fonts);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await canvas.write(outputPath);
  return outputPath;
}

module.exports = {
  renderMapPng
};
