"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

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

function normalizeExit(exitInput) {
  if (typeof exitInput === "string" && exitInput.trim() !== "") {
    return exitInput.trim();
  }

  const value = exitInput && typeof exitInput === "object" ? exitInput : null;
  if (!value) {
    return null;
  }

  if (!value.direction && !value.to_room_id) {
    return null;
  }

  return {
    direction: value.direction ? String(value.direction) : null,
    to_room_id: value.to_room_id ? String(value.to_room_id) : null
  };
}

function createRoomObject(input) {
  const data = input || {};
  if (!data.room_id || String(data.room_id).trim() === "") {
    throw new Error("room_id is required");
  }

  const exitsInput = Array.isArray(data.exits) ? data.exits : [];
  const exits = exitsInput
    .map(normalizeExit)
    .filter((x) => x !== null);

  return {
    room_id: String(data.room_id),
    name: data.name ? String(data.name) : "",
    description: data.description ? String(data.description) : "",
    // Flexible room type, with common values like:
    // empty, encounter, challenge, rest, boss.
    room_type: data.room_type ? String(data.room_type) : "empty",
    exits,
    encounter: data.encounter && typeof data.encounter === "object" ? clone(data.encounter) : null,
    challenge: data.challenge && typeof data.challenge === "object" ? clone(data.challenge) : null,
    objects: Array.isArray(data.objects) ? clone(data.objects) : [],
    discovered: Boolean(data.discovered),
    cleared: Boolean(data.cleared)
  };
}

// Structured wrapper used by Stage 2 flow code.
function createRoomModel(input) {
  try {
    const room = createRoomObject(input);
    return success("room_created", { room });
  } catch (error) {
    return failure("room_create_failed", error.message);
  }
}

module.exports = {
  createRoomObject,
  createRoomModel
};
