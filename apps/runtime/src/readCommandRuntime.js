"use strict";

const { createEvent, EVENT_TYPES } = require("../../../packages/shared-types");
const {
  EventRouter,
  validateIncomingGatewayEvent,
  SUPPORTED_READ_COMMAND_EVENTS
} = require("../../controller/src");
const { createEventBus } = require("./eventBus");
const { createOrchestrator } = require("./orchestrator");
const {
  handleWorldCommandDispatch,
  handleSessionCommandDispatch,
  handleCombatCommandDispatch
} = require("./domainCommandDispatchHandlers");
const { CharacterRepository } = require("../../world-system/src/character/character.repository");
const { CharacterPersistenceBridge } = require("../../world-system/src/character/character.persistence");
const { AccountPersistenceBridge } = require("../../world-system/src/account/account.persistence");
const { AccountService } = require("../../world-system/src/account/account.service");
const { PartyPersistenceBridge } = require("../../world-system/src/party/party.persistence");
const { PartyService } = require("../../world-system/src/party/party.service");
const { InventoryPersistenceBridge } = require("../../inventory-system/src/inventory.persistence");
const { SessionPersistenceBridge } = require("../../dungeon-exploration/src/session.persistence");
const { DungeonSessionManagerCore } = require("../../dungeon-exploration/src/core/dungeonSessionManager");
const { CombatManager } = require("../../combat-system/src/core/combatManager");
const { CombatPersistenceBridge } = require("../../combat-system/src/combat.persistence");
const { defaultGuildManager } = require("../../world-system/src/guild");
const { defaultWorldEventManager } = require("../../world-system/src/world-events");
const {
  NpcShopManager,
  InMemoryNpcShopStore,
  TransactionManager,
  InMemoryTransactionStore,
  PlayerTradeManager,
  InMemoryPlayerTradeStore,
  PlayerTradePersistenceBridge,
  ProcessedNpcShopPurchaseStore,
  ProcessedNpcShopSellStore
} = require("../../world-system/src/economy");
const { ProcessedCraftFinalizationStore } = require("../../world-system/src/crafting/craft-resource-consumption.flow");
const { loadStarterContentBundle } = require("../../world-system/src/content");

function createAdminAccessControl(options) {
  const cfg = options || {};
  const ids = new Set(
    (cfg.admin_player_ids || [])
      .map((value) => String(value || "").trim())
      .filter((value) => value !== "")
  );

  return {
    isAdminPlayerId(playerId) {
      const id = String(playerId || "").trim();
      if (!id) return false;
      return ids.has(id);
    }
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createMutationReplayStore() {
  const seen = new Set();
  const order = [];
  return {
    has(replayKey) {
      return seen.has(String(replayKey || ""));
    },
    add(replayKey) {
      const key = String(replayKey || "");
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      order.push(key);
      if (order.length > 2000) {
        const expired = order.shift();
        seen.delete(expired);
      }
    }
  };
}

function createValidationFailureResponse(event, validation) {
  return createEvent(EVENT_TYPES.GATEWAY_RESPONSE_READY, {
    response_type: "validation_error",
    ok: false,
    data: {},
    error: validation.error || "validation failed",
    request_event_type: event && event.event_type ? event.event_type : null
  }, {
    source: "controller",
    target_system: "gateway",
    player_id: event && event.player_id ? event.player_id : null,
    session_id: event && event.session_id ? event.session_id : null,
    combat_id: event && event.combat_id ? event.combat_id : null
  });
}

function createRoutingFailureResponse(event, routingError) {
  const errorPayload = routingError && routingError.payload ? routingError.payload : {};
  return createEvent(EVENT_TYPES.GATEWAY_RESPONSE_READY, {
    response_type: "routing_error",
    ok: false,
    data: {
      reason: errorPayload.reason || null,
      target_system: errorPayload.target_system || null,
      details: errorPayload.details || null
    },
    error: (routingError && routingError.error) || "routing failed",
    request_event_type: event && event.event_type ? event.event_type : null
  }, {
    source: "controller",
    target_system: "gateway",
    player_id: event && event.player_id ? event.player_id : null,
    session_id: event && event.session_id ? event.session_id : null,
    combat_id: event && event.combat_id ? event.combat_id : null
  });
}

function createUnhandledFailureResponse(event) {
  return createEvent(EVENT_TYPES.GATEWAY_RESPONSE_READY, {
    response_type: "routing_error",
    ok: false,
    data: {
      reason: "unhandled_event",
      target_system: event && event.target_system ? event.target_system : null
    },
    error: "event produced no follow-up responses",
    request_event_type: event && event.event_type ? event.event_type : null
  }, {
    source: "controller",
    target_system: "gateway",
    player_id: event && event.player_id ? event.player_id : null,
    session_id: event && event.session_id ? event.session_id : null,
    combat_id: event && event.combat_id ? event.combat_id : null
  });
}

function createReadCommandRuntime(options) {
  const cfg = options || {};
  const eventBus = cfg.eventBus || createEventBus();
  const router = cfg.router || new EventRouter();
  const maxEvents = Number.isFinite(cfg.max_events) ? cfg.max_events : 50;
  const characterRepository = cfg.characterRepository || new CharacterRepository();
  const characterPersistence = cfg.characterPersistence || new CharacterPersistenceBridge();
  const accountPersistence = cfg.accountPersistence || new AccountPersistenceBridge();
  const accountService =
    cfg.accountService ||
    new AccountService({
      accountPersistence,
      characterPersistence,
      characterRepository
    });
  const partyPersistence = cfg.partyPersistence || new PartyPersistenceBridge();
  const partyService = cfg.partyService || new PartyService({ partyPersistence });
  const inventoryPersistence = cfg.inventoryPersistence || new InventoryPersistenceBridge();
  const sessionPersistence = cfg.sessionPersistence || new SessionPersistenceBridge();
  const sessionManager = cfg.sessionManager || new DungeonSessionManagerCore();
  const combatManager = cfg.combatManager || new CombatManager();
  const combatPersistence = cfg.combatPersistence || new CombatPersistenceBridge();
  const guildManager = cfg.guildManager || defaultGuildManager;
  const worldEventManager = cfg.worldEventManager || defaultWorldEventManager;
  const npcShopManager = cfg.npcShopManager || new NpcShopManager({ store: new InMemoryNpcShopStore() });
  const transactionManager = cfg.transactionManager || new TransactionManager({ store: new InMemoryTransactionStore() });
  const playerTradePersistence = cfg.playerTradePersistence || new PlayerTradePersistenceBridge();
  const playerTradeManager = cfg.playerTradeManager || new PlayerTradeManager({
    store: new InMemoryPlayerTradeStore(),
    persistence: playerTradePersistence
  });
  const processedNpcShopPurchaseStore = cfg.processedNpcShopPurchaseStore || new ProcessedNpcShopPurchaseStore();
  const processedNpcShopSellStore = cfg.processedNpcShopSellStore || new ProcessedNpcShopSellStore();
  const processedCraftFinalizationStore = cfg.processedCraftFinalizationStore || new ProcessedCraftFinalizationStore();
  const loadContentBundle = cfg.loadContentBundle || loadStarterContentBundle;
  const adminTuningStore = cfg.adminTuningStore || { reward_multiplier: 1 };
  const adminMutationReplayStore = cfg.adminMutationReplayStore || {
    seen: new Set(),
    has(replayKey) {
      return this.seen.has(String(replayKey || ""));
    },
    add(replayKey) {
      this.seen.add(String(replayKey || ""));
    }
  };
  const mutationReplayStore = cfg.mutationReplayStore || createMutationReplayStore();
  const adminAccessControl =
    cfg.adminAccessControl ||
    createAdminAccessControl({
      admin_player_ids: String(process.env.ADMIN_PLAYER_IDS || "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value !== "")
    });

  const orchestrator = createOrchestrator({
    eventBus,
    max_events: maxEvents
  });

  function handleIncomingReadCommand(event) {
    const validation = validateIncomingGatewayEvent(event);
    if (!validation.ok) {
      return [createValidationFailureResponse(event, validation)];
    }

    const queuedEvents = [];
    const routeContext = {
      characterRepository,
      characterPersistence,
      accountPersistence,
      accountService,
      partyPersistence,
      partyService,
      inventoryPersistence,
      sessionPersistence,
      sessionManager,
      combatManager,
      combatPersistence,
      guildManager,
      worldEventManager,
      npcShopManager,
      transactionManager,
      playerTradePersistence,
      playerTradeManager,
      processedNpcShopPurchaseStore,
      processedNpcShopSellStore,
      processedCraftFinalizationStore,
      loadContentBundle,
      adminTuningStore,
      adminMutationReplayStore,
      mutationReplayStore,
      adminAccessControl,
      logger: cfg.logger || null,
      attackRollFn: typeof cfg.attackRollFn === "function" ? cfg.attackRollFn : null,
      grappleContestRollFn: typeof cfg.grappleContestRollFn === "function" ? cfg.grappleContestRollFn : null,
      queue: {
        enqueue(nextEvent) {
          queuedEvents.push(nextEvent);
        }
      }
    };

    let routeResult = null;
    try {
      routeResult = router.route(event, routeContext);
    } catch (error) {
      return [
        createRoutingFailureResponse(event, {
          error: error && error.message ? error.message : "router execution failed",
          payload: {
            reason: "router_exception",
            target_system: event && event.target_system ? event.target_system : null
          }
        })
      ];
    }

    if (!routeResult || routeResult.ok !== true) {
      return [createRoutingFailureResponse(event, routeResult && routeResult.routing_error)];
    }

    if (!Array.isArray(queuedEvents) || queuedEvents.length === 0) {
      return [createUnhandledFailureResponse(event)];
    }

    return queuedEvents;
  }

  for (const eventType of SUPPORTED_READ_COMMAND_EVENTS) {
    eventBus.subscribe(eventType, handleIncomingReadCommand);
  }

  eventBus.subscribe(EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED, function processWorldDispatch(event) {
    return handleWorldCommandDispatch(event, routeContextForDispatch());
  });
  eventBus.subscribe(EVENT_TYPES.RUNTIME_SESSION_COMMAND_REQUESTED, function processSessionDispatch(event) {
    return handleSessionCommandDispatch(event, routeContextForDispatch());
  });
  eventBus.subscribe(EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED, function processCombatDispatch(event) {
    return handleCombatCommandDispatch(event, routeContextForDispatch());
  });

  function routeContextForDispatch() {
    return {
      characterRepository,
      characterPersistence,
      accountPersistence,
      accountService,
      partyPersistence,
      partyService,
      inventoryPersistence,
      sessionPersistence,
      sessionManager,
      combatManager,
      combatPersistence,
      guildManager,
      worldEventManager,
      npcShopManager,
      transactionManager,
      playerTradePersistence,
      playerTradeManager,
      processedNpcShopPurchaseStore,
      processedNpcShopSellStore,
      processedCraftFinalizationStore,
      loadContentBundle,
      adminTuningStore,
      adminMutationReplayStore,
      mutationReplayStore,
      adminAccessControl,
      logger: cfg.logger || null,
      attackRollFn: typeof cfg.attackRollFn === "function" ? cfg.attackRollFn : null,
      grappleContestRollFn: typeof cfg.grappleContestRollFn === "function" ? cfg.grappleContestRollFn : null
    };
  }

  async function processGatewayReadCommandEvent(event) {
    const out = await orchestrator.run(event);
    const processed = Array.isArray(out.events_processed) ? out.events_processed : [];
    const responses = processed.filter(function onlyGatewayResponses(processedEvent) {
      return processedEvent && processedEvent.event_type === EVENT_TYPES.GATEWAY_RESPONSE_READY;
    });

    return {
      ok: out.ok,
      event_type: "read_command_runtime_completed",
      payload: {
        responses: clone(responses),
        events_processed: clone(processed),
        final_state: clone(out.final_state || {})
      },
      error: out.ok ? null : "read command runtime processing failed"
    };
  }

  return {
    processGatewayReadCommandEvent,
    eventBus,
    orchestrator
  };
}

module.exports = {
  createReadCommandRuntime
};
