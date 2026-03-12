"use strict";

// Shared event schema for the whole system.
// Every system should send and receive this same shape.
const EVENT_VERSION = 1;
const SUPPORTED_EVENT_VERSIONS = [EVENT_VERSION];
const REQUIRED_EVENT_FIELDS = [
  "event_id",
  "event_version",
  "event_type",
  "timestamp",
  "source",
  "target_system",
  "player_id",
  "session_id",
  "combat_id",
  "payload"
];

/**
 * Build a normalized event object.
 * Event flow:
 * 1) Gateway creates an event with createEvent(...)
 * 2) Queue stores the event in FIFO order
 * 3) Router sends the event to matching handlers
 * 4) Handlers may return new events with the same schema
 *
 * @param {string} eventType - Event name (example: "player_move").
 * @param {object} payload - Event data (scaffolding only, no gameplay logic).
 * @param {object} [context] - Optional metadata for top-level event fields.
 * @returns {object}
 */
function createEvent(eventType, payload, context) {
  const safePayload = payload || {};
  const safeContext = context || {};

  // Support both beginner-friendly and existing key names.
  // This keeps Phase 1 scaffolding stable while using one shared schema.
  const playerId =
    safeContext.player_id ||
    safeContext.playerId ||
    safeContext.user_id ||
    null;
  const sessionId =
    safeContext.session_id ||
    safeContext.sessionId ||
    null;
  const combatId =
    safeContext.combat_id ||
    safeContext.combatId ||
    safePayload.combat_id ||
    null;

  const requestedEventVersion = Number(safeContext.event_version);
  const eventVersion = Number.isFinite(requestedEventVersion)
    ? Math.floor(requestedEventVersion)
    : EVENT_VERSION;

  return {
    event_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    event_version: eventVersion,
    event_type: eventType,
    timestamp: new Date().toISOString(),
    source: safeContext.source || "unknown",
    target_system: safeContext.target_system || safeContext.targetSystem || "event_router",
    player_id: playerId,
    session_id: sessionId,
    combat_id: combatId,
    payload: safePayload
  };
}

function isSupportedEventVersion(eventVersion) {
  if (!Number.isFinite(eventVersion)) {
    return false;
  }
  return SUPPORTED_EVENT_VERSIONS.includes(Math.floor(Number(eventVersion)));
}

function validateEventContract(event) {
  if (!event || typeof event !== "object") {
    return {
      ok: false,
      error: "event must be an object",
      error_code: "event_not_object"
    };
  }

  for (const field of REQUIRED_EVENT_FIELDS) {
    if (!(field in event)) {
      return {
        ok: false,
        error: "event is missing required field: " + field,
        error_code: "event_missing_required_field",
        field
      };
    }
  }

  if (!Number.isFinite(event.event_version)) {
    return {
      ok: false,
      error: "event_version must be a number",
      error_code: "event_version_invalid_type"
    };
  }

  const normalizedVersion = Math.floor(Number(event.event_version));
  if (!isSupportedEventVersion(normalizedVersion)) {
    return {
      ok: false,
      error: "unsupported event_version: " + String(event.event_version),
      error_code: "event_version_unsupported",
      supported_versions: SUPPORTED_EVENT_VERSIONS.slice()
    };
  }

  return {
    ok: true,
    error: null,
    error_code: null,
    event_version: normalizedVersion
  };
}

/**
 * Validate that an object looks like a Phase 1 event.
 * @param {object} event
 * @returns {boolean}
 */
function isValidEvent(event) {
  const contract = validateEventContract(event);
  if (!contract.ok) return false;

  const hasStringBasics =
    typeof event.event_id === "string" &&
    typeof event.event_type === "string" &&
    typeof event.timestamp === "string" &&
    typeof event.source === "string" &&
    typeof event.target_system === "string";

  const hasIdsOrNull =
    (typeof event.player_id === "string" || event.player_id === null) &&
    (typeof event.session_id === "string" || event.session_id === null) &&
    (typeof event.combat_id === "string" || event.combat_id === null);

  const hasPayloadObject =
    typeof event.payload === "object" &&
    event.payload !== null &&
    !Array.isArray(event.payload);

  return hasStringBasics && hasIdsOrNull && hasPayloadObject;
}

module.exports = {
  EVENT_VERSION,
  SUPPORTED_EVENT_VERSIONS,
  REQUIRED_EVENT_FIELDS,
  isSupportedEventVersion,
  validateEventContract,
  createEvent,
  isValidEvent
};
