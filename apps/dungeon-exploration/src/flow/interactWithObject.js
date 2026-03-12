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

const SUPPORTED_OBJECT_TYPES = ["chest", "lever", "shrine", "lore_object", "trap"];
const SUPPORTED_INTERACTION_ACTIONS = ["open", "unlock", "activate", "use", "read", "disarm"];
const SUPPORTED_UTILITY_SPELL_IDS = new Set(["light", "thaumaturgy"]);

function normalizeObjectType(value) {
  return value ? String(value).trim().toLowerCase() : "";
}

function getInteractionOutcomeByType(objectType) {
  if (objectType === "chest") {
    return {
      action: "opened",
      next_event_type: "room_object_chest_opened"
    };
  }

  if (objectType === "lever") {
    return {
      action: "activated",
      next_event_type: "room_object_lever_activated"
    };
  }

  if (objectType === "shrine") {
    return {
      action: "used",
      next_event_type: "room_object_shrine_used"
    };
  }

  if (objectType === "trap") {
    return {
      action: "disarmed",
      next_event_type: "room_object_trap_disarmed"
    };
  }

  return {
    action: "read",
    next_event_type: "room_object_lore_read"
  };
}

function normalizeAction(value) {
  return value ? String(value).trim().toLowerCase() : "";
}

function resolveRequestedAction(objectType, action) {
  const normalized = normalizeAction(action);
  if (!normalized) {
    if (objectType === "chest") {
      return "open";
    }
    if (objectType === "lever") {
      return "activate";
    }
    if (objectType === "shrine") {
      return "use";
    }
    if (objectType === "trap") {
      return "disarm";
    }
    return "read";
  }
  return normalized;
}

function getAllowedActionsForType(objectType) {
  if (objectType === "chest") {
    return ["open", "unlock"];
  }
  if (objectType === "lever") {
    return ["activate"];
  }
  if (objectType === "shrine") {
    return ["use"];
  }
  if (objectType === "trap") {
    return ["disarm"];
  }
  return ["read"];
}

function normalizeUtilitySpell(spell) {
  if (!spell || typeof spell !== "object") {
    return null;
  }
  const spellId = spell.spell_id || spell.id ? String(spell.spell_id || spell.id).trim().toLowerCase() : "";
  if (!SUPPORTED_UTILITY_SPELL_IDS.has(spellId)) {
    return null;
  }
  const utilityRef = spell.effect && spell.effect.utility_ref
    ? String(spell.effect.utility_ref).trim().toLowerCase()
    : "";
  if (!utilityRef) {
    return null;
  }
  return {
    spell_id: spellId,
    spell_name: spell.name || spellId,
    utility_ref: utilityRef
  };
}

function applyUtilitySpellToObject(input) {
  const data = input || {};
  const liveObject = data.liveObject;
  const objectType = normalizeObjectType(data.objectType);
  const utilitySpell = normalizeUtilitySpell(data.spell);
  if (!utilitySpell) {
    return failure("dungeon_object_interaction_failed", "utility spell is not supported for interaction");
  }

  const metadata = liveObject && liveObject.metadata && typeof liveObject.metadata === "object"
    ? liveObject.metadata
    : {};

  if (utilitySpell.spell_id === "light") {
    if (!["lore_object", "shrine"].includes(objectType)) {
      return failure("dungeon_object_interaction_failed", "light cannot affect this object type", {
        object_type: objectType,
        spell_id: utilitySpell.spell_id
      });
    }
    liveObject.is_lit = true;
    liveObject.last_spell_effect = utilitySpell.spell_id;
    metadata.requires_light = false;
    metadata.is_dark = false;
    metadata.illuminated_by_spell_id = utilitySpell.spell_id;
    liveObject.metadata = metadata;
    return success("dungeon_object_spell_applied", {
      spell_effect: {
        spell_id: utilitySpell.spell_id,
        spell_name: utilitySpell.spell_name,
        utility_ref: utilitySpell.utility_ref,
        object_state: "illuminated"
      }
    });
  }

  if (utilitySpell.spell_id === "thaumaturgy") {
    if (!["lever", "shrine"].includes(objectType)) {
      return failure("dungeon_object_interaction_failed", "thaumaturgy cannot affect this object type", {
        object_type: objectType,
        spell_id: utilitySpell.spell_id
      });
    }
    liveObject.last_spell_effect = utilitySpell.spell_id;
    metadata.requires_thaumaturgy = false;
    metadata.activated_by_spell_id = utilitySpell.spell_id;
    liveObject.metadata = metadata;
    return success("dungeon_object_spell_applied", {
      spell_effect: {
        spell_id: utilitySpell.spell_id,
        spell_name: utilitySpell.spell_name,
        utility_ref: utilitySpell.utility_ref,
        object_state: "spell_attuned"
      }
    });
  }

  return failure("dungeon_object_interaction_failed", "utility spell is not supported for interaction");
}

function interactWithObject(input) {
  const data = input || {};
  const manager = data.manager;
  const sessionId = data.session_id ? String(data.session_id) : "";
  const objectId = data.object_id ? String(data.object_id) : "";
  const requestedAction = normalizeAction(data.action);
  const utilitySpell = normalizeUtilitySpell(data.spell);

  if (!manager || typeof manager.getSessionById !== "function") {
    return failure("dungeon_object_interaction_failed", "manager with getSessionById is required");
  }
  if (!sessionId) {
    return failure("dungeon_object_interaction_failed", "session_id is required");
  }
  if (!objectId) {
    return failure("dungeon_object_interaction_failed", "object_id is required", {
      session_id: sessionId
    });
  }
  if (requestedAction && !SUPPORTED_INTERACTION_ACTIONS.includes(requestedAction)) {
    return failure("dungeon_object_interaction_failed", "unsupported interaction action", {
      session_id: sessionId,
      object_id: objectId,
      action: requestedAction,
      supported_actions: clone(SUPPORTED_INTERACTION_ACTIONS)
    });
  }

  const found = manager.getSessionById(sessionId);
  if (!found.ok) {
    return failure("dungeon_object_interaction_failed", "session not found", {
      session_id: sessionId,
      object_id: objectId
    });
  }

  const session = found.payload.session;
  const currentRoomId = session.current_room_id ? String(session.current_room_id) : "";
  if (!currentRoomId) {
    return failure("dungeon_object_interaction_failed", "current_room_id is not set", {
      session_id: sessionId
    });
  }

  const rooms = Array.isArray(session.rooms) ? session.rooms : [];
  const room = rooms.find((x) => String(x.room_id) === currentRoomId);
  if (!room) {
    return failure("dungeon_object_interaction_failed", "current room not found in session rooms", {
      session_id: sessionId,
      current_room_id: currentRoomId
    });
  }

  const objects = Array.isArray(room.objects) ? room.objects : [];
  const targetObject = objects.find((x) => x && String(x.object_id) === objectId);
  if (!targetObject) {
    return failure("dungeon_object_interaction_failed", "object not found in current room", {
      session_id: sessionId,
      room_id: currentRoomId,
      object_id: objectId
    });
  }

  const objectType = normalizeObjectType(targetObject.object_type || targetObject.type);
  if (!SUPPORTED_OBJECT_TYPES.includes(objectType)) {
    return failure("dungeon_object_interaction_failed", "unsupported object type", {
      session_id: sessionId,
      room_id: currentRoomId,
      object_id: objectId,
      object_type: objectType,
      supported_object_types: clone(SUPPORTED_OBJECT_TYPES)
    });
  }

  const outcome = getInteractionOutcomeByType(objectType);
  const action = resolveRequestedAction(objectType, requestedAction);
  const allowedActions = getAllowedActionsForType(objectType);
  if (!allowedActions.includes(action)) {
    return failure("dungeon_object_interaction_failed", "action is not supported for object type", {
      session_id: sessionId,
      room_id: currentRoomId,
      object_id: objectId,
      object_type: objectType,
      action,
      allowed_actions: clone(allowedActions)
    });
  }

  // Update live session state so object status flags persist in memory.
  const liveSession = manager.sessions.get(sessionId);
  if (!liveSession) {
    return failure("dungeon_object_interaction_failed", "session missing during state update", {
      session_id: sessionId
    });
  }

  const liveRoom = Array.isArray(liveSession.rooms)
    ? liveSession.rooms.find((x) => String(x.room_id) === currentRoomId)
    : null;
  if (!liveRoom) {
    return failure("dungeon_object_interaction_failed", "current room missing during state update", {
      session_id: sessionId,
      current_room_id: currentRoomId
    });
  }

  liveRoom.objects = Array.isArray(liveRoom.objects) ? liveRoom.objects : [];
  const liveObject = liveRoom.objects.find((x) => x && String(x.object_id) === objectId);
  if (!liveObject) {
    return failure("dungeon_object_interaction_failed", "object missing during state update", {
      session_id: sessionId,
      room_id: currentRoomId,
      object_id: objectId
    });
  }

  const wasLocked = Boolean(liveObject.is_locked || (liveObject.metadata && liveObject.metadata.locked));
  let spellEffect = null;
  if (utilitySpell) {
    const spellApplied = applyUtilitySpellToObject({
      liveObject,
      objectType,
      spell: data.spell
    });
    if (!spellApplied.ok) {
      return spellApplied;
    }
    spellEffect = spellApplied.payload.spell_effect || null;
  }
  const liveMetadata = liveObject.metadata && typeof liveObject.metadata === "object" ? liveObject.metadata : {};
  const requiresLight = Boolean(liveMetadata.requires_light || liveMetadata.is_dark);
  const requiresThaumaturgy = Boolean(liveMetadata.requires_thaumaturgy);

  if (requiresLight && ["read", "use"].includes(action)) {
    return failure("dungeon_object_interaction_failed", "object requires light", {
      session_id: sessionId,
      room_id: currentRoomId,
      object_id: objectId,
      action
    });
  }
  if (requiresThaumaturgy && ["activate", "use"].includes(action)) {
    return failure("dungeon_object_interaction_failed", "object requires thaumaturgy", {
      session_id: sessionId,
      room_id: currentRoomId,
      object_id: objectId,
      action
    });
  }

  if (objectType === "chest" && action === "unlock") {
    if (!wasLocked) {
      return failure("dungeon_object_interaction_failed", "object is not locked", {
        session_id: sessionId,
        room_id: currentRoomId,
        object_id: objectId
      });
    }
    liveObject.is_locked = false;
    if (liveObject.metadata && typeof liveObject.metadata === "object") {
      liveObject.metadata.locked = false;
    }
    liveObject.is_unlocked = true;
  } else {
    if (wasLocked) {
      return failure("dungeon_object_interaction_failed", "object is locked", {
        session_id: sessionId,
        room_id: currentRoomId,
        object_id: objectId
      });
    }
  }

  if (action === "open" && liveObject.is_opened) {
    return failure("dungeon_object_interaction_failed", "object already opened", {
      session_id: sessionId,
      room_id: currentRoomId,
      object_id: objectId
    });
  }
  if (action === "activate" && liveObject.is_activated) {
    return failure("dungeon_object_interaction_failed", "object already activated", {
      session_id: sessionId,
      room_id: currentRoomId,
      object_id: objectId
    });
  }
  if (action === "use" && liveObject.is_used) {
    return failure("dungeon_object_interaction_failed", "object already used", {
      session_id: sessionId,
      room_id: currentRoomId,
      object_id: objectId
    });
  }
  if (action === "read" && liveObject.is_read) {
    return failure("dungeon_object_interaction_failed", "object already read", {
      session_id: sessionId,
      room_id: currentRoomId,
      object_id: objectId
    });
  }

  if (action === "unlock") {
    outcome.action = "unlocked";
    outcome.next_event_type = "room_object_chest_unlocked";
  } else if (action === "disarm") {
    if (liveObject.is_disarmed) {
      return failure("dungeon_object_interaction_failed", "object already disarmed", {
        session_id: sessionId,
        room_id: currentRoomId,
        object_id: objectId
      });
    }
    liveObject.is_disarmed = true;
    outcome.action = "disarmed";
    outcome.next_event_type = "room_object_trap_disarmed";
  } else if (outcome.action === "opened") {
    liveObject.is_opened = true;
  } else if (outcome.action === "activated") {
    liveObject.is_activated = true;
  } else if (outcome.action === "used") {
    liveObject.is_used = true;
  } else if (outcome.action === "read") {
    liveObject.is_read = true;
  }

  liveObject.last_interaction_at = new Date().toISOString();

  liveSession.event_log = Array.isArray(liveSession.event_log) ? liveSession.event_log : [];
  liveSession.event_log.push({
    event_type: "dungeon_object_interacted",
    timestamp: new Date().toISOString(),
    room_id: currentRoomId,
    object_id: objectId,
    object_type: objectType,
    interaction_action: outcome.action
  });
  liveSession.updated_at = new Date().toISOString();
  manager.sessions.set(sessionId, liveSession);

  const updated = manager.getSessionById(sessionId);
  return success("dungeon_object_interacted", {
    session_id: sessionId,
    room_id: currentRoomId,
    object_id: objectId,
    object_type: objectType,
    interaction_action: outcome.action,
    object_state: {
      is_locked: Boolean(liveObject.is_locked),
      is_unlocked: Boolean(liveObject.is_unlocked),
      is_opened: Boolean(liveObject.is_opened),
      is_lit: Boolean(liveObject.is_lit),
      is_disarmed: Boolean(liveObject.is_disarmed),
      is_activated: Boolean(liveObject.is_activated),
      is_used: Boolean(liveObject.is_used),
      is_read: Boolean(liveObject.is_read)
    },
    spell_effect: spellEffect,
    reward_hint:
      objectType === "chest" && outcome.action === "opened"
        ? {
            reward_context: "chest_opened",
            loot_table_id:
              liveObject.loot_table_id ||
              (liveObject.metadata && liveObject.metadata.loot_table_id) ||
              null,
            loot_table:
              liveObject.loot_table && typeof liveObject.loot_table === "object"
                ? clone(liveObject.loot_table)
                : (liveObject.metadata && liveObject.metadata.loot_table && typeof liveObject.metadata.loot_table === "object"
                  ? clone(liveObject.metadata.loot_table)
                  : null),
            reward_update:
              liveObject.reward_update && typeof liveObject.reward_update === "object"
                ? clone(liveObject.reward_update)
                : (liveObject.metadata && liveObject.metadata.reward_update && typeof liveObject.metadata.reward_update === "object"
                  ? clone(liveObject.metadata.reward_update)
                  : null)
          }
        : null,
    next_event: {
      event_type: outcome.next_event_type,
      target_system: "session_system",
      should_activate: true
    },
    session: updated.ok ? clone(updated.payload.session) : clone(session)
  });
}

module.exports = {
  SUPPORTED_OBJECT_TYPES,
  SUPPORTED_INTERACTION_ACTIONS,
  interactWithObject,
  getInteractionOutcomeByType
};
