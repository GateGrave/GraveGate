"use strict";

const assert = require("assert");
const { createEvent, EVENT_TYPES } = require("../../../../packages/shared-types");
const { EventRouter } = require("..");
const { CharacterRepository } = require("../../../world-system/src/character/character.repository");
const { CharacterPersistenceBridge } = require("../../../world-system/src/character/character.persistence");
const { createCharacterRecord } = require("../../../world-system/src/character/character.schema");
const { InventoryPersistenceBridge } = require("../../../inventory-system/src/inventory.persistence");
const { createInventoryRecord } = require("../../../inventory-system/src/inventory.schema");
const { SessionPersistenceBridge } = require("../../../dungeon-exploration/src/session.persistence");
const { DungeonSessionManagerCore } = require("../../../dungeon-exploration/src/core/dungeonSessionManager");
const { CombatManager } = require("../../../combat-system/src/core/combatManager");
const { CombatPersistenceBridge } = require("../../../combat-system/src/combat.persistence");
const { startCombat } = require("../../../combat-system/src/flow/startCombat");
const { createRoomObject } = require("../../../dungeon-exploration/src/rooms/roomModel");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createRouteContext() {
  const characterRepository = new CharacterRepository();
  const characterPersistence = new CharacterPersistenceBridge();
  const inventoryPersistence = new InventoryPersistenceBridge();
  const sessionPersistence = new SessionPersistenceBridge();
  const sessionManager = new DungeonSessionManagerCore();
  const combatManager = new CombatManager();
  const combatPersistence = new CombatPersistenceBridge();
  const queued = [];

  return {
    characterRepository,
    characterPersistence,
    inventoryPersistence,
    sessionPersistence,
    sessionManager,
    combatManager,
    combatPersistence,
    queued,
    context: {
      characterRepository,
      characterPersistence,
      inventoryPersistence,
      sessionPersistence,
      sessionManager,
      combatManager,
      combatPersistence,
      queue: {
        enqueue(event) {
          queued.push(event);
        }
      },
      logger: null
    }
  };
}

function runEventRouterReadRoutingTests() {
  const results = [];

  runTest("help_event_routes_to_controller_and_emits_gateway_response", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const event = createEvent(EVENT_TYPES.GATEWAY_HELP_REQUESTED, { command_name: "help" }, {
      source: "gateway.discord",
      target_system: "controller",
      player_id: "player-1"
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "controller");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.GATEWAY_RESPONSE_READY);
    assert.equal(setup.queued[0].payload.response_type, "help");
  }, results);

  runTest("ping_event_routes_to_controller_and_emits_ping_response", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const event = createEvent(EVENT_TYPES.GATEWAY_PING_REQUESTED, { command_name: "ping" }, {
      source: "gateway.discord",
      target_system: "controller",
      player_id: "player-ping-1"
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "controller");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.GATEWAY_RESPONSE_READY);
    assert.equal(setup.queued[0].payload.response_type, "ping");
    assert.equal(setup.queued[0].payload.ok, true);
  }, results);

  runTest("profile_event_routes_to_world_and_emits_profile_response", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    setup.characterRepository.saveCharacter({
      character_id: "char-100",
      player_id: "player-100",
      name: "Read Hero",
      class: "fighter",
      level: 3
    });

    const event = createEvent(EVENT_TYPES.PLAYER_PROFILE_REQUESTED, { command_name: "profile" }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: "player-100"
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "world");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].payload.response_type, "profile");
    assert.equal(setup.queued[0].payload.data.profile_found, true);
  }, results);

  runTest("inventory_event_routes_to_world_and_emits_inventory_response", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    setup.inventoryPersistence.saveInventory(
      createInventoryRecord({
        inventory_id: "inv-200",
        owner_id: "player-200",
        stackable_items: [{ item_id: "potion", quantity: 2 }]
      })
    );

    const event = createEvent(EVENT_TYPES.PLAYER_INVENTORY_REQUESTED, { command_name: "inventory" }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: "player-200"
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "world");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].payload.response_type, "inventory");
    assert.equal(setup.queued[0].payload.data.inventory_found, true);
  }, results);

  runTest("start_event_routes_to_world_and_emits_world_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const event = createEvent(EVENT_TYPES.PLAYER_START_REQUESTED, {
      command_name: "start",
      requested_character_name: "Router Hero"
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: "player-router-start-001"
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "world");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_START_REQUESTED);
  }, results);

  runTest("admin_event_routes_to_world_and_emits_world_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const event = createEvent(EVENT_TYPES.PLAYER_ADMIN_REQUESTED, {
      action: "inspect_account_character"
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: "player-router-admin-001"
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "world");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_ADMIN_REQUESTED);
  }, results);

  runTest("equip_event_routes_to_world_and_emits_world_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const playerId = "player-router-equip-001";
    const inventoryId = "inv-router-equip-001";
    const characterId = "char-router-equip-001";

    setup.characterPersistence.saveCharacter(
      createCharacterRecord({
        character_id: characterId,
        player_id: playerId,
        name: "Router Equip Hero",
        class: "fighter",
        race: "human",
        inventory_id: inventoryId,
        equipment: {}
      })
    );
    setup.inventoryPersistence.saveInventory(
      createInventoryRecord({
        inventory_id: inventoryId,
        owner_type: "player",
        owner_id: playerId,
        equipment_items: [
          {
            item_id: "item-router-sword-001",
            quantity: 1,
            owner_player_id: playerId,
            metadata: {}
          }
        ]
      })
    );

    const event = createEvent(EVENT_TYPES.PLAYER_EQUIP_REQUESTED, {
      item_id: "item-router-sword-001",
      slot: "main_hand"
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: playerId
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "world");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_EQUIP_REQUESTED);
  }, results);

  runTest("unequip_event_routes_to_world_and_emits_world_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const playerId = "player-router-unequip-001";
    const inventoryId = "inv-router-unequip-001";
    const characterId = "char-router-unequip-001";

    setup.characterPersistence.saveCharacter(
      createCharacterRecord({
        character_id: characterId,
        player_id: playerId,
        name: "Router Unequip Hero",
        class: "fighter",
        race: "human",
        inventory_id: inventoryId,
        equipment: {
          main_hand: "item-router-sword-002"
        }
      })
    );
    setup.inventoryPersistence.saveInventory(
      createInventoryRecord({
        inventory_id: inventoryId,
        owner_type: "player",
        owner_id: playerId,
        equipment_items: [
          {
            item_id: "item-router-sword-002",
            quantity: 1,
            owner_player_id: playerId,
            metadata: {
              equipped: true,
              equipped_slot: "main_hand"
            }
          }
        ]
      })
    );

    const event = createEvent(EVENT_TYPES.PLAYER_UNEQUIP_REQUESTED, {
      slot: "main_hand",
      item_id: "item-router-sword-002"
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: playerId
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "world");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_UNEQUIP_REQUESTED);
  }, results);

  runTest("identify_attune_and_unattune_events_route_to_world_dispatch", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const playerId = "player-router-magical-001";
    const identifyEvent = createEvent(EVENT_TYPES.PLAYER_IDENTIFY_ITEM_REQUESTED, {
      item_id: "item_mysterious_ring"
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: playerId
    });
    const attuneEvent = createEvent(EVENT_TYPES.PLAYER_ATTUNE_ITEM_REQUESTED, {
      item_id: "item_ring_of_protection"
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: playerId
    });
    const unattuneEvent = createEvent(EVENT_TYPES.PLAYER_UNATTUNE_ITEM_REQUESTED, {
      item_id: "item_ring_of_protection"
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: playerId
    });

    const identifyOut = router.route(identifyEvent, setup.context);
    const attuneOut = router.route(attuneEvent, setup.context);
    const unattuneOut = router.route(unattuneEvent, setup.context);

    assert.equal(identifyOut.system, "world");
    assert.equal(attuneOut.system, "world");
    assert.equal(unattuneOut.system, "world");
    assert.equal(setup.queued.length, 3);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED);
    assert.equal(setup.queued[1].event_type, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED);
    assert.equal(setup.queued[2].event_type, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED);
  }, results);

  runTest("feat_event_routes_to_world_and_emits_world_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const event = createEvent(EVENT_TYPES.PLAYER_FEAT_REQUESTED, {
      action: "list"
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: "player-router-feat-001"
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "world");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_FEAT_REQUESTED);
  }, results);

  runTest("dungeon_enter_event_routes_to_session_and_emits_session_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const playerId = "player-router-session-enter-001";

    const event = createEvent(EVENT_TYPES.PLAYER_ENTER_DUNGEON, {
      dungeon_id: "dungeon-router-001",
      party_id: "party-router-001"
    }, {
      source: "gateway.discord",
      target_system: "session_system",
      player_id: playerId
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "session");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_SESSION_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_ENTER_DUNGEON);
  }, results);

  runTest("leave_event_routes_to_session_and_emits_session_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const playerId = "player-router-session-leave-001";

    // Create a session first through the same routed event path.
    const enterEvent = createEvent(EVENT_TYPES.PLAYER_ENTER_DUNGEON, {
      dungeon_id: "dungeon-router-002",
      party_id: "party-router-002"
    }, {
      source: "gateway.discord",
      target_system: "session_system",
      player_id: playerId
    });
    router.route(enterEvent, setup.context);
    setup.queued.length = 0;

    const leaveEvent = createEvent(EVENT_TYPES.PLAYER_LEAVE_SESSION, {
      session_id: "session-" + playerId + "-dungeon-router-002"
    }, {
      source: "gateway.discord",
      target_system: "session_system",
      player_id: playerId
    });

    const out = router.route(leaveEvent, setup.context);
    assert.equal(out.system, "session");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_SESSION_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_LEAVE_SESSION);
  }, results);

  runTest("move_event_routes_to_session_and_emits_session_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const sessionId = "session-router-move-001";
    const playerId = "player-router-move-001";

    setup.sessionManager.createSession({
      session_id: sessionId,
      dungeon_id: "dungeon-router-move-001",
      status: "active"
    });
    setup.sessionManager.setParty({
      session_id: sessionId,
      party: {
        party_id: "party-router-move-001",
        leader_id: playerId,
        members: [playerId]
      }
    });
    setup.sessionManager.addMultipleRoomsToSession({
      session_id: sessionId,
      rooms: [
        createRoomObject({
          room_id: "room-router-move-A",
          room_type: "empty",
          exits: [{ direction: "east", to_room_id: "room-router-move-B" }]
        }),
        createRoomObject({
          room_id: "room-router-move-B",
          room_type: "empty",
          exits: [{ direction: "west", to_room_id: "room-router-move-A" }]
        })
      ]
    });
    setup.sessionManager.setStartRoom({
      session_id: sessionId,
      room_id: "room-router-move-A"
    });

    const event = createEvent(EVENT_TYPES.PLAYER_MOVE, {
      direction: "east",
      session_id: sessionId
    }, {
      source: "gateway.discord",
      target_system: "session_system",
      player_id: playerId,
      session_id: sessionId
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "session");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_SESSION_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_MOVE);
  }, results);

  runTest("use_item_event_routes_to_world_dispatch_without_controller_mutation", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const event = createEvent(EVENT_TYPES.PLAYER_USE_ITEM, {
      item_id: "potion-healing-001"
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: "player-router-use-001"
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "world");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_WORLD_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_USE_ITEM);
  }, results);

  runTest("attack_event_routes_to_combat_and_emits_combat_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const combatId = "combat-router-attack-001";

    setup.combatManager.createCombat({
      combat_id: combatId,
      status: "pending"
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "player-router-attack-001",
        name: "Router Hero",
        team: "heroes",
        armor_class: 12,
        current_hp: 20,
        max_hp: 20,
        attack_bonus: 5,
        damage: 4,
        position: { x: 0, y: 0 }
      }
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "enemy-router-attack-001",
        name: "Router Goblin",
        team: "monsters",
        armor_class: 10,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 3,
        position: { x: 1, y: 0 }
      }
    });
    startCombat({
      combatManager: setup.combatManager,
      combat_id: combatId,
      roll_function: (participant) => (participant.participant_id === "player-router-attack-001" ? 20 : 1)
    });

    const event = createEvent(EVENT_TYPES.PLAYER_ATTACK, {
      target_id: "enemy-router-attack-001"
    }, {
      source: "gateway.discord",
      target_system: "combat_system",
      player_id: "player-router-attack-001",
      combat_id: combatId
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "combat");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_ATTACK);
  }, results);

  runTest("assist_event_routes_to_combat_and_emits_combat_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const combatId = "combat-router-assist-001";

    setup.combatManager.createCombat({
      combat_id: combatId,
      status: "pending"
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "player-router-assist-001",
        name: "Router Hero",
        team: "heroes",
        armor_class: 12,
        current_hp: 20,
        max_hp: 20,
        attack_bonus: 5,
        damage: 4,
        position: { x: 0, y: 0 }
      }
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "ally-router-assist-001",
        name: "Router Ally",
        team: "heroes",
        armor_class: 11,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 3,
        damage: 3,
        position: { x: 1, y: 0 }
      }
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "enemy-router-assist-001",
        name: "Router Goblin",
        team: "monsters",
        armor_class: 10,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 3,
        position: { x: 2, y: 0 }
      }
    });
    startCombat({
      combatManager: setup.combatManager,
      combat_id: combatId,
      roll_function: (participant) => (participant.participant_id === "player-router-assist-001" ? 20 : 1)
    });

    const event = createEvent(EVENT_TYPES.PLAYER_HELP_ACTION, { target_id: "ally-router-assist-001" }, {
      source: "gateway.discord",
      target_system: "combat_system",
      player_id: "player-router-assist-001",
      combat_id: combatId
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "combat");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_HELP_ACTION);
  }, results);

  runTest("ready_event_routes_to_combat_and_emits_combat_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const combatId = "combat-router-ready-001";

    setup.combatManager.createCombat({
      combat_id: combatId,
      status: "pending"
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "player-router-ready-001",
        name: "Router Hero",
        team: "heroes",
        armor_class: 12,
        current_hp: 20,
        max_hp: 20,
        attack_bonus: 5,
        damage: 4,
        position: { x: 0, y: 0 }
      }
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "enemy-router-ready-001",
        name: "Router Goblin",
        team: "monsters",
        armor_class: 10,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 3,
        position: { x: 1, y: 0 }
      }
    });
    startCombat({
      combatManager: setup.combatManager,
      combat_id: combatId,
      roll_function: (participant) => (participant.participant_id === "player-router-ready-001" ? 20 : 1)
    });

    const event = createEvent(EVENT_TYPES.PLAYER_READY_ACTION, {}, {
      source: "gateway.discord",
      target_system: "combat_system",
      player_id: "player-router-ready-001",
      combat_id: combatId
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "combat");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_READY_ACTION);
  }, results);

  runTest("dodge_event_routes_to_combat_and_emits_combat_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const combatId = "combat-router-dodge-001";

    setup.combatManager.createCombat({
      combat_id: combatId,
      status: "pending"
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "player-router-dodge-001",
        name: "Router Hero",
        team: "heroes",
        armor_class: 12,
        current_hp: 20,
        max_hp: 20,
        attack_bonus: 5,
        damage: 4,
        position: { x: 0, y: 0 }
      }
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "enemy-router-dodge-001",
        name: "Router Goblin",
        team: "monsters",
        armor_class: 10,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 3,
        position: { x: 1, y: 0 }
      }
    });
    startCombat({
      combatManager: setup.combatManager,
      combat_id: combatId,
      roll_function: (participant) => (participant.participant_id === "player-router-dodge-001" ? 20 : 1)
    });

    const event = createEvent(EVENT_TYPES.PLAYER_DODGE, {}, {
      source: "gateway.discord",
      target_system: "combat_system",
      player_id: "player-router-dodge-001",
      combat_id: combatId
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "combat");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_DODGE);
  }, results);

  runTest("dash_event_routes_to_combat_and_emits_combat_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const combatId = "combat-router-dash-001";

    setup.combatManager.createCombat({
      combat_id: combatId,
      status: "pending"
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "player-router-dash-001",
        name: "Router Hero",
        team: "heroes",
        armor_class: 12,
        current_hp: 20,
        max_hp: 20,
        attack_bonus: 5,
        damage: 4,
        position: { x: 0, y: 0 }
      }
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "enemy-router-dash-001",
        name: "Router Goblin",
        team: "monsters",
        armor_class: 10,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 3,
        position: { x: 1, y: 0 }
      }
    });
    startCombat({
      combatManager: setup.combatManager,
      combat_id: combatId,
      roll_function: (participant) => (participant.participant_id === "player-router-dash-001" ? 20 : 1)
    });

    const event = createEvent(EVENT_TYPES.PLAYER_DASH, {}, {
      source: "gateway.discord",
      target_system: "combat_system",
      player_id: "player-router-dash-001",
      combat_id: combatId
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "combat");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_DASH);
  }, results);

  runTest("grapple_event_routes_to_combat_and_emits_combat_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const combatId = "combat-router-grapple-001";

    setup.combatManager.createCombat({
      combat_id: combatId,
      status: "pending"
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "player-router-grapple-001",
        name: "Router Hero",
        team: "heroes",
        armor_class: 12,
        current_hp: 20,
        max_hp: 20,
        attack_bonus: 5,
        damage: 4,
        position: { x: 0, y: 0 }
      }
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "enemy-router-grapple-001",
        name: "Router Goblin",
        team: "monsters",
        armor_class: 10,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 3,
        position: { x: 1, y: 0 }
      }
    });
    startCombat({
      combatManager: setup.combatManager,
      combat_id: combatId,
      roll_function: (participant) => (participant.participant_id === "player-router-grapple-001" ? 20 : 1)
    });

    const event = createEvent(EVENT_TYPES.PLAYER_GRAPPLE, {
      target_id: "enemy-router-grapple-001"
    }, {
      source: "gateway.discord",
      target_system: "combat_system",
      player_id: "player-router-grapple-001",
      combat_id: combatId
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "combat");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_GRAPPLE);
  }, results);

  runTest("escape_grapple_event_routes_to_combat_and_emits_combat_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const combatId = "combat-router-escape-001";

    setup.combatManager.createCombat({
      combat_id: combatId,
      status: "pending"
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "player-router-escape-001",
        name: "Router Hero",
        team: "heroes",
        armor_class: 12,
        current_hp: 20,
        max_hp: 20,
        attack_bonus: 5,
        damage: 4,
        position: { x: 0, y: 0 }
      }
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "enemy-router-escape-001",
        name: "Router Goblin",
        team: "monsters",
        armor_class: 10,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 3,
        position: { x: 1, y: 0 }
      }
    });
    startCombat({
      combatManager: setup.combatManager,
      combat_id: combatId,
      roll_function: (participant) => (participant.participant_id === "player-router-escape-001" ? 20 : 1)
    });

    const event = createEvent(EVENT_TYPES.PLAYER_ESCAPE_GRAPPLE, {}, {
      source: "gateway.discord",
      target_system: "combat_system",
      player_id: "player-router-escape-001",
      combat_id: combatId
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "combat");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_ESCAPE_GRAPPLE);
  }, results);

  runTest("shove_event_routes_to_combat_and_emits_combat_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const combatId = "combat-router-shove-001";

    setup.combatManager.createCombat({
      combat_id: combatId,
      status: "pending"
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "player-router-shove-001",
        name: "Router Hero",
        team: "heroes",
        armor_class: 12,
        current_hp: 20,
        max_hp: 20,
        attack_bonus: 5,
        damage: 4,
        position: { x: 0, y: 0 }
      }
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "enemy-router-shove-001",
        name: "Router Goblin",
        team: "monsters",
        armor_class: 10,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 3,
        position: { x: 1, y: 0 }
      }
    });
    startCombat({
      combatManager: setup.combatManager,
      combat_id: combatId,
      roll_function: (participant) => (participant.participant_id === "player-router-shove-001" ? 20 : 1)
    });

    const event = createEvent(EVENT_TYPES.PLAYER_SHOVE, {
      target_id: "enemy-router-shove-001",
      shove_mode: "push"
    }, {
      source: "gateway.discord",
      target_system: "combat_system",
      player_id: "player-router-shove-001",
      combat_id: combatId
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "combat");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_SHOVE);
  }, results);

  runTest("disengage_event_routes_to_combat_and_emits_combat_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const combatId = "combat-router-disengage-001";

    setup.combatManager.createCombat({
      combat_id: combatId,
      status: "pending"
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "player-router-disengage-001",
        name: "Router Hero",
        team: "heroes",
        armor_class: 12,
        current_hp: 20,
        max_hp: 20,
        attack_bonus: 5,
        damage: 4,
        position: { x: 0, y: 0 }
      }
    });
    setup.combatManager.addParticipant({
      combat_id: combatId,
      participant: {
        participant_id: "enemy-router-disengage-001",
        name: "Router Goblin",
        team: "monsters",
        armor_class: 10,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 3,
        position: { x: 1, y: 0 }
      }
    });
    startCombat({
      combatManager: setup.combatManager,
      combat_id: combatId,
      roll_function: (participant) => (participant.participant_id === "player-router-disengage-001" ? 20 : 1)
    });

    const event = createEvent(EVENT_TYPES.PLAYER_DISENGAGE, {}, {
      source: "gateway.discord",
      target_system: "combat_system",
      player_id: "player-router-disengage-001",
      combat_id: combatId
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "combat");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_DISENGAGE);
  }, results);

  runTest("combat_read_event_routes_to_combat_and_emits_combat_dispatch_event", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const event = createEvent(EVENT_TYPES.PLAYER_COMBAT_REQUESTED, {
      command_name: "combat",
      combat_id: "combat-router-read-001"
    }, {
      source: "gateway.discord",
      target_system: "combat_system",
      player_id: "player-router-combat-read-001"
    });

    const out = router.route(event, setup.context);
    assert.equal(out.system, "combat");
    assert.equal(setup.queued.length, 1);
    assert.equal(setup.queued[0].event_type, EVENT_TYPES.RUNTIME_COMBAT_COMMAND_REQUESTED);
    assert.equal(setup.queued[0].payload.request_event.event_type, EVENT_TYPES.PLAYER_COMBAT_REQUESTED);
  }, results);

  runTest("unknown_event_type_with_default_target_returns_structured_target_failure", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const event = createEvent("unknown_router_event_type", {
      sample: true
    }, {
      source: "gateway.discord",
      player_id: "player-router-unknown-001"
    });

    const out = router.route(event, setup.context);
    assert.equal(out.ok, false);
    assert.equal(out.system, null);
    assert.equal(out.generated_events, 0);
    assert.equal(Boolean(out.routing_error), true);
    assert.equal(out.routing_error.event_type, "event_routing_failed");
    assert.equal(out.routing_error.payload.reason, "unsupported_target_system");
    assert.equal(setup.queued.length, 0);
  }, results);

  runTest("unknown_target_system_returns_structured_routing_failure", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const event = createEvent(EVENT_TYPES.PLAYER_PROFILE_REQUESTED, {
      command_name: "profile"
    }, {
      source: "gateway.discord",
      target_system: "unknown_system",
      player_id: "player-router-unknown-target-001"
    });

    const out = router.route(event, setup.context);
    assert.equal(out.ok, false);
    assert.equal(out.system, null);
    assert.equal(Boolean(out.routing_error), true);
    assert.equal(out.routing_error.payload.reason, "unsupported_target_system");
    assert.equal(setup.queued.length, 0);
  }, results);

  runTest("structurally_valid_but_unhandled_event_returns_structured_failure", () => {
    const router = new EventRouter();
    const setup = createRouteContext();
    const event = createEvent(EVENT_TYPES.COMBAT_STARTED, {
      combat_id: "combat-unhandled-001"
    }, {
      source: "gateway.discord",
      target_system: "combat_system",
      player_id: "player-router-unhandled-001",
      combat_id: "combat-unhandled-001"
    });

    const out = router.route(event, setup.context);
    assert.equal(out.ok, false);
    assert.equal(out.system, "combat");
    assert.equal(Boolean(out.routing_error), true);
    assert.equal(out.routing_error.payload.reason, "unhandled_event");
    assert.equal(setup.queued.length, 0);
  }, results);

  const passed = results.filter((x) => x.ok).length;
  const failed = results.length - passed;

  return {
    ok: failed === 0,
    totals: { total: results.length, passed, failed },
    results
  };
}

if (require.main === module) {
  const summary = runEventRouterReadRoutingTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

module.exports = {
  runEventRouterReadRoutingTests
};
