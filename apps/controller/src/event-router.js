"use strict";

const { EVENT_TYPES, isValidEvent } = require("../../../packages/shared-types");
const {
  handleWorldEvent,
  handleSessionEvent,
  handleCombatEvent,
  handleControllerEvent
} = require("./handlers");

// Event Router exists so systems stay decoupled.
// Systems do not call each other directly.
// They only emit events, and the router decides where each event goes.
class EventRouter {
  constructor() {
    this.routes = new Map();
  }

  /**
   * Optional extension point for later phases.
   * Allows event_type-specific handlers to be attached without coupling systems.
   * @param {string} eventType
   * @param {Function} handler
   */
  register(eventType, handler) {
    if (!this.routes.has(eventType)) {
      this.routes.set(eventType, []);
    }

    this.routes.get(eventType).push(handler);
  }

  /**
   * Inspect one event and route it to a placeholder system handler.
   * @param {object} event
   * @param {object} context
   */
  route(event, context) {
    if (!isValidEvent(event)) {
      throw new Error("EventRouter.route received an invalid event object");
    }

    const resolved = this.resolveSystem(event);
    const system = resolved.system;
    const logger = context.logger;

    if (!system) {
      const errorResult = {
        ok: false,
        event_type: "event_routing_failed",
        payload: {
          reason: resolved.reason || "unsupported_event_type",
          event_type: event.event_type,
          target_system: event.target_system || null,
          details: resolved.details || null
        },
        error: resolved.error || "unsupported event type for router"
      };

      if (logger && typeof logger.logProcessingResult === "function") {
        logger.logProcessingResult(event, errorResult);
      }

      return {
        ok: false,
        system: null,
        generated_events: 0,
        routing_error: errorResult
      };
    }

    if (logger) {
      logger.logRoute(event, system);
    }

    const systemEvents = this.routeToSystemStub(event, context, system) || [];
    let generatedEvents = 0;
    generatedEvents += this.enqueueAll(systemEvents, context);

    const typedHandlers = this.routes.get(event.event_type) || [];
    for (const handler of typedHandlers) {
      const nextEvents = handler(event, context) || [];
      generatedEvents += this.enqueueAll(nextEvents, context);
    }

    if (generatedEvents === 0) {
      const errorResult = {
        ok: false,
        event_type: "event_routing_failed",
        payload: {
          reason: "unhandled_event",
          event_type: event.event_type,
          target_system: event.target_system || null
        },
        error: "event routed to subsystem but no handler emitted follow-up events"
      };

      if (logger && typeof logger.logProcessingResult === "function") {
        logger.logProcessingResult(event, errorResult);
      }

      return {
        ok: false,
        system,
        generated_events: 0,
        routing_error: errorResult
      };
    }

    return {
      ok: true,
      system,
      generated_events: generatedEvents
    };
  }

  /**
   * Route to one of the three Phase 1 system stubs:
   * - world
   * - session
   * - combat
   */
  routeToSystemStub(event, context, system) {
    if (system === "world") {
      return handleWorldEvent(event, context);
    }

    if (system === "session") {
      return handleSessionEvent(event, context);
    }

    if (system === "combat") {
      return handleCombatEvent(event, context);
    }

    if (system === "controller") {
      return handleControllerEvent(event, context);
    }

    return [];
  }

  /**
   * Pick the target system for the event.
   * Prefer event.target_system. If missing/unknown, infer by event_type.
   */
  resolveSystem(event) {
    const directTarget = event.target_system;
    if (
      directTarget === "world" ||
      directTarget === "session" ||
      directTarget === "combat" ||
      directTarget === "controller"
    ) {
      return { system: directTarget, reason: null, error: null, details: null };
    }

    if (directTarget === "world_system") {
      return { system: "world", reason: null, error: null, details: null };
    }
    if (directTarget === "session_system") {
      return { system: "session", reason: null, error: null, details: null };
    }
    if (directTarget === "combat_system") {
      return { system: "combat", reason: null, error: null, details: null };
    }

    if (directTarget !== null && directTarget !== undefined) {
      return {
        system: null,
        reason: "unsupported_target_system",
        error: "unsupported target_system for router",
        details: {
          target_system: String(directTarget)
        }
      };
    }

    const byType = {
      [EVENT_TYPES.CHARACTER_CREATED]: "world",
      [EVENT_TYPES.CHARACTER_UPDATED]: "world",
      [EVENT_TYPES.LEVEL_UP]: "world",
      [EVENT_TYPES.ITEM_ADDED]: "world",
      [EVENT_TYPES.ITEM_REMOVED]: "world",
      [EVENT_TYPES.ITEM_EQUIPPED]: "world",
      [EVENT_TYPES.ITEM_UNEQUIPPED]: "world",
      [EVENT_TYPES.PLAYER_USE_ITEM]: "world",
      [EVENT_TYPES.PLAYER_PROFILE_REQUESTED]: "world",
      [EVENT_TYPES.PLAYER_COMBAT_REQUESTED]: "combat",
      [EVENT_TYPES.PLAYER_INVENTORY_REQUESTED]: "world",
      [EVENT_TYPES.PLAYER_SHOP_REQUESTED]: "world",
      [EVENT_TYPES.PLAYER_CRAFT_REQUESTED]: "world",
      [EVENT_TYPES.PLAYER_TRADE_REQUESTED]: "world",
      [EVENT_TYPES.PLAYER_ADMIN_REQUESTED]: "world",
      [EVENT_TYPES.PLAYER_START_REQUESTED]: "world",
      [EVENT_TYPES.PLAYER_EQUIP_REQUESTED]: "world",
      [EVENT_TYPES.PLAYER_UNEQUIP_REQUESTED]: "world",
      [EVENT_TYPES.PLAYER_IDENTIFY_ITEM_REQUESTED]: "world",
      [EVENT_TYPES.PLAYER_ATTUNE_ITEM_REQUESTED]: "world",
      [EVENT_TYPES.PLAYER_UNATTUNE_ITEM_REQUESTED]: "world",
      [EVENT_TYPES.PLAYER_FEAT_REQUESTED]: "world",
      [EVENT_TYPES.GATEWAY_HELP_REQUESTED]: "controller",
      [EVENT_TYPES.GATEWAY_PING_REQUESTED]: "controller",
      [EVENT_TYPES.PLAYER_ENTER_DUNGEON]: "session",
      [EVENT_TYPES.PLAYER_LEAVE_SESSION]: "session",
      [EVENT_TYPES.PLAYER_INTERACT_OBJECT]: "session",
      [EVENT_TYPES.PLAYER_MOVE]: "session",
      [EVENT_TYPES.LOOT_GENERATED]: "session",
      [EVENT_TYPES.PLAYER_ATTACK]: "combat",
      [EVENT_TYPES.PLAYER_HELP_ACTION]: "combat",
      [EVENT_TYPES.PLAYER_READY_ACTION]: "combat",
      [EVENT_TYPES.PLAYER_DODGE]: "combat",
      [EVENT_TYPES.PLAYER_DASH]: "combat",
      [EVENT_TYPES.PLAYER_GRAPPLE]: "combat",
      [EVENT_TYPES.PLAYER_ESCAPE_GRAPPLE]: "combat",
      [EVENT_TYPES.PLAYER_SHOVE]: "combat",
      [EVENT_TYPES.PLAYER_DISENGAGE]: "combat",
      [EVENT_TYPES.PLAYER_CAST_SPELL]: "combat",
      [EVENT_TYPES.COMBAT_STARTED]: "combat"
    };

    const byTypeSystem = byType[event.event_type] || null;
    if (!byTypeSystem) {
      return {
        system: null,
        reason: "unsupported_event_type",
        error: "unsupported event type for router",
        details: {
          event_type: event.event_type
        }
      };
    }

    return {
      system: byTypeSystem,
      reason: null,
      error: null,
      details: null
    };
  }

  /**
   * Queue any events returned by handlers.
   */
  enqueueAll(events, context) {
    let count = 0;

    for (const nextEvent of events) {
      if (!isValidEvent(nextEvent)) {
        throw new Error("Handler returned an invalid event object");
      }

      context.queue.enqueue(nextEvent);
      count += 1;
    }

    return count;
  }
}

module.exports = {
  EventRouter
};
