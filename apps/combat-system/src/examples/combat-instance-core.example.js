"use strict";

const { CombatRegistry } = require("../registry/combat-registry");

async function runExample() {
  const registry = new CombatRegistry();

  // 1) Create combat
  const combat = registry.createCombat({
    participants: [
      { participant_id: "player-001", name: "Aria" },
      { participant_id: "enemy-001", name: "Goblin Scout" }
    ],
    battlefield_grid: {
      width: 8,
      height: 8,
      cells: []
    }
  });

  console.log("Created combat:", combat.combat_id);

  // 2) Fetch combat by id
  const fetched = registry.getCombatById(combat.combat_id);
  console.log("Fetched combat participants:", fetched.participants.length);

  // 3) Update combat state (async-safe queue per combat_id)
  const updated = await registry.updateCombatState(combat.combat_id, (state) => {
    return {
      ...state,
      round_number: state.round_number + 1,
      current_turn_index: 1
    };
  });

  console.log("Updated round:", updated.round_number);

  // 4) List active combats
  const active = registry.listActiveCombats();
  console.log("Active combats:", active.length);

  // 5) Remove combat
  const removed = registry.removeCombat(combat.combat_id);
  console.log("Removed:", removed);
}

if (require.main === module) {
  runExample().catch((error) => {
    console.error("Example failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  runExample
};
