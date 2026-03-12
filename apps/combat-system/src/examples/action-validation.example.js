"use strict";

const { CombatRegistry } = require("../registry/combat-registry");
const { createBattlefieldGrid, setTileAt, getTileAt } = require("../battlefield");
const { validateCombatAction } = require("../validation");

function runActionValidationExample() {
  let grid = createBattlefieldGrid({ width: 9, height: 9 });

  // Add one line-of-effect blocker.
  grid = setTileAt(grid, 2, 2, {
    ...getTileAt(grid, 2, 2),
    terrain: "wall"
  });

  const registry = new CombatRegistry();
  const combat = registry.createCombat({
    combat_id: "combat-validate-demo",
    battlefield_grid: grid,
    participants: [
      {
        participant_id: "player-001",
        position: { x: 1, y: 1 },
        movement_speed: 30,
        movement_remaining: 30,
        action_available: true,
        bonus_action_available: true
      },
      {
        participant_id: "enemy-001",
        position: { x: 3, y: 3 },
        movement_speed: 30,
        movement_remaining: 30,
        action_available: true,
        bonus_action_available: false
      }
    ]
  });

  const attackPayload = {
    action_type: "attack",
    actor_participant_id: "player-001",
    target_participant_id: "enemy-001",
    max_range_feet: 10
  };

  const movePayload = {
    action_type: "move",
    actor_participant_id: "player-001",
    destination: { x: 3, y: 1 },
    path: [{ x: 2, y: 1 }, { x: 3, y: 1 }]
  };

  const castSpellPayload = {
    action_type: "cast_spell",
    actor_participant_id: "player-001",
    target_participant_id: "enemy-001",
    max_range_feet: 60
  };

  const attackCheck = validateCombatAction({
    combat_state: combat,
    action_payload: attackPayload
  });
  const moveCheck = validateCombatAction({
    combat_state: combat,
    action_payload: movePayload
  });
  const spellCheck = validateCombatAction({
    combat_state: combat,
    action_payload: castSpellPayload
  });

  return {
    attack_check: attackCheck,
    move_check: moveCheck,
    cast_spell_check: spellCheck
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runActionValidationExample(), null, 2));
}

module.exports = {
  runActionValidationExample
};
