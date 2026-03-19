"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildCombatId() {
  return "combat-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function createCombatModel(input) {
  const data = input || {};
  const now = new Date().toISOString();

  const combat = {
    combat_id: data.combat_id || buildCombatId(),
    status: data.status || "pending",
    round: Number.isFinite(data.round) ? Math.max(1, Math.floor(data.round)) : 1,
    turn_index: Number.isFinite(data.turn_index) ? Math.max(0, Math.floor(data.turn_index)) : 0,
    participants: Array.isArray(data.participants) ? clone(data.participants) : [],
    conditions: Array.isArray(data.conditions) ? clone(data.conditions) : [],
    initiative_order: Array.isArray(data.initiative_order) ? clone(data.initiative_order) : [],
    active_effects: Array.isArray(data.active_effects) ? clone(data.active_effects) : [],
    battlefield_grid:
      data.battlefield_grid && typeof data.battlefield_grid === "object" ? clone(data.battlefield_grid) : null,
    battlefield: data.battlefield && typeof data.battlefield === "object" ? clone(data.battlefield) : {},
    event_log: Array.isArray(data.event_log) ? clone(data.event_log) : [],
    created_at: data.created_at || now,
    updated_at: data.updated_at || now
  };

  return combat;
}

module.exports = {
  createCombatModel
};
