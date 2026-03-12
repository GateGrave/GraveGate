"use strict";

const { CombatRegistry } = require("../registry/combat-registry");
const { createBattlefieldGrid, setTileAt, getTileAt } = require("../battlefield");
const { processMovementEvent } = require("../resolvers/movement.resolver");

async function runMovementExample() {
  const registry = new CombatRegistry();

  let grid = createBattlefieldGrid({ width: 9, height: 9 });

  // Place one difficult terrain tile and one hazard tile for demo.
  grid = setTileAt(grid, 2, 1, {
    ...getTileAt(grid, 2, 1),
    terrain: "difficult"
  });
  grid = setTileAt(grid, 3, 1, {
    ...getTileAt(grid, 3, 1),
    hazards: ["fire_rune"]
  });

  // Place an occupied tile to demonstrate invalid stop.
  grid = setTileAt(grid, 4, 1, {
    ...getTileAt(grid, 4, 1),
    occupant: "enemy-001"
  });

  const combat = registry.createCombat({
    combat_id: "combat-move-demo",
    battlefield_grid: grid,
    participants: [
      {
        participant_id: "player-001",
        initiative_modifier: 2,
        movement_speed: 30,
        movement_remaining: 30,
        position: { x: 1, y: 1 }
      },
      {
        participant_id: "enemy-001",
        initiative_modifier: 1,
        movement_speed: 30,
        movement_remaining: 30,
        position: { x: 4, y: 1 }
      }
    ]
  });

  // Occupy starting tile for player.
  const playerStart = combat.participants[0].position;
  const seededGrid = setTileAt(combat.battlefield_grid, playerStart.x, playerStart.y, {
    ...getTileAt(combat.battlefield_grid, playerStart.x, playerStart.y),
    occupant: "player-001"
  });
  await registry.updateCombatState(combat.combat_id, { battlefield_grid: seededGrid });

  const moveEvent = {
    event_id: "evt-move-001",
    event_type: "movement_requested",
    combat_id: combat.combat_id,
    timestamp: new Date().toISOString(),
    payload: {
      participant_id: "player-001",
      path: [
        { x: 2, y: 1 }, // difficult terrain (10 feet)
        { x: 3, y: 1 }, // hazard trigger (5 feet)
        { x: 4, y: 1 } // occupied (invalid, stop here)
      ]
    }
  };

  const result = await processMovementEvent({ registry, event: moveEvent });
  console.log(JSON.stringify(result.output, null, 2));
}

if (require.main === module) {
  runMovementExample().catch((error) => {
    console.error("Movement example failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  runMovementExample
};
