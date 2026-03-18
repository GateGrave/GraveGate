"use strict";

const fs = require("fs");
const path = require("path");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const {
  TOKEN_TYPES,
  loadMapWithProfile,
  validateMapStateShape,
  renderMapAsync,
  buildSelectionOverlay,
  buildPlayerToken,
  buildEnemyToken,
  buildDungeonEntriesFromMaskPath,
  normalizeDebugFlags
} = require("../../map-system/src");

const DEFAULT_DUNGEON_MAP_OUTPUT_DIR = "apps/map-system/output/live/dungeon";
const DEFAULT_PARTY_TOKEN_ASSET_PATH = "apps/map-system/assets/tokens/players/processed/party-token.cleaned.png";
const DUNGEON_MAP_ACTIONS = Object.freeze({
  PREVIEW_MOVE: "preview_move",
  MOVE: "move",
  BACK: "back",
  DEBUG_TOGGLE: "debug_toggle"
});

const OBJECT_MARKER_STYLES = Object.freeze({
  DOOR: "door",
  CHEST: "chest",
  TRAP: "trap",
  SHRINE: "shrine",
  LORE: "lore",
  LEVER: "lever",
  OBJECT: "object"
});

const DUNGEON_DEBUG_FLAG_LABELS = Object.freeze({
  markers: "Markers",
  walls: "Walls",
  terrain: "Terrain",
  coords: "Coords"
});

function cleanText(value, fallback) {
  const safe = String(value || "").trim();
  return safe === "" ? (fallback || "") : safe;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeUniqueEntriesByKey(primaryList, secondaryList, keyBuilder) {
  const merged = new Map();
  [].concat(primaryList || [], secondaryList || []).forEach((entry) => {
    if (!entry) {
      return;
    }
    merged.set(keyBuilder(entry), entry);
  });
  return Array.from(merged.values());
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizePosition(position) {
  if (!position || !Number.isFinite(Number(position.x)) || !Number.isFinite(Number(position.y))) {
    return null;
  }

  return {
    x: Math.floor(Number(position.x)),
    y: Math.floor(Number(position.y))
  };
}

function abbreviateMarkerLabel(value, fallback) {
  const safe = cleanText(value, fallback || "");
  if (!safe) {
    return "";
  }
  return safe.slice(0, 3).toUpperCase();
}

function normalizeDirection(value) {
  return cleanText(value, "").toLowerCase();
}

function getDirectionSortRank(value) {
  const safe = normalizeDirection(value);
  if (safe === "north") return 1;
  if (safe === "east") return 2;
  if (safe === "south") return 3;
  if (safe === "west") return 4;
  if (safe === "up") return 5;
  if (safe === "down") return 6;
  return 99;
}

function compareEntriesByPosition(left, right) {
  const leftPosition = normalizePosition(left && left.position);
  const rightPosition = normalizePosition(right && right.position);
  const leftY = leftPosition ? leftPosition.y : Number.POSITIVE_INFINITY;
  const rightY = rightPosition ? rightPosition.y : Number.POSITIVE_INFINITY;
  const leftX = leftPosition ? leftPosition.x : Number.POSITIVE_INFINITY;
  const rightX = rightPosition ? rightPosition.x : Number.POSITIVE_INFINITY;
  return leftY - rightY || leftX - rightX;
}

function getDungeonExitKey(entry) {
  const safe = entry && typeof entry === "object" ? entry : {};
  const direction = normalizeDirection(safe.direction);
  const toRoomId = cleanText(safe.to_room_id, "");
  if (direction || toRoomId) {
    return `${direction}|${toRoomId}`;
  }

  const position = normalizePosition(safe.position || safe.map_position);
  return position ? `@${position.x},${position.y}` : "exit";
}

function mergeDungeonExitEntry(existing, incoming) {
  const left = existing && typeof existing === "object" ? existing : {};
  const right = incoming && typeof incoming === "object" ? incoming : {};
  const leftPosition = normalizePosition(left.position || left.map_position);
  const rightPosition = normalizePosition(right.position || right.map_position);
  const position = rightPosition || leftPosition;

  return {
    ...left,
    ...right,
    direction: cleanText(right.direction, cleanText(left.direction, "")),
    to_room_id: cleanText(right.to_room_id, cleanText(left.to_room_id, "")),
    label: cleanText(right.label, cleanText(left.label, "")),
    position,
    map_position: position
  };
}

function getMergedDungeonExits(dungeonMap, room) {
  const merged = new Map();
  [].concat(
    Array.isArray(dungeonMap && dungeonMap.exits) ? dungeonMap.exits : [],
    Array.isArray(room && room.exits) ? room.exits : []
  ).forEach((entry) => {
    if (!entry) {
      return;
    }

    const key = getDungeonExitKey(entry);
    merged.set(key, mergeDungeonExitEntry(merged.get(key), entry));
  });

  return Array.from(merged.values())
    .filter((entry) => {
      const position = normalizePosition(entry && (entry.position || entry.map_position));
      return Boolean(
        position
        || cleanText(entry && entry.direction, "")
        || cleanText(entry && entry.to_room_id, "")
        || cleanText(entry && entry.label, "")
      );
    })
    .sort((left, right) => (
      getDirectionSortRank(left.direction) - getDirectionSortRank(right.direction)
      || compareEntriesByPosition(left, right)
      || cleanText(left.to_room_id, left.label).localeCompare(cleanText(right.to_room_id, right.label))
    ));
}

function titleCaseWords(value, fallback) {
  const safe = cleanText(value, fallback || "");
  if (!safe) {
    return fallback || "";
  }
  return safe
    .split(/[_\s-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function truncateText(value, limit) {
  const safe = cleanText(value, "");
  if (!safe || safe.length <= limit) {
    return safe;
  }
  return `${safe.slice(0, Math.max(0, limit - 3))}...`;
}

function formatGridPosition(position) {
  const safe = normalizePosition(position);
  return safe ? `(${safe.x}, ${safe.y})` : "";
}

function normalizeDungeonDebugFlags(value) {
  const flags = normalizeDebugFlags(value);
  return {
    markers: flags.markers === true,
    walls: flags.walls === true,
    terrain: flags.terrain === true,
    coords: flags.coords === true
  };
}

function toggleDungeonDebugFlag(value, key) {
  const safeKey = String(key || "").trim().toLowerCase();
  const flags = normalizeDungeonDebugFlags(value);
  if (!Object.prototype.hasOwnProperty.call(DUNGEON_DEBUG_FLAG_LABELS, safeKey)) {
    return flags;
  }
  return {
    ...flags,
    [safeKey]: !flags[safeKey]
  };
}

function getActiveDungeonDebugKeys(value) {
  const flags = normalizeDungeonDebugFlags(value);
  return Object.keys(DUNGEON_DEBUG_FLAG_LABELS).filter((key) => flags[key] === true);
}

function formatDungeonDebugSummary(value) {
  const active = getActiveDungeonDebugKeys(value);
  if (active.length === 0) {
    return "";
  }
  return `Debug: ${active.map((key) => DUNGEON_DEBUG_FLAG_LABELS[key]).join(", ")}`;
}

function formatSummaryList(label, entries, emptyText) {
  const safeEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (safeEntries.length === 0) {
    return `${label}: ${emptyText}`;
  }
  const visible = safeEntries.slice(0, 3);
  const extra = safeEntries.length - visible.length;
  return `${label}: ${visible.join(" | ")}${extra > 0 ? ` | +${extra} more` : ""}`;
}

function buildMarkerOverlay(options) {
  if (!options || !options.tile) {
    return null;
  }

  return buildSelectionOverlay({
    overlay_id: options.overlay_id,
    color: options.color,
    opacity: typeof options.opacity === "number" ? options.opacity : 0.18,
    marker_style: options.marker_style,
    tile: options.tile
  });
}

function resolveDungeonMapData(data) {
  const safe = data && typeof data === "object" ? data : {};
  if (safe.dungeon_map && typeof safe.dungeon_map === "object") {
    return safe.dungeon_map;
  }
  if (safe.room && typeof safe.room === "object" && safe.room.dungeon_map && typeof safe.room.dungeon_map === "object") {
    return safe.room.dungeon_map;
  }
  return null;
}

function resolveDungeonMapConfig(data) {
  const dungeonMap = resolveDungeonMapData(data);
  if (!dungeonMap) {
    return null;
  }

  const mapPath = cleanText(dungeonMap.map_path, "");
  if (!mapPath) {
    return null;
  }

  return {
    map_path: path.resolve(process.cwd(), mapPath),
    profile_path: cleanText(dungeonMap.profile_path, ""),
    output_dir: path.resolve(
      process.cwd(),
      cleanText(dungeonMap.output_dir, DEFAULT_DUNGEON_MAP_OUTPUT_DIR)
    ),
    dungeon_map: clone(dungeonMap)
  };
}

function getLeaderId(data, dungeonMap) {
  const session = data && data.session && typeof data.session === "object" ? data.session : {};
  return cleanText(dungeonMap.leader_id, cleanText(session.leader_id || (session.party && session.party.leader_id), "party-leader"));
}

function buildDungeonMapCustomId(options) {
  return [
    "dungeon-map",
    "view",
    options.action || "unknown",
    options.session_id || "unknown",
    options.value || ""
  ].join(":");
}

function parseDungeonMapCustomId(customId) {
  const parts = String(customId || "").split(":");
  if (parts.length < 4 || parts[0] !== "dungeon-map" || parts[1] !== "view") {
    return {
      ok: false,
      error: "invalid dungeon map custom id"
    };
  }

  return {
    ok: true,
    action: parts[2] || "",
    session_id: parts[3] || "",
    value: parts[4] || ""
  };
}

function toSafeButtonLabel(label, fallback) {
  return cleanText(label, fallback || "Action").slice(0, 80);
}

function buildPartyToken(data, dungeonMap) {
  const session = data && data.session && typeof data.session === "object" ? data.session : {};
  const room = data && data.room && typeof data.room === "object" ? data.room : {};
  const partyPosition = normalizePosition(dungeonMap.party_position || room.party_position || session.party_position);
  if (!partyPosition) {
    return null;
  }

  const partyToken = dungeonMap.party_token && typeof dungeonMap.party_token === "object"
    ? dungeonMap.party_token
    : {};
  const leaderId = getLeaderId(data, dungeonMap);

  return buildPlayerToken({
    token_id: cleanText(partyToken.token_id, "party-token"),
    actor_id: leaderId,
    character_id: leaderId,
    label: cleanText(partyToken.label, "Party"),
    badge_text: cleanText(partyToken.badge_text, "P"),
    position: partyPosition,
    asset_path: cleanText(partyToken.asset_path, DEFAULT_PARTY_TOKEN_ASSET_PATH),
    shape: cleanText(partyToken.shape, "circle"),
    color: cleanText(partyToken.color, ""),
    border_color: cleanText(partyToken.border_color, ""),
    image_border_color: cleanText(partyToken.image_border_color, "")
  });
}

function getVisibleEnemyEntries(dungeonMap, room) {
  const explicit = Array.isArray(dungeonMap.visible_enemy_tokens) ? dungeonMap.visible_enemy_tokens : [];
  if (explicit.length > 0) {
    return explicit;
  }

  const encounter = room && room.encounter && typeof room.encounter === "object" ? room.encounter : {};
  if (Array.isArray(encounter.visible_enemy_tokens)) {
    return encounter.visible_enemy_tokens;
  }
  if (Array.isArray(encounter.preview_tokens)) {
    return encounter.preview_tokens;
  }

  const fallbackPosition = normalizePosition(
    encounter.position
    || encounter.map_position
    || dungeonMap.active_encounter_position
    || dungeonMap.encounter_position
  );
  if (!fallbackPosition) {
    return [];
  }

  return [{
    token_id: cleanText(encounter.encounter_id, "dungeon-encounter"),
    actor_id: cleanText(encounter.actor_id, cleanText(encounter.encounter_id, "dungeon-encounter")),
    encounter_actor_id: cleanText(encounter.encounter_actor_id, ""),
    label: cleanText(encounter.name || encounter.monster_name, "Encounter"),
    badge_text: cleanText(encounter.badge_text, "!"),
    position: fallbackPosition
  }];
}

function buildVisibleEnemyTokens(dungeonMap, room) {
  const enemies = getVisibleEnemyEntries(dungeonMap, room);
  return enemies
    .map((entry, index) => {
      const position = normalizePosition(entry && entry.position);
      if (!position) {
        return null;
      }

      return buildEnemyToken({
        token_id: cleanText(entry && entry.token_id, `dungeon-enemy-${index + 1}`),
        actor_id: cleanText(entry && entry.actor_id, cleanText(entry && entry.token_id, `dungeon-enemy-${index + 1}`)),
        encounter_actor_id: cleanText(entry && entry.encounter_actor_id, ""),
        label: cleanText(entry && entry.label, cleanText(entry && entry.name, `Enemy ${index + 1}`)),
        badge_text: cleanText(entry && entry.badge_text, String(index + 1)),
        position,
        asset_path: cleanText(entry && entry.asset_path, ""),
        shape: cleanText(entry && entry.shape, "circle"),
        color: cleanText(entry && entry.color, ""),
        border_color: cleanText(entry && entry.border_color, ""),
        image_border_color: cleanText(entry && entry.image_border_color, "")
      });
    })
    .filter(Boolean);
}

function getDungeonMoveTargets(dungeonMap, room) {
  const explicit = Array.isArray(dungeonMap.move_targets) ? dungeonMap.move_targets : [];
  if (explicit.length > 0) {
    return explicit
      .map((entry) => {
        const position = normalizePosition(entry && (entry.position || entry.map_position));
        if (!position) {
          return null;
        }
        return {
          direction: normalizeDirection(entry && entry.direction),
          to_room_id: cleanText(entry && entry.to_room_id, ""),
          position,
          label: cleanText(entry && entry.label, cleanText(entry && entry.direction, cleanText(entry && entry.to_room_id, "Move")))
        };
      })
      .filter(Boolean)
      .sort((left, right) => (
        getDirectionSortRank(left.direction) - getDirectionSortRank(right.direction)
        || compareEntriesByPosition(left, right)
        || cleanText(left.to_room_id, left.label).localeCompare(cleanText(right.to_room_id, right.label))
      ));
  }

  return getMergedDungeonExits(dungeonMap, room)
    .map((entry) => {
      const position = normalizePosition(entry && (entry.position || entry.map_position));
      if (!position) {
        return null;
      }
      return {
        direction: normalizeDirection(entry && entry.direction),
        to_room_id: cleanText(entry && entry.to_room_id, ""),
        position,
        label: cleanText(entry && entry.direction, cleanText(entry && entry.to_room_id, "Move"))
      };
    })
    .filter(Boolean)
    .sort((left, right) => (
      getDirectionSortRank(left.direction) - getDirectionSortRank(right.direction)
      || compareEntriesByPosition(left, right)
      || cleanText(left.to_room_id, left.label).localeCompare(cleanText(right.to_room_id, right.label))
    ));
}

function buildExitOverlay(dungeonMap, room) {
  const tiles = getDungeonMoveTargets(dungeonMap, room)
    .map((entry) => ({
      x: entry.position.x,
      y: entry.position.y,
      label: abbreviateMarkerLabel(entry.direction, "EX"),
      marker_style: "exit"
    }));

  if (tiles.length === 0) {
    return null;
  }

  return buildSelectionOverlay({
    overlay_id: "dungeon-exit-overlay",
    color: "#5ac8fa",
    opacity: 0.18,
    marker_style: "exit",
    tiles
  });
}

function getObjectMarkerStyle(objectType) {
  const normalized = cleanText(objectType, "object").toLowerCase();
  if (normalized === "door" || normalized === "hidden_door") return OBJECT_MARKER_STYLES.DOOR;
  if (normalized === "chest") return OBJECT_MARKER_STYLES.CHEST;
  if (normalized === "trap") return OBJECT_MARKER_STYLES.TRAP;
  if (normalized === "shrine") return OBJECT_MARKER_STYLES.SHRINE;
  if (normalized === "lore_object") return OBJECT_MARKER_STYLES.LORE;
  if (normalized === "lever") return OBJECT_MARKER_STYLES.LEVER;
  return OBJECT_MARKER_STYLES.OBJECT;
}

function getObjectOverlayColor(objectType) {
  const style = getObjectMarkerStyle(objectType);
  if (style === OBJECT_MARKER_STYLES.DOOR) return "#5ac8fa";
  if (style === OBJECT_MARKER_STYLES.CHEST) return "#ffd60a";
  if (style === OBJECT_MARKER_STYLES.TRAP) return "#ff9f0a";
  if (style === OBJECT_MARKER_STYLES.SHRINE) return "#64d2ff";
  if (style === OBJECT_MARKER_STYLES.LORE) return "#c7a35a";
  if (style === OBJECT_MARKER_STYLES.LEVER) return "#30d158";
  return "#ffd60a";
}

function getObjectMarkerLabel(entry) {
  const safe = entry && typeof entry === "object" ? entry : {};
  const state = safe.state && typeof safe.state === "object" ? safe.state : {};
  const objectType = cleanText(safe.object_type, "obj").toLowerCase();

  if ((objectType === "door" || objectType === "hidden_door") && state.is_locked) {
    return "LCK";
  }
  if (objectType === "chest" && state.is_locked) {
    return "LCK";
  }
  if (objectType === "trap" && state.is_disarmed) {
    return "SAFE";
  }
  if (objectType === "door") return "DOR";
  if (objectType === "hidden_door") return "HDR";
  if (objectType === "chest") return "CHS";
  if (objectType === "trap") return "TRP";
  if (objectType === "shrine") return "SHR";
  if (objectType === "lore_object") return "LOR";
  if (objectType === "lever") return "LEV";
  return abbreviateMarkerLabel(objectType, "OBJ");
}

function buildObjectOverlays(dungeonMap, room) {
  const objects = Array.isArray(dungeonMap.objects) && dungeonMap.objects.length > 0
    ? dungeonMap.objects
    : (Array.isArray(room && room.visible_objects) ? room.visible_objects : []);
  return objects
    .map((entry) => {
      const position = normalizePosition(entry && (entry.position || entry.map_position));
      if (!position) {
        return null;
      }

      const objectType = cleanText(entry && entry.object_type, "obj");
      return buildMarkerOverlay({
        overlay_id: `dungeon-object-${cleanText(entry && entry.object_id, `${objectType}-${position.x}-${position.y}`)}`,
        color: getObjectOverlayColor(objectType),
        opacity: 0.16,
        marker_style: getObjectMarkerStyle(objectType),
        tile: {
          x: position.x,
          y: position.y,
          label: getObjectMarkerLabel(entry),
          marker_style: getObjectMarkerStyle(objectType)
        }
      });
    })
    .filter(Boolean);
}

function buildEncounterOverlays(dungeonMap, room) {
  const encounters = Array.isArray(dungeonMap.encounter_triggers) ? dungeonMap.encounter_triggers : [];
  const triggerOverlays = encounters
    .map((entry) => {
      const position = normalizePosition(entry && (entry.position || entry.map_position));
      if (!position) {
        return null;
      }

      return buildMarkerOverlay({
        overlay_id: `dungeon-encounter-${cleanText(entry && entry.encounter_id, `${position.x}-${position.y}`)}`,
        color: "#ff3b30",
        opacity: 0.18,
        marker_style: "encounter",
        tile: {
          x: position.x,
          y: position.y,
          label: abbreviateMarkerLabel(entry && entry.label, "ENC"),
          marker_style: "encounter"
        }
      });
    })
    .filter(Boolean);

  const enemyPresenceOverlays = getVisibleEnemyEntries(dungeonMap, room)
    .map((entry, index) => {
      const position = normalizePosition(entry && entry.position);
      if (!position) {
        return null;
      }

      return buildMarkerOverlay({
        overlay_id: `dungeon-visible-enemy-${cleanText(entry && entry.token_id, index + 1)}`,
        color: "#ff453a",
        opacity: 0.14,
        marker_style: "encounter",
        tile: {
          x: position.x,
          y: position.y,
          label: cleanText(entry && entry.badge_text, "FOE").slice(0, 3).toUpperCase(),
          marker_style: "encounter"
        }
      });
    })
    .filter(Boolean);

  return triggerOverlays.concat(enemyPresenceOverlays);
}

function buildMovePreviewOverlay(dungeonMap, room) {
  const moveTargets = getDungeonMoveTargets(dungeonMap, room);
  if (moveTargets.length === 0) {
    return null;
  }

  return buildSelectionOverlay({
    overlay_id: "dungeon-move-preview-overlay",
    color: "#34c759",
    opacity: 0.28,
    marker_style: "exit",
    tiles: moveTargets.map((entry) => ({
      x: entry.position.x,
      y: entry.position.y,
      label: abbreviateMarkerLabel(entry.direction, "GO"),
      marker_style: "exit"
    }))
  });
}

function buildPartyPathOverlay(dungeonMap) {
  const pathTiles = Array.isArray(dungeonMap.party_path) ? dungeonMap.party_path : [];
  const tiles = pathTiles
    .map((entry) => normalizePosition(entry && (entry.position || entry)))
    .filter(Boolean)
    .map((position) => ({
      x: position.x,
      y: position.y,
      label: "",
      marker_style: "path"
    }));

  if (tiles.length === 0) {
    return null;
  }

  return buildSelectionOverlay({
    overlay_id: "dungeon-party-path-overlay",
    color: "#64d2ff",
    opacity: 0.1,
    marker_style: "path",
    tiles
  });
}

function summarizeDungeonExit(entry) {
  const safe = entry && typeof entry === "object" ? entry : {};
  const direction = titleCaseWords(safe.direction, "");
  const destination = cleanText(safe.to_room_id, cleanText(safe.label, "unknown"));
  if (direction && destination) {
    return `${direction} -> ${destination}`;
  }
  return direction || destination || "Unknown exit";
}

function summarizeDungeonObject(entry) {
  const safe = entry && typeof entry === "object" ? entry : {};
  const state = safe.state && typeof safe.state === "object" ? safe.state : {};
  const name = cleanText(safe.name, cleanText(safe.object_id, "Unknown object"));
  const type = titleCaseWords(safe.object_type, "Object").toLowerCase();
  const tags = [];
  if (state.is_locked === true) tags.push("locked");
  if (state.is_open === true || state.is_opened === true) tags.push("open");
  if (state.is_disarmed === true) tags.push("safe");
  if (state.is_hidden === true) tags.push("hidden");
  return `${truncateText(name, 28)} [${type}${tags.length > 0 ? `; ${tags.join(", ")}` : ""}]`;
}

function summarizeDungeonThreat(entry) {
  const safe = entry && typeof entry === "object" ? entry : {};
  const name = cleanText(
    safe.label,
    cleanText(safe.name, cleanText(safe.actor_id, cleanText(safe.token_id, "Unknown threat")))
  );
  const positionText = formatGridPosition(safe.position);
  return positionText ? `${truncateText(name, 24)} at ${positionText}` : truncateText(name, 28);
}

function buildMaskSummaryLine(maskSummary) {
  const counts = maskSummary && maskSummary.marker_type_counts && typeof maskSummary.marker_type_counts === "object"
    ? maskSummary.marker_type_counts
    : {};
  const parts = Object.keys(counts)
    .sort()
    .map((key) => `${titleCaseWords(key, key).toLowerCase()} ${Number(counts[key])}`)
    .filter((entry) => !entry.endsWith(" 0"));

  if (parts.length === 0) {
    return "";
  }

  return `Mask markers: ${parts.slice(0, 4).join(" | ")}${parts.length > 4 ? ` | +${parts.length - 4} more` : ""}`;
}

function buildDungeonSummaryLines(payload, viewState) {
  const room = payload.room && typeof payload.room === "object" ? payload.room : {};
  const dungeonMap = payload.dungeon_map && typeof payload.dungeon_map === "object" ? payload.dungeon_map : {};
  const debugFlags = normalizeDungeonDebugFlags(viewState && viewState.debug_flags);
  const roomType = titleCaseWords(room.room_type, "Unknown");
  const partyPosition = normalizePosition(dungeonMap.party_position || room.party_position || (payload.session && payload.session.party_position));
  const exits = getMergedDungeonExits(dungeonMap, room)
    .map((entry) => summarizeDungeonExit(entry));
  const objects = mergeUniqueEntriesByKey(
    Array.isArray(dungeonMap.objects) ? dungeonMap.objects : [],
    Array.isArray(room.visible_objects) ? room.visible_objects : [],
    (entry) => cleanText(entry && entry.object_id, `${entry && entry.position ? `${entry.position.x},${entry.position.y}` : "object"}`)
  )
    .sort(compareEntriesByPosition)
    .map((entry) => summarizeDungeonObject(entry));
  const threats = mergeUniqueEntriesByKey(
    Array.isArray(dungeonMap.visible_enemy_tokens) ? dungeonMap.visible_enemy_tokens : [],
    getVisibleEnemyEntries(dungeonMap, room),
    (entry) => cleanText(entry && entry.token_id, `${entry && entry.position ? `${entry.position.x},${entry.position.y}` : "threat"}`)
  )
    .sort(compareEntriesByPosition)
    .map((entry) => summarizeDungeonThreat(entry));
  const lines = [[
    partyPosition ? `Party: ${formatGridPosition(partyPosition)}` : "",
    `Room Type: ${roomType}`
  ].filter(Boolean).join(" | ")];

  lines.push(formatSummaryList("Routes", exits, "none visible"));
  lines.push(formatSummaryList("Interactables", objects, "none visible"));
  lines.push(formatSummaryList("Threats", threats, "none visible"));

  if (room.encounter && typeof room.encounter === "object") {
    lines.push(`Encounter: ${cleanText(room.encounter.name || room.encounter.encounter_id, "active encounter")}`);
  }

  lines.push(formatDungeonDebugSummary(debugFlags));
  if (debugFlags.markers === true) {
    lines.push(buildMaskSummaryLine(dungeonMap.mask_summary));
  }

  return lines.filter(Boolean);
}

function buildDungeonMapComponents(options) {
  const dungeonMap = options.dungeon_map && typeof options.dungeon_map === "object" ? options.dungeon_map : {};
  const room = options.room && typeof options.room === "object" ? options.room : {};
  const sessionId = cleanText(options.session_id, "");
  if (!sessionId) {
    return [];
  }

  const rows = [];
  const moveTargets = getDungeonMoveTargets(dungeonMap, room);
  const isLeader = options.is_leader === true;
  const mode = cleanText(options.mode, "idle");
  const debugFlags = normalizeDungeonDebugFlags(options.debug_flags);

  function buildDebugToggleButtons() {
    return Object.keys(DUNGEON_DEBUG_FLAG_LABELS).map((key) => (
      new ButtonBuilder()
        .setCustomId(buildDungeonMapCustomId({
          action: DUNGEON_MAP_ACTIONS.DEBUG_TOGGLE,
          session_id: sessionId,
          value: key
        }))
        .setLabel(DUNGEON_DEBUG_FLAG_LABELS[key])
        .setStyle(debugFlags[key] === true ? ButtonStyle.Primary : ButtonStyle.Secondary)
    ));
  }

  if (mode === "move_preview") {
    const moveButtons = moveTargets
      .filter((entry) => entry.direction)
      .slice(0, 5)
      .map((entry) => (
        new ButtonBuilder()
          .setCustomId(buildDungeonMapCustomId({
            action: DUNGEON_MAP_ACTIONS.MOVE,
            session_id: sessionId,
            value: entry.direction
          }))
          .setLabel(toSafeButtonLabel(summarizeDungeonExit(entry), entry.label))
          .setStyle(ButtonStyle.Primary)
          .setDisabled(!isLeader)
      ));

    if (moveButtons.length > 0) {
      rows.push(new ActionRowBuilder().addComponents(moveButtons));
    }

    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildDungeonMapCustomId({
          action: DUNGEON_MAP_ACTIONS.BACK,
          session_id: sessionId
        }))
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary),
      ...buildDebugToggleButtons()
    ));
    return rows;
  }

  const controlButtons = [];
  if (moveTargets.length > 0) {
    controlButtons.push(
        new ButtonBuilder()
          .setCustomId(buildDungeonMapCustomId({
            action: DUNGEON_MAP_ACTIONS.PREVIEW_MOVE,
            session_id: sessionId
          }))
          .setLabel("Preview Move")
          .setStyle(ButtonStyle.Success)
          .setDisabled(!isLeader)
    );
  }
  controlButtons.push(...buildDebugToggleButtons());

  if (controlButtons.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(controlButtons));
  }

  return rows;
}

function buildDungeonMapOutputPath(options) {
  ensureDirectory(options.map_config.output_dir);
  const suffix = cleanText(options.suffix, "dungeon");
  const sessionId = cleanText(options.session_id, "session");
  const userId = cleanText(options.user_id, "user");
  return path.join(options.map_config.output_dir, `${sessionId}.${userId}.${suffix}.png`);
}

async function renderDungeonMapAttachments(options) {
  const outputPath = buildDungeonMapOutputPath(options);
  await renderMapAsync({
    map: options.map,
    format: "png",
    output_path: outputPath
  });
  return [outputPath];
}

async function buildDungeonMapState(options) {
  const data = options.data && typeof options.data === "object" ? options.data : {};
  const room = data.room && typeof data.room === "object" ? data.room : null;
  const session = data.session && typeof data.session === "object" ? data.session : {};
  const mapConfig = options.map_config;
  if (!room || !mapConfig) {
    return {
      ok: false,
      error: "room snapshot and dungeon map config are required"
    };
  }

  const map = loadMapWithProfile({
    map_path: mapConfig.map_path,
    profile_path: mapConfig.profile_path
  });
  const dungeonMap = mapConfig.dungeon_map || {};
  const maskDerived = await buildDungeonEntriesFromMaskPath(map, {
    mask_path: dungeonMap.mask_path || "",
    palette_id: dungeonMap.mask_palette_id || ""
  });
  const mergedDungeonMap = clone(dungeonMap);
  if (!normalizePosition(mergedDungeonMap.party_position) && normalizePosition(maskDerived.party_position)) {
    mergedDungeonMap.party_position = normalizePosition(maskDerived.party_position);
  }
  mergedDungeonMap.visible_enemy_tokens = mergeUniqueEntriesByKey(
    Array.isArray(mergedDungeonMap.visible_enemy_tokens) ? mergedDungeonMap.visible_enemy_tokens : [],
    maskDerived.visible_enemy_tokens || [],
    (entry) => cleanText(entry && entry.token_id, `${entry && entry.position ? `${entry.position.x},${entry.position.y}` : "enemy"}`)
  );
  mergedDungeonMap.objects = mergeUniqueEntriesByKey(
    Array.isArray(mergedDungeonMap.objects) ? mergedDungeonMap.objects : [],
    maskDerived.objects || [],
    (entry) => cleanText(entry && entry.object_id, `${entry && entry.position ? `${entry.position.x},${entry.position.y}` : "object"}`)
  );
  mergedDungeonMap.exits = mergeUniqueEntriesByKey(
    Array.isArray(mergedDungeonMap.exits) ? mergedDungeonMap.exits : [],
    maskDerived.exits || [],
    (entry) => cleanText(entry && entry.to_room_id, `${entry && entry.position ? `${entry.position.x},${entry.position.y}` : "exit"}`)
  );
  mergedDungeonMap.encounter_triggers = mergeUniqueEntriesByKey(
    Array.isArray(mergedDungeonMap.encounter_triggers) ? mergedDungeonMap.encounter_triggers : [],
    maskDerived.encounter_triggers || [],
    (entry) => cleanText(entry && entry.encounter_id, `${entry && entry.position ? `${entry.position.x},${entry.position.y}` : "encounter"}`)
  );
  if (maskDerived.summary) {
    mergedDungeonMap.mask_summary = maskDerived.summary;
  }

  const partyToken = buildPartyToken(data, mergedDungeonMap);
  const enemyTokens = buildVisibleEnemyTokens(mergedDungeonMap, room);
  map.tokens = [].concat(partyToken ? [partyToken] : [], enemyTokens);

  const overlays = [
    buildPartyPathOverlay(mergedDungeonMap),
    buildExitOverlay(mergedDungeonMap, room),
    ...buildObjectOverlays(mergedDungeonMap, room),
    ...buildEncounterOverlays(mergedDungeonMap, room)
  ].filter(Boolean);
  if (options.view_state && options.view_state.mode === "move_preview") {
    const movePreviewOverlay = buildMovePreviewOverlay(mergedDungeonMap, room);
    if (movePreviewOverlay) {
      overlays.push(movePreviewOverlay);
    }
  }
  map.overlays = [].concat(Array.isArray(map.overlays) ? map.overlays : [], overlays);
  map.render_debug = normalizeDungeonDebugFlags(options.view_state && options.view_state.debug_flags);

  const validation = validateMapStateShape(map);
  if (!validation.ok) {
    return {
      ok: false,
      error: `invalid dungeon map state: ${validation.errors.join("; ")}`
    };
  }

  return {
    ok: true,
    payload: {
      map,
      session_id: cleanText(data.session_id, cleanText(session.session_id, "")),
      room_id: cleanText(room.room_id, ""),
      room_name: cleanText(room.name, cleanText(room.room_id, "Unknown Room")),
      leader_id: getLeaderId(data, mergedDungeonMap),
      room: clone(room),
      dungeon_map: clone(mergedDungeonMap)
    }
  };
}

async function buildDungeonMapView(options) {
  const data = options.data && typeof options.data === "object" ? options.data : {};
  const room = data.room && typeof data.room === "object" ? data.room : null;
  if (!room) {
    return {
      ok: false,
      error: "room snapshot is required"
    };
  }

  const mapConfig = options.map_config || resolveDungeonMapConfig(data);
  if (!mapConfig || !fs.existsSync(mapConfig.map_path)) {
    return {
      ok: false,
      error: "dungeon map config is unavailable"
    };
  }

  const built = await buildDungeonMapState({
    data,
    map_config: mapConfig,
    view_state: options.view_state || null
  });
  if (!built.ok) {
    return built;
  }

  const payload = built.payload;
  const files = await renderDungeonMapAttachments({
    map_config: mapConfig,
    map: payload.map,
    session_id: payload.session_id,
    user_id: options.user_id,
    suffix: options.suffix || "dungeon"
  });

  return {
    ok: true,
    payload: {
      files,
      content: [
        cleanText(
          options.content,
          (options.view_state && options.view_state.mode === "move_preview")
            ? "Dungeon move preview ready."
            : "Dungeon map ready."
        ),
        ...buildDungeonSummaryLines(payload, options.view_state),
        options.view_state && options.view_state.mode === "move_preview"
          ? "Mode: Move Preview"
          : "Mode: Exploration"
      ].join("\n"),
      map: payload.map,
      session_id: payload.session_id,
      room_id: payload.room_id,
      map_config: mapConfig,
      dungeon_map: payload.dungeon_map,
      components: buildDungeonMapComponents({
        dungeon_map: payload.dungeon_map,
        room,
        session_id: payload.session_id,
        is_leader: cleanText(options.user_id, "") === cleanText(payload.leader_id, ""),
        mode: options.view_state && options.view_state.mode ? options.view_state.mode : "idle",
        debug_flags: options.view_state && options.view_state.debug_flags
      }),
      view_state: {
        mode: options.view_state && options.view_state.mode ? options.view_state.mode : "idle",
        debug_flags: normalizeDungeonDebugFlags(options.view_state && options.view_state.debug_flags)
      }
    }
  };
}

module.exports = {
  DUNGEON_MAP_ACTIONS,
  DUNGEON_DEBUG_FLAG_LABELS,
  resolveDungeonMapConfig,
  buildDungeonMapCustomId,
  parseDungeonMapCustomId,
  normalizeDungeonDebugFlags,
  toggleDungeonDebugFlag,
  getDungeonMoveTargets,
  buildDungeonMapState,
  buildDungeonMapView
};
