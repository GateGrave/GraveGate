"use strict";

/**
 * Safely process one combat event with lock lifecycle:
 * 1) check lock
 * 2) lock
 * 3) process event
 * 4) update state
 * 5) unlock (always, even on error)
 *
 * @param {object} input
 * @param {object} input.registry - CombatRegistry instance
 * @param {object} input.event - Combat event object with combat_id
 * @param {Function} input.processEventFn - async ({ event, combatState }) => { statePatch? | nextState? | stateUpdater? , output? }
 * @returns {Promise<object>}
 */
async function processCombatEventSafe(input) {
  const registry = input.registry;
  const event = input.event;
  const processEventFn = input.processEventFn;

  if (!event || typeof event.combat_id !== "string") {
    return {
      ok: false,
      status: "invalid_event",
      reason: "event.combat_id is required"
    };
  }

  const combatId = event.combat_id;
  const lockAttempt = registry.lockCombat(combatId, {
    locked_by: "combat_event_processor",
    reason: event.event_type || "unknown_event"
  });

  if (!lockAttempt.ok) {
    return {
      ok: false,
      status: "locked",
      combat_id: combatId,
      reason: lockAttempt.reason || "combat_locked",
      recommendation: lockAttempt.recommendation || "queue_event_for_retry"
    };
  }

  try {
    const combatState = registry.getCombatById(combatId);
    const result = await processEventFn({ event, combatState });

    let updatedState;
    if (result && typeof result.stateUpdater === "function") {
      updatedState = await registry.updateCombatState(combatId, result.stateUpdater);
    } else if (result && result.nextState && typeof result.nextState === "object") {
      updatedState = await registry.updateCombatState(combatId, () => result.nextState);
    } else {
      const patch = result && result.statePatch ? result.statePatch : {};
      updatedState = await registry.updateCombatState(combatId, patch);
    }

    return {
      ok: true,
      status: "processed",
      combat_id: combatId,
      updated_state: updatedState,
      output: result && result.output ? result.output : null
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      combat_id: combatId,
      reason: error.message
    };
  } finally {
    registry.unlockCombat(combatId);
  }
}

module.exports = {
  processCombatEventSafe
};
