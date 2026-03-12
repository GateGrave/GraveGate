"use strict";

const fs = require("fs");
const path = require("path");
const { assertValidMapState } = require("../schema/map-state.schema");
const { OVERLAY_KINDS } = require("../constants");
const { buildTokenVisualProfile } = require("../tokens/token-catalog");
const { resolveAssetPath } = require("../core/asset-path-utils");

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
      const fillOpacity = typeof overlay.opacity === "number" ? overlay.opacity : 0.18;
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

        return [
          `<rect x="${x + inset}" y="${y + inset}" width="${boxWidth}" height="${boxHeight}" rx="10" ry="10" fill="${escapeXml(stroke)}" fill-opacity="${fillOpacity}" stroke="${escapeXml(stroke)}" stroke-width="4" />`,
          `<circle cx="${centerX}" cy="${centerY}" r="${Math.round(size / 2.8)}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="3" />`,
          `<line x1="${centerX}" y1="${y + inset + 8}" x2="${centerX}" y2="${y + inset + 22}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
          `<line x1="${centerX}" y1="${y + metrics.tile_height_px - inset - 8}" x2="${centerX}" y2="${y + metrics.tile_height_px - inset - 22}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
          `<line x1="${x + inset + 8}" y1="${centerY}" x2="${x + inset + 22}" y2="${centerY}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
          `<line x1="${x + metrics.tile_width_px - inset - 8}" y1="${centerY}" x2="${x + metrics.tile_width_px - inset - 22}" y2="${centerY}" stroke="${escapeXml(stroke)}" stroke-width="3" stroke-linecap="round" />`,
          badgeLabel
            ? `<circle cx="${x + metrics.tile_width_px - 14}" cy="${y + 14}" r="12" fill="${escapeXml(stroke)}" />`
            : "",
          badgeLabel
            ? `<text x="${x + metrics.tile_width_px - 14}" y="${y + 19}" font-family="Verdana, sans-serif" font-size="14" font-weight="bold" text-anchor="middle" fill="#111">${badgeLabel}</text>`
            : ""
        ].join("\n");
      }).join("\n");
    }).join("\n");
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
    const label = escapeXml(visualProfile.label);
    const badgeText = visualProfile.badge_text ? escapeXml(visualProfile.badge_text) : "";
    const tokenShape = visualProfile.shape || "circle";
    const clipId = `token-clip-${escapeXml(token.token_id || `${token.position.x}-${token.position.y}`)}`;
    const centerX = x + (metrics.tile_width_px / 2);
    const centerY = y + (metrics.tile_height_px / 2);
    const tokenX = centerX - (tokenSize / 2);
    const tokenY = centerY - (tokenSize / 2);

    if (visualProfile.asset_path) {
      const tokenAssetPath = toSvgHref(visualProfile.asset_path, outputPath);
      const clipPath = tokenShape === "square"
        ? `<clipPath id="${clipId}"><rect x="${tokenX}" y="${tokenY}" width="${tokenSize}" height="${tokenSize}" rx="12" ry="12" /></clipPath>`
        : `<clipPath id="${clipId}"><circle cx="${centerX}" cy="${centerY}" r="${Math.round(tokenSize / 2)}" /></clipPath>`;

      return [
        `<defs>${clipPath}</defs>`,
        tokenShape === "square"
          ? `<rect x="${tokenX}" y="${tokenY}" width="${tokenSize}" height="${tokenSize}" rx="12" ry="12" fill="none" stroke="${imageBorderColor}" stroke-width="3" />`
          : `<circle cx="${centerX}" cy="${centerY}" r="${Math.round(tokenSize / 2)}" fill="none" stroke="${imageBorderColor}" stroke-width="3" />`,
        `<image href="${escapeXml(tokenAssetPath)}" x="${tokenX}" y="${tokenY}" width="${tokenSize}" height="${tokenSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" />`,
        badgeText
          ? `<text x="${x + metrics.tile_width_px - 10}" y="${y + 18}" font-family="Verdana, sans-serif" font-size="14" font-weight="bold" text-anchor="end" fill="${badgeColor}">${badgeText}</text>`
          : "",
        `<text x="${x + (metrics.tile_width_px / 2)}" y="${y + metrics.tile_height_px - 8}" font-family="Verdana, sans-serif" font-size="14" text-anchor="middle" fill="#111">${label}</text>`
      ].join("\n");
    }

    if (tokenShape === "square") {
      return [
        `<rect x="${tokenX}" y="${tokenY}" width="${tokenSize}" height="${tokenSize}" rx="12" ry="12" fill="${fill}" fill-opacity="0.92" stroke="${borderColor}" stroke-width="3" />`,
        badgeText
          ? `<text x="${x + metrics.tile_width_px - 10}" y="${y + 18}" font-family="Verdana, sans-serif" font-size="14" font-weight="bold" text-anchor="end" fill="${badgeColor}">${badgeText}</text>`
          : "",
        `<text x="${x + (metrics.tile_width_px / 2)}" y="${y + (metrics.tile_height_px / 2) + 5}" font-family="Verdana, sans-serif" font-size="18" font-weight="bold" text-anchor="middle" fill="#ffffff">${label}</text>`
      ].join("\n");
    }

    return [
      `<circle cx="${centerX}" cy="${centerY}" r="${Math.round(tokenSize / 2)}" fill="${fill}" fill-opacity="0.9" stroke="${borderColor}" stroke-width="3" />`,
      badgeText
        ? `<text x="${x + metrics.tile_width_px - 10}" y="${y + 18}" font-family="Verdana, sans-serif" font-size="14" font-weight="bold" text-anchor="end" fill="${badgeColor}">${badgeText}</text>`
        : "",
      `<text x="${x + (metrics.tile_width_px / 2)}" y="${y + (metrics.tile_height_px / 2) + 5}" font-family="Verdana, sans-serif" font-size="18" font-weight="bold" text-anchor="middle" fill="#ffffff">${label}</text>`
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
    renderFilledOverlays(map, metrics),
    showGrid ? renderGridLines(map, metrics) : "",
    renderTokens(map, outputPath, metrics),
    renderSelectionOverlays(map, metrics),
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
