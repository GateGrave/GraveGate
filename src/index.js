"use strict";

const { EVENT_TYPES } = require("../packages/shared-types");
const { EventQueue } = require("../apps/queue/src");
const { EventRouter } = require("../apps/controller/src");
const { createExampleEventsFromMockDiscordInput } = require("../apps/gateway/src");
const { DatabasePlaceholder } = require("../apps/database/src");
const { EventLogger } = require("../apps/logger/src");

// Phase 1 bootstrap flow:
// 1) Gateway emits example events (no gameplay logic).
// 2) Queue stores events in order.
// 3) Router dispatches each event by event_type.
// 4) Database placeholder acknowledges saved events.
// 5) Logger records queue entry, routing, results, and basic errors.
function main() {
  const logger = new EventLogger();
  const queue = new EventQueue(logger);
  const router = new EventRouter();
  const database = new DatabasePlaceholder();

  database.connect();

  // Register one shared handler for all example gameplay event types.
  // The handler does not execute gameplay; it only forwards to database placeholder.
  const exampleEventTypes = [
    EVENT_TYPES.PLAYER_MOVE,
    EVENT_TYPES.PLAYER_ATTACK,
    EVENT_TYPES.PLAYER_CAST_SPELL,
    EVENT_TYPES.COMBAT_STARTED,
    EVENT_TYPES.LOOT_GENERATED
  ];

  for (const eventType of exampleEventTypes) {
    router.register(eventType, (event) => {
      return database.handleEvent(event);
    });
  }

  // Final acknowledgement route for saved events.
  router.register(EVENT_TYPES.DATABASE_EVENT_SAVED, () => {
    return [];
  });
  router.register(EVENT_TYPES.WORLD_ACTION_RESULT, () => {
    return [];
  });

  const mockDiscordInput = {
    guildId: "guild-123",
    channelId: "channel-456",
    authorId: "user-789",
    content: "!phase1-demo"
  };

  const gatewayEvents = createExampleEventsFromMockDiscordInput(mockDiscordInput);

  for (const event of gatewayEvents) {
    queue.enqueue(event);
  }

  // Process FIFO until all initial and generated events are handled.
  queue.processAll(router, { queue, logger, database });

  database.disconnect();

  console.log("Total processed events:", logger.getRecords().length);
}

if (require.main === module) {
  main();
}

module.exports = {
  main
};
