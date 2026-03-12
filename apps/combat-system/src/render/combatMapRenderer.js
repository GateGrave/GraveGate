"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function success(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {},
    error: null
  };
}

function failure(eventType, message, payload) {
  return {
    ok: false,
    event_type: eventType,
    payload: payload || {},
    error: message
  };
}

function toSafeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toFiniteNumber(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function normalizePosition(position) {
  const data = toSafeObject(position);
  const x = Number(data.x);
  const y = Number(data.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x: Math.floor(x), y: Math.floor(y) };
}

function parseHexColor(hex, fallback) {
  const safe = typeof hex === "string" ? hex.trim() : "";
  const normalized = safe.startsWith("#") ? safe.slice(1) : safe;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return fallback;
  }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
    a: 255
  };
}

function color(r, g, b, a) {
  return { r, g, b, a: Number.isFinite(a) ? a : 255 };
}

function copyColor(value) {
  return color(value.r, value.g, value.b, value.a);
}

const LAYER_ORDER = ["terrain", "environment", "actors", "effects"];

const TERRAIN_COLORS = {
  normal: color(54, 66, 74, 255),
  difficult: color(84, 72, 58, 255),
  hazard: color(105, 44, 44, 255),
  wall: color(33, 33, 37, 255)
};

const ENVIRONMENT_COLORS = {
  blocking: color(30, 22, 18, 255),
  occupied_hint: color(85, 85, 85, 255)
};

const EFFECT_COLORS = {
  blocks_line_of_effect: color(188, 86, 255, 130),
  default: color(111, 201, 255, 90)
};

const TEAM_COLORS = {
  heroes: color(66, 153, 225, 255),
  monsters: color(229, 62, 62, 255),
  neutral: color(160, 174, 192, 255)
};

function getTerrainColor(tile) {
  const terrain = String(tile.terrain || "normal");
  return copyColor(TERRAIN_COLORS[terrain] || TERRAIN_COLORS.normal);
}

function getActorColor(participant) {
  const metadata = toSafeObject(participant.render_metadata);
  const explicit = parseHexColor(metadata.token_color, null);
  if (explicit) {
    return explicit;
  }
  const team = String(participant.team || "neutral");
  return copyColor(TEAM_COLORS[team] || TEAM_COLORS.neutral);
}

function getEffectColor(effectId) {
  return copyColor(EFFECT_COLORS[effectId] || EFFECT_COLORS.default);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createRgbaBuffer(width, height, fill) {
  const pixelCount = width * height;
  const out = Buffer.alloc(pixelCount * 4);
  for (let i = 0; i < pixelCount; i += 1) {
    const index = i * 4;
    out[index] = fill.r;
    out[index + 1] = fill.g;
    out[index + 2] = fill.b;
    out[index + 3] = fill.a;
  }
  return out;
}

function paintRect(buffer, width, height, rect, fill) {
  const xStart = clamp(Math.floor(rect.x), 0, width);
  const yStart = clamp(Math.floor(rect.y), 0, height);
  const xEnd = clamp(Math.floor(rect.x + rect.w), 0, width);
  const yEnd = clamp(Math.floor(rect.y + rect.h), 0, height);
  if (xStart >= xEnd || yStart >= yEnd) {
    return;
  }
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const index = (y * width + x) * 4;
      const srcA = fill.a / 255;
      const invA = 1 - srcA;
      buffer[index] = Math.round(fill.r * srcA + buffer[index] * invA);
      buffer[index + 1] = Math.round(fill.g * srcA + buffer[index + 1] * invA);
      buffer[index + 2] = Math.round(fill.b * srcA + buffer[index + 2] * invA);
      buffer[index + 3] = 255;
    }
  }
}

let crcTable = null;
function getCrcTable() {
  if (crcTable) {
    return crcTable;
  }
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

function crc32(buffer) {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = table[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgbaBuffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowBytes = width * 4;
  const scanlineData = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const scanlineIndex = y * (rowBytes + 1);
    scanlineData[scanlineIndex] = 0;
    const srcStart = y * rowBytes;
    rgbaBuffer.copy(scanlineData, scanlineIndex + 1, srcStart, srcStart + rowBytes);
  }
  const compressed = zlib.deflateSync(scanlineData, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0))
  ]);
}

function getTileIndex(grid, x, y) {
  return y * grid.width + x;
}

function getTile(grid, x, y) {
  const list = Array.isArray(grid.tiles) ? grid.tiles : [];
  return list[getTileIndex(grid, x, y)] || null;
}

function buildTerrainLayer(drawContext) {
  const grid = drawContext.grid;
  const tileSize = drawContext.tileSizePx;
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const tile = getTile(grid, x, y) || { terrain: "normal" };
      const pixelX = x * tileSize;
      const pixelY = y * tileSize;
      paintRect(drawContext.rgba, drawContext.widthPx, drawContext.heightPx, {
        x: pixelX,
        y: pixelY,
        w: tileSize,
        h: tileSize
      }, getTerrainColor(tile));
      drawContext.manifest.layers.terrain.push({
        tile_x: x,
        tile_y: y,
        terrain: tile.terrain || "normal",
        pixel_x: pixelX,
        pixel_y: pixelY
      });
    }
  }
}

function buildEnvironmentLayer(drawContext) {
  const grid = drawContext.grid;
  const tileSize = drawContext.tileSizePx;
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const tile = getTile(grid, x, y);
      if (!tile) {
        continue;
      }
      const pixelX = x * tileSize;
      const pixelY = y * tileSize;
      if (tile.terrain === "wall") {
        paintRect(drawContext.rgba, drawContext.widthPx, drawContext.heightPx, {
          x: pixelX + Math.floor(tileSize * 0.15),
          y: pixelY + Math.floor(tileSize * 0.15),
          w: Math.ceil(tileSize * 0.7),
          h: Math.ceil(tileSize * 0.7)
        }, ENVIRONMENT_COLORS.blocking);
        drawContext.manifest.layers.environment.push({
          type: "wall_overlay",
          tile_x: x,
          tile_y: y,
          pixel_x: pixelX,
          pixel_y: pixelY
        });
      }
      if (tile.occupant) {
        paintRect(drawContext.rgba, drawContext.widthPx, drawContext.heightPx, {
          x: pixelX + 1,
          y: pixelY + 1,
          w: Math.max(1, tileSize - 2),
          h: 2
        }, ENVIRONMENT_COLORS.occupied_hint);
      }
    }
  }
}

function buildActorLayer(drawContext, combatState) {
  const tileSize = drawContext.tileSizePx;
  const participants = Array.isArray(combatState.participants) ? combatState.participants : [];
  for (let i = 0; i < participants.length; i += 1) {
    const participant = participants[i];
    const hp = toFiniteNumber(participant.current_hp, 0);
    if (hp <= 0) {
      continue;
    }
    const tilePos = normalizePosition(participant.position);
    if (!tilePos) {
      return failure("combat_render_failed", "participant is missing position", {
        participant_id: String(participant.participant_id || ""),
        reason: "missing_position"
      });
    }
    if (tilePos.x < 0 || tilePos.y < 0 || tilePos.x >= drawContext.grid.width || tilePos.y >= drawContext.grid.height) {
      return failure("combat_render_failed", "participant position is out of bounds", {
        participant_id: String(participant.participant_id || ""),
        position: tilePos,
        reason: "out_of_bounds_position"
      });
    }

    const colorFill = getActorColor(participant);
    const tokenPadding = Math.max(2, Math.floor(tileSize * 0.2));
    const pixelX = tilePos.x * tileSize + tokenPadding;
    const pixelY = tilePos.y * tileSize + tokenPadding;
    const tokenSize = Math.max(4, tileSize - tokenPadding * 2);
    paintRect(drawContext.rgba, drawContext.widthPx, drawContext.heightPx, {
      x: pixelX,
      y: pixelY,
      w: tokenSize,
      h: tokenSize
    }, colorFill);

    drawContext.manifest.layers.actors.push({
      participant_id: String(participant.participant_id || ""),
      team: String(participant.team || "neutral"),
      token_asset_id: participant.token_asset_id || null,
      token_fallback_used: !participant.token_asset_id,
      tile_x: tilePos.x,
      tile_y: tilePos.y,
      pixel_x: pixelX,
      pixel_y: pixelY,
      token_size_px: tokenSize
    });
  }
  return success("combat_render_actors_built");
}

function buildEffectsLayer(drawContext) {
  const grid = drawContext.grid;
  const tileSize = drawContext.tileSizePx;
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const tile = getTile(grid, x, y);
      if (!tile) {
        continue;
      }
      const effects = Array.isArray(tile.status_effects) ? tile.status_effects : [];
      if (effects.length === 0) {
        continue;
      }
      const pixelX = x * tileSize;
      const pixelY = y * tileSize;
      for (let i = 0; i < effects.length; i += 1) {
        const effectId = String(effects[i] || "default");
        paintRect(drawContext.rgba, drawContext.widthPx, drawContext.heightPx, {
          x: pixelX,
          y: pixelY,
          w: tileSize,
          h: tileSize
        }, getEffectColor(effectId));
        drawContext.manifest.layers.effects.push({
          effect_id: effectId,
          tile_x: x,
          tile_y: y,
          pixel_x: pixelX,
          pixel_y: pixelY
        });
      }
    }
  }
}

function normalizeGridFromCombatState(combatState) {
  const raw = toSafeObject(combatState.battlefield_grid);
  const width = Math.floor(toFiniteNumber(raw.width, 0));
  const height = Math.floor(toFiniteNumber(raw.height, 0));
  if (width <= 0 || height <= 0) {
    return {
      ok: false,
      error: "combat_state.battlefield_grid must define positive width and height",
      payload: {
        reason: "invalid_battlefield_grid_dimensions"
      }
    };
  }
  const safeTiles = Array.isArray(raw.tiles) ? raw.tiles.slice() : [];
  if (safeTiles.length < width * height) {
    return {
      ok: false,
      error: "combat_state.battlefield_grid tiles are incomplete",
      payload: {
        reason: "incomplete_battlefield_grid_tiles",
        expected_tiles: width * height,
        actual_tiles: safeTiles.length
      }
    };
  }
  return {
    ok: true,
    payload: {
      grid: {
        width,
        height,
        tile_size_feet: toFiniteNumber(raw.tile_size_feet, 5),
        tiles: safeTiles
      }
    }
  };
}

function writeRenderOutputIfRequested(pngBuffer, options, combatId) {
  const output = toSafeObject(options.output);
  if (!output.write_file) {
    return null;
  }
  const dir = typeof output.output_dir === "string" && output.output_dir.trim() !== ""
    ? output.output_dir
    : path.join("apps", "combat-system", "data", "renders");
  const safeId = String(combatId || "combat-render").replace(/[^a-zA-Z0-9-_]/g, "_");
  const fileName = (typeof output.file_name === "string" && output.file_name.trim() !== "")
    ? output.file_name
    : safeId + "-" + Date.now() + ".png";
  fs.mkdirSync(dir, { recursive: true });
  const outputPath = path.join(dir, fileName);
  fs.writeFileSync(outputPath, pngBuffer);
  return outputPath;
}

function renderCombatMapFromState(input) {
  const data = input || {};
  const combatState = toSafeObject(data.combat_state);
  const combatId = String(combatState.combat_id || "").trim();
  if (!combatId) {
    return failure("combat_render_failed", "combat_state.combat_id is required", {
      reason: "missing_combat_id"
    });
  }
  if (String(combatState.status || "") !== "active") {
    return failure("combat_render_failed", "combat is not active for rendering", {
      reason: "combat_not_active",
      combat_id: combatId,
      status: combatState.status || null
    });
  }

  const options = toSafeObject(data.options);
  const normalizedGrid = normalizeGridFromCombatState(combatState);
  if (!normalizedGrid.ok) {
    return failure("combat_render_failed", normalizedGrid.error, normalizedGrid.payload);
  }
  const grid = normalizedGrid.payload.grid;
  const tileSizePx = Math.max(8, Math.floor(toFiniteNumber(options.tile_size_px, 48)));
  const widthPx = grid.width * tileSizePx;
  const heightPx = grid.height * tileSizePx;

  const drawContext = {
    grid,
    tileSizePx,
    widthPx,
    heightPx,
    rgba: createRgbaBuffer(widthPx, heightPx, color(22, 26, 31, 255)),
    manifest: {
      layer_order: LAYER_ORDER.slice(),
      layers: {
        terrain: [],
        environment: [],
        actors: [],
        effects: []
      }
    }
  };

  buildTerrainLayer(drawContext);
  buildEnvironmentLayer(drawContext);
  const actorsOut = buildActorLayer(drawContext, combatState);
  if (!actorsOut.ok) {
    return actorsOut;
  }
  buildEffectsLayer(drawContext);

  const pngBuffer = encodePng(widthPx, heightPx, drawContext.rgba);
  const outputPath = writeRenderOutputIfRequested(pngBuffer, options, combatId);

  return success("combat_render_generated", {
    combat_id: combatId,
    width_px: widthPx,
    height_px: heightPx,
    tile_size_px: tileSizePx,
    grid_width: grid.width,
    grid_height: grid.height,
    output_path: outputPath,
    png_buffer: pngBuffer,
    render_manifest: drawContext.manifest
  });
}

module.exports = {
  LAYER_ORDER,
  renderCombatMapFromState
};
