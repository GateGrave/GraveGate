"use strict";
const { initializeInitiativeState } = require("../initiative/initiative-state");
const { createBattlefieldGrid } = require("../battlefield");

/**
 * Build a unique combat id for in-memory combat instances.
 * @returns {string}
 */
function createCombatId() {
  return `combat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Initialize a new combat state object.
 * No attack/movement/reaction logic is implemented here.
 * @param {object} options
 * @param {string} [options.combat_id]
 * @param {object[]} [options.participants]
 * @param {object} [options.battlefield_grid]
 * @returns {object}
 */
function createCombatInstance(options) {
  const input = options || {};
  const now = new Date().toISOString();
  const participants = Array.isArray(input.participants) ? [...input.participants] : [];

  const baseState = {
    combat_id: input.combat_id || createCombatId(),
    participants,
    initiative_order: [],
    current_turn_index: 0,
    round_number: 1,
    battlefield_grid: input.battlefield_grid || createBattlefieldGrid({ width: 9, height: 9 }),
    active_effects: [],
    combat_status: "active",
    lock_flag: false,
    lock: {
      locked: false,
      locked_at: null,
      locked_by: null,
      reason: null
    },
    created_at: now,
    updated_at: now
  };

  // Phase 3B: initialize initiative as part of combat creation.
  // This sets initiative_order, current_turn_index, and round_number.
  return initializeInitiativeState(baseState, {
    rng: input.initiative_rng
  });
}

module.exports = {
  createCombatId,
  createCombatInstance
};
