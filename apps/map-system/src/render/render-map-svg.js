"use strict";

const fs = require("fs");
const path = require("path");
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

function readSvgDimensions(absolutePath) {
  const raw = fs.readFileSync(absolutePath, "utf8");
  const widthMatch = raw.match(/\bwidth=["']([\d.]+)(?:px)?["']/i);
  const heightMatch = raw.match(/\bheight=["']([\d.]+)(?:px)?["']/i);
  if (!widthMatch || !heightMatch) {
    return null;
  }

  return {
    width: Number(widthMatch[1]),
    height: Number(heightMatch[1])
  };
}

function readImageDimensions(absolutePath) {
  const extension = path.extname(absolutePath).toLowerCase();
  if (extension === ".png") {
    return readPngDimensions(absolutePath);
  }

  if (extension === ".svg") {
    return readSvgDimensions(absolutePath);
  }

  return null;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getRenderMetrics(map, outputPath) {
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
  const tileWidthPx = gridWidthPx / map.grid.width;
  const tileHeightPx = gridHeightPx / map.grid.height;
  const baseImagePath = map.asset && map.asset.base_image_path
    ? toSvgHref(map.asset.base_image_path, outputPath)
    : "";

  return {
    width_px: widthPx,
    height_px: heightPx,
    tile_width_px: tileWidthPx,
    tile_height_px: tileHeightPx,
    grid_origin_x: gridOriginX,
    grid_origin_y: gridOriginY,
    base_image_path: baseImagePath
  };
}

function renderGridLines(map, metrics) {
  const lines = [];
  const widthPx = metrics.width_px;
  const heightPx = metrics.height_px;

  for (let x = 0; x <= map.grid.width; x += 1) {
    const position = metrics.grid_origin_x + (x * metrics.tile_width_px);
    lines.push(
      `<line x1="${position}" y1="0" x2="${position}" y2="${heightPx}" stroke="rgba(0,0,0,0.18)" stroke-width="1" />`
    );
  }

  for (let y = 0; y <= map.grid.height; y += 1) {
    const position = metrics.grid_origin_y + (y * metrics.tile_height_px);
    lines.push(
      `<line x1="0" y1="${position}" x2="${widthPx}" y2="${position}" stroke="rgba(0,0,0,0.18)" stroke-width="1" />`
    );
  }

  return lines.join("\n");
}

function renderTerrainSemantics(map, metrics) {
  return buildTerrainVisualTiles(map)
    .map((tile) => {
      const x = metrics.grid_origin_x + (tile.x * metrics.tile_width_px);
      const y = metrics.grid_origin_y + (tile.y * metrics.tile_height_px);
      const inset = Math.max(4, Math.round(Math.min(metrics.tile_width_px, metrics.tile_height_px) * 0.12));
      const innerX = x + inset;
      const innerY = y + inset;
      const innerWidth = Math.max(6, metrics.tile_width_px - (inset * 2));
      const innerHeight = Math.max(6, metrics.tile_height_px - (inset * 2));
      const centerX = x + (metrics.tile_width_px / 2);
      const centerY = y + (metrics.tile_height_px / 2);
      const parts = [];

      if (Number.isFinite(Number(tile.movement_cost)) && Number(tile.movement_cost) > 1 && tile.blocks_movement !== true) {
        parts.push(`<rect x="${innerX}" y="${innerY}" width="${innerWidth}" height="${innerHeight}" rx="10" ry="10" fill="#8c6a35" fill-opacity="0.14" />`);
        parts.push(`<line x1="${innerX + 3}" y1="${innerY + innerHeight - 4}" x2="${innerX + (innerWidth * 0.45)}" y2="${innerY + 4}" stroke="#8c6a35" stroke-opacity="0.45" stroke-width="2" stroke-linecap="round" />`);
        parts.push(`<line x1="${innerX + (innerWidth * 0.3)}" y1="${innerY + innerHeight - 4}" x2="${innerX + (innerWidth * 0.75)}" y2="${innerY + 4}" stroke="#8c6a35" stroke-opacity="0.45" stroke-width="2" stroke-linecap="round" />`);
        parts.push(`<line x1="${innerX + (innerWidth * 0.6)}" y1="${innerY + innerHeight - 4}" x2="${innerX + innerWidth - 3}" y2="${innerY + 4}" stroke="#8c6a35" stroke-opacity="0.45" stroke-width="2" stroke-linecap="round" />`);
      }

      if (tile.blocks_movement === true) {
        parts.push(`<rect x="${innerX}" y="${innerY}" width="${innerWidth}" height="${innerHeight}" rx="10" ry="10" fill="#0f172a" fill-opacity="0.12" stroke="#0f172a" stroke-opacity="0.58" stroke-width="2" />`);
      }

      if (tile.blocks_sight === true) {
        parts.push(`<line x1="${innerX + 4}" y1="${centerY}" x2="${innerX + innerWidth - 4}" y2="${centerY}" stroke="#334155" stroke-opacity="0.72" stroke-width="3" stroke-linecap="round" />`);
      }

      if (tile.is_hazard === true) {
        parts.push(`<rect x="${innerX + (innerWidth * 0.22)}" y="${innerY + (innerHeight * 0.22)}" width="${innerWidth * 0.56}" height="${innerHeight * 0.56}" rx="8" ry="8" fill="none" stroke="#ff9f0a" stroke-opacity="0.85" stroke-width="2" />`);
        parts.push(`<rect x="${centerX - 4}" y="${centerY - 4}" width="8" height="8" rx="2" ry="2" fill="#ff9f0a" fill-opacity="0.88" />`);
      }

      if (tile.cover_level) {
        parts.push(`<rect x="${x + metrics.tile_width_px - 18}" y="${y + metrics.tile_height_px - 18}" width="14" height="14" rx="4" ry="4" fill="#2563eb" fill-opacity="0.82" />`);
      }

      return parts.join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

function renderSelectionMarkerEmblem(rect, icon, stroke) {
  const left = rect.x + 8;
  const right = rect.x + rect.width - 8;
  const top = rect.y + 8;
  const bottom = rect.y + rect.height - 8;
  const centerX = rect.x + (rect.width / 2);
  const centerY = rect.y + (rect.height / 2);

  if (icon === "exit") {
    return [
      `<line x1="${left}" y1="${top + 4}" x2="${centerX + 4}" y2="${centerY}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
      `<line x1="${left}" y1="${bottom - 4}" x2="${centerX + 4}" y2="${centerY}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
      `<line x1="${centerX + 2}" y1="${centerY}" x2="${right - 2}" y2="${centerY}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`
    ].join("\n");
  }

  if (icon === "door") {
    return [
      `<line x1="${centerX - 4}" y1="${top}" x2="${centerX - 4}" y2="${bottom}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
      `<line x1="${centerX + 4}" y1="${top + 4}" x2="${centerX + 4}" y2="${bottom - 4}" stroke="${escapeXml(stroke)}" stroke-width="2" stroke-linecap="round" />`,
      `<rect x="${centerX + 7}" y="${centerY - 2}" width="4" height="4" rx="1" ry="1" fill="${escapeXml(stroke)}" />`
    ].join("\n");
  }

  if (icon === "chest") {
    return [
      `<rect x="${centerX - 12}" y="${centerY - 9}" width="24" height="18" rx="4" ry="4" fill="none" stroke="${escapeXml(stroke)}" stroke-width="2" />`,
      `<line x1="${centerX - 12}" y1="${centerY - 3}" x2="${centerX + 12}" y2="${centerY - 3}" stroke="${escapeXml(stroke)}" stroke-width="2" stroke-linecap="round" />`,
      `<rect x="${centerX - 2}" y="${centerY - 1}" width="4" height="6" rx="1" ry="1" fill="${escapeXml(stroke)}" />`
    ].join("\n");
  }

  if (icon === "trap") {
    return [
      `<line x1="${centerX}" y1="${top}" x2="${left + 2}" y2="${bottom}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
      `<line x1="${centerX}" y1="${top}" x2="${right - 2}" y2="${bottom}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
      `<line x1="${left + 2}" y1="${bottom}" x2="${right - 2}" y2="${bottom}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
      `<rect x="${centerX - 2}" y="${centerY - 2}" width="4" height="8" rx="1" ry="1" fill="${escapeXml(stroke)}" />`
    ].join("\n");
  }

  if (icon === "shrine") {
    return [
      `<line x1="${centerX}" y1="${top}" x2="${left + 4}" y2="${centerY}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
      `<line x1="${left + 4}" y1="${centerY}" x2="${centerX}" y2="${bottom}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
      `<line x1="${centerX}" y1="${bottom}" x2="${right - 4}" y2="${centerY}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
      `<line x1="${right - 4}" y1="${centerY}" x2="${centerX}" y2="${top}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
      `<rect x="${centerX - 3}" y="${centerY - 3}" width="6" height="6" rx="2" ry="2" fill="${escapeXml(stroke)}" />`
    ].join("\n");
  }

  if (icon === "lore") {
    return [
      `<rect x="${centerX - 12}" y="${centerY - 10}" width="24" height="20" rx="4" ry="4" fill="none" stroke="${escapeXml(stroke)}" stroke-width="2" />`,
      `<line x1="${centerX}" y1="${centerY - 10}" x2="${centerX}" y2="${centerY + 10}" stroke="${escapeXml(stroke)}" stroke-width="2" stroke-linecap="round" />`,
      `<line x1="${centerX - 8}" y1="${centerY - 4}" x2="${centerX - 2}" y2="${centerY - 4}" stroke="${escapeXml(stroke)}" stroke-width="2" stroke-linecap="round" />`,
      `<line x1="${centerX + 2}" y1="${centerY - 4}" x2="${centerX + 8}" y2="${centerY - 4}" stroke="${escapeXml(stroke)}" stroke-width="2" stroke-linecap="round" />`
    ].join("\n");
  }

  if (icon === "lever") {
    return [
      `<line x1="${centerX - 5}" y1="${bottom}" x2="${centerX - 5}" y2="${centerY - 2}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
      `<line x1="${centerX - 5}" y1="${centerY - 2}" x2="${centerX + 7}" y2="${centerY - 10}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
      `<rect x="${centerX + 6}" y="${centerY - 12}" width="6" height="6" rx="2" ry="2" fill="${escapeXml(stroke)}" />`,
      `<line x1="${centerX - 12}" y1="${bottom}" x2="${centerX + 2}" y2="${bottom}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`
    ].join("\n");
  }

  if (icon === "object") {
    return [
      `<rect x="${centerX - 10}" y="${centerY - 10}" width="20" height="20" rx="4" ry="4" fill="none" stroke="${escapeXml(stroke)}" stroke-width="2" />`,
      `<rect x="${centerX - 3}" y="${centerY - 3}" width="6" height="6" rx="2" ry="2" fill="${escapeXml(stroke)}" />`
    ].join("\n");
  }

  if (icon === "encounter") {
    return [
      `<line x1="${centerX}" y1="${top}" x2="${left + 4}" y2="${centerY}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
      `<line x1="${left + 4}" y1="${centerY}" x2="${centerX}" y2="${bottom}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
      `<line x1="${centerX}" y1="${bottom}" x2="${right - 4}" y2="${centerY}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
      `<line x1="${right - 4}" y1="${centerY}" x2="${centerX}" y2="${top}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
      `<line x1="${centerX}" y1="${top + 7}" x2="${centerX}" y2="${centerY + 2}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
      `<rect x="${centerX - 2}" y="${centerY + 6}" width="4" height="4" rx="1" ry="1" fill="${escapeXml(stroke)}" />`
    ].join("\n");
  }

  if (icon === "path") {
    return [
      `<rect x="${left + 2}" y="${centerY - 3}" width="6" height="6" rx="2" ry="2" fill="${escapeXml(stroke)}" fill-opacity="0.95" />`,
      `<rect x="${centerX - 3}" y="${centerY - 3}" width="6" height="6" rx="2" ry="2" fill="${escapeXml(stroke)}" fill-opacity="0.95" />`,
      `<rect x="${right - 8}" y="${centerY - 3}" width="6" height="6" rx="2" ry="2" fill="${escapeXml(stroke)}" fill-opacity="0.95" />`
    ].join("\n");
  }

  return "";
}

function renderDebugOverlays(map, metrics) {
  const debugFlags = normalizeDebugFlags(map && map.render_debug);
  const pieces = [];
  const terrainTiles = buildTerrainVisualTiles(map);

  if (debugFlags.coords === true) {
    for (let y = 0; y < map.grid.height; y += 1) {
      for (let x = 0; x < map.grid.width; x += 1) {
        const px = metrics.grid_origin_x + (x * metrics.tile_width_px) + 4;
        const py = metrics.grid_origin_y + (y * metrics.tile_height_px) + 4;
        pieces.push(renderTextPlate({
          x: px,
          y: py,
          text: `${x},${y}`,
          fill: "#0f172a",
          text_color: "#ffffff",
          min_width: 22,
          max_width: Math.max(22, metrics.tile_width_px - 8),
          height: 16,
          opacity: 0.8
        }));
      }
    }
  }

  if (debugFlags.terrain === true) {
    terrainTiles.forEach((tile) => {
      const label = buildTerrainDebugLabel(tile);
      if (!label) {
        return;
      }
      const x = metrics.grid_origin_x + (tile.x * metrics.tile_width_px) + 4;
      const y = metrics.grid_origin_y + ((tile.y + 1) * metrics.tile_height_px) - 20;
      pieces.push(renderTextPlate({
        x,
        y,
        text: label,
        fill: "#7c3aed",
        text_color: "#ffffff",
        min_width: 26,
        max_width: Math.max(26, metrics.tile_width_px - 8),
        height: 16,
        opacity: 0.84
      }));
    });
  }

  if (debugFlags.markers === true) {
    buildMarkerDebugEntries(map).forEach((entry) => {
      const x = metrics.grid_origin_x + ((entry.x + 1) * metrics.tile_width_px) - getPlateWidth(entry.label, 34, Math.max(34, metrics.tile_width_px - 8)) - 4;
      const y = metrics.grid_origin_y + (entry.y * metrics.tile_height_px) + 4;
      pieces.push(renderTextPlate({
        x,
        y,
        text: entry.label,
        fill: "#0f766e",
        text_color: "#ffffff",
        min_width: 34,
        max_width: Math.max(34, metrics.tile_width_px - 8),
        height: 16,
        opacity: 0.9
      }));
    });
  }

  if (debugFlags.cover === true) {
    terrainTiles.forEach((tile) => {
      const label = getCoverDebugLabel(tile.cover_level);
      if (!label) {
        return;
      }
      const x = metrics.grid_origin_x + ((tile.x + 1) * metrics.tile_width_px) - 28;
      const y = metrics.grid_origin_y + ((tile.y + 1) * metrics.tile_height_px) - 20;
      pieces.push(renderTextPlate({
        x,
        y,
        text: label,
        fill: "#2563eb",
        text_color: "#ffffff",
        min_width: 22,
        max_width: 28,
        height: 16,
        opacity: 0.9
      }));
    });
  }

  if (debugFlags.walls === true) {
    buildEdgeWallVisuals(map).forEach((segment) => {
      const startX = metrics.grid_origin_x + (segment.start.x * metrics.tile_width_px);
      const startY = metrics.grid_origin_y + (segment.start.y * metrics.tile_height_px);
      const endX = metrics.grid_origin_x + (segment.end.x * metrics.tile_width_px);
      const endY = metrics.grid_origin_y + (segment.end.y * metrics.tile_height_px);
      const stroke = segment.blocks_sight === true ? "#06b6d4" : "#fb7185";
      pieces.push(`<line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}" stroke="${stroke}" stroke-width="4" stroke-linecap="round" />`);
    });
  }

  return pieces.filter(Boolean).join("\n");
}

function renderFilledOverlays(map, metrics) {
  return (map.overlays || [])
    .filter((overlay) => overlay.kind !== OVERLAY_KINDS.SELECTION)
    .map((overlay) => {
    const opacity = typeof overlay.opacity === "number" ? overlay.opacity : 0.3;
    const fill = overlay.color || "#34c759";
    return overlay.tiles.map((tile) => {
      const x = metrics.grid_origin_x + (tile.x * metrics.tile_width_px);
      const y = metrics.grid_origin_y + (tile.y * metrics.tile_height_px);
      return `<rect x="${x}" y="${y}" width="${metrics.tile_width_px}" height="${metrics.tile_height_px}" fill="${escapeXml(fill)}" fill-opacity="${opacity}" />`;
    }).join("\n");
    }).join("\n");
}

function renderSelectionOverlays(map, metrics) {
  return (map.overlays || [])
    .filter((overlay) => overlay.kind === OVERLAY_KINDS.SELECTION)
    .map((overlay) => {
      const stroke = overlay.color || "#ffd60a";
      return (overlay.tiles || []).map((tile) => {
        const x = metrics.grid_origin_x + (tile.x * metrics.tile_width_px);
        const y = metrics.grid_origin_y + (tile.y * metrics.tile_height_px);
        const inset = 5;
        const boxWidth = Math.max(1, metrics.tile_width_px - (inset * 2));
        const boxHeight = Math.max(1, metrics.tile_height_px - (inset * 2));
        const size = Math.min(boxWidth, boxHeight);
        const centerX = x + (metrics.tile_width_px / 2);
        const centerY = y + (metrics.tile_height_px / 2);
        const badgeLabel = tile.label ? escapeXml(tile.label) : "";
        const visual = getSelectionMarkerVisual(tile.marker_style || (overlay.metadata && overlay.metadata.marker_style));
        const fillOpacity = typeof overlay.opacity === "number" ? overlay.opacity : visual.fill_opacity;

        return [
          `<rect x="${x + inset}" y="${y + inset}" width="${boxWidth}" height="${boxHeight}" rx="10" ry="10" fill="${escapeXml(stroke)}" fill-opacity="${fillOpacity}" stroke="${escapeXml(stroke)}" stroke-width="${visual.border_thickness}" />`,
          visual.style === "target"
            ? `<line x1="${centerX}" y1="${y + inset + 8}" x2="${centerX}" y2="${y + inset + 22}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`
            : "",
          visual.style === "target"
            ? `<line x1="${centerX}" y1="${y + metrics.tile_height_px - inset - 8}" x2="${centerX}" y2="${y + metrics.tile_height_px - inset - 22}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`
            : "",
          visual.style === "target"
            ? `<line x1="${x + inset + 8}" y1="${centerY}" x2="${x + inset + 22}" y2="${centerY}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`
            : "",
          visual.style === "target"
            ? `<line x1="${x + metrics.tile_width_px - inset - 8}" y1="${centerY}" x2="${x + metrics.tile_width_px - inset - 22}" y2="${centerY}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`
            : "",
          visual.style === "target"
            ? `<circle cx="${centerX}" cy="${centerY}" r="${Math.round(size / 2.8)}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="3" />`
            : renderSelectionMarkerEmblem({
              x: x + inset,
              y: y + inset,
              width: boxWidth,
              height: boxHeight
            }, visual.icon, stroke),
          (visual.show_badge !== false && badgeLabel)
            ? `<circle cx="${x + metrics.tile_width_px - 14}" cy="${y + 14}" r="12" fill="${escapeXml(stroke)}" />`
            : "",
          (visual.show_badge !== false && badgeLabel)
            ? `<text x="${x + metrics.tile_width_px - 14}" y="${y + 19}" font-family="Verdana, sans-serif" font-size="14" font-weight="bold" text-anchor="middle" fill="#111">${badgeLabel}</text>`
            : ""
        ].join("\n");
      }).join("\n");
    }).join("\n");
}

function getPlateWidth(text, minWidth, maxWidth) {
  const safeText = String(text || "");
  const estimated = 14 + (safeText.length * 10);
  return Math.max(minWidth, Math.min(maxWidth, estimated));
}

function renderTextPlate(options) {
  const text = String(options && options.text || "").trim();
  if (!text) {
    return "";
  }

  const width = getPlateWidth(
    text,
    Math.max(18, Number(options.min_width || 18)),
    Math.max(18, Number(options.max_width || 64))
  );
  const height = Math.max(16, Number(options.height || 18));
  const x = Number(options.x || 0);
  const y = Number(options.y || 0);
  const fill = escapeXml(options.fill || "#111827");
  const textColor = escapeXml(options.text_color || "#ffffff");
  const border = options.border ? escapeXml(options.border) : "";

  return [
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" ry="6" fill="${fill}" fill-opacity="${typeof options.opacity === "number" ? options.opacity : 0.92}"${border ? ` stroke="${border}" stroke-width="${Number(options.border_width || 1)}"` : ""} />`,
    `<text x="${x + (width / 2)}" y="${y + height - 5}" font-family="Verdana, sans-serif" font-size="12" font-weight="bold" text-anchor="middle" fill="${textColor}">${escapeXml(text)}</text>`
  ].join("\n");
}

function renderTokens(map, outputPath, metrics) {
  return (map.tokens || []).map((token) => {
    const visualProfile = buildTokenVisualProfile(token);
    const x = metrics.grid_origin_x + (token.position.x * metrics.tile_width_px);
    const y = metrics.grid_origin_y + (token.position.y * metrics.tile_height_px);
    const insetRatio = visualProfile.asset_path ? 0.04 : 0.1;
    const baseTileSize = Math.min(metrics.tile_width_px, metrics.tile_height_px);
    const inset = Math.round(baseTileSize * insetRatio);
    const tokenSize = Math.max(1, baseTileSize - (inset * 2));
    const fill = visualProfile.color || (token.token_type === "enemy" ? "#c62828" : "#1e88e5");
    const borderColor = visualProfile.border_color || "#ffffff";
    const imageBorderColor = visualProfile.image_border_color || "#d4af37";
    const badgeColor = visualProfile.badge_color || "#4aa3ff";
    const badgeTextColor = visualProfile.badge_text_color || "#ffffff";
    const label = visualProfile.label ? String(visualProfile.label) : "";
    const labelPlateColor = visualProfile.label_plate_color || "#111827";
    const labelTextColor = visualProfile.label_text_color || "#ffffff";
    const badgeText = visualProfile.badge_text ? String(visualProfile.badge_text) : "";
    const activeOutlineColor = visualProfile.active_tile_color || "";
    const tokenShape = visualProfile.shape || "circle";
    const clipId = `token-clip-${escapeXml(token.token_id || `${token.position.x}-${token.position.y}`)}`;
    const centerX = x + (metrics.tile_width_px / 2);
    const centerY = y + (metrics.tile_height_px / 2);
    const tokenX = centerX - (tokenSize / 2);
    const tokenY = centerY - (tokenSize / 2);
    const activeOutlinePadding = 5;
    const activeFrame = activeOutlineColor
      ? (tokenShape === "square"
        ? `<rect x="${tokenX - activeOutlinePadding}" y="${tokenY - activeOutlinePadding}" width="${tokenSize + (activeOutlinePadding * 2)}" height="${tokenSize + (activeOutlinePadding * 2)}" rx="16" ry="16" fill="none" stroke="${escapeXml(activeOutlineColor)}" stroke-width="3" />`
        : `<circle cx="${centerX}" cy="${centerY}" r="${Math.round((tokenSize / 2) + activeOutlinePadding)}" fill="none" stroke="${escapeXml(activeOutlineColor)}" stroke-width="4" />`)
      : "";
    const topBadgeWidth = getPlateWidth(badgeText, 26, Math.max(26, metrics.tile_width_px - 8));
    const topBadge = badgeText
      ? renderTextPlate({
          x: x + ((metrics.tile_width_px - topBadgeWidth) / 2),
          y: y + 2,
          text: badgeText,
          fill: badgeColor,
          text_color: badgeTextColor,
          min_width: 26,
          max_width: Math.max(26, metrics.tile_width_px - 8),
          height: 18
        })
      : "";
    const labelPlateWidth = getPlateWidth(label, 20, Math.max(20, metrics.tile_width_px - 8));
    const labelPlate = label
      ? renderTextPlate({
          x: x + ((metrics.tile_width_px - labelPlateWidth) / 2),
          y: y + metrics.tile_height_px - 22,
          text: label,
          fill: labelPlateColor,
          text_color: labelTextColor,
          min_width: 20,
          max_width: Math.max(20, metrics.tile_width_px - 8),
          height: 18
        })
      : "";

    if (visualProfile.asset_path) {
      const tokenAssetPath = toSvgHref(visualProfile.asset_path, outputPath);
      const clipPath = tokenShape === "square"
        ? `<clipPath id="${clipId}"><rect x="${tokenX}" y="${tokenY}" width="${tokenSize}" height="${tokenSize}" rx="12" ry="12" /></clipPath>`
        : `<clipPath id="${clipId}"><circle cx="${centerX}" cy="${centerY}" r="${Math.round(tokenSize / 2)}" /></clipPath>`;

      return [
        `<defs>${clipPath}</defs>`,
        activeFrame,
        tokenShape === "square"
          ? `<rect x="${tokenX}" y="${tokenY}" width="${tokenSize}" height="${tokenSize}" rx="12" ry="12" fill="none" stroke="${imageBorderColor}" stroke-width="3" />`
          : `<circle cx="${centerX}" cy="${centerY}" r="${Math.round(tokenSize / 2)}" fill="none" stroke="${imageBorderColor}" stroke-width="3" />`,
        `<image href="${escapeXml(tokenAssetPath)}" x="${tokenX}" y="${tokenY}" width="${tokenSize}" height="${tokenSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" />`,
        topBadge,
        labelPlate
      ].join("\n");
    }

    if (tokenShape === "square") {
      return [
        activeFrame,
        `<rect x="${tokenX}" y="${tokenY}" width="${tokenSize}" height="${tokenSize}" rx="12" ry="12" fill="${fill}" fill-opacity="0.92" stroke="${borderColor}" stroke-width="3" />`,
        topBadge,
        labelPlate
      ].join("\n");
    }

    return [
      activeFrame,
      `<circle cx="${centerX}" cy="${centerY}" r="${Math.round(tokenSize / 2)}" fill="${fill}" fill-opacity="0.9" stroke="${borderColor}" stroke-width="3" />`,
      topBadge,
      labelPlate
    ].join("\n");
  }).join("\n");
}

function toSvgHref(inputPath, outputPath) {
  if (!inputPath) {
    return "";
  }

  const resolvedInputPath = resolveAssetPath(inputPath);

  if (path.isAbsolute(resolvedInputPath)) {
    return resolvedInputPath.replace(/\\/g, "/");
  }

  if (!outputPath) {
    return resolvedInputPath.replace(/\\/g, "/");
  }

  const absoluteAssetPath = path.resolve(process.cwd(), resolvedInputPath);
  const relative = path.relative(path.dirname(outputPath), absoluteAssetPath);
  return relative.replace(/\\/g, "/");
}

function renderMapSvg(map, options) {
  assertValidMapState(map);
  const outputPath = options && options.output_path ? path.resolve(options.output_path) : "";
  const metrics = getRenderMetrics(map, outputPath);
  const widthPx = metrics.width_px;
  const heightPx = metrics.height_px;
  const assetHasEmbeddedGrid = Boolean(map.asset && map.asset.has_embedded_grid);
  const showGrid = options && typeof options.show_grid === "boolean"
    ? options.show_grid
    : !assetHasEmbeddedGrid;
  const baseImagePath = metrics.base_image_path;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">`,
    `<rect x="0" y="0" width="${widthPx}" height="${heightPx}" fill="#1f3422" />`,
    baseImagePath
      ? `<image href="${escapeXml(baseImagePath)}" x="0" y="0" width="${widthPx}" height="${heightPx}" preserveAspectRatio="none" />`
      : "",
    renderTerrainSemantics(map, metrics),
    renderFilledOverlays(map, metrics),
    showGrid ? renderGridLines(map, metrics) : "",
    renderTokens(map, outputPath, metrics),
    renderSelectionOverlays(map, metrics),
    renderDebugOverlays(map, metrics),
    `</svg>`
  ].filter(Boolean).join("\n");

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, svg, "utf8");
  }

  return svg;
}

module.exports = {
  renderMapSvg
};
