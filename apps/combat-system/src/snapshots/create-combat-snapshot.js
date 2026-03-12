"use strict";

function createCombatSnapshot(combatState) {
  return {
    snapshot_id: `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    combat_id: combatState.combat_id,
    snapshot_timestamp: new Date().toISOString(),
    round_number: combatState.round_number,
    current_turn_index: combatState.current_turn_index,
    initiative_order: Array.isArray(combatState.initiative_order)
      ? [...combatState.initiative_order]
      : [],
    grid_positions: Array.isArray(combatState.participants)
      ? combatState.participants.map((participant) => ({
          participant_id: participant.participant_id,
          position: participant.position || null
        }))
      : [],
    active_effects: Array.isArray(combatState.active_effects)
      ? [...combatState.active_effects]
      : [],
    combat_state: JSON.parse(JSON.stringify(combatState))
  };
}

module.exports = {
  createCombatSnapshot
};
