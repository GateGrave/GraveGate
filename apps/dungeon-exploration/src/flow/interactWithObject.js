"use strict";

const { resolveInteractionCheck } = require("./resolveInteractionCheck");

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

const SUPPORTED_OBJECT_TYPES = ["chest", "lever", "shrine", "lore_object", "trap", "door"];
const SUPPORTED_INTERACTION_ACTIONS = ["open", "unlock", "activate", "use", "read", "disarm"];
const SUPPORTED_UTILITY_SPELL_IDS = new Set(["light", "thaumaturgy", "knock", "detect_magic", "identify"]);

function normalizeSkillProfile(skills) {
  return skills && typeof skills === "object" && !Array.isArray(skills) ? skills : {};
}

function hasSkillProficiency(skillProfile, skillId) {
  const normalizedSkillId = skillId ? String(skillId).trim().toLowerCase() : "";
  if (!normalizedSkillId) {
    return false;
  }
  const value = skillProfile[normalizedSkillId];
  if (value === true) {
    return true;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0;
  }
  if (value && typeof value === "object") {
    if (value.proficient === true || value.trained === true || value.enabled === true) {
      return true;
    }
    if (typeof value.modifier === "number" && Number.isFinite(value.modifier)) {
      return value.modifier > 0;
    }
  }
  return false;
}

function actionMatchesSkillRequirement(metadata, action) {
  const requiredActions = Array.isArray(metadata && metadata.required_skill_actions)
    ? metadata.required_skill_actions.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
    : (metadata && metadata.required_skill_action ? [String(metadata.required_skill_action).trim().toLowerCase()] : []);
  if (requiredActions.length === 0) {
    return true;
  }
  return requiredActions.includes(String(action || "").trim().toLowerCase());
}

function resolveRequiredSkillFailure(skillId) {
  return "object requires " + String(skillId || "a required skill");
}

function normalizeToolProfile(tools) {
  if (Array.isArray(tools)) {
    return tools.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean);
  }
  if (tools && typeof tools === "object") {
    return Object.keys(tools)
      .filter((key) => tools[key] === true || (typeof tools[key] === "number" && Number.isFinite(tools[key]) && tools[key] > 0))
      .map((key) => String(key || "").trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function hasToolProficiency(toolProfile, toolId) {
  const normalizedToolId = toolId ? String(toolId).trim().toLowerCase() : "";
  if (!normalizedToolId) {
    return false;
  }
  return Array.isArray(toolProfile) && toolProfile.includes(normalizedToolId);
}

function actionMatchesToolRequirement(metadata, action) {
  const requiredActions = Array.isArray(metadata && metadata.required_tool_actions)
    ? metadata.required_tool_actions.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
    : (metadata && metadata.required_tool_action ? [String(metadata.required_tool_action).trim().toLowerCase()] : []);
  if (requiredActions.length === 0) {
    return true;
  }
  return requiredActions.includes(String(action || "").trim().toLowerCase());
}

function resolveRequiredToolFailure(toolId) {
  return "object requires " + String(toolId || "a required tool");
}

function resolveCheckFailure(checkType, targetId) {
  if (checkType === "tool") {
    return resolveRequiredToolFailure(targetId);
  }
  if (checkType === "ability") {
    return "object requires a successful " + String(targetId || "ability") + " check";
  }
  return resolveRequiredSkillFailure(targetId);
}

function findObjectInSessionRooms(session, objectId) {
  const rooms = Array.isArray(session && session.rooms) ? session.rooms : [];
  for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 1) {
    const room = rooms[roomIndex];
    const objects = Array.isArray(room && room.objects) ? room.objects : [];
    const found = objects.find((entry) => entry && String(entry.object_id || "") === String(objectId || ""));
    if (found) {
      return {
        room,
        object: found
      };
    }
  }
  return null;
}

function buildGenericRewardHint(liveObject, objectType, action) {
  const metadata = liveObject && liveObject.metadata && typeof liveObject.metadata === "object"
    ? liveObject.metadata
    : {};
  const rewardContext = metadata.reward_context
    ? String(metadata.reward_context)
    : (
      objectType === "chest" && action === "opened"
        ? "chest_opened"
        : null
    );
  if (!rewardContext) {
    return null;
  }
  return {
    reward_context: rewardContext,
    loot_table_id: liveObject.loot_table_id || metadata.loot_table_id || null,
    loot_table:
      liveObject.loot_table && typeof liveObject.loot_table === "object"
        ? clone(liveObject.loot_table)
        : (metadata.loot_table && typeof metadata.loot_table === "object" ? clone(metadata.loot_table) : null),
    reward_update:
      liveObject.reward_update && typeof liveObject.reward_update === "object"
        ? clone(liveObject.reward_update)
        : (metadata.reward_update && typeof metadata.reward_update === "object" ? clone(metadata.reward_update) : null)
  };
}

function applyLinkedInteractionEffects(liveSession, liveObject, objectType, action) {
  const metadata = liveObject && liveObject.metadata && typeof liveObject.metadata === "object"
    ? liveObject.metadata
    : {};
  const effects = [];

  if (objectType === "lever" && action === "activated") {
    const linkedObjectId = metadata.linked_object_id ? String(metadata.linked_object_id) : "";
    if (linkedObjectId) {
      const linked = findObjectInSessionRooms(liveSession, linkedObjectId);
      if (linked && linked.object) {
        const linkedMetadata = linked.object.metadata && typeof linked.object.metadata === "object"
          ? linked.object.metadata
          : {};
        if (String(linked.object.object_type || linked.object.type || "").toLowerCase() === "door") {
          linked.object.is_locked = false;
          linked.object.is_unlocked = true;
          linked.object.is_opened = true;
          linkedMetadata.locked = false;
          linkedMetadata.opened_by_link = liveObject.object_id || null;
          linked.object.metadata = linkedMetadata;
          effects.push({
            effect_type: "linked_object_opened",
            object_id: linked.object.object_id || null,
            room_id: linked.room && linked.room.room_id ? linked.room.room_id : null
          });
        }
      }
    }
  }

  if (objectType === "lore_object" && action === "read") {
    const discoveryKey = metadata.discovery_key ? String(metadata.discovery_key) : "";
    if (discoveryKey) {
      liveSession.discovery_state = liveSession.discovery_state && typeof liveSession.discovery_state === "object"
        ? liveSession.discovery_state
        : { lore_keys: [] };
      liveSession.discovery_state.lore_keys = Array.isArray(liveSession.discovery_state.lore_keys)
        ? liveSession.discovery_state.lore_keys
        : [];
      if (!liveSession.discovery_state.lore_keys.includes(discoveryKey)) {
        liveSession.discovery_state.lore_keys.push(discoveryKey);
      }
      effects.push({
        effect_type: "lore_discovered",
        discovery_key: discoveryKey
      });
    }
  }

  if (objectType === "shrine" && action === "used") {
    const blessingKey = metadata.blessing_key ? String(metadata.blessing_key) : "";
    if (blessingKey) {
      liveSession.blessing_state = liveSession.blessing_state && typeof liveSession.blessing_state === "object"
        ? liveSession.blessing_state
        : { active_blessings: [] };
      liveSession.blessing_state.active_blessings = Array.isArray(liveSession.blessing_state.active_blessings)
        ? liveSession.blessing_state.active_blessings
        : [];
      const existing = liveSession.blessing_state.active_blessings.find((entry) => {
        return entry && String(entry.blessing_key || "") === blessingKey;
      });
      if (!existing) {
        liveSession.blessing_state.active_blessings.push({
          blessing_key: blessingKey,
          source_object_id: liveObject.object_id || null,
          source_room_id: liveSession.current_room_id || null,
          granted_at: new Date().toISOString(),
          metadata: metadata.blessing_metadata && typeof metadata.blessing_metadata === "object"
            ? clone(metadata.blessing_metadata)
            : {}
        });
      }
      effects.push({
        effect_type: "blessing_granted",
        blessing_key: blessingKey
      });
    }
  }

  const revealRoomIds = Array.isArray(metadata.reveal_room_ids)
    ? metadata.reveal_room_ids.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  if (revealRoomIds.length > 0) {
    liveSession.discovered_rooms = Array.isArray(liveSession.discovered_rooms)
      ? liveSession.discovered_rooms
      : [];
    for (let index = 0; index < revealRoomIds.length; index += 1) {
      const roomId = revealRoomIds[index];
      if (!liveSession.discovered_rooms.includes(roomId)) {
        liveSession.discovered_rooms.push(roomId);
        effects.push({
          effect_type: "room_revealed",
          room_id: roomId
        });
      }
    }
  }

  if (metadata.clear_movement_lock === true && liveSession.movement_locked === true) {
    liveSession.movement_locked = false;
    effects.push({
      effect_type: "movement_lock_cleared",
      source_object_id: liveObject.object_id || null
    });
  }

  return effects;
}

function triggerLinkedTrapIfNeeded(liveSession, liveObject, action) {
  const metadata = liveObject && liveObject.metadata && typeof liveObject.metadata === "object"
    ? liveObject.metadata
    : {};
  const linkedTrapObjectId = metadata.linked_trap_object_id ? String(metadata.linked_trap_object_id) : "";
  if (!linkedTrapObjectId || !["open", "unlock"].includes(String(action || "").trim().toLowerCase())) {
    return null;
  }
  const linked = findObjectInSessionRooms(liveSession, linkedTrapObjectId);
  if (!linked || !linked.object) {
    return null;
  }
  const trap = linked.object;
  const trapType = normalizeObjectType(trap.object_type || trap.type);
  if (trapType !== "trap" || trap.is_disarmed === true || trap.is_triggered === true) {
    return null;
  }
  trap.is_triggered = true;
  trap.last_triggered_at = new Date().toISOString();
  liveSession.movement_locked = true;
  liveSession.event_log = Array.isArray(liveSession.event_log) ? liveSession.event_log : [];
  liveSession.event_log.push({
    event_type: "dungeon_trap_triggered",
    timestamp: new Date().toISOString(),
    room_id: linked.room && linked.room.room_id ? linked.room.room_id : liveSession.current_room_id || null,
    object_id: trap.object_id || null,
    source_object_id: liveObject.object_id || null
  });
  return {
    effect_type: "linked_trap_triggered",
    object_id: trap.object_id || null,
    room_id: linked.room && linked.room.room_id ? linked.room.room_id : null
  };
}

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

  if (objectType === "door") {
    return {
      action: "opened",
      next_event_type: "room_object_door_opened"
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
    if (objectType === "door") {
      return "open";
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
  if (objectType === "door") {
    return ["open", "unlock"];
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
  const itemIndex = data.item_index && typeof data.item_index === "object" ? data.item_index : {};
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

  if (utilitySpell.spell_id === "knock") {
    if (!["chest", "door"].includes(objectType)) {
      return failure("dungeon_object_interaction_failed", "knock cannot affect this object type", {
        object_type: objectType,
        spell_id: utilitySpell.spell_id
      });
    }
    liveObject.is_locked = false;
    liveObject.is_unlocked = true;
    liveObject.last_spell_effect = utilitySpell.spell_id;
    metadata.locked = false;
    metadata.unlocked_by_spell_id = utilitySpell.spell_id;
    liveObject.metadata = metadata;
    return success("dungeon_object_spell_applied", {
      spell_effect: {
        spell_id: utilitySpell.spell_id,
        spell_name: utilitySpell.spell_name,
        utility_ref: utilitySpell.utility_ref,
        object_state: "unlocked_by_magic"
      }
    });
  }

  if (utilitySpell.spell_id === "detect_magic") {
    const auraSummary = metadata.detect_magic_reveal
      ? String(metadata.detect_magic_reveal)
      : (metadata.magic_school ? String(metadata.magic_school) + " aura" : (metadata.magic_aura === true ? "magic detected" : "no_magic_detected"));
    liveObject.is_magic_revealed = true;
    liveObject.last_spell_effect = utilitySpell.spell_id;
    metadata.magic_revealed = true;
    metadata.detected_by_spell_id = utilitySpell.spell_id;
    liveObject.metadata = metadata;
    return success("dungeon_object_spell_applied", {
      spell_effect: {
        spell_id: utilitySpell.spell_id,
        spell_name: utilitySpell.spell_name,
        utility_ref: utilitySpell.utility_ref,
        object_state: metadata.magic_aura === true || metadata.magic_school || metadata.detect_magic_reveal
          ? "magic_revealed"
          : "no_magic_detected",
        aura_summary: auraSummary
      }
    });
  }

  if (utilitySpell.spell_id === "identify") {
    const hiddenItemRef = metadata.hidden_item_ref ? String(metadata.hidden_item_ref) : "";
    const identifiedItem = hiddenItemRef && itemIndex[hiddenItemRef] ? itemIndex[hiddenItemRef] : null;
    const identifySummary = metadata.identify_reveal
      ? String(metadata.identify_reveal)
      : (identifiedItem ? String(identifiedItem.name || identifiedItem.item_id || hiddenItemRef) : "");
    if (!identifySummary && !hiddenItemRef) {
      return failure("dungeon_object_interaction_failed", "identify cannot reveal anything about this object", {
        object_type: objectType,
        spell_id: utilitySpell.spell_id
      });
    }
    liveObject.is_identified = true;
    liveObject.last_spell_effect = utilitySpell.spell_id;
    metadata.is_identified = true;
    metadata.identified_by_spell_id = utilitySpell.spell_id;
    metadata.identified_at = new Date().toISOString();
    liveObject.metadata = metadata;
    return success("dungeon_object_spell_applied", {
      spell_effect: {
        spell_id: utilitySpell.spell_id,
        spell_name: utilitySpell.spell_name,
        utility_ref: utilitySpell.utility_ref,
        object_state: "identified",
        identify_summary: identifySummary || hiddenItemRef || "identified",
        identified_item_id: identifiedItem ? identifiedItem.item_id || null : (hiddenItemRef || null),
        identified_item_name: identifiedItem ? identifiedItem.name || identifiedItem.item_id || null : null
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
  const skillProfile = normalizeSkillProfile(data.skill_profile);
  const toolProfile = normalizeToolProfile(data.tool_profile);
  const itemIndex = data.item_index && typeof data.item_index === "object" ? data.item_index : {};
  const characterProfile = data.character_profile && typeof data.character_profile === "object"
    ? data.character_profile
    : {};
  const checkContext = data.check_context && typeof data.check_context === "object" ? data.check_context : {};

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

  const wasLockedBeforeSpell = Boolean(liveObject.is_locked || (liveObject.metadata && liveObject.metadata.locked));
  let spellEffect = null;
  if (utilitySpell) {
    const spellApplied = applyUtilitySpellToObject({
      liveObject,
      objectType,
      spell: data.spell,
      item_index: itemIndex
    });
    if (!spellApplied.ok) {
      return spellApplied;
    }
    spellEffect = spellApplied.payload.spell_effect || null;
  }
  const liveMetadata = liveObject.metadata && typeof liveObject.metadata === "object" ? liveObject.metadata : {};
  const wasLocked = Boolean(liveObject.is_locked || liveMetadata.locked);
  const requiresLight = Boolean(liveMetadata.requires_light || liveMetadata.is_dark);
  const requiresThaumaturgy = Boolean(liveMetadata.requires_thaumaturgy);
  const requiresDetectMagic = Boolean(liveMetadata.requires_detect_magic);
  const requiredSkill = liveMetadata.required_skill ? String(liveMetadata.required_skill).trim().toLowerCase() : "";
  const requiredTool = liveMetadata.required_tool ? String(liveMetadata.required_tool).trim().toLowerCase() : "";
  const requiredSkillDc = Number.isFinite(Number(liveMetadata.required_skill_dc)) ? Number(liveMetadata.required_skill_dc) : null;
  const requiredToolDc = Number.isFinite(Number(liveMetadata.required_tool_dc)) ? Number(liveMetadata.required_tool_dc) : null;
  const requiredAbility = liveMetadata.required_ability ? String(liveMetadata.required_ability).trim().toLowerCase() : "";
  const requiredAbilityDc = Number.isFinite(Number(liveMetadata.required_ability_dc)) ? Number(liveMetadata.required_ability_dc) : null;

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
  const usedDetectMagic = Boolean(
    spellEffect &&
    spellEffect.spell_id &&
    String(spellEffect.spell_id).trim().toLowerCase() === "detect_magic"
  );
  if (requiresDetectMagic && !usedDetectMagic) {
    return failure("dungeon_object_interaction_failed", "object requires detect magic", {
      session_id: sessionId,
      room_id: currentRoomId,
      object_id: objectId,
      action
    });
  }
  if (requiredSkill && actionMatchesSkillRequirement(liveMetadata, action) && !hasSkillProficiency(skillProfile, requiredSkill)) {
    return failure("dungeon_object_interaction_failed", resolveRequiredSkillFailure(requiredSkill), {
      session_id: sessionId,
      room_id: currentRoomId,
      object_id: objectId,
      action,
      required_skill: requiredSkill
    });
  }
  if (requiredTool && actionMatchesToolRequirement(liveMetadata, action) && !hasToolProficiency(toolProfile, requiredTool)) {
    return failure("dungeon_object_interaction_failed", resolveRequiredToolFailure(requiredTool), {
      session_id: sessionId,
      room_id: currentRoomId,
      object_id: objectId,
      action,
      required_tool: requiredTool
    });
  }

  const checkRequirements = [];
  if (requiredSkill && actionMatchesSkillRequirement(liveMetadata, action) && Number.isFinite(requiredSkillDc)) {
    checkRequirements.push({ check_type: "skill", target_id: requiredSkill, difficulty_class: requiredSkillDc });
  }
  if (requiredTool && actionMatchesToolRequirement(liveMetadata, action) && Number.isFinite(requiredToolDc)) {
    checkRequirements.push({ check_type: "tool", target_id: requiredTool, difficulty_class: requiredToolDc });
  }
  if (requiredAbility && Number.isFinite(requiredAbilityDc)) {
    checkRequirements.push({ check_type: "ability", target_id: requiredAbility, difficulty_class: requiredAbilityDc });
  }

  const resolvedChecks = [];
  for (let index = 0; index < checkRequirements.length; index += 1) {
    const requirement = checkRequirements[index];
    const resolvedCheck = resolveInteractionCheck({
      check_type: requirement.check_type,
      target_id: requirement.target_id,
      difficulty_class: requirement.difficulty_class,
      character_profile: {
        stats: characterProfile.stats || {},
        proficiency_bonus: characterProfile.proficiency_bonus,
        skills: skillProfile,
        tools: toolProfile
      },
      forced_roll: checkContext.forced_roll,
      roll_fn: checkContext.roll_fn
    });
    if (!resolvedCheck.ok) {
      return failure("dungeon_object_interaction_failed", resolvedCheck.error || "interaction check failed to resolve", {
        session_id: sessionId,
        room_id: currentRoomId,
        object_id: objectId,
        action,
        check_type: requirement.check_type,
        target_id: requirement.target_id
      });
    }
    resolvedChecks.push(resolvedCheck.payload);
    if (resolvedCheck.payload.passed !== true) {
      return failure("dungeon_object_interaction_failed", resolveCheckFailure(requirement.check_type, requirement.target_id), {
        session_id: sessionId,
        room_id: currentRoomId,
        object_id: objectId,
        action,
        check_result: resolvedCheck.payload
      });
    }
  }

  const usedKnock = Boolean(
    spellEffect &&
    spellEffect.spell_id &&
    String(spellEffect.spell_id).trim().toLowerCase() === "knock"
  );

  const linkedTrapEffect = triggerLinkedTrapIfNeeded(liveSession, liveObject, action);
  if (linkedTrapEffect) {
    return failure("dungeon_object_interaction_failed", "object is trapped", {
      session_id: sessionId,
      room_id: currentRoomId,
      object_id: objectId,
      trap_trigger: linkedTrapEffect
    });
  }

  if ((objectType === "chest" || objectType === "door") && action === "unlock") {
    if (!wasLocked && !(usedKnock && wasLockedBeforeSpell)) {
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
    outcome.next_event_type = objectType === "door"
      ? "room_object_door_unlocked"
      : "room_object_chest_unlocked";
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

  const interactionEffects = applyLinkedInteractionEffects(liveSession, liveObject, objectType, outcome.action);
  const skillCheck = requiredSkill && actionMatchesSkillRequirement(liveMetadata, action)
    ? {
        skill_id: requiredSkill,
        requirement_type: "proficiency",
        passed: hasSkillProficiency(skillProfile, requiredSkill)
      }
    : null;
  const toolCheck = requiredTool && actionMatchesToolRequirement(liveMetadata, action)
    ? {
        tool_id: requiredTool,
        requirement_type: "proficiency",
        passed: hasToolProficiency(toolProfile, requiredTool)
      }
    : null;
  const rolledSkillCheck = resolvedChecks.find((entry) => entry.check_type === "skill") || null;
  const rolledToolCheck = resolvedChecks.find((entry) => entry.check_type === "tool") || null;
  const rolledAbilityCheck = resolvedChecks.find((entry) => entry.check_type === "ability") || null;
  const normalizedSkillCheck = rolledSkillCheck
    ? {
        skill_id: rolledSkillCheck.target_id,
        requirement_type: "roll",
        passed: rolledSkillCheck.passed,
        dc: rolledSkillCheck.dc,
        roll: clone(rolledSkillCheck.roll)
      }
    : skillCheck;
  const normalizedToolCheck = rolledToolCheck
    ? {
        tool_id: rolledToolCheck.target_id,
        requirement_type: "roll",
        passed: rolledToolCheck.passed,
        dc: rolledToolCheck.dc,
        roll: clone(rolledToolCheck.roll)
      }
    : toolCheck;
  const normalizedAbilityCheck = rolledAbilityCheck
    ? {
        ability_id: rolledAbilityCheck.target_id,
        requirement_type: "roll",
        passed: rolledAbilityCheck.passed,
        dc: rolledAbilityCheck.dc,
        roll: clone(rolledAbilityCheck.roll)
      }
    : null;
  if (requiredSkill && actionMatchesSkillRequirement(liveMetadata, action) && hasSkillProficiency(skillProfile, requiredSkill)) {
    interactionEffects.push({
      effect_type: "skill_requirement_passed",
      skill_id: requiredSkill
    });
  }
  if (requiredTool && actionMatchesToolRequirement(liveMetadata, action) && hasToolProficiency(toolProfile, requiredTool)) {
    interactionEffects.push({
      effect_type: "tool_requirement_passed",
      tool_id: requiredTool
    });
  }
  if (rolledSkillCheck) {
    interactionEffects.push({
      effect_type: "skill_check_passed",
      skill_id: rolledSkillCheck.target_id,
      dc: rolledSkillCheck.dc
    });
  }
  if (rolledToolCheck) {
    interactionEffects.push({
      effect_type: "tool_check_passed",
      tool_id: rolledToolCheck.target_id,
      dc: rolledToolCheck.dc
    });
  }
  if (rolledAbilityCheck) {
    interactionEffects.push({
      effect_type: "ability_check_passed",
      ability_id: rolledAbilityCheck.target_id,
      dc: rolledAbilityCheck.dc
    });
  }

  if (liveMetadata.reveal_hidden_on_pass === true) {
    liveObject.is_hidden = false;
    liveMetadata.hidden = false;
    interactionEffects.push({
      effect_type: "hidden_path_revealed",
      object_id: liveObject.object_id || null
    });
    const linkedRevealObjectId = liveMetadata.linked_object_id ? String(liveMetadata.linked_object_id) : "";
    if (linkedRevealObjectId) {
      const linkedReveal = findObjectInSessionRooms(liveSession, linkedRevealObjectId);
      if (linkedReveal && linkedReveal.object) {
        linkedReveal.object.is_hidden = false;
        linkedReveal.object.metadata = linkedReveal.object.metadata && typeof linkedReveal.object.metadata === "object"
          ? linkedReveal.object.metadata
          : {};
        linkedReveal.object.metadata.hidden = false;
        interactionEffects.push({
          effect_type: "hidden_path_revealed",
          object_id: linkedReveal.object.object_id || null
        });
      }
    }
  }
  if (liveMetadata.clear_magic_seal_on_pass === true) {
    liveMetadata.requires_detect_magic = false;
    liveMetadata.magic_sealed = false;
    interactionEffects.push({
      effect_type: "arcane_seal_cleared",
      object_id: liveObject.object_id || null
    });
  }
  liveObject.metadata = liveMetadata;

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
    skill_check: normalizedSkillCheck,
    tool_check: normalizedToolCheck,
    ability_check: normalizedAbilityCheck,
    interaction_effects: interactionEffects,
    spell_effect: spellEffect,
    reward_hint: buildGenericRewardHint(liveObject, objectType, outcome.action),
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
