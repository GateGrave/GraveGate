"use strict";

const { COVER_LEVELS, EDGE_WALL_SIDES } = require("../constants");
const { buildTerrainIndex, resolveTerrainFlags } = require("../logic/terrain");
const { buildEdgeWallIndex } = require("../logic/edge-walls");

function getCoverRank(level) {
  if (level === COVER_LEVELS.HALF) return 1;
  if (level === COVER_LEVELS.THREE_QUARTERS) return 2;
  if (level === COVER_LEVELS.TOTAL) return 3;
  return 0;
}

function mergeTerrainFlags(existing, flags) {
  return {
    x: Number(existing.x),
    y: Number(existing.y),
    terrain_type: flags.terrain_type || existing.terrain_type || "open",
    movement_cost: Math.max(
      Number.isFinite(Number(existing.movement_cost)) ? Number(existing.movement_cost) : 1,
      Number.isFinite(Number(flags.movement_cost)) ? Number(flags.movement_cost) : 1
    ),
    blocks_movement: existing.blocks_movement === true || flags.blocks_movement === true,
    blocks_sight: existing.blocks_sight === true || flags.blocks_sight === true,
    cover_level: getCoverRank(flags.cover_level) >= getCoverRank(existing.cover_level)
      ? flags.cover_level || ""
      : existing.cover_level || "",
    is_hazard: existing.is_hazard === true || flags.is_hazard === true,
    hazard_kind: String(flags.hazard_kind || existing.hazard_kind || ""),
    damages_on_enter: existing.damages_on_enter === true || flags.damages_on_enter === true,
    damages_on_turn_start: existing.damages_on_turn_start === true || flags.damages_on_turn_start === true
  };
}

function buildTerrainVisualTiles(map) {
  const terrainTiles = new Map();
  const terrainIndex = buildTerrainIndex(map);

  (Array.isArray(map && map.blocked_tiles) ? map.blocked_tiles : []).forEach((entry) => {
    const key = `${Number(entry.x)},${Number(entry.y)}`;
    terrainTiles.set(key, {
      x: Number(entry.x),
      y: Number(entry.y),
      terrain_type: "blocked",
      movement_cost: Number.POSITIVE_INFINITY,
      blocks_movement: true,
      blocks_sight: false,
      cover_level: "",
      is_hazard: false,
      hazard_kind: "",
      damages_on_enter: false,
      damages_on_turn_start: false
    });
  });

  terrainIndex.forEach((entry) => {
    if (!entry || !Number.isFinite(Number(entry.x)) || !Number.isFinite(Number(entry.y))) {
      return;
    }

    const key = `${Number(entry.x)},${Number(entry.y)}`;
    const flags = resolveTerrainFlags(entry);
    const existing = terrainTiles.get(key) || {
      x: Number(entry.x),
      y: Number(entry.y),
      terrain_type: "open",
      movement_cost: 1,
      blocks_movement: false,
      blocks_sight: false,
      cover_level: "",
      is_hazard: false,
      hazard_kind: "",
      damages_on_enter: false,
      damages_on_turn_start: false
    };
    terrainTiles.set(key, mergeTerrainFlags(existing, flags));
  });

  return Array.from(terrainTiles.values())
    .filter((tile) => (
      tile.blocks_movement === true ||
      tile.blocks_sight === true ||
      tile.is_hazard === true ||
      Boolean(tile.cover_level) ||
      (Number.isFinite(Number(tile.movement_cost)) && Number(tile.movement_cost) > 1)
    ))
    .sort((left, right) => left.y - right.y || left.x - right.x);
}

function getCoverDebugLabel(level) {
  if (level === COVER_LEVELS.HALF) return "+2";
  if (level === COVER_LEVELS.THREE_QUARTERS) return "+5";
  if (level === COVER_LEVELS.TOTAL) return "TOT";
  return "";
}

function buildTerrainDebugLabel(tile) {
  const parts = [];

  if (tile.is_hazard === true) {
    parts.push(tile.hazard_kind ? String(tile.hazard_kind).slice(0, 3).toUpperCase() : "HZD");
  }

  if (tile.blocks_movement === true) {
    parts.push("BLK");
  } else if (Number.isFinite(Number(tile.movement_cost)) && Number(tile.movement_cost) > 1) {
    parts.push(`MV${Number(tile.movement_cost)}`);
  }

  if (tile.blocks_sight === true) {
    parts.push("LOS");
  }

  return parts.slice(0, 2).join("/");
}

function buildEdgeWallVisuals(map) {
  return Array.from(buildEdgeWallIndex(map).values())
    .map((entry) => {
      if (entry.side === EDGE_WALL_SIDES.NORTH) {
        return {
          x: entry.x,
          y: entry.y,
          side: entry.side,
          start: { x: entry.x, y: entry.y },
          end: { x: entry.x + 1, y: entry.y },
          blocks_movement: entry.blocks_movement === true,
          blocks_sight: entry.blocks_sight === true
        };
      }

      if (entry.side === EDGE_WALL_SIDES.WEST) {
        return {
          x: entry.x,
          y: entry.y,
          side: entry.side,
          start: { x: entry.x, y: entry.y },
          end: { x: entry.x, y: entry.y + 1 },
          blocks_movement: entry.blocks_movement === true,
          blocks_sight: entry.blocks_sight === true
        };
      }

      return null;
    })
    .filter(Boolean)
    .sort((left, right) => left.y - right.y || left.x - right.x || left.side.localeCompare(right.side));
}

const SELECTION_MARKER_CODES = Object.freeze({
  exit: "EXT",
  door: "DOR",
  chest: "CHS",
  trap: "TRP",
  shrine: "SHR",
  lore: "LOR",
  lever: "LEV",
  object: "OBJ",
  encounter: "ENC",
  path: "PTH",
  target: "TGT"
});

function normalizeSelectionMarkerStyle(value) {
  const safe = String(value || "").trim().toLowerCase();
  if (!safe) {
    return "target";
  }
  if (safe === "move" || safe === "range" || safe === "spell" || safe === "selection") {
    return "target";
  }
  if (Object.prototype.hasOwnProperty.call(SELECTION_MARKER_CODES, safe)) {
    return safe;
  }
  return "target";
}

function getSelectionMarkerVisual(style) {
  const safeStyle = normalizeSelectionMarkerStyle(style);

  if (safeStyle === "path") {
    return {
      style: safeStyle,
      icon: "path",
      fill_opacity: 0.12,
      border_thickness: 2,
      show_badge: false
    };
  }

  if (safeStyle === "exit") {
    return {
      style: safeStyle,
      icon: "exit",
      fill_opacity: 0.16,
      border_thickness: 3,
      show_badge: true
    };
  }

  if (safeStyle === "door") {
    return {
      style: safeStyle,
      icon: "door",
      fill_opacity: 0.15,
      border_thickness: 3,
      show_badge: true
    };
  }

  if (safeStyle === "chest") {
    return {
      style: safeStyle,
      icon: "chest",
      fill_opacity: 0.15,
      border_thickness: 3,
      show_badge: true
    };
  }

  if (safeStyle === "trap") {
    return {
      style: safeStyle,
      icon: "trap",
      fill_opacity: 0.14,
      border_thickness: 3,
      show_badge: true
    };
  }

  if (safeStyle === "shrine") {
    return {
      style: safeStyle,
      icon: "shrine",
      fill_opacity: 0.15,
      border_thickness: 3,
      show_badge: true
    };
  }

  if (safeStyle === "lore") {
    return {
      style: safeStyle,
      icon: "lore",
      fill_opacity: 0.15,
      border_thickness: 3,
      show_badge: true
    };
  }

  if (safeStyle === "lever") {
    return {
      style: safeStyle,
      icon: "lever",
      fill_opacity: 0.15,
      border_thickness: 3,
      show_badge: true
    };
  }

  if (safeStyle === "object") {
    return {
      style: safeStyle,
      icon: "object",
      fill_opacity: 0.15,
      border_thickness: 3,
      show_badge: true
    };
  }

  if (safeStyle === "encounter") {
    return {
      style: safeStyle,
      icon: "encounter",
      fill_opacity: 0.17,
      border_thickness: 3,
      show_badge: true
    };
  }

  return {
    style: "target",
    icon: "crosshair",
    fill_opacity: 0.18,
    border_thickness: 3,
    show_badge: true
  };
}

function getMarkerDebugCode(style) {
  const safeStyle = normalizeSelectionMarkerStyle(style);
  if (safeStyle === "path") {
    return "";
  }
  return SELECTION_MARKER_CODES[safeStyle] || "MRK";
}

function buildMarkerDebugEntries(map) {
  const overlays = Array.isArray(map && map.overlays) ? map.overlays : [];
  const grouped = new Map();

  overlays.forEach((overlay) => {
    if (!overlay || overlay.kind !== "selection") {
      return;
    }

    const overlayStyle = normalizeSelectionMarkerStyle(overlay.metadata && overlay.metadata.marker_style);
    (Array.isArray(overlay.tiles) ? overlay.tiles : []).forEach((tile) => {
      if (!tile || !Number.isFinite(Number(tile.x)) || !Number.isFinite(Number(tile.y))) {
        return;
      }

      const tileStyle = normalizeSelectionMarkerStyle(tile.marker_style || overlayStyle);
      const code = getMarkerDebugCode(tileStyle);
      if (!code) {
        return;
      }

      const suffix = String(tile.label || "").trim();
      const key = `${Number(tile.x)},${Number(tile.y)}`;
      const label = suffix ? `${code} ${suffix}` : code;
      if (!grouped.has(key)) {
        grouped.set(key, {
          x: Number(tile.x),
          y: Number(tile.y),
          labels: new Set()
        });
      }
      grouped.get(key).labels.add(label);
    });
  });

  return Array.from(grouped.values())
    .map((entry) => ({
      x: entry.x,
      y: entry.y,
      label: Array.from(entry.labels).slice(0, 2).join(" / ")
    }))
    .filter((entry) => Boolean(entry.label))
    .sort((left, right) => left.y - right.y || left.x - right.x);
}

module.exports = {
  buildTerrainVisualTiles,
  getCoverDebugLabel,
  buildTerrainDebugLabel,
  buildEdgeWallVisuals,
  normalizeSelectionMarkerStyle,
  getSelectionMarkerVisual,
  buildMarkerDebugEntries
};
