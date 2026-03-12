"use strict";

const { createEvent, EVENT_TYPES } = require("../packages/shared-types");
const { EventQueue } = require("../apps/queue/src");
const { EventRouter } = require("../apps/controller/src");
const { EventLogger } = require("../apps/logger/src");

// Phase 1 architecture test:
// - No real Discord API
// - No real database
// - Gateway layer is only a translator from external input to internal events

function simulateGatewayInput() {
  return [
    {
      kind: "slash_command",
      name: "move",
      options: { direction: "north", steps: 1 },
      actor: { player_id: "user-789", session_id: "session-001" }
    },
    {
      kind: "slash_command",
      name: "start_combat",
      options: { combat_id: "combat-001", enemy_group: "goblins" },
      actor: { player_id: "user-789", session_id: "session-001" }
    }
  ];
}

function translateGatewayInputToEvent(input) {
  if (input.name === "move") {
    return createEvent(EVENT_TYPES.PLAYER_MOVE, input.options, {
      source: "gateway",
      target_system: "session",
      player_id: input.actor.player_id,
      session_id: input.actor.session_id,
      combat_id: null
    });
  }

  if (input.name === "start_combat") {
    return createEvent(EVENT_TYPES.COMBAT_STARTED, input.options, {
      source: "gateway",
      target_system: "combat",
      player_id: input.actor.player_id,
      session_id: input.actor.session_id,
      combat_id: input.options.combat_id
    });
  }

  return null;
}

function main() {
  const logger = new EventLogger();
  const queue = new EventQueue(logger);
  const router = new EventRouter();

  // Stub handlers only.
  // They confirm routing works but do not implement gameplay.
  router.register(EVENT_TYPES.PLAYER_MOVE, () => []);
  router.register(EVENT_TYPES.COMBAT_STARTED, () => []);

  const mockInputs = simulateGatewayInput();

  for (const input of mockInputs) {
    const event = translateGatewayInputToEvent(input);
    if (event) {
      queue.enqueue(event);
    }
  }

  // End-to-end flow:
  // gateway input -> event -> queue -> router -> logger output
  queue.processAll(router, { queue, logger });

  console.log("Architecture test complete.");
  console.log("Total log entries:", logger.getRecords().length);
}

if (require.main === module) {
  main();
}

module.exports = {
  simulateGatewayInput,
  translateGatewayInputToEvent,
  main
};
