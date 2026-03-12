"use strict";

const { createCombatInstance } = require("../factory/create-combat-instance");
const { isCombatStateShapeValid } = require("../schema/combat-state.schema");
const {
  lockCombatInstance,
  unlockCombatInstance,
  isCombatInstanceLocked
} = require("../locks/combat-lock");
const {
  initializeInitiativeState,
  advanceToNextTurn
} = require("../initiative/initiative-state");

// In-memory combat registry.
// Keeps every combat instance isolated by combat_id.
class CombatRegistry {
  constructor() {
    this.combatsById = new Map();
    this.updateQueuesByCombatId = new Map();
  }

  /**
   * Create and register one combat instance.
   * @param {object} options
   * @returns {object}
   */
  createCombat(options) {
    const combat = createCombatInstance(options);
    this.combatsById.set(combat.combat_id, combat);
    return combat;
  }

  /**
   * Fetch one combat by id.
   * @param {string} combatId
   * @returns {object|null}
   */
  getCombatById(combatId) {
    return this.combatsById.get(combatId) || null;
  }

  /**
   * Check if one combat is locked.
   * @param {string} combatId
   * @returns {boolean}
   */
  isCombatLocked(combatId) {
    const combat = this.getCombatById(combatId);
    if (!combat) {
      return false;
    }

    return isCombatInstanceLocked(combat);
  }

  /**
   * Try to lock one combat instance.
   * @param {string} combatId
   * @param {object} [lockInfo]
   * @returns {{ok: boolean, combat_id: string, recommendation?: string, state?: object, reason?: string}}
   */
  lockCombat(combatId, lockInfo) {
    const combat = this.getCombatById(combatId);
    if (!combat) {
      return { ok: false, combat_id: combatId, reason: "combat_not_found" };
    }

    if (isCombatInstanceLocked(combat)) {
      return {
        ok: false,
        combat_id: combatId,
        reason: "combat_locked",
        recommendation: "queue_event_for_retry"
      };
    }

    const lockedState = lockCombatInstance(combat, lockInfo);
    this.combatsById.set(combatId, lockedState);
    return { ok: true, combat_id: combatId, state: lockedState };
  }

  /**
   * Unlock one combat instance.
   * @param {string} combatId
   * @returns {{ok: boolean, combat_id: string, state?: object, reason?: string}}
   */
  unlockCombat(combatId) {
    const combat = this.getCombatById(combatId);
    if (!combat) {
      return { ok: false, combat_id: combatId, reason: "combat_not_found" };
    }

    const unlockedState = unlockCombatInstance(combat);
    this.combatsById.set(combatId, unlockedState);
    return { ok: true, combat_id: combatId, state: unlockedState };
  }

  /**
   * Update one combat state safely in async flows.
   * - Updates for the same combat_id are queued in order.
   * - Different combat_ids can update independently.
   * @param {string} combatId
   * @param {Function|object} updateInput
   * @returns {Promise<object>}
   */
  async updateCombatState(combatId, updateInput) {
    const currentQueue = this.updateQueuesByCombatId.get(combatId) || Promise.resolve();

    const nextQueue = currentQueue.then(async () => {
      const current = this.getCombatById(combatId);
      if (!current) {
        throw new Error(`Combat not found: ${combatId}`);
      }

      let nextState;
      if (typeof updateInput === "function") {
        nextState = updateInput({ ...current });
      } else {
        nextState = { ...current, ...(updateInput || {}) };
      }

      nextState.combat_id = current.combat_id;
      nextState.created_at = current.created_at;
      nextState.updated_at = new Date().toISOString();
      nextState.lock_flag = current.lock_flag;
      nextState.lock = current.lock;

      if (!isCombatStateShapeValid(nextState)) {
        throw new Error("updateCombatState produced an invalid combat state shape");
      }

      this.combatsById.set(combatId, nextState);
      return nextState;
    });

    // Keep queue alive even when a previous update fails.
    this.updateQueuesByCombatId.set(
      combatId,
      nextQueue.catch(() => Promise.resolve())
    );

    return nextQueue;
  }

  /**
   * Remove one combat by id.
   * @param {string} combatId
   * @returns {boolean}
   */
  removeCombat(combatId) {
    this.updateQueuesByCombatId.delete(combatId);
    return this.combatsById.delete(combatId);
  }

  /**
   * List active combats only.
   * @returns {object[]}
   */
  listActiveCombats() {
    const active = [];

    for (const combat of this.combatsById.values()) {
      if (combat.combat_status === "active") {
        active.push(combat);
      }
    }

    return active;
  }

  /**
   * Re-roll and store initiative order for one combat.
   * Resets current_turn_index to 0 and round_number to 1.
   * @param {string} combatId
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async initializeInitiative(combatId, options) {
    return this.updateCombatState(combatId, (state) => {
      return initializeInitiativeState(state, options);
    });
  }

  /**
   * Advance one turn in initiative order.
   * Wraps turn index and increments round_number when needed.
   * @param {string} combatId
   * @returns {Promise<object>}
   */
  async advanceTurn(combatId) {
    return this.updateCombatState(combatId, (state) => {
      return advanceToNextTurn(state);
    });
  }
}

module.exports = {
  CombatRegistry
};
