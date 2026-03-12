"use strict";

/**
 * Safely process one dungeon session event with lock lifecycle:
 * 1) receive event
 * 2) lock session
 * 3) process event
 * 4) update session state
 * 5) unlock session (always, even if processing fails)
 *
 * @param {object} input
 * @param {object} input.manager - DungeonSessionManager instance
 * @param {object} input.event - Event object with session_id
 * @param {Function} input.processEventFn - async ({ event, sessionState }) => { statePatch? | nextState? | stateUpdater? , output? }
 * @returns {Promise<object>}
 */
async function processDungeonSessionEventSafe(input) {
  const manager = input.manager;
  const event = input.event;
  const processEventFn = input.processEventFn;

  if (!event || typeof event.session_id !== "string") {
    return {
      ok: false,
      status: "invalid_event",
      reason: "event.session_id is required"
    };
  }

  const sessionId = event.session_id;
  const lockAttempt = manager.lockDungeonSession(sessionId, {
    locked_by: "dungeon_session_event_processor",
    reason: event.event_type || "unknown_event"
  });

  if (!lockAttempt.ok) {
    return {
      ok: false,
      status: "locked",
      session_id: sessionId,
      reason: lockAttempt.reason || "session_locked",
      recommendation: lockAttempt.recommendation || "queue_event_for_retry"
    };
  }

  try {
    const sessionState = manager.getDungeonSession(sessionId);
    const result = await processEventFn({ event, sessionState });

    let updatedSession;
    if (result && typeof result.stateUpdater === "function") {
      updatedSession = manager.updateDungeonSession(sessionId, result.stateUpdater);
    } else if (result && result.nextState && typeof result.nextState === "object") {
      updatedSession = manager.updateDungeonSession(sessionId, () => result.nextState);
    } else {
      const patch = result && result.statePatch ? result.statePatch : {};
      updatedSession = manager.updateDungeonSession(sessionId, patch);
    }

    return {
      ok: true,
      status: "processed",
      session_id: sessionId,
      updated_session: updatedSession,
      output: result && result.output ? result.output : null
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      session_id: sessionId,
      reason: error.message
    };
  } finally {
    manager.unlockDungeonSession(sessionId);
  }
}

module.exports = {
  processDungeonSessionEventSafe
};

