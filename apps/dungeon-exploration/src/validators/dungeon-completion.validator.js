"use strict";

/**
 * Build one condition result object in a consistent format.
 */
function buildConditionResult(name, required, met, details) {
  return {
    condition: name,
    required: Boolean(required),
    met: Boolean(met),
    details: details || {}
  };
}

/**
 * Determine whether a boss has been defeated.
 * Supports simple scaffolding flags in session data.
 */
function hasBossBeenDefeated(session) {
  if (session.boss_defeated === true) {
    return true;
  }

  const encounters = Array.isArray(session.encounters) ? session.encounters : [];
  return encounters.some((encounter) => {
    const isBoss = encounter && (encounter.is_boss === true || encounter.type === "boss");
    const defeated = encounter && encounter.status === "defeated";
    return isBoss && defeated;
  });
}

/**
 * Determine whether the final room is cleared.
 */
function isFinalRoomCleared(session) {
  if (session.final_room_cleared === true) {
    return true;
  }

  const finalRoomId = session.final_room_id || null;
  if (!finalRoomId) {
    return false;
  }

  const rooms = Array.isArray(session.rooms) ? session.rooms : [];
  const finalRoom = rooms.find((room) => room.room_id === finalRoomId);
  return Boolean(finalRoom && finalRoom.cleared === true);
}

/**
 * Determine whether the objective is completed.
 */
function isObjectiveCompleted(session) {
  if (session.objective_completed === true) {
    return true;
  }

  const objectives = Array.isArray(session.objectives) ? session.objectives : [];
  if (objectives.length > 0) {
    return objectives.every((objective) => objective && objective.completed === true);
  }

  return false;
}

/**
 * Check if a dungeon session is complete based on configurable conditions.
 * This function only validates state; it does not trigger other systems.
 *
 * @param {string} session_id
 * @param {object} options
 * @param {object} options.manager - DungeonSessionManager
 */
function checkDungeonCompletion(session_id, options) {
  const manager = options && options.manager;
  if (!manager || typeof manager.getDungeonSession !== "function") {
    return {
      ok: false,
      event_type: "dungeon_completion_check_failed",
      reason: "manager_required",
      payload: null
    };
  }

  const session = manager.getDungeonSession(session_id);
  if (!session) {
    return {
      ok: false,
      event_type: "dungeon_completion_check_failed",
      reason: "session_not_found",
      payload: {
        session_id
      }
    };
  }

  const requirements = {
    boss_defeated: session.completion_requirements?.boss_defeated !== false,
    final_room_cleared: session.completion_requirements?.final_room_cleared !== false,
    objective_completed: session.completion_requirements?.objective_completed !== false
  };

  const conditionResults = [
    buildConditionResult("boss_defeated", requirements.boss_defeated, hasBossBeenDefeated(session), {
      encounters_count: Array.isArray(session.encounters) ? session.encounters.length : 0
    }),
    buildConditionResult("final_room_cleared", requirements.final_room_cleared, isFinalRoomCleared(session), {
      final_room_id: session.final_room_id || null
    }),
    buildConditionResult("objective_completed", requirements.objective_completed, isObjectiveCompleted(session), {
      objectives_count: Array.isArray(session.objectives) ? session.objectives.length : 0
    })
  ];

  const missingConditions = conditionResults
    .filter((item) => item.required && !item.met)
    .map((item) => item.condition);

  const isComplete = missingConditions.length === 0;

  return {
    ok: true,
    event_type: "dungeon_completion_checked",
    payload: {
      session_id: session.session_id,
      party_id: session.party_id,
      is_complete: isComplete,
      conditions: conditionResults,
      missing_conditions: missingConditions,
      next_event_type: isComplete ? "dungeon_completed" : "dungeon_incomplete",
      checked_at: new Date().toISOString()
    }
  };
}

module.exports = {
  checkDungeonCompletion,
  hasBossBeenDefeated,
  isFinalRoomCleared,
  isObjectiveCompleted
};

