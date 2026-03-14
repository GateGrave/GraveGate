"use strict";

const DEBUG_FLAG_LABELS = Object.freeze({
  terrain: "Terrain",
  cover: "Cover",
  walls: "Walls",
  coords: "Coords"
});

function normalizeDebugFlags(value) {
  const safe = value && typeof value === "object" ? value : {};
  return {
    terrain: safe.terrain === true,
    cover: safe.cover === true,
    walls: safe.walls === true,
    coords: safe.coords === true
  };
}

function toggleDebugFlag(value, key) {
  const safeKey = String(key || "").trim().toLowerCase();
  const flags = normalizeDebugFlags(value);
  if (!Object.prototype.hasOwnProperty.call(DEBUG_FLAG_LABELS, safeKey)) {
    return flags;
  }

  return {
    ...flags,
    [safeKey]: !flags[safeKey]
  };
}

function getActiveDebugFlagKeys(value) {
  const flags = normalizeDebugFlags(value);
  return Object.keys(DEBUG_FLAG_LABELS).filter((key) => flags[key] === true);
}

function formatDebugFlagSummary(value) {
  const active = getActiveDebugFlagKeys(value);
  if (active.length === 0) {
    return "";
  }

  return `Debug overlays: ${active.map((key) => DEBUG_FLAG_LABELS[key]).join(", ")}`;
}

module.exports = {
  DEBUG_FLAG_LABELS,
  normalizeDebugFlags,
  toggleDebugFlag,
  getActiveDebugFlagKeys,
  formatDebugFlagSummary
};
