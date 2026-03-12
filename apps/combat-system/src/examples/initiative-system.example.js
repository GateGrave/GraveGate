"use strict";

const { CombatRegistry } = require("../registry/combat-registry");

async function runInitiativeExample() {
  const registry = new CombatRegistry();

  const combat = registry.createCombat({
    combat_id: "combat-initiative-demo",
    participants: [
      { participant_id: "player-001", name: "Aria", initiative_modifier: 3 },
      { participant_id: "player-002", name: "Bram", initiative_modifier: 1 },
      { participant_id: "enemy-001", name: "Goblin", initiative_modifier: 2 }
    ]
  });

  console.log("Combat created:", combat.combat_id);
  console.log("Initial round:", combat.round_number);
  console.log("Initial turn index:", combat.current_turn_index);
  console.log("Initiative order:", combat.initiative_order);

  // Advance turns to show wrapping behavior.
  let state = await registry.advanceTurn(combat.combat_id);
  console.log("After turn 1 -> index:", state.current_turn_index, "round:", state.round_number);

  state = await registry.advanceTurn(combat.combat_id);
  console.log("After turn 2 -> index:", state.current_turn_index, "round:", state.round_number);

  state = await registry.advanceTurn(combat.combat_id);
  console.log("After turn 3 -> index:", state.current_turn_index, "round:", state.round_number);
}

if (require.main === module) {
  runInitiativeExample().catch((error) => {
    console.error("Initiative example failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  runInitiativeExample
};
