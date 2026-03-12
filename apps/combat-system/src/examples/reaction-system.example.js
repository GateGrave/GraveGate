"use strict";

const { CombatRegistry } = require("../registry/combat-registry");
const {
  createDefaultReactionRegistry,
  OPPORTUNITY_ATTACK,
  processReactionTriggerEvent
} = require("../reactions");

async function runReactionSystemExample() {
  const combatRegistry = new CombatRegistry();
  const reactionRegistry = createDefaultReactionRegistry();

  const usedCombat = combatRegistry.createCombat({
    combat_id: "combat-reaction-demo",
    participants: [
      {
        participant_id: "fighter-001",
        position: { x: 2, y: 2 },
        reaction_available: true,
        team_id: "heroes"
      },
      {
        participant_id: "goblin-001",
        position: { x: 3, y: 2 },
        reaction_available: true,
        team_id: "monsters"
      }
    ]
  });

  const triggerEvent = {
    event_id: "evt-trigger-001",
    event_type: "combat_trigger_enemy_leaves_melee_range",
    combat_id: usedCombat.combat_id,
    timestamp: new Date().toISOString(),
    payload: {
      moving_participant_id: "goblin-001",
      from_position: { x: 3, y: 2 },
      to_position: { x: 5, y: 2 }
    }
  };

  // Example decision provider:
  // uses opportunity attack immediately.
  const decisionProvider = async ({ window }) => {
    const candidate = window.candidates.find(
      (item) => item.reaction_type === OPPORTUNITY_ATTACK
    );
    if (!candidate) {
      return { status: "declined" };
    }

    return {
      status: "used",
      reaction_type: candidate.reaction_type,
      reactor_participant_id: candidate.reactor_participant_id
    };
  };

  const usedResult = await processReactionTriggerEvent({
    registry: combatRegistry,
    reaction_registry: reactionRegistry,
    event: triggerEvent,
    decision_provider: decisionProvider,
    wait_ms: 10000
  });

  const timeoutCombat = combatRegistry.createCombat({
    combat_id: "combat-reaction-timeout-demo",
    participants: [
      {
        participant_id: "fighter-002",
        position: { x: 2, y: 2 },
        reaction_available: true,
        team_id: "heroes"
      },
      {
        participant_id: "goblin-002",
        position: { x: 3, y: 2 },
        reaction_available: true,
        team_id: "monsters"
      }
    ]
  });

  const timeoutTriggerEvent = {
    event_id: "evt-trigger-002",
    event_type: "combat_trigger_enemy_leaves_melee_range",
    combat_id: timeoutCombat.combat_id,
    timestamp: new Date().toISOString(),
    payload: {
      moving_participant_id: "goblin-002",
      from_position: { x: 3, y: 2 },
      to_position: { x: 5, y: 2 }
    }
  };

  const timeoutResult = await processReactionTriggerEvent({
    registry: combatRegistry,
    reaction_registry: reactionRegistry,
    event: timeoutTriggerEvent,
    // no decision provider => timeout path
    wait_ms: 50
  });

  return {
    used_result_status: usedResult.output.status,
    used_result_events: usedResult.output.emitted_events,
    timeout_result_status: timeoutResult.output.status,
    timeout_result_events: timeoutResult.output.emitted_events
  };
}

if (require.main === module) {
  runReactionSystemExample()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error("Reaction example failed:", error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  runReactionSystemExample
};
