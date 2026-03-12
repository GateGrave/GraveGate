"use strict";

// COMBAT STATE (encounter-scoped layer, must stay isolated)
// What belongs here:
// - Turn order and initiative
// - Temporary status effects
// - Encounter-local HP/action snapshots
// Every read/write must include combat_id to prevent state mixing.
class InMemoryCombatState {
  constructor() {
    this.combatsById = new Map();
  }

  save(combatId, value) {
    if (!combatId) {
      throw new Error("combat_id is required to save combat state");
    }

    this.combatsById.set(combatId, value);
    return value;
  }

  load(combatId) {
    if (!combatId) {
      throw new Error("combat_id is required to load combat state");
    }

    return this.combatsById.get(combatId) || null;
  }
}

// Tiny mock save/load example that shows isolation by combat_id.
function mockCombatSaveLoadExample() {
  const combats = new InMemoryCombatState();
  combats.save("combat-001", { turn: 1, active_entity_id: "user-789" });
  combats.save("combat-002", { turn: 4, active_entity_id: "enemy-09" });

  return {
    combat_001: combats.load("combat-001"),
    combat_002: combats.load("combat-002")
  };
}

module.exports = {
  InMemoryCombatState,
  mockCombatSaveLoadExample
};
