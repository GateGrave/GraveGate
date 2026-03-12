"use strict";

const { CombatRegistry } = require("../registry/combat-registry");
const { processTurnStartedEvent } = require("../resolvers/turn-started.resolver");

async function runTurnStartedExample() {
  const registry = new CombatRegistry();

  const combat = registry.createCombat({
    combat_id: "combat-turn-start-demo",
    participants: [
      {
        participant_id: "player-001",
        name: "Aria",
        initiative_modifier: 3,
        movement_speed: 30,
        action_available: false,
        bonus_action_available: false,
        reaction_available: false,
        movement_remaining: 0
      },
      {
        participant_id: "enemy-001",
        name: "Goblin",
        initiative_modifier: 1,
        movement_speed: 30,
        action_available: false,
        bonus_action_available: false,
        reaction_available: false,
        movement_remaining: 0
      }
    ]
  });

  const event = {
    event_id: "evt-turn-start-001",
    event_type: "turn_started",
    combat_id: combat.combat_id,
    timestamp: new Date().toISOString(),
    payload: {}
  };

  const result = await processTurnStartedEvent({ registry, event });
  console.log("Result status:", result.status);
  console.log("Active participant:", result.output.active_participant_id);
  console.log("Updated participant:", result.updated_state.participants.find((p) => p.participant_id === result.output.active_participant_id));
}

if (require.main === module) {
  runTurnStartedExample().catch((error) => {
    console.error("turn_started example failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  runTurnStartedExample
};
