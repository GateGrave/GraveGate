"use strict";

// Combat state schema shape (documentation + scaffold).
// This module does not enforce full runtime validation yet.
const COMBAT_STATE_SCHEMA = {
  combat_id: "string",
  participants: "array",
  initiative_order: "array",
  current_turn_index: "number",
  round_number: "number",
  battlefield_grid: "object",
  active_effects: "array",
  combat_status: "string",
  lock_flag: "boolean",
  lock: "object",
  created_at: "ISO-8601 string",
  updated_at: "ISO-8601 string"
};

/**
 * Basic shape check for Phase 3A.1 scaffolding.
 * @param {object} combatState
 * @returns {boolean}
 */
function isCombatStateShapeValid(combatState) {
  if (!combatState || typeof combatState !== "object") {
    return false;
  }

  return (
    typeof combatState.combat_id === "string" &&
    Array.isArray(combatState.participants) &&
    Array.isArray(combatState.initiative_order) &&
    typeof combatState.current_turn_index === "number" &&
    typeof combatState.round_number === "number" &&
    typeof combatState.battlefield_grid === "object" &&
    Array.isArray(combatState.active_effects) &&
    typeof combatState.combat_status === "string" &&
    typeof combatState.lock_flag === "boolean" &&
    typeof combatState.lock === "object" &&
    combatState.lock !== null &&
    typeof combatState.lock.locked === "boolean" &&
    typeof combatState.created_at === "string" &&
    typeof combatState.updated_at === "string"
  );
}

module.exports = {
  COMBAT_STATE_SCHEMA,
  isCombatStateShapeValid
};
