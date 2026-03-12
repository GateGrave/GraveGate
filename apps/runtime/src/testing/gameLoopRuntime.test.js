"use strict";

const assert = require("assert");
const { createEventBus } = require("../eventBus");
const { createOrchestrator } = require("../orchestrator");
const { CharacterService } = require("../../../world-system/src/character/character.service");
const { CharacterRepository } = require("../../../world-system/src/character/character.repository");
const { toDungeonPartyMember } = require("../../../world-system/src/character/adapters/toDungeonPartyMember");
const { DungeonSessionManagerCore } = require("../../../dungeon-exploration/src/core/dungeonSessionManager");
const { createRoomObject } = require("../../../dungeon-exploration/src/rooms/roomModel");
const { moveParty } = require("../../../dungeon-exploration/src/flow/moveParty");
const { resolveRoomEntry } = require("../../../dungeon-exploration/src/flow/resolveRoomEntry");
const { prepareRewardHook } = require("../../../dungeon-exploration/src/flow/prepareRewardHook");
const { createLootTableObject } = require("../../../world-system/src/loot/tables/lootTableModel");
const { consumeRewardHook } = require("../../../world-system/src/loot/flow/consumeRewardHook");
const { rollLoot } = require("../../../world-system/src/loot/flow/rollLoot");
const { grantLootToInventory } = require("../../../world-system/src/loot/flow/grantLootToInventory");
const { createInventoryRecord } = require("../../../inventory-system/src/inventory.schema");

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
    return {
      ok: true,
      payload: { inventory },
      error: null
    };
  }
}

function runTest(name, fn, results) {
  return Promise.resolve()
    .then(fn)
    .then(function onPass() {
      results.push({ name, ok: true });
    })
    .catch(function onFail(error) {
      results.push({ name, ok: false, reason: error.message });
    });
}

function setupGameLoopRuntime() {
  const eventBus = createEventBus();
  const orchestrator = createOrchestrator({ eventBus, max_events: 100 });
  const characterService = new CharacterService();
  const characterRepository = new CharacterRepository();
  const dungeonManager = new DungeonSessionManagerCore();
  const inventoryService = new InMemoryCanonicalInventoryService();

  const context = {
    characterService,
    characterRepository,
    dungeonManager,
    inventoryService,
    session_id: "runtime-session-001",
    character_id: "runtime-character-001",
    player_id: "runtime-player-001",
    inventory_id: "runtime-inventory-001",
    character_summary: null,
    inventory_summary: null
  };

  const lootTable = createLootTableObject({
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

  eventBus.subscribe("game_loop_start", function onGameLoopStart() {
    let character = null;
    const loaded = context.characterRepository.loadCharacterById(context.character_id);
    if (loaded.ok) {
      character = loaded.payload.character;
    } else {
      const created = context.characterService.createCharacter({
        character_id: context.character_id,
        player_id: context.player_id,
        name: "Runtime Hero",
        race: "human",
        class: "fighter",
        level: 1,
        inventory_id: context.inventory_id
      });
      if (!created.ok) {
        return [];
      }
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

    if (!entry.ok || entry.payload.outcome !== "encounter") {
      return [];
    }

    return {
      event_type: "encounter_triggered",
      payload: { encounter_id: "enc-runtime-001" },
      metadata: {}
    };
  });

  eventBus.subscribe("encounter_triggered", function onEncounterTriggered() {
    return {
      event_type: "enemy_defeated",
      payload: {
        encounter_id: "enc-runtime-001"
      },
      metadata: {}
    };
  });

  eventBus.subscribe("enemy_defeated", function onEnemyDefeated() {
    const prepared = prepareRewardHook({
      manager: context.dungeonManager,
      session_id: context.session_id,
      reward_context: "encounter_clear"
    });
    if (!prepared.ok) {
      return [];
    }

    const rewardHook = {
      ...prepared.payload.reward_event.payload,
      target_player_id: context.player_id,
      loot_table_id: "runtime-loot-table-001"
    };

    return {
      event_type: "reward_event_emitted",
      payload: { reward_hook: rewardHook },
      metadata: {}
    };
  });

  eventBus.subscribe("reward_event_emitted", function onRewardEventEmitted(event) {
    const consumed = consumeRewardHook({
      reward_hook: event.payload.reward_hook,
      loot_table: lootTable
    });
    if (!consumed.ok) {
      return [];
    }

    return {
      event_type: "loot_resolve_requested",
      payload: {
        roll_input: consumed.payload.next_step.roll_input
      },
      metadata: {}
    };
  });

  eventBus.subscribe("loot_resolve_requested", function onLootResolve(event) {
    const rolled = rollLoot({
      ...event.payload.roll_input,
      random_fn: function deterministicRandom() {
        return 0;
      }
    });
    if (!rolled.ok) {
      return [];
    }

    return {
      event_type: "loot_grant_requested",
      payload: {
        loot_bundle: rolled.payload.loot_bundle
      },
      metadata: {}
    };
  });

  eventBus.subscribe("loot_grant_requested", function onLootGrant(event) {
    const granted = grantLootToInventory({
      inventory_service: context.inventoryService,
      inventory_id: context.inventory_id,
      owner_id: context.player_id,
      loot_bundle: event.payload.loot_bundle
    });
    if (!granted.ok) {
      return [];
    }

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

  async function run() {
    const orchestrationResult = await orchestrator.run({
      event_type: "game_loop_start",
      payload: {},
      metadata: {}
    });

    return {
      ok: orchestrationResult.ok,
      events_processed: orchestrationResult.events_processed,
      character_summary: context.character_summary,
      inventory_summary: context.inventory_summary,
      final_state: orchestrationResult.final_state
    };
  }

  return { run };
}

async function runGameLoopRuntimeTests() {
  const results = [];

  await runTest("runtime_game_loop_chain_completes_with_character_and_inventory", async () => {
    const harness = setupGameLoopRuntime();
    const out = await harness.run();

    assert.equal(out.ok, true);
    assert.equal(Array.isArray(out.events_processed), true);
    assert.equal(out.events_processed.length > 0, true);

    const processedTypes = out.events_processed.map((x) => x.event_type);
    assert.equal(processedTypes.includes("game_loop_start"), true);
    assert.equal(processedTypes.includes("dungeon_session_start_requested"), true);
    assert.equal(processedTypes.includes("encounter_triggered"), true);
    assert.equal(processedTypes.includes("enemy_defeated"), true);
    assert.equal(processedTypes.includes("reward_event_emitted"), true);
    assert.equal(processedTypes.includes("loot_resolve_requested"), true);
    assert.equal(processedTypes.includes("loot_grant_requested"), true);

    assert.equal(typeof out.character_summary, "object");
    assert.equal(out.character_summary.character_id, "runtime-character-001");
    assert.equal(out.character_summary.player_id, "runtime-player-001");
    assert.equal(typeof out.character_summary.name, "string");

    assert.equal(typeof out.inventory_summary, "object");
    assert.equal(out.inventory_summary.inventory_id, "runtime-inventory-001");
    assert.equal(out.inventory_summary.stackable_count >= 1, true);
  }, results);

  const passed = results.filter((x) => x.ok).length;
  const failed = results.length - passed;

  return {
    ok: failed === 0,
    totals: {
      total: results.length,
      passed,
      failed
    },
    results
  };
}

if (require.main === module) {
  runGameLoopRuntimeTests()
    .then(function done(summary) {
      console.log(JSON.stringify(summary, null, 2));
      if (!summary.ok) {
        process.exitCode = 1;
      }
    })
    .catch(function failed(error) {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  runGameLoopRuntimeTests
};
