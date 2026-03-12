"use strict";

const { createEventBus } = require("./eventBus");
const { createOrchestrator } = require("./orchestrator");
const { CharacterService } = require("../../world-system/src/character/character.service");
const { CharacterRepository } = require("../../world-system/src/character/character.repository");
const { toDungeonPartyMember } = require("../../world-system/src/character/adapters/toDungeonPartyMember");
const { DungeonSessionManagerCore } = require("../../dungeon-exploration/src/core/dungeonSessionManager");
const { createRoomObject } = require("../../dungeon-exploration/src/rooms/roomModel");
const { moveParty } = require("../../dungeon-exploration/src/flow/moveParty");
const { resolveRoomEntry } = require("../../dungeon-exploration/src/flow/resolveRoomEntry");
const { prepareRewardHook } = require("../../dungeon-exploration/src/flow/prepareRewardHook");
const { createLootTableObject } = require("../../world-system/src/loot/tables/lootTableModel");
const { consumeRewardHook } = require("../../world-system/src/loot/flow/consumeRewardHook");
const { rollLoot } = require("../../world-system/src/loot/flow/rollLoot");
const { grantLootToInventory } = require("../../world-system/src/loot/flow/grantLootToInventory");
const { createInventoryRecord } = require("../../inventory-system/src/inventory.schema");

class InMemoryCanonicalInventoryService {
  constructor() {
    this.byId = new Map();
  }

  getInventory(inventory_id) {
    const inventory = this.byId.get(String(inventory_id)) || null;
    if (!inventory) {
      return { ok: false, payload: { inventory: null }, error: "inventory not found" };
    }
    return {
      ok: true,
      payload: { inventory: JSON.parse(JSON.stringify(inventory)) },
      error: null
    };
  }

  saveInventory(inventory) {
    if (!inventory || !inventory.inventory_id) {
      return { ok: false, error: "inventory.inventory_id is required" };
    }
    this.byId.set(String(inventory.inventory_id), JSON.parse(JSON.stringify(inventory)));
    return { ok: true, payload: { inventory }, error: null };
  }
}

function createDefaultLootTable() {
  return createLootTableObject({
    loot_table_id: "runtime-loot-table-001",
    name: "Runtime Loop Table",
    guaranteed_entries: [
      {
        item_id: "item-runtime-gold-coin",
        item_name: "Runtime Gold Coin",
        rarity: "common",
        quantity: 5
      }
    ],
    weighted_entries: [
      {
        item_id: "item-runtime-potion",
        item_name: "Runtime Potion",
        rarity: "common",
        weight: 100,
        quantity: 1
      }
    ]
  });
}

function defaultRandomFn() {
  return 0;
}

function createGameLoopHarness(input) {
  const data = input || {};

  const eventBus = createEventBus();
  const orchestrator = createOrchestrator({
    eventBus,
    max_events: Number.isFinite(data.max_events) ? data.max_events : 100
  });
  const characterService = data.characterService || new CharacterService();
  const characterRepository = data.characterRepository || new CharacterRepository();
  const dungeonManager = data.dungeonManager || new DungeonSessionManagerCore();
  const inventoryService = data.inventoryService || new InMemoryCanonicalInventoryService();

  const context = {
    characterService,
    characterRepository,
    dungeonManager,
    inventoryService,
    session_id: data.session_id || "runtime-session-001",
    character_id: data.character_id || "runtime-character-001",
    player_id: data.player_id || "runtime-player-001",
    inventory_id: data.inventory_id || "runtime-inventory-001",
    loot_table_id: data.loot_table_id || "runtime-loot-table-001",
    random_fn: typeof data.random_fn === "function" ? data.random_fn : defaultRandomFn,
    character_summary: null,
    inventory_summary: null,
    event_log: []
  };

  const lootTable = data.loot_table || createDefaultLootTable();

  eventBus.subscribe("game_loop_start", function onGameLoopStart() {
    context.event_log.push({ stage: "start", event_type: "game_loop_start" });

    let character = null;
    const loaded = context.characterRepository.loadCharacterById(context.character_id);
    if (loaded.ok) {
      character = loaded.payload.character;
    } else {
      const created = context.characterService.createCharacter({
        character_id: context.character_id,
        player_id: context.player_id,
        name: data.character_name || "Runtime Hero",
        race: data.character_race || "human",
        class: data.character_class || "fighter",
        level: Number.isFinite(data.character_level) ? data.character_level : 1,
        inventory_id: context.inventory_id
      });
      if (!created.ok) return [];
      context.characterRepository.saveCharacter(created.payload.character);
      character = created.payload.character;
    }

    if (!context.inventoryService.getInventory(context.inventory_id).ok) {
      context.inventoryService.saveInventory(
        createInventoryRecord({
          inventory_id: context.inventory_id,
          owner_type: "player",
          owner_id: context.player_id
        })
      );
    }

    context.character_summary = {
      character_id: character.character_id,
      player_id: character.player_id,
      name: character.name,
      level: character.level
    };

    return {
      event_type: "dungeon_session_start_requested",
      payload: {},
      metadata: {}
    };
  });

  eventBus.subscribe("dungeon_session_start_requested", function onDungeonStart() {
    context.event_log.push({ stage: "dungeon", event_type: "dungeon_session_start_requested" });

    const loaded = context.characterRepository.loadCharacterById(context.character_id);
    if (!loaded.ok) return [];

    const memberOut = toDungeonPartyMember({ character: loaded.payload.character });
    if (!memberOut.ok) return [];

    const createdSession = context.dungeonManager.createSession({
      session_id: context.session_id,
      dungeon_id: "runtime-dungeon-001",
      status: "active"
    });
    if (!createdSession.ok) return [];

    context.dungeonManager.setParty({
      session_id: context.session_id,
      party: {
        party_id: "runtime-party-001",
        leader_id: memberOut.payload.party_member.player_id,
        members: [memberOut.payload.party_member.player_id]
      }
    });

    context.dungeonManager.addMultipleRoomsToSession({
      session_id: context.session_id,
      rooms: [
        createRoomObject({
          room_id: "room-runtime-1",
          name: "Start",
          room_type: "empty",
          exits: [{ direction: "east", to_room_id: "room-runtime-2" }]
        }),
        createRoomObject({
          room_id: "room-runtime-2",
          name: "Encounter",
          room_type: "encounter",
          encounter: { encounter_id: "enc-runtime-001" },
          exits: [{ direction: "west", to_room_id: "room-runtime-1" }]
        })
      ]
    });

    context.dungeonManager.setStartRoom({
      session_id: context.session_id,
      room_id: "room-runtime-1"
    });

    moveParty({
      manager: context.dungeonManager,
      session_id: context.session_id,
      target_room_id: "room-runtime-2"
    });

    const entry = resolveRoomEntry({
      manager: context.dungeonManager,
      session_id: context.session_id
    });
    if (!entry.ok || entry.payload.outcome !== "encounter") return [];

    return {
      event_type: "encounter_triggered",
      payload: { encounter_id: "enc-runtime-001" },
      metadata: {}
    };
  });

  eventBus.subscribe("encounter_triggered", function onEncounterTriggered() {
    context.event_log.push({ stage: "encounter", event_type: "encounter_triggered" });
    return {
      event_type: "enemy_defeated",
      payload: { encounter_id: "enc-runtime-001" },
      metadata: {}
    };
  });

  eventBus.subscribe("enemy_defeated", function onEnemyDefeated() {
    context.event_log.push({ stage: "reward_prepare", event_type: "enemy_defeated" });
    const prepared = prepareRewardHook({
      manager: context.dungeonManager,
      session_id: context.session_id,
      reward_context: "encounter_clear"
    });
    if (!prepared.ok) return [];

    const rewardHook = {
      ...prepared.payload.reward_event.payload,
      target_player_id: context.player_id,
      loot_table_id: context.loot_table_id
    };

    return {
      event_type: "reward_event_emitted",
      payload: { reward_hook: rewardHook },
      metadata: {}
    };
  });

  eventBus.subscribe("reward_event_emitted", function onRewardEvent(event) {
    context.event_log.push({ stage: "reward_emit", event_type: "reward_event_emitted" });
    const consumed = consumeRewardHook({
      reward_hook: event.payload.reward_hook,
      loot_table: lootTable
    });
    if (!consumed.ok) return [];

    return {
      event_type: "loot_resolve_requested",
      payload: { roll_input: consumed.payload.next_step.roll_input },
      metadata: {}
    };
  });

  eventBus.subscribe("loot_resolve_requested", function onLootResolve(event) {
    context.event_log.push({ stage: "loot_roll", event_type: "loot_resolve_requested" });
    const rolled = rollLoot({
      ...event.payload.roll_input,
      random_fn: context.random_fn
    });
    if (!rolled.ok) return [];

    return {
      event_type: "loot_grant_requested",
      payload: { loot_bundle: rolled.payload.loot_bundle },
      metadata: {}
    };
  });

  eventBus.subscribe("loot_grant_requested", function onLootGrant(event) {
    context.event_log.push({ stage: "loot_grant", event_type: "loot_grant_requested" });
    const granted = grantLootToInventory({
      inventory_service: context.inventoryService,
      inventory_id: context.inventory_id,
      owner_id: context.player_id,
      loot_bundle: event.payload.loot_bundle
    });
    if (!granted.ok) return [];

    const inventory = context.inventoryService.getInventory(context.inventory_id);
    if (inventory.ok) {
      const inv = inventory.payload.inventory;
      context.inventory_summary = {
        inventory_id: inv.inventory_id,
        stackable_count: Array.isArray(inv.stackable_items) ? inv.stackable_items.length : 0,
        equipment_count: Array.isArray(inv.equipment_items) ? inv.equipment_items.length : 0,
        quest_count: Array.isArray(inv.quest_items) ? inv.quest_items.length : 0
      };
    }

    return [];
  });

  async function run(runInput) {
    const startEvent = runInput && runInput.initial_event
      ? runInput.initial_event
      : { event_type: "game_loop_start", payload: {}, metadata: {} };

    const orchestrationResult = await orchestrator.run(startEvent);
    return {
      ok: orchestrationResult.ok,
      events_processed: orchestrationResult.events_processed,
      character_summary: context.character_summary,
      inventory_summary: context.inventory_summary,
      event_log: context.event_log,
      final_state: orchestrationResult.final_state
    };
  }

  return {
    run
  };
}

function runGameLoopHarness(input) {
  return createGameLoopHarness(input).run();
}

module.exports = {
  InMemoryCanonicalInventoryService,
  createGameLoopHarness,
  runGameLoopHarness
};
