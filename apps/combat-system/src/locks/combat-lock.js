"use strict";

/**
 * Check if a combat instance is currently locked.
 * @param {object} combatState
 * @returns {boolean}
 */
function isCombatInstanceLocked(combatState) {
  if (!combatState) {
    return false;
  }

  return Boolean(combatState.lock_flag || (combatState.lock && combatState.lock.locked));
}

/**
 * Return a locked version of the combat state.
 * @param {object} combatState
 * @param {object} [lockInfo]
 * @returns {object}
 */
function lockCombatInstance(combatState, lockInfo) {
  const info = lockInfo || {};

  return {
    ...combatState,
    lock_flag: true,
    lock: {
      locked: true,
      locked_at: new Date().toISOString(),
      locked_by: info.locked_by || "combat_processor",
      reason: info.reason || "event_processing"
    },
    updated_at: new Date().toISOString()
  };
}

/**
 * Return an unlocked version of the combat state.
 * @param {object} combatState
 * @returns {object}
 */
function unlockCombatInstance(combatState) {
  return {
    ...combatState,
    lock_flag: false,
    lock: {
      locked: false,
      locked_at: null,
      locked_by: null,
      reason: null
    },
    updated_at: new Date().toISOString()
  };
}

module.exports = {
  lockCombatInstance,
  unlockCombatInstance,
  isCombatInstanceLocked
};
