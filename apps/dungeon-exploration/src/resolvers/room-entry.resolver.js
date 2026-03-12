"use strict";

const ROOM_ENTRY_OUTCOMES = {
  COMBAT_ENCOUNTER: "combat_encounter",
  CHALLENGE: "challenge",
  INTERACTABLE_OBJECTS: "interactable_objects",
  REST_ROOM: "rest_room",
  BOSS_ROOM: "boss_room",
  EMPTY_ROOM: "empty_room"
};

const NEXT_SYSTEMS = {
  COMBAT: "combat_system",
  CHALLENGE: "challenge_system",
  INTERACTION: "interaction_system",
  SESSION: "session_system",
  NONE: "none"
};

/**
 * Determine what type of room was entered and what system should activate next.
 * This resolver only returns instructions. It does not start combat or execute gameplay.
 *
 * Priority order:
 * 1) boss_room
 * 2) combat_encounter (encounter_id exists or room_type indicates encounter)
 * 3) challenge (challenge_id exists or room_type indicates challenge)
 * 4) interactable_objects (objects exist or room_type indicates objects)
 * 5) rest_room
 * 6) empty_room
 */
function resolveRoomEntry(input) {
  const value = input || {};
  const session = value.session || null;
  const room = value.room || null;

  if (!session || !room) {
    return {
      ok: false,
      event_type: "room_entry_resolution_failed",
      reason: "session_and_room_required",
      payload: null
    };
  }

  const roomType = String(room.room_type || "").toLowerCase();
  const hasEncounter = Boolean(room.encounter_id) || roomType === "combat_encounter";
  const hasChallenge = Boolean(room.challenge_id) || roomType === "challenge";
  const hasObjects = Array.isArray(room.objects) && room.objects.length > 0;
  const hasInteractionType = roomType === "interactable_objects";
  const isRestRoom = roomType === "rest_room";
  const isBossRoom = roomType === "boss_room";

  let outcome = ROOM_ENTRY_OUTCOMES.EMPTY_ROOM;
  let targetSystem = NEXT_SYSTEMS.NONE;

  if (isBossRoom) {
    outcome = ROOM_ENTRY_OUTCOMES.BOSS_ROOM;
    targetSystem = NEXT_SYSTEMS.COMBAT;
  } else if (hasEncounter) {
    outcome = ROOM_ENTRY_OUTCOMES.COMBAT_ENCOUNTER;
    targetSystem = NEXT_SYSTEMS.COMBAT;
  } else if (hasChallenge) {
    outcome = ROOM_ENTRY_OUTCOMES.CHALLENGE;
    targetSystem = NEXT_SYSTEMS.CHALLENGE;
  } else if (hasObjects || hasInteractionType) {
    outcome = ROOM_ENTRY_OUTCOMES.INTERACTABLE_OBJECTS;
    targetSystem = NEXT_SYSTEMS.INTERACTION;
  } else if (isRestRoom) {
    outcome = ROOM_ENTRY_OUTCOMES.REST_ROOM;
    targetSystem = NEXT_SYSTEMS.SESSION;
  }

  return {
    ok: true,
    event_type: "room_entry_resolved",
    payload: {
      session_id: session.session_id,
      party_id: session.party_id,
      room_id: room.room_id,
      room_type: room.room_type,
      outcome,
      target_system: targetSystem,
      next_action: {
        event_type: `room_outcome_${outcome}`,
        should_activate: targetSystem !== NEXT_SYSTEMS.NONE
      },
      metadata: {
        encounter_id: room.encounter_id || null,
        challenge_id: room.challenge_id || null,
        object_count: Array.isArray(room.objects) ? room.objects.length : 0
      },
      resolved_at: new Date().toISOString()
    }
  };
}

module.exports = {
  ROOM_ENTRY_OUTCOMES,
  NEXT_SYSTEMS,
  resolveRoomEntry
};

