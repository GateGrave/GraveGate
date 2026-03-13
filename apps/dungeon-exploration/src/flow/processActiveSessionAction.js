"use strict";

const { moveParty } = require("./moveParty");
const { resolveRoomEntry } = require("./resolveRoomEntry");
const { interactWithObject } = require("./interactWithObject");
const { startCombat } = require("../../../combat-system/src/flow/startCombat");
const { progressCombatFromCurrentTurn } = require("../../../combat-system/src/flow/progressCombatState");

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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveMonsterAttackProfile(monsterMetadata) {
  const metadata = monsterMetadata && typeof monsterMetadata === "object" ? monsterMetadata : {};
  const attacks = Array.isArray(metadata.attacks) ? metadata.attacks : [];
  const primaryAttack = attacks[0] && typeof attacks[0] === "object" ? attacks[0] : null;
  return {
    damage_formula: primaryAttack && primaryAttack.damage_dice ? String(primaryAttack.damage_dice) : null,
    damage_type: primaryAttack && primaryAttack.damage_type ? String(primaryAttack.damage_type) : null
  };
}

function findRoomById(session, roomId) {
  const rooms = Array.isArray(session.rooms) ? session.rooms : [];
  return rooms.find((room) => String(room.room_id || "") === String(roomId)) || null;
}

function getRoomExits(room) {
  const exits = Array.isArray(room && room.exits) ? room.exits : [];
  return exits.map((entry) => {
    if (typeof entry === "string") {
      return {
        direction: null,
        to_room_id: entry
      };
    }
    return {
      direction: entry && entry.direction ? String(entry.direction).toLowerCase() : null,
      to_room_id: entry && entry.to_room_id ? String(entry.to_room_id) : null
    };
  }).filter((entry) => entry.to_room_id);
}

function resolveTargetRoomId(session, payload) {
  const destinationId = payload && payload.destination_id ? String(payload.destination_id) : null;
  if (destinationId) {
    return destinationId;
  }

  const direction = payload && payload.direction ? String(payload.direction).toLowerCase() : null;
  if (!direction) {
    return null;
  }

  const currentRoom = findRoomById(session, session.current_room_id);
  if (!currentRoom) {
    return null;
  }

  const exits = getRoomExits(currentRoom);
  const byDirection = exits.find((entry) => entry.direction === direction);
  return byDirection ? byDirection.to_room_id : null;
}

function findBlockingDoor(session, payload, targetRoomId) {
  const currentRoom = findRoomById(session, session.current_room_id);
  if (!currentRoom) {
    return null;
  }
  const objects = Array.isArray(currentRoom.objects) ? currentRoom.objects : [];
  const direction = payload && payload.direction ? String(payload.direction).toLowerCase() : null;
  return objects.find((entry) => {
    const type = entry && (entry.object_type || entry.type) ? String(entry.object_type || entry.type).toLowerCase() : "";
    if (type !== "door") {
      return false;
    }
    const metadata = entry && entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
    const doorTarget = metadata.to_room_id ? String(metadata.to_room_id) : (entry.to_room_id ? String(entry.to_room_id) : null);
    const doorDirection = metadata.direction ? String(metadata.direction).toLowerCase() : (entry.direction ? String(entry.direction).toLowerCase() : null);
    const matchesTarget = doorTarget ? doorTarget === String(targetRoomId || "") : false;
    const matchesDirection = direction && doorDirection ? doorDirection === direction : false;
    if (!matchesTarget && !matchesDirection) {
      return false;
    }
    return Boolean(
      entry.is_hidden === true ||
      metadata.hidden === true ||
      entry.is_locked ||
      (metadata.locked === true) ||
      entry.is_opened !== true
    );
  }) || null;
}

function listSessionPlayerIds(session) {
  const party = session && session.party && typeof session.party === "object" ? session.party : {};
  const members = Array.isArray(party.members) ? party.members : [];
  const out = [];
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    const playerId = member && typeof member === "object"
      ? String(member.player_id || "").trim()
      : String(member || "").trim();
    if (!playerId || out.includes(playerId)) {
      continue;
    }
    out.push(playerId);
  }
  const leaderId = party.leader_id ? String(party.leader_id).trim() : "";
  if (leaderId && !out.includes(leaderId)) {
    out.push(leaderId);
  }
  return out;
}

function triggerEntryTrapIfPresent(sessionManager, sessionId, roomId) {
  const liveSession = sessionManager.sessions.get(String(sessionId));
  if (!liveSession) {
    return null;
  }
  const liveRoom = findRoomById(liveSession, roomId);
  if (!liveRoom) {
    return null;
  }
  const objects = Array.isArray(liveRoom.objects) ? liveRoom.objects : [];
  const trapObject = objects.find((entry) => {
    const type = entry && (entry.object_type || entry.type) ? String(entry.object_type || entry.type).toLowerCase() : "";
    return type === "trap" &&
      entry.is_disarmed !== true &&
      entry.is_triggered !== true &&
      (!entry.metadata || entry.metadata.trigger_on_entry !== false);
  });
  if (!trapObject) {
    return null;
  }

  trapObject.is_triggered = true;
  trapObject.last_triggered_at = new Date().toISOString();
  liveSession.movement_locked = true;
  liveSession.event_log = Array.isArray(liveSession.event_log) ? liveSession.event_log : [];
  liveSession.event_log.push({
    event_type: "dungeon_trap_triggered",
    timestamp: new Date().toISOString(),
    room_id: roomId,
    object_id: trapObject.object_id || null
  });
  liveSession.updated_at = new Date().toISOString();
  sessionManager.sessions.set(String(sessionId), liveSession);

  return {
    object_id: trapObject.object_id || null,
    room_id: roomId,
    movement_locked: true
  };
}

function processSessionMoveRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const sessionId = data.session_id;
  const playerId = data.player_id;
  const payload = data.payload;

  if (!sessionId || String(sessionId).trim() === "") {
    return failure("player_move_failed", "session_id is required");
  }
  if (!isPlainObject(payload)) {
    return failure("player_move_failed", "payload must be an object");
  }
  if (!context.sessionManager || typeof context.sessionManager.getSessionById !== "function") {
    return failure("player_move_failed", "sessionManager is required");
  }

  const loaded = context.sessionManager.getSessionById(String(sessionId));
  if (!loaded.ok) {
    return failure("player_move_failed", "no active session found", {
      session_id: String(sessionId)
    });
  }

  const session = loaded.payload.session;
  if (String(session.status || "") !== "active") {
    return failure("player_move_failed", "session is not active", {
      session_id: String(sessionId),
      status: session.status || null
    });
  }
  const sessionPlayerIds = listSessionPlayerIds(session);
  const normalizedPlayerId = String(playerId || "").trim();
  if (!normalizedPlayerId) {
    return failure("player_move_failed", "player_id is required");
  }
  if (!sessionPlayerIds.includes(normalizedPlayerId)) {
    return failure("player_move_failed", "player is not a participant in this session", {
      session_id: String(sessionId),
      player_id: normalizedPlayerId
    });
  }
  if (session.movement_locked === true) {
    return failure("player_move_failed", "session movement is locked", {
      session_id: String(sessionId),
      current_room_id: session.current_room_id || null
    });
  }
  if (session.active_combat_id) {
    return failure("player_move_failed", "session has active combat", {
      session_id: String(sessionId),
      active_combat_id: String(session.active_combat_id)
    });
  }
  const targetRoomId = resolveTargetRoomId(session, payload);
  if (!targetRoomId) {
    return failure("player_move_failed", "could not resolve target room from move payload", {
      session_id: String(sessionId)
    });
  }
  const blockingDoor = findBlockingDoor(session, payload, targetRoomId);
  if (blockingDoor) {
    const blockingMetadata = blockingDoor.metadata && typeof blockingDoor.metadata === "object" ? blockingDoor.metadata : {};
    if (blockingDoor.is_hidden === true || blockingMetadata.hidden === true) {
      return failure("player_move_failed", "path is hidden", {
        session_id: String(sessionId),
        current_room_id: session.current_room_id || null,
        target_room_id: String(targetRoomId),
        object_id: blockingDoor.object_id || null
      });
    }
    return failure("player_move_failed", "path is blocked by a locked door", {
      session_id: String(sessionId),
      current_room_id: session.current_room_id || null,
      target_room_id: String(targetRoomId),
      object_id: blockingDoor.object_id || null
    });
  }

  const sessionBeforeMove = clone(session);
  const moved = moveParty({
    manager: context.sessionManager,
    session_id: String(sessionId),
    target_room_id: String(targetRoomId)
  });
  if (!moved.ok) {
    return failure("player_move_failed", moved.error || "failed to process session move", {
      session_id: String(sessionId),
      target_room_id: String(targetRoomId)
    });
  }

  function rollbackSessionMove(reason, payloadData) {
    const snapshot = clone(sessionBeforeMove);
    context.sessionManager.sessions.set(String(sessionId), snapshot);
    let rollbackPersisted = true;
    let rollbackError = null;
    if (context.sessionPersistence && typeof context.sessionPersistence.saveSession === "function") {
      const rollbackOut = context.sessionPersistence.saveSession(snapshot);
      rollbackPersisted = Boolean(rollbackOut && rollbackOut.ok);
      rollbackError = rollbackPersisted ? null : (rollbackOut.error || "failed to persist rollback session snapshot");
    }
    return failure("player_move_failed", reason, {
      ...(payloadData || {}),
      rollback_applied: rollbackPersisted,
      rollback_error: rollbackError
    });
  }

  const sessionAfterMoveResult = context.sessionManager.getSessionById(String(sessionId));
  if (!sessionAfterMoveResult.ok) {
    return rollbackSessionMove("failed to load moved session", {
      session_id: String(sessionId)
    });
  }

  const roomEntry = resolveRoomEntry({
    manager: context.sessionManager,
    session_id: String(sessionId)
  });
  if (!roomEntry.ok) {
    return rollbackSessionMove(roomEntry.error || "failed to resolve room entry", {
      session_id: String(sessionId),
      target_room_id: String(targetRoomId)
    });
  }

  const latestLiveSession = context.sessionManager.sessions.get(String(sessionId));
  if (!latestLiveSession) {
    return rollbackSessionMove("session missing during trigger update", {
      session_id: String(sessionId)
    });
  }

  latestLiveSession.trigger_state = latestLiveSession.trigger_state && typeof latestLiveSession.trigger_state === "object"
    ? latestLiveSession.trigger_state
    : { consumed_keys: [] };
  latestLiveSession.trigger_state.consumed_keys = Array.isArray(latestLiveSession.trigger_state.consumed_keys)
    ? latestLiveSession.trigger_state.consumed_keys
    : [];

  const roomOutcome = roomEntry.payload.outcome || "empty";
  const triggerKey = "room:" + String(targetRoomId) + ":" + String(roomOutcome);
  const triggerAlreadyConsumed = latestLiveSession.trigger_state.consumed_keys.includes(triggerKey);
  let combatHandoff = null;
  let triggerStatus = "none";

  if (roomOutcome === "encounter") {
    if (triggerAlreadyConsumed) {
      triggerStatus = "already_consumed";
    } else {
      latestLiveSession.trigger_state.consumed_keys.push(triggerKey);
      triggerStatus = "consumed";

      combatHandoff = activateEncounterCombat({
        context,
        session: latestLiveSession,
        session_id: String(sessionId),
        room_id: String(targetRoomId)
      });
      if (!combatHandoff.ok) {
        return rollbackSessionMove(combatHandoff.error || "failed to handoff encounter to combat", {
          session_id: String(sessionId),
          room_id: String(targetRoomId),
          trigger_key: triggerKey
        });
      }
    }
  }

  const triggeredTrap = roomOutcome !== "encounter"
    ? triggerEntryTrapIfPresent(context.sessionManager, String(sessionId), String(targetRoomId))
    : null;

  const latestForPersist = context.sessionManager.sessions.get(String(sessionId)) || latestLiveSession;
  latestForPersist.updated_at = new Date().toISOString();
  context.sessionManager.sessions.set(String(sessionId), latestForPersist);

  if (context.sessionPersistence && typeof context.sessionPersistence.saveSession === "function") {
    const persisted = context.sessionPersistence.saveSession(latestForPersist);
    if (!persisted.ok) {
      return rollbackSessionMove(persisted.error || "failed to persist moved session", {
        session_id: String(sessionId)
      });
    }
  }

  const reloaded = context.sessionManager.getSessionById(String(sessionId));
  if (!reloaded.ok) {
    return rollbackSessionMove("failed to reload session after move", {
      session_id: String(sessionId)
    });
  }

  return success("player_move_processed", {
    session: clone(reloaded.payload.session),
    from_room_id: moved.payload.from_room_id || null,
    to_room_id: moved.payload.to_room_id || null,
    room_outcome: roomOutcome,
    trigger: {
      trigger_key: triggerKey,
      consumed: roomOutcome === "encounter" ? !triggerAlreadyConsumed : false,
      trigger_status: triggerStatus
    },
    trap_trigger: triggeredTrap ? clone(triggeredTrap) : null,
    combat_handoff: combatHandoff && combatHandoff.ok ? clone(combatHandoff.payload) : null,
    next_event: roomEntry.payload.next_event || null
  });
}

function processSessionInteractRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const sessionId = data.session_id;
  const playerId = data.player_id;
  const payload = data.payload;

  if (!sessionId || String(sessionId).trim() === "") {
    return failure("player_interact_failed", "session_id is required");
  }
  if (!isPlainObject(payload)) {
    return failure("player_interact_failed", "payload must be an object");
  }
  if (!context.sessionManager || typeof context.sessionManager.getSessionById !== "function") {
    return failure("player_interact_failed", "sessionManager is required");
  }

  const loaded = context.sessionManager.getSessionById(String(sessionId));
  if (!loaded.ok) {
    return failure("player_interact_failed", "no active session found", {
      session_id: String(sessionId)
    });
  }

  const session = loaded.payload.session;
  if (String(session.status || "") !== "active") {
    return failure("player_interact_failed", "session is not active", {
      session_id: String(sessionId),
      status: session.status || null
    });
  }

  const sessionPlayerIds = listSessionPlayerIds(session);
  const normalizedPlayerId = String(playerId || "").trim();
  if (!normalizedPlayerId) {
    return failure("player_interact_failed", "player_id is required");
  }
  if (!sessionPlayerIds.includes(normalizedPlayerId)) {
    return failure("player_interact_failed", "player is not a participant in this session", {
      session_id: String(sessionId),
      player_id: normalizedPlayerId
    });
  }
  if (session.active_combat_id) {
    return failure("player_interact_failed", "session has active combat", {
      session_id: String(sessionId),
      active_combat_id: String(session.active_combat_id)
    });
  }

  const interaction = interactWithObject({
    manager: context.sessionManager,
    session_id: String(sessionId),
    object_id: payload.object_id,
    action: payload.action || null,
    spell: payload.spell || null,
    skill_profile: payload.skill_profile || {},
    tool_profile: payload.tool_profile || [],
    item_index: payload.item_index || {},
    character_profile: payload.character_profile || {},
    check_context: payload.check_context || {}
  });
  if (!interaction.ok) {
    return failure("player_interact_failed", interaction.error || "failed to interact with object", {
      session_id: String(sessionId),
      object_id: payload.object_id || null
    });
  }

  if (context.sessionPersistence && typeof context.sessionPersistence.saveSession === "function") {
    const liveSession = context.sessionManager.sessions.get(String(sessionId));
    if (
      liveSession &&
      interaction.payload &&
      interaction.payload.object_type === "trap" &&
      interaction.payload.interaction_action === "disarmed"
    ) {
      const currentRoom = findRoomById(liveSession, liveSession.current_room_id);
      const remainingTriggeredTraps = currentRoom && Array.isArray(currentRoom.objects)
        ? currentRoom.objects.filter((entry) => {
            const type = entry && (entry.object_type || entry.type) ? String(entry.object_type || entry.type).toLowerCase() : "";
            return type === "trap" && entry.is_triggered === true && entry.is_disarmed !== true;
          })
        : [];
      if (remainingTriggeredTraps.length === 0) {
        liveSession.movement_locked = false;
        liveSession.updated_at = new Date().toISOString();
        context.sessionManager.sessions.set(String(sessionId), liveSession);
        interaction.payload.session = clone(liveSession);
        interaction.payload.object_state = {
          ...(interaction.payload.object_state || {}),
          is_disarmed: true
        };
      }
    }
    const persisted = context.sessionPersistence.saveSession(interaction.payload.session);
    if (!persisted.ok) {
      return failure("player_interact_failed", persisted.error || "failed to persist session interaction", {
        session_id: String(sessionId),
        object_id: payload.object_id || null
      });
    }
  }

  return success("player_interact_processed", {
    session: clone(interaction.payload.session),
    session_id: String(sessionId),
    room_id: interaction.payload.room_id || null,
    object_id: interaction.payload.object_id || null,
    object_type: interaction.payload.object_type || null,
    interaction_action: interaction.payload.interaction_action || null,
    object_state: interaction.payload.object_state || null,
    interaction_effects: Array.isArray(interaction.payload.interaction_effects) ? interaction.payload.interaction_effects : [],
    spell_effect: interaction.payload.spell_effect || null,
    skill_check: interaction.payload.skill_check || null,
    tool_check: interaction.payload.tool_check || null,
    ability_check: interaction.payload.ability_check || null,
    reward_hint: interaction.payload.reward_hint || null,
    next_event: interaction.payload.next_event || null
  });
}

function activateEncounterCombat(input) {
  const data = input || {};
  const context = data.context || {};
  const session = data.session || null;
  const sessionId = data.session_id ? String(data.session_id) : "";
  const roomId = data.room_id ? String(data.room_id) : "";

  if (!session || typeof session !== "object") {
    return failure("dungeon_combat_handoff_failed", "session is required");
  }
  if (!context.combatManager || typeof context.combatManager.createCombat !== "function") {
    // Session flow stays usable even when combat system is not wired in this runtime.
    return success("dungeon_combat_handoff_deferred", {
      handoff_status: "deferred",
      reason: "combatManager not available",
      combat_id: null
    });
  }

  const room = findRoomById(session, roomId);
  const encounter = room && room.encounter && typeof room.encounter === "object" ? room.encounter : {};
  const combatId = String(encounter.combat_id || ("combat-" + sessionId + "-" + roomId));
  const enemyId = String(encounter.monster_id || ("enemy-" + roomId));
  const party = session.party && typeof session.party === "object" ? session.party : {};
  const memberIds = Array.isArray(party.members) ? party.members : [];
  const actorIds = memberIds.length > 0
    ? memberIds.map((member) => String(member && member.player_id ? member.player_id : member))
    : [String(party.leader_id || "unknown-player")];

  if (session.active_combat_id && String(session.active_combat_id) !== combatId) {
    return failure("dungeon_combat_handoff_failed", "session already has another active combat", {
      session_id: sessionId,
      active_combat_id: String(session.active_combat_id),
      requested_combat_id: combatId
    });
  }

  const existingCombat = context.combatManager.getCombatById(combatId);
  let created = false;
  if (!existingCombat.ok) {
    const createdCombat = context.combatManager.createCombat({
      combat_id: combatId,
      status: "pending"
    });
    if (!createdCombat.ok) {
      return failure("dungeon_combat_handoff_failed", createdCombat.error || "failed to create combat", {
        combat_id: combatId
      });
    }
    created = true;

    for (let index = 0; index < actorIds.length; index += 1) {
      const playerId = actorIds[index];
      const addPlayer = context.combatManager.addParticipant({
        combat_id: combatId,
        participant: {
          participant_id: playerId,
          name: "Player " + (index + 1),
          team: "party",
          armor_class: 12,
          current_hp: 18,
          max_hp: 18,
          attack_bonus: 3,
          damage: 4,
          position: { x: index, y: 0 },
          metadata: {
            owner_player_id: playerId,
            session_id: sessionId
          }
        }
      });
      if (!addPlayer.ok) {
        return failure("dungeon_combat_handoff_failed", addPlayer.error || "failed to add player participant", {
          combat_id: combatId,
          player_id: playerId
        });
      }
    }

    const enemyAttackProfile = resolveMonsterAttackProfile(encounter.metadata || {});
    const addEnemy = context.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: enemyId,
        name: encounter.monster_name || enemyId,
        team: "enemy",
        armor_class: 10,
        current_hp: 12,
        max_hp: 12,
        attack_bonus: 2,
        damage: 3,
        damage_formula: enemyAttackProfile.damage_formula,
        damage_type: enemyAttackProfile.damage_type,
        position: { x: Math.max(1, actorIds.length), y: 0 }
      }
    });
    if (!addEnemy.ok) {
      return failure("dungeon_combat_handoff_failed", addEnemy.error || "failed to add encounter participant", {
        combat_id: combatId,
        enemy_id: enemyId
      });
    }

    const started = startCombat({
      combatManager: context.combatManager,
      combat_id: combatId
    });
    if (!started.ok) {
      return failure("dungeon_combat_handoff_failed", started.error || "failed to start encounter combat", {
        combat_id: combatId
      });
    }

    const progressed = progressCombatFromCurrentTurn({
      combatManager: context.combatManager,
      combat_id: combatId
    });
    if (!progressed.ok) {
      return failure("dungeon_combat_handoff_failed", progressed.error || "failed to progress AI-controlled opening turn", {
        combat_id: combatId
      });
    }
  } else {
    const existingState = existingCombat.payload && existingCombat.payload.combat ? existingCombat.payload.combat : null;
    const existingStatus = existingState && existingState.status ? String(existingState.status) : "";
    if (existingStatus && existingStatus !== "pending" && existingStatus !== "active") {
      return failure("dungeon_combat_handoff_failed", "stale combat instance cannot be reused for encounter handoff", {
        combat_id: combatId,
        combat_status: existingStatus
      });
    }
    const participantList = existingState && Array.isArray(existingState.participants) ? existingState.participants : [];
    const mismatchedSessionParticipant = participantList.find((entry) => {
      const metadata = entry && entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
      const participantSessionId = metadata.session_id ? String(metadata.session_id) : null;
      return participantSessionId && participantSessionId !== sessionId;
    });
    if (mismatchedSessionParticipant) {
      return failure("dungeon_combat_handoff_failed", "combat instance belongs to a different session", {
        combat_id: combatId,
        session_id: sessionId
      });
    }
  }

  session.active_combat_id = combatId;
  session.last_combat_id = combatId;
  session.combat_history = Array.isArray(session.combat_history) ? session.combat_history : [];
  session.combat_history.push({
    combat_id: combatId,
    room_id: roomId,
    created_at: new Date().toISOString()
  });
  session.event_log = Array.isArray(session.event_log) ? session.event_log : [];
  session.event_log.push({
    event_type: "dungeon_combat_handoff_created",
    timestamp: new Date().toISOString(),
    room_id: roomId,
    combat_id: combatId,
    created
  });

  if (context.combatPersistence && typeof context.combatPersistence.saveCombatSnapshot === "function") {
    const loaded = context.combatManager.getCombatById(combatId);
    if (loaded.ok) {
      context.combatPersistence.saveCombatSnapshot({
        snapshot: loaded.payload.combat
      });
    }
  }

  return success("dungeon_combat_handoff_created", {
    handoff_status: created ? "created" : "already_exists",
    combat_id: combatId,
    room_id: roomId
  });
}

function processSessionCombatReturnRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const sessionId = data.session_id;
  const combatId = data.combat_id;
  const payload = data.payload;
  const playerId = data.player_id ? String(data.player_id).trim() : "";

  if (!sessionId || String(sessionId).trim() === "") {
    return failure("session_combat_return_failed", "session_id is required");
  }
  if (!combatId || String(combatId).trim() === "") {
    return failure("session_combat_return_failed", "combat_id is required");
  }
  if (!isPlainObject(payload)) {
    return failure("session_combat_return_failed", "payload must be an object");
  }
  if (!context.sessionManager || typeof context.sessionManager.getSessionById !== "function") {
    return failure("session_combat_return_failed", "sessionManager is required");
  }

  const loaded = context.sessionManager.getSessionById(String(sessionId));
  if (!loaded.ok) {
    return failure("session_combat_return_failed", "session not found", {
      session_id: String(sessionId)
    });
  }

  const session = loaded.payload.session;
  if (String(session.status || "") !== "active") {
    return failure("session_combat_return_failed", "session is not active", {
      session_id: String(sessionId),
      status: session.status || null
    });
  }

  const activeCombatId = session.active_combat_id ? String(session.active_combat_id) : null;
  if (!activeCombatId) {
    return failure("session_combat_return_failed", "session has no active combat to return from", {
      session_id: String(sessionId)
    });
  }
  if (activeCombatId !== String(combatId)) {
    return failure("session_combat_return_failed", "combat_id does not match active session combat", {
      session_id: String(sessionId),
      active_combat_id: activeCombatId,
      combat_id: String(combatId)
    });
  }
  if (playerId) {
    const sessionPlayerIds = listSessionPlayerIds(session);
    if (!sessionPlayerIds.includes(playerId)) {
      return failure("session_combat_return_failed", "player is not a participant in this session", {
        session_id: String(sessionId),
        player_id: playerId
      });
    }
  }

  if (payload.mark_room_cleared !== false && session.current_room_id) {
    context.sessionManager.markRoomCleared({
      session_id: String(sessionId),
      room_id: String(session.current_room_id)
    });
  }

  const live = context.sessionManager.sessions.get(String(sessionId));
  if (!live) {
    return failure("session_combat_return_failed", "session missing during combat return update", {
      session_id: String(sessionId)
    });
  }

  live.active_combat_id = null;
  live.last_completed_combat_id = String(combatId);
  if (payload.complete_session === true) {
    live.status = "completed";
  }
  live.event_log = Array.isArray(live.event_log) ? live.event_log : [];
  live.event_log.push({
    event_type: "dungeon_combat_return_processed",
    timestamp: new Date().toISOString(),
    combat_id: String(combatId),
    outcome: payload.outcome || "victory"
  });
  live.updated_at = new Date().toISOString();
  context.sessionManager.sessions.set(String(sessionId), live);

  if (context.sessionPersistence && typeof context.sessionPersistence.saveSession === "function") {
    const persisted = context.sessionPersistence.saveSession(live);
    if (!persisted.ok) {
      return failure("session_combat_return_failed", persisted.error || "failed to persist session combat return", {
        session_id: String(sessionId)
      });
    }
  }

  const updated = context.sessionManager.getSessionById(String(sessionId));
  if (!updated.ok) {
    return failure("session_combat_return_failed", "failed to reload session after combat return", {
      session_id: String(sessionId)
    });
  }

  return success("session_combat_return_processed", {
    session: clone(updated.payload.session),
    session_id: String(sessionId),
    combat_id: String(combatId),
    room_id: updated.payload.session.current_room_id || null,
    return_status: "completed",
    session_completed: String(updated.payload.session.status || "") === "completed"
  });
}

module.exports = {
  processSessionMoveRequest,
  processSessionInteractRequest,
  processSessionCombatReturnRequest
};
