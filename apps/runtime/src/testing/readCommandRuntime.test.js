"use strict";

const assert = require("assert");
const { createEvent, EVENT_TYPES } = require("../../../../packages/shared-types");
const { mapSlashCommandToGatewayEvent } = require("../../../gateway/src/discord/commandEventMapper");
const { CharacterRepository } = require("../../../world-system/src/character/character.repository");
const { CharacterPersistenceBridge } = require("../../../world-system/src/character/character.persistence");
const { AccountPersistenceBridge } = require("../../../world-system/src/account/account.persistence");
const { InventoryPersistenceBridge } = require("../../../inventory-system/src/inventory.persistence");
const { createInventoryRecord } = require("../../../inventory-system/src/inventory.schema");
const { createCharacterRecord } = require("../../../world-system/src/character/character.schema");
const { SessionPersistenceBridge } = require("../../../dungeon-exploration/src/session.persistence");
const { DungeonSessionManagerCore } = require("../../../dungeon-exploration/src/core/dungeonSessionManager");
const { createRoomObject } = require("../../../dungeon-exploration/src/rooms/roomModel");
const { CombatManager } = require("../../../combat-system/src/core/combatManager");
const { startCombat } = require("../../../combat-system/src/flow/startCombat");
const { CombatPersistenceBridge } = require("../../../combat-system/src/combat.persistence");
const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { GuildManager, InMemoryGuildStore } = require("../../../world-system/src/guild");
const { WorldEventManager, InMemoryWorldEventStore } = require("../../../world-system/src/world-events");
const { PartyPersistenceBridge } = require("../../../world-system/src/party/party.persistence");
const { PlayerTradePersistenceBridge } = require("../../../world-system/src/economy");
const { upsertRankingScore } = require("../../../world-system/src/ranking");
const { createReadCommandRuntime } = require("../readCommandRuntime");

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

function createInteraction(commandName, optionsData, playerId) {
  return {
    commandName,
    user: { id: playerId || "player-read-001" },
    guildId: "guild-read-001",
    channelId: "channel-read-001",
    options: {
      data: Array.isArray(optionsData) ? optionsData : []
    }
  };
}

function mapInteractionOrThrow(interaction) {
  const mapped = mapSlashCommandToGatewayEvent(interaction);
  if (!mapped.ok) {
    throw new Error(mapped.error || "failed to map interaction");
  }
  return mapped.payload.event;
}

function findResponse(result, responseType) {
  const responses = result.payload.responses || [];
  return responses.find(function findByType(event) {
    return event && event.payload && event.payload.response_type === responseType;
  });
}

function createActiveCombat(combatManager, combatId, playerId, enemyId, playerPosition, enemyPosition) {
  combatManager.createCombat({
    combat_id: combatId,
    status: "pending"
  });
  combatManager.addParticipant({
    combat_id: combatId,
    participant: {
      participant_id: playerId,
      name: "Runtime Player",
      team: "heroes",
      armor_class: 12,
      current_hp: 20,
      max_hp: 20,
      attack_bonus: 5,
      damage: 4,
      position: playerPosition || { x: 0, y: 0 }
    }
  });
  combatManager.addParticipant({
    combat_id: combatId,
    participant: {
      participant_id: enemyId,
      name: "Runtime Enemy",
      team: "monsters",
      armor_class: 10,
      current_hp: 12,
      max_hp: 12,
      attack_bonus: 2,
      damage: 3,
      position: enemyPosition || { x: 1, y: 0 }
    }
  });
  startCombat({
    combatManager,
    combat_id: combatId,
    roll_function: (participant) => (participant.participant_id === playerId ? 20 : 1)
  });
}

function createAdminAccessControl(allowedPlayerIds) {
  const allowed = new Set((allowedPlayerIds || []).map((id) => String(id)));
  return {
    isAdminPlayerId(playerId) {
      return allowed.has(String(playerId || ""));
    }
  };
}

async function runReadCommandRuntimeTests() {
  const results = [];

  await runTest("end_to_end_help_command_through_canonical_path", async () => {
    const runtime = createReadCommandRuntime();
    const event = mapInteractionOrThrow(createInteraction("help"));
    const out = await runtime.processGatewayReadCommandEvent(event);

    assert.equal(out.ok, true);
    const response = findResponse(out, "help");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
  }, results);

  await runTest("end_to_end_profile_command_through_canonical_path", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const playerId = "player-read-profile-001";
    const profileCharacter = createCharacterRecord({
      character_id: "char-read-001",
      player_id: playerId,
      name: "Profile Hero",
      race: "human",
      class: "fighter",
      background: "soldier",
      class_id: "fighter",
      race_id: "human",
      level: 5,
      xp: 650,
      armor_class: 17,
      speed: 35,
      initiative: 2,
      proficiency_bonus: 3,
      spellcasting_ability: "wisdom",
      spellsave_dc: 13,
      saving_throws: {
        strength: 5,
        dexterity: 1,
        constitution: 4,
        intelligence: 0,
        wisdom: 2,
        charisma: 1
      },
      hp_summary: {
        current: 38,
        max: 42,
        temporary: 5
      },
      inventory_id: "inv-read-profile-001",
      base_stats: {
        strength: 15,
        dexterity: 12,
        constitution: 14,
        intelligence: 10,
        wisdom: 8,
        charisma: 13
      },
      stats: {
        strength: 15,
        dexterity: 12,
        constitution: 14,
        intelligence: 10,
        wisdom: 8,
        charisma: 13
      },
      gestalt_progression: {
        track_b_class_key: "wizard",
        track_b_option_id: "evocation"
      },
      attunement: {
        attunement_slots: 3,
        slots_used: 1,
        attuned_items: ["item_ring_of_protection"]
      },
      item_effects: {
        armor_class_bonus: 1,
        saving_throw_bonus: 1,
        spell_save_dc_bonus: 1,
        active_item_names: ["Ring of Protection"]
      },
      effective_armor_class: 18,
      effective_speed: 35,
      feat_slots: {
        total_slots: 1,
        used_slots: 1,
        remaining_slots: 0
      }
    });
    profileCharacter.spellbook = {
      known_spell_ids: ["fire_bolt", "light"]
    };
    profileCharacter.feats = ["alert", "war_caster"];
    characterPersistence.saveCharacter(profileCharacter);

    const runtime = createReadCommandRuntime({
      characterPersistence,
      loadContentBundle() {
        return {
          ok: true,
          payload: {
            content: {
              feats: [
                { feat_id: "alert", name: "Alert", description: "Init edge.", prerequisites: {}, effects: [], metadata: {} },
                { feat_id: "war_caster", name: "War Caster", description: "Concentration edge.", prerequisites: {}, effects: [], metadata: {} }
              ]
            }
          }
        };
      }
    });
    const event = mapInteractionOrThrow(createInteraction("profile", [], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);

    assert.equal(out.ok, true);
    const response = findResponse(out, "profile");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.data.profile_found, true);
    assert.equal(response.payload.data.character.name, "Profile Hero");
    assert.equal(response.payload.data.character.attunement.slots_used, 1);
    assert.equal(response.payload.data.character.spellbook.known_spell_ids.length, 2);
    assert.equal(response.payload.data.character.feats.length, 2);
    assert.equal(response.payload.data.character.feats[0].name, "Alert");
    assert.equal(response.payload.data.character.feat_slots.total_slots, 1);
    assert.equal(response.payload.data.character.armor_class, 18);
    assert.equal(response.payload.data.character.hp_summary.current, 38);
    assert.equal(response.payload.data.character.saving_throws.strength, 6);
    assert.equal(response.payload.data.character.item_effects.active_item_names[0], "Ring of Protection");
    assert.equal(typeof response.payload.data.character, "object");
  }, results);

  await runTest("end_to_end_feat_command_through_canonical_path", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const playerId = "player-read-feat-001";
    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-read-feat-001",
      player_id: playerId,
      name: "Feat Hero",
      level: 4,
      initiative: 2,
      hitpoint_max: 20,
      current_hitpoints: 20,
      hp_summary: {
        current: 20,
        max: 20,
        temporary: 0
      }
    }));

    const runtime = createReadCommandRuntime({
      characterPersistence,
      loadContentBundle() {
        return {
          ok: true,
          payload: {
            content: {
              feats: [
                {
                  feat_id: "alert",
                  name: "Alert",
                  description: "Init edge.",
                  prerequisites: {},
                  effects: [{ type: "initiative_bonus", value: 5 }],
                  metadata: {}
                },
                {
                  feat_id: "resilient",
                  name: "Resilient",
                  description: "Save edge.",
                  prerequisites: {},
                  effects: [{ type: "resilient_ability_choice" }],
                  metadata: { requires_ability_choice: true }
                }
              ]
            }
          }
        };
      }
    });

    const listEvent = mapInteractionOrThrow(createInteraction("feat", [{ name: "action", value: "list" }], playerId));
    const listOut = await runtime.processGatewayReadCommandEvent(listEvent);
    const listResponse = findResponse(listOut, "feat");
    assert.equal(listOut.ok, true);
    assert.equal(Boolean(listResponse), true);
    assert.equal(listResponse.payload.data.action, "list");
    assert.equal(Array.isArray(listResponse.payload.data.feats), true);

    const takeEvent = mapInteractionOrThrow(
      createInteraction("feat", [{ name: "action", value: "take" }, { name: "feat_id", value: "alert" }], playerId)
    );
    const takeOut = await runtime.processGatewayReadCommandEvent(takeEvent);
    const takeResponse = findResponse(takeOut, "feat");
    assert.equal(takeOut.ok, true);
    assert.equal(Boolean(takeResponse), true);
    assert.equal(takeResponse.payload.data.action, "take");
    assert.equal(takeResponse.payload.data.feat.name, "Alert");
    assert.equal(takeResponse.payload.data.character.initiative, 7);
  }, results);

  await runTest("end_to_end_resilient_feat_take_updates_saving_throw_state", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const playerId = "player-read-feat-resilient-001";
    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-read-feat-resilient-001",
      player_id: playerId,
      name: "Resilient Hero",
      level: 4,
      proficiency_bonus: 2,
      stats: {
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10
      }
    }));

    const runtime = createReadCommandRuntime({
      characterPersistence,
      loadContentBundle() {
        return {
          ok: true,
          payload: {
            content: {
              feats: [
                {
                  feat_id: "resilient",
                  name: "Resilient",
                  description: "Save edge.",
                  prerequisites: {},
                  effects: [{ type: "resilient_ability_choice" }],
                  metadata: { requires_ability_choice: true }
                }
              ]
            }
          }
        };
      }
    });

    const takeEvent = mapInteractionOrThrow(
      createInteraction("feat", [
        { name: "action", value: "take" },
        { name: "feat_id", value: "resilient" },
        { name: "ability_id", value: "wisdom" }
      ], playerId)
    );
    const takeOut = await runtime.processGatewayReadCommandEvent(takeEvent);
    const takeResponse = findResponse(takeOut, "feat");
    assert.equal(takeOut.ok, true);
    assert.equal(Boolean(takeResponse), true);
    assert.equal(takeResponse.payload.data.character.saving_throws.wisdom, 2);
    assert.equal(takeResponse.payload.data.character.stats.wisdom, 11);
  }, results);

  await runTest("end_to_end_inventory_command_through_canonical_path", async () => {
    const inventoryPersistence = new InventoryPersistenceBridge();
    const playerId = "player-read-inventory-001";

    inventoryPersistence.saveInventory(
      createInventoryRecord({
        inventory_id: "inv-read-001",
        owner_id: playerId,
        stackable_items: [{ item_id: "potion", item_name: "Potion", quantity: 2 }],
        equipment_items: [{
          item_id: "item_ring_of_protection",
          item_name: "Ring of Protection",
          item_type: "equipment",
          equip_slot: "ring",
          metadata: {
            magical: true,
            requires_attunement: true,
            equipped: true,
            equipped_slot: "ring",
            armor_class_bonus: 1
          }
        }]
      })
    );
    const characterPersistence = new CharacterPersistenceBridge({ adapter: createInMemoryAdapter() });
    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-read-inventory-001",
      player_id: playerId,
      name: "Inventory Hero",
      inventory_id: "inv-read-001",
      attunement: {
        attunement_slots: 3,
        slots_used: 1,
        attuned_items: ["item_ring_of_protection"]
      }
    }));

    const runtime = createReadCommandRuntime({ inventoryPersistence, characterPersistence });
    const event = mapInteractionOrThrow(createInteraction("inventory", [], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);

    assert.equal(out.ok, true);
    const response = findResponse(out, "inventory");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.data.inventory_found, true);
    assert.equal(response.payload.data.inventory.inventory_id, "inv-read-001");
    assert.equal(response.payload.data.inventory.magical_count, 1);
    assert.equal(response.payload.data.inventory.attuned_count, 1);
    assert.equal(response.payload.data.inventory.equipment_preview[0].item_name, "Ring of Protection");
    assert.equal(response.payload.data.inventory.equipment_preview[0].equipped, true);
    assert.equal(response.payload.data.inventory.equipment_preview[0].equipped_slot, "ring");
    assert.equal(response.payload.data.inventory.equipment_preview[0].equip_slot, "ring");
    assert.equal(response.payload.data.inventory.magical_preview[0].effect_summary.includes("AC +1"), true);
    assert.equal(Array.isArray(response.payload.data.inventory.tradeable_items), true);
    assert.equal(response.payload.data.inventory.tradeable_items[0].item_id, "potion");
  }, results);

  await runTest("end_to_end_shop_browse_and_buy_flow_through_canonical_path", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const playerId = "player-read-shop-001";

    inventoryPersistence.saveInventory(createInventoryRecord({
      inventory_id: "inv-read-shop-001",
      owner_id: playerId,
      currency: { gold: 100, silver: 0, copper: 0 }
    }));
    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-read-shop-001",
      player_id: playerId,
      name: "Shop Hero",
      inventory_id: "inv-read-shop-001"
    }));

    const runtime = createReadCommandRuntime({ characterPersistence, inventoryPersistence });

    const browseEvent = mapInteractionOrThrow(createInteraction("shop", [
      { name: "action", value: "browse" }
    ], playerId));
    const browseOut = await runtime.processGatewayReadCommandEvent(browseEvent);
    const browseResponse = findResponse(browseOut, "shop");
    assert.equal(browseOut.ok, true);
    assert.equal(Boolean(browseResponse), true);
    assert.equal(browseResponse.payload.data.vendor_id, "vendor_starter_quartermaster");
    assert.equal(Array.isArray(browseResponse.payload.data.stock), true);
    assert.equal(browseResponse.payload.data.stock.length >= 1, true);
    assert.equal(typeof browseResponse.payload.data.vendor_description, "string");

    const buyEvent = mapInteractionOrThrow(createInteraction("shop", [
      { name: "action", value: "buy" },
      { name: "item_id", value: "item_healing_potion" },
      { name: "quantity", value: 1 }
    ], playerId));
    const buyOut = await runtime.processGatewayReadCommandEvent(buyEvent);
    const buyResponse = findResponse(buyOut, "shop");
    assert.equal(buyOut.ok, true);
    assert.equal(Boolean(buyResponse), true);
    assert.equal(buyResponse.payload.data.item_id, "item_healing_potion");

    const inventory = inventoryPersistence.loadInventoryById("inv-read-shop-001").payload.inventory;
    const potion = inventory.stackable_items.find((entry) => entry.item_id === "item_healing_potion");
    assert.ok(potion);
    assert.equal(potion.quantity, 1);
    assert.equal(inventory.currency.gold, 50);
  }, results);

  await runTest("end_to_end_shop_browse_supports_alternate_content_vendor", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const playerId = "player-read-shop-armorer-001";

    inventoryPersistence.saveInventory(createInventoryRecord({
      inventory_id: "inv-read-shop-armorer-001",
      owner_id: playerId,
      currency: { gold: 100, silver: 0, copper: 0 }
    }));
    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-read-shop-armorer-001",
      player_id: playerId,
      name: "Armorer Browser",
      inventory_id: "inv-read-shop-armorer-001"
    }));

    const runtime = createReadCommandRuntime({ characterPersistence, inventoryPersistence });
    const browseEvent = mapInteractionOrThrow(createInteraction("shop", [
      { name: "action", value: "browse" },
      { name: "vendor_id", value: "vendor_starter_armorer" }
    ], playerId));
    const browseOut = await runtime.processGatewayReadCommandEvent(browseEvent);
    const browseResponse = findResponse(browseOut, "shop");
    assert.equal(browseOut.ok, true);
    assert.equal(Boolean(browseResponse), true);
    assert.equal(browseResponse.payload.data.vendor_id, "vendor_starter_armorer");
    assert.equal(browseResponse.payload.data.vendor_name, "Armorer Vexa");
    assert.equal(browseResponse.payload.data.stock.some((entry) => entry.item_id === "item_shield"), true);
  }, results);

  await runTest("end_to_end_shop_sell_flow_through_canonical_path", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const playerId = "player-read-shop-sell-001";

    inventoryPersistence.saveInventory(createInventoryRecord({
      inventory_id: "inv-read-shop-sell-001",
      owner_id: playerId,
      currency: { gold: 10, silver: 0, copper: 0 },
      stackable_items: [
        { item_id: "item_bandage_roll", quantity: 2, owner_player_id: playerId, stackable: true }
      ]
    }));
    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-read-shop-sell-001",
      player_id: playerId,
      name: "Sell Hero",
      inventory_id: "inv-read-shop-sell-001"
    }));

    const runtime = createReadCommandRuntime({ characterPersistence, inventoryPersistence });
    const sellEvent = mapInteractionOrThrow(createInteraction("shop", [
      { name: "action", value: "sell" },
      { name: "item_id", value: "item_bandage_roll" },
      { name: "quantity", value: 1 }
    ], playerId));
    const sellOut = await runtime.processGatewayReadCommandEvent(sellEvent);
    const sellResponse = findResponse(sellOut, "shop");
    assert.equal(sellOut.ok, true);
    assert.equal(Boolean(sellResponse), true);
    assert.equal(sellResponse.payload.ok, true);

    const inventory = inventoryPersistence.loadInventoryById("inv-read-shop-sell-001").payload.inventory;
    assert.equal(inventory.currency.gold, 14);
    assert.equal(inventory.stackable_items[0].quantity, 1);
  }, results);

  await runTest("end_to_end_craft_browse_and_make_flow_through_canonical_path", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const playerId = "player-read-craft-001";

    inventoryPersistence.saveInventory(createInventoryRecord({
      inventory_id: "inv-read-craft-001",
      owner_id: playerId,
      currency: { gold: 0, silver: 0, copper: 0 },
      stackable_items: [
        { item_id: "item_rat_tail", quantity: 3, owner_player_id: playerId, stackable: true }
      ]
    }));
    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-read-craft-001",
      player_id: playerId,
      name: "Craft Hero",
      inventory_id: "inv-read-craft-001"
    }));

    const runtime = createReadCommandRuntime({ characterPersistence, inventoryPersistence });
    const browseEvent = mapInteractionOrThrow(createInteraction("craft", [
      { name: "action", value: "browse" }
    ], playerId));
    const browseOut = await runtime.processGatewayReadCommandEvent(browseEvent);
    const browseResponse = findResponse(browseOut, "craft");
    assert.equal(browseOut.ok, true);
    assert.equal(Boolean(browseResponse), true);
    assert.equal(Array.isArray(browseResponse.payload.data.recipes), true);
    assert.equal(browseResponse.payload.data.recipes.some((entry) => entry.recipe_id === "recipe_torch_pack"), true);
    assert.equal(browseResponse.payload.data.recipes.some((entry) => entry.recipe_id === "recipe_field_wraps"), true);
    assert.equal(browseResponse.payload.data.recipes.length >= 5, true);

    const makeEvent = mapInteractionOrThrow(createInteraction("craft", [
      { name: "action", value: "make" },
      { name: "recipe_id", value: "recipe_torch_pack" }
    ], playerId));
    const makeOut = await runtime.processGatewayReadCommandEvent(makeEvent);
    const makeResponse = findResponse(makeOut, "craft");
    assert.equal(makeOut.ok, true);
    assert.equal(Boolean(makeResponse), true);

    const inventory = inventoryPersistence.loadInventoryById("inv-read-craft-001").payload.inventory;
    const output = inventory.stackable_items.find((entry) => entry.item_id === "item_torch_bundle");
    const material = inventory.stackable_items.find((entry) => entry.item_id === "item_rat_tail");
    assert.ok(output);
    assert.equal(output.quantity, 1);
    assert.equal(material.quantity, 2);
  }, results);

  await runTest("end_to_end_trade_propose_list_and_accept_flow_through_canonical_path", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const playerTradePersistence = new PlayerTradePersistenceBridge({ adapter });
    const sellerId = "player-read-trade-seller-001";
    const buyerId = "player-read-trade-buyer-001";

    inventoryPersistence.saveInventory(createInventoryRecord({
      inventory_id: "inv-read-trade-seller-001",
      owner_id: sellerId,
      currency: { gold: 10, silver: 0, copper: 0 },
      stackable_items: [
        { item_id: "item_bandage_roll", item_name: "Bandage Roll", quantity: 2, owner_player_id: sellerId, stackable: true }
      ]
    }));
    inventoryPersistence.saveInventory(createInventoryRecord({
      inventory_id: "inv-read-trade-buyer-001",
      owner_id: buyerId,
      currency: { gold: 25, silver: 0, copper: 0 },
      stackable_items: []
    }));
    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-read-trade-seller-001",
      player_id: sellerId,
      name: "Trade Seller",
      inventory_id: "inv-read-trade-seller-001"
    }));
    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-read-trade-buyer-001",
      player_id: buyerId,
      name: "Trade Buyer",
      inventory_id: "inv-read-trade-buyer-001"
    }));

    const runtime = createReadCommandRuntime({
      characterPersistence,
      inventoryPersistence,
      playerTradePersistence
    });

    const proposeEvent = mapInteractionOrThrow(createInteraction("trade", [
      { name: "action", value: "propose" },
      { name: "counterparty_player_id", value: buyerId },
      { name: "offered_item_id", value: "item_bandage_roll" },
      { name: "offered_quantity", value: 1 },
      { name: "requested_currency", value: 5 }
    ], sellerId));
    const proposeOut = await runtime.processGatewayReadCommandEvent(proposeEvent);
    const proposeResponse = findResponse(proposeOut, "trade");
    assert.equal(proposeOut.ok, true);
    assert.equal(Boolean(proposeResponse), true);
    assert.equal(proposeResponse.payload.ok, true);
    assert.equal(proposeResponse.payload.data.trade.trade_state, "pending");
    const tradeId = proposeResponse.payload.data.trade.trade_id;
    assert.equal(typeof tradeId, "string");

    const listEvent = mapInteractionOrThrow(createInteraction("trade", [
      { name: "action", value: "list" }
    ], buyerId));
    const listOut = await runtime.processGatewayReadCommandEvent(listEvent);
    const listResponse = findResponse(listOut, "trade");
    assert.equal(listOut.ok, true);
    assert.equal(Boolean(listResponse), true);
    assert.equal(Array.isArray(listResponse.payload.data.trades), true);
    assert.equal(listResponse.payload.data.actionable_trades.length, 1);
    assert.equal(listResponse.payload.data.actionable_trades[0].trade_id, tradeId);
    assert.equal(listResponse.payload.data.actionable_trades[0].offered.item_name, "Bandage Roll");

    const acceptEvent = mapInteractionOrThrow(createInteraction("trade", [
      { name: "action", value: "accept" },
      { name: "trade_id", value: tradeId }
    ], buyerId));
    const acceptOut = await runtime.processGatewayReadCommandEvent(acceptEvent);
    const acceptResponse = findResponse(acceptOut, "trade");
    assert.equal(acceptOut.ok, true);
    assert.equal(Boolean(acceptResponse), true);
    assert.equal(acceptResponse.payload.ok, true);
    assert.equal(acceptResponse.payload.data.trade.trade_state, "completed");

    const sellerInventory = inventoryPersistence.loadInventoryById("inv-read-trade-seller-001").payload.inventory;
    const buyerInventory = inventoryPersistence.loadInventoryById("inv-read-trade-buyer-001").payload.inventory;
    assert.equal(sellerInventory.currency.gold, 15);
    assert.equal(buyerInventory.currency.gold, 20);
    assert.equal(sellerInventory.stackable_items[0].quantity, 1);
    const buyerBandage = buyerInventory.stackable_items.find((entry) => entry.item_id === "item_bandage_roll");
    assert.ok(buyerBandage);
    assert.equal(buyerBandage.quantity, 1);
  }, results);

  await runTest("structured_result_contract_is_returned_by_runtime", async () => {
    const runtime = createReadCommandRuntime();
    const event = mapInteractionOrThrow(createInteraction("help"));
    const out = await runtime.processGatewayReadCommandEvent(event);

    assert.equal(typeof out.ok, "boolean");
    assert.equal(out.event_type, "read_command_runtime_completed");
    assert.equal(Array.isArray(out.payload.responses), true);
    assert.equal(Array.isArray(out.payload.events_processed), true);
    assert.equal(typeof out.payload.final_state, "object");
  }, results);

  await runTest("end_to_end_start_command_through_canonical_path", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const accountPersistence = new AccountPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({ characterPersistence, accountPersistence, inventoryPersistence });

    const playerId = "player-start-runtime-001";
    const event = mapInteractionOrThrow(createInteraction("start", [
      { name: "name", value: "Start Hero" }
    ], playerId));

    const out = await runtime.processGatewayReadCommandEvent(event);
    assert.equal(out.ok, true);

    const response = findResponse(out, "start");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.bootstrap_status, "created");

    const listedCharacters = characterPersistence.listCharacters();
    assert.equal(listedCharacters.ok, true);
    const createdCharacter = listedCharacters.payload.characters.find((character) => {
      return String(character.player_id || "") === playerId;
    });
    assert.equal(Boolean(createdCharacter), true);
    assert.equal(typeof createdCharacter.account_id, "string");
    assert.equal(String(createdCharacter.account_id).trim() !== "", true);

    const loadedAccount = accountPersistence.loadAccountByDiscordUserId(playerId);
    assert.equal(loadedAccount.ok, true);
    assert.equal(loadedAccount.payload.account.active_character_id, createdCharacter.character_id);

    const listedInventories = inventoryPersistence.listInventories();
    assert.equal(listedInventories.ok, true);
    const createdInventory = listedInventories.payload.inventories.find((inventory) => {
      return String(inventory.owner_id || "") === playerId;
    });
    assert.equal(Boolean(createdInventory), true);
  }, results);

  await runTest("repeated_start_request_creates_characters_until_slot_cap", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const accountPersistence = new AccountPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({ characterPersistence, accountPersistence, inventoryPersistence });
    const playerId = "player-start-runtime-duplicate-001";

    const startOne = mapInteractionOrThrow(createInteraction("start", [
      { name: "name", value: "Dupe Hero One" }
    ], playerId));
    const startTwo = mapInteractionOrThrow(createInteraction("start", [
      { name: "name", value: "Dupe Hero Two" }
    ], playerId));
    const startThree = mapInteractionOrThrow(createInteraction("start", [
      { name: "name", value: "Dupe Hero Three" }
    ], playerId));
    const startFour = mapInteractionOrThrow(createInteraction("start", [
      { name: "name", value: "Dupe Hero Four" }
    ], playerId));

    const firstOut = await runtime.processGatewayReadCommandEvent(startOne);
    const secondOut = await runtime.processGatewayReadCommandEvent(startTwo);
    const thirdOut = await runtime.processGatewayReadCommandEvent(startThree);
    const fourthOut = await runtime.processGatewayReadCommandEvent(startFour);

    const firstResponse = findResponse(firstOut, "start");
    const secondResponse = findResponse(secondOut, "start");
    const thirdResponse = findResponse(thirdOut, "start");
    const fourthResponse = findResponse(fourthOut, "start");

    assert.equal(firstResponse.payload.ok, true);
    assert.equal(secondResponse.payload.ok, true);
    assert.equal(thirdResponse.payload.ok, true);
    assert.equal(fourthResponse.payload.ok, false);
    assert.equal(fourthResponse.payload.error, "character slot limit reached");

    const listedCharacters = characterPersistence.listCharacters();
    assert.equal(listedCharacters.ok, true);
    const matches = listedCharacters.payload.characters.filter((character) => {
      return String(character.player_id || "") === playerId;
    });
    assert.equal(matches.length, 3);

    const loadedAccount = accountPersistence.loadAccountByDiscordUserId(playerId);
    assert.equal(loadedAccount.ok, true);
    const firstCharacterId = firstResponse.payload.data.character.character_id;
    assert.equal(loadedAccount.payload.account.active_character_id, firstCharacterId);
  }, results);

  await runTest("start_creation_reloads_with_applied_race_and_gestalt_class_selection", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const accountPersistence = new AccountPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({ characterPersistence, accountPersistence, inventoryPersistence });
    const playerId = "player-start-runtime-selection-001";

    const event = createEvent(EVENT_TYPES.PLAYER_START_REQUESTED, {
      command_name: "start",
      requested_character_name: "Selection Hero",
      race_id: "dragonborn",
      race_option_id: "blue",
      class_id: "sorcerer",
      class_option_id: "draconic_bloodline",
      secondary_class_id: "fighter",
      secondary_class_option_id: null,
      stats: {
        strength: 15,
        dexterity: 10,
        constitution: 15,
        intelligence: 8,
        wisdom: 8,
        charisma: 14
      }
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: playerId
    });

    const out = await runtime.processGatewayReadCommandEvent(event);
    const response = findResponse(out, "start");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);

    const characterId = response.payload.data.character.character_id;
    const reloadedCharacter = characterPersistence.loadCharacterById(characterId);
    assert.equal(reloadedCharacter.ok, true);
    assert.equal(reloadedCharacter.payload.character.race_id, "dragonborn");
    assert.equal(reloadedCharacter.payload.character.race_option_id, "blue");
    assert.equal(reloadedCharacter.payload.character.class_id, "sorcerer");
    assert.equal(reloadedCharacter.payload.character.class_option_id, "draconic_bloodline");
    assert.equal(reloadedCharacter.payload.character.gestalt_progression.track_b_class_key, "fighter");
    assert.equal(reloadedCharacter.payload.character.gestalt_progression.track_a_option_id, "draconic_bloodline");
    assert.equal(reloadedCharacter.payload.character.metadata.start_configuration.mode, "gestalt");
    assert.deepEqual(reloadedCharacter.payload.character.base_stats, {
      strength: 15,
      dexterity: 10,
      constitution: 15,
      intelligence: 8,
      wisdom: 8,
      charisma: 14
    });
  }, results);

  await runTest("admin_inspect_returns_structured_output_for_valid_account_character", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const accountPersistence = new AccountPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const playerId = "player-admin-inspect-001";
    const runtime = createReadCommandRuntime({
      characterPersistence,
      accountPersistence,
      inventoryPersistence,
      adminAccessControl: createAdminAccessControl([playerId])
    });
    const accountOut = accountPersistence.findOrCreateAccountByDiscordUserId({ discord_user_id: playerId });
    assert.equal(accountOut.ok, true);
    const accountId = accountOut.payload.account.account_id;

    characterPersistence.saveCharacter(
      createCharacterRecord({
        character_id: "char-admin-inspect-001",
        account_id: accountId,
        player_id: playerId,
        name: "Admin Inspect Hero",
        class: "fighter",
        race: "human",
        level: 2,
        inventory_id: "inv-admin-inspect-001"
      })
    );
    accountPersistence.saveAccount({
      ...accountOut.payload.account,
      active_character_id: "char-admin-inspect-001"
    });
    inventoryPersistence.saveInventory(
      createInventoryRecord({
        inventory_id: "inv-admin-inspect-001",
        owner_type: "player",
        owner_id: playerId,
        stackable_items: [{ item_id: "item_potion", quantity: 2 }]
      })
    );

    const event = mapInteractionOrThrow(createInteraction("admin", [
      { name: "action", value: "inspect_account_character" }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    assert.equal(out.ok, true);
    const response = findResponse(out, "admin");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.admin_event_type, "admin_inspect_account_character_succeeded");
    assert.equal(response.payload.data.result.character.character_id, "char-admin-inspect-001");
  }, results);

  await runTest("admin_grant_item_succeeds_and_persists", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const accountPersistence = new AccountPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const playerId = "player-admin-grant-item-001";
    const runtime = createReadCommandRuntime({
      characterPersistence,
      accountPersistence,
      inventoryPersistence,
      adminAccessControl: createAdminAccessControl([playerId])
    });
    const accountOut = accountPersistence.findOrCreateAccountByDiscordUserId({ discord_user_id: playerId });
    const accountId = accountOut.payload.account.account_id;

    characterPersistence.saveCharacter(
      createCharacterRecord({
        character_id: "char-admin-grant-item-001",
        account_id: accountId,
        player_id: playerId,
        name: "Admin Item Hero",
        inventory_id: "inv-admin-grant-item-001"
      })
    );
    accountPersistence.saveAccount({
      ...accountOut.payload.account,
      active_character_id: "char-admin-grant-item-001"
    });
    inventoryPersistence.saveInventory(
      createInventoryRecord({
        inventory_id: "inv-admin-grant-item-001",
        owner_type: "player",
        owner_id: playerId
      })
    );

    const event = mapInteractionOrThrow(createInteraction("admin", [
      { name: "action", value: "grant_item" },
      { name: "item_id", value: "item_admin_token_001" },
      { name: "quantity", value: 3 }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    const response = findResponse(out, "admin");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.admin_event_type, "admin_grant_item_succeeded");

    const reloaded = inventoryPersistence.loadInventoryById("inv-admin-grant-item-001");
    assert.equal(reloaded.ok, true);
    const granted = reloaded.payload.inventory.stackable_items.find((entry) => entry.item_id === "item_admin_token_001");
    assert.equal(Boolean(granted), true);
    assert.equal(Number(granted.quantity), 3);
  }, results);

  await runTest("admin_grant_xp_succeeds_and_persists", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const accountPersistence = new AccountPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const playerId = "player-admin-grant-xp-001";
    const runtime = createReadCommandRuntime({
      characterPersistence,
      accountPersistence,
      inventoryPersistence,
      adminAccessControl: createAdminAccessControl([playerId])
    });
    const accountOut = accountPersistence.findOrCreateAccountByDiscordUserId({ discord_user_id: playerId });
    const accountId = accountOut.payload.account.account_id;

    characterPersistence.saveCharacter(
      createCharacterRecord({
        character_id: "char-admin-grant-xp-001",
        account_id: accountId,
        player_id: playerId,
        name: "Admin XP Hero",
        xp: 0,
        level: 1,
        inventory_id: "inv-admin-grant-xp-001"
      })
    );
    accountPersistence.saveAccount({
      ...accountOut.payload.account,
      active_character_id: "char-admin-grant-xp-001"
    });

    const event = mapInteractionOrThrow(createInteraction("admin", [
      { name: "action", value: "grant_xp" },
      { name: "xp_delta", value: 300 }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    const response = findResponse(out, "admin");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.admin_event_type, "admin_grant_xp_succeeded");

    const reloaded = characterPersistence.loadCharacterById("char-admin-grant-xp-001");
    assert.equal(reloaded.ok, true);
    assert.equal(Number(reloaded.payload.character.xp), 300);
    assert.equal(Number(reloaded.payload.character.level), 2);
  }, results);

  await runTest("admin_set_active_character_works_for_owned_character", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const accountPersistence = new AccountPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const playerId = "player-admin-active-char-001";
    const runtime = createReadCommandRuntime({
      characterPersistence,
      accountPersistence,
      inventoryPersistence,
      adminAccessControl: createAdminAccessControl([playerId])
    });
    const accountOut = accountPersistence.findOrCreateAccountByDiscordUserId({ discord_user_id: playerId });
    const accountId = accountOut.payload.account.account_id;

    characterPersistence.saveCharacter(
      createCharacterRecord({
        character_id: "char-admin-active-a",
        account_id: accountId,
        player_id: playerId,
        name: "Admin Active A",
        inventory_id: "inv-admin-active-char-001"
      })
    );
    characterPersistence.saveCharacter(
      createCharacterRecord({
        character_id: "char-admin-active-b",
        account_id: accountId,
        player_id: playerId,
        name: "Admin Active B",
        inventory_id: "inv-admin-active-char-001"
      })
    );

    const event = mapInteractionOrThrow(createInteraction("admin", [
      { name: "action", value: "set_active_character" },
      { name: "character_id", value: "char-admin-active-b" }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    const response = findResponse(out, "admin");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.result.active_character_id, "char-admin-active-b");
  }, results);

  await runTest("admin_reset_session_succeeds_cleanly", async () => {
    const adapter = createInMemoryAdapter();
    const sessionPersistence = new SessionPersistenceBridge({ adapter });
    const sessionManager = new DungeonSessionManagerCore();
    const accountPersistence = new AccountPersistenceBridge({ adapter });
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const playerId = "player-admin-reset-session-001";
    const runtime = createReadCommandRuntime({
      sessionPersistence,
      sessionManager,
      accountPersistence,
      characterPersistence,
      adminAccessControl: createAdminAccessControl([playerId])
    });
    const sessionId = "session-admin-reset-001";

    accountPersistence.findOrCreateAccountByDiscordUserId({ discord_user_id: playerId });

    sessionManager.createSession({
      session_id: sessionId,
      status: "active",
      dungeon_id: "dungeon-admin-reset-001"
    });
    sessionManager.setParty({
      session_id: sessionId,
      party: {
        party_id: "party-admin-reset-001",
        leader_id: playerId,
        members: [playerId]
      }
    });
    const saveOut = sessionPersistence.saveSession(sessionManager.getSessionById(sessionId).payload.session);
    assert.equal(saveOut.ok, true);

    const event = mapInteractionOrThrow(createInteraction("admin", [
      { name: "action", value: "reset_session" },
      { name: "session_id", value: sessionId }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    const response = findResponse(out, "admin");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.admin_event_type, "admin_reset_session_succeeded");

    const reloaded = sessionPersistence.loadSessionById(sessionId);
    assert.equal(reloaded.ok, false);
  }, results);

  await runTest("admin_spawn_monster_supports_combat_test_context", async () => {
    const adapter = createInMemoryAdapter();
    const accountPersistence = new AccountPersistenceBridge({ adapter });
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const combatManager = new CombatManager();
    const combatPersistence = new CombatPersistenceBridge({ adapter });
    const playerId = "player-admin-spawn-001";
    const runtime = createReadCommandRuntime({
      accountPersistence,
      characterPersistence,
      inventoryPersistence,
      combatManager,
      combatPersistence,
      adminAccessControl: createAdminAccessControl([playerId])
    });
    accountPersistence.findOrCreateAccountByDiscordUserId({ discord_user_id: playerId });

    combatManager.createCombat({
      combat_id: "combat-admin-spawn-001",
      status: "active"
    });

    const event = mapInteractionOrThrow(createInteraction("admin", [
      { name: "action", value: "spawn_monster" },
      { name: "combat_id", value: "combat-admin-spawn-001" },
      { name: "monster_id", value: "monster_goblin_scout" }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    const response = findResponse(out, "admin");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.admin_event_type, "admin_spawn_monster_succeeded");

    const participants = combatManager.listParticipants("combat-admin-spawn-001");
    assert.equal(participants.ok, true);
      assert.equal(participants.payload.participants.length, 1);
      assert.equal(String(participants.payload.participants[0].metadata.monster_id), "monster_goblin_scout");
    }, results);

    await runTest("admin_spawn_monster_rejects_ended_combat", async () => {
      const adapter = createInMemoryAdapter();
      const accountPersistence = new AccountPersistenceBridge({ adapter });
      const characterPersistence = new CharacterPersistenceBridge({ adapter });
      const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
      const combatManager = new CombatManager();
      const combatPersistence = new CombatPersistenceBridge({ adapter });
      const playerId = "player-admin-spawn-ended-001";
      const runtime = createReadCommandRuntime({
        accountPersistence,
        characterPersistence,
        inventoryPersistence,
        combatManager,
        combatPersistence,
        adminAccessControl: createAdminAccessControl([playerId])
      });
      accountPersistence.findOrCreateAccountByDiscordUserId({ discord_user_id: playerId });

      combatManager.createCombat({
        combat_id: "combat-admin-spawn-ended-001",
        status: "completed"
      });

      const event = mapInteractionOrThrow(createInteraction("admin", [
        { name: "action", value: "spawn_monster" },
        { name: "combat_id", value: "combat-admin-spawn-ended-001" },
        { name: "monster_id", value: "monster_goblin_scout" }
      ], playerId));
      const out = await runtime.processGatewayReadCommandEvent(event);
      const response = findResponse(out, "admin");
      assert.equal(Boolean(response), true);
      assert.equal(response.payload.ok, false);
      assert.equal(response.payload.error, "combat is not mutable");
    }, results);

  await runTest("admin_invalid_target_fails_clearly", async () => {
    const adapter = createInMemoryAdapter();
    const accountPersistence = new AccountPersistenceBridge({ adapter });
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const playerId = "player-admin-invalid-target-001";
    const runtime = createReadCommandRuntime({
      accountPersistence,
      characterPersistence,
      inventoryPersistence,
      adminAccessControl: createAdminAccessControl([playerId])
    });
    accountPersistence.findOrCreateAccountByDiscordUserId({ discord_user_id: playerId });

    const event = mapInteractionOrThrow(createInteraction("admin", [
      { name: "action", value: "inspect_session" },
      { name: "session_id", value: "session-does-not-exist" }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    const response = findResponse(out, "admin");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, false);
    assert.equal(typeof response.payload.error, "string");
    assert.equal(response.payload.error.includes("session not found"), true);
  }, results);

  await runTest("admin_non_admin_caller_is_rejected_safely", async () => {
    const adapter = createInMemoryAdapter();
    const accountPersistence = new AccountPersistenceBridge({ adapter });
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const playerId = "player-admin-unauthorized-001";
    const runtime = createReadCommandRuntime({
      accountPersistence,
      characterPersistence,
      inventoryPersistence,
      adminAccessControl: createAdminAccessControl([])
    });
    accountPersistence.findOrCreateAccountByDiscordUserId({ discord_user_id: playerId });

    const event = mapInteractionOrThrow(createInteraction("admin", [
      { name: "action", value: "inspect_account_character" }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    const response = findResponse(out, "admin");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, false);
    assert.equal(response.payload.error, "unauthorized admin action");
  }, results);

  await runTest("admin_mutation_replay_with_same_request_id_is_rejected", async () => {
    const adapter = createInMemoryAdapter();
    const accountPersistence = new AccountPersistenceBridge({ adapter });
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const playerId = "player-admin-replay-001";
    const runtime = createReadCommandRuntime({
      accountPersistence,
      characterPersistence,
      inventoryPersistence,
      adminAccessControl: createAdminAccessControl([playerId]),
      adminTuningStore: { reward_multiplier: 1 }
    });
    accountPersistence.findOrCreateAccountByDiscordUserId({ discord_user_id: playerId });

    const event = createEvent(EVENT_TYPES.PLAYER_ADMIN_REQUESTED, {
      command_name: "admin",
      action: "set_reward_multiplier",
      reward_multiplier: 2,
      request_id: "admin-request-001"
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: playerId
    });

    const firstOut = await runtime.processGatewayReadCommandEvent(event);
    const secondOut = await runtime.processGatewayReadCommandEvent(event);

    const firstResponse = findResponse(firstOut, "admin");
    const secondResponse = findResponse(secondOut, "admin");
    assert.equal(Boolean(firstResponse), true);
    assert.equal(Boolean(secondResponse), true);
    assert.equal(firstResponse.payload.ok, true);
    assert.equal(secondResponse.payload.ok, false);
    assert.equal(secondResponse.payload.error, "duplicate admin action request");
  }, results);

  await runTest("player_mutation_replay_with_same_request_id_is_rejected", async () => {
    const adapter = createInMemoryAdapter();
    const combatManager = new CombatManager();
    const combatPersistence = new CombatPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({ combatManager, combatPersistence });
    const playerId = "player-runtime-replay-attack-001";
    const combatId = "combat-runtime-replay-attack-001";
    createActiveCombat(combatManager, combatId, playerId, "enemy-runtime-replay-attack-001");

    const event = createEvent(EVENT_TYPES.PLAYER_ATTACK, {
      command_name: "attack",
      target_id: "enemy-runtime-replay-attack-001",
      request_id: "attack-request-001"
    }, {
      source: "gateway.discord",
      target_system: "combat_system",
      player_id: playerId,
      combat_id: combatId
    });

    const firstOut = await runtime.processGatewayReadCommandEvent(event);
    const secondOut = await runtime.processGatewayReadCommandEvent(event);
    const firstResponse = findResponse(firstOut, "attack");
    const secondResponse = findResponse(secondOut, "attack");
    assert.equal(Boolean(firstResponse), true);
    assert.equal(Boolean(secondResponse), true);
    assert.equal(firstResponse.payload.ok, true);
    assert.equal(secondResponse.payload.ok, false);
    assert.equal(secondResponse.payload.error, "duplicate mutation request");
  }, results);

  await runTest("admin_world_state_inspection_and_tuning_controls_work", async () => {
    const adapter = createInMemoryAdapter();
    const accountPersistence = new AccountPersistenceBridge({ adapter });
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const sessionPersistence = new SessionPersistenceBridge({ adapter });
    const combatPersistence = new CombatPersistenceBridge({ adapter });
    const partyPersistence = new PartyPersistenceBridge({ adapter });
    const guildManager = new GuildManager({ store: new InMemoryGuildStore() });
    const worldEventManager = new WorldEventManager({ store: new InMemoryWorldEventStore() });
    const adminTuningStore = { reward_multiplier: 1 };
    const playerId = "player-admin-controls-001";

    const runtime = createReadCommandRuntime({
      accountPersistence,
      characterPersistence,
      inventoryPersistence,
      sessionPersistence,
      combatPersistence,
      partyPersistence,
      guildManager,
      worldEventManager,
      adminTuningStore,
      adminAccessControl: createAdminAccessControl([playerId])
    });

      accountPersistence.findOrCreateAccountByDiscordUserId({ discord_user_id: playerId });
      inventoryPersistence.saveInventory(
        createInventoryRecord({
          inventory_id: "inv-admin-controls-001",
          owner_type: "player",
          owner_id: playerId,
          stackable_items: [{ item_id: "item-admin-controls-001", quantity: 2 }]
        })
      );
      partyPersistence.saveParty({
        party_id: "party-admin-controls-001",
      leader_player_id: playerId,
      member_player_ids: [playerId],
      status: "active"
    });
    guildManager.createGuild({
      guild_id: "guild-admin-controls-001",
      guild_name: "Admin Controls Guild",
      guild_tag: "ACG",
      leader_id: playerId,
      officer_ids: [],
      member_ids: [playerId],
      guild_level: 1,
      guild_xp: 0,
      guild_status: "active"
    });
    worldEventManager.createWorldEvent({
      event_id: "world-event-admin-controls-001",
      event_name: "Admin Event",
      event_type: "seasonal",
      event_scope: "global",
      event_state: { status: "scheduled" },
      start_time: "2026-03-01T00:00:00.000Z",
      end_time: "2026-03-31T00:00:00.000Z",
      participation_rules: { min_level: 1 },
      reward_rules: { table_id: "table-1" },
      active_flag: false
    });
    upsertRankingScore({
      ranking_type: "hunter",
      entity_id: playerId,
      score_value: 123
    });

    const inspectPartyOut = await runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(createInteraction("admin", [
        { name: "action", value: "inspect_party" },
        { name: "party_id", value: "party-admin-controls-001" }
      ], playerId))
    );
      const inspectGuildOut = await runtime.processGatewayReadCommandEvent(
        mapInteractionOrThrow(createInteraction("admin", [
          { name: "action", value: "inspect_guild" },
          { name: "guild_id", value: "guild-admin-controls-001" }
        ], playerId))
      );
      const inspectInventoryOut = await runtime.processGatewayReadCommandEvent(
        mapInteractionOrThrow(createInteraction("admin", [
          { name: "action", value: "inspect_inventory" },
          { name: "inventory_id", value: "inv-admin-controls-001" }
        ], playerId))
      );
      const inspectWorldEventOut = await runtime.processGatewayReadCommandEvent(
        mapInteractionOrThrow(createInteraction("admin", [
          { name: "action", value: "inspect_world_event" },
          { name: "world_event_id", value: "world-event-admin-controls-001" }
        ], playerId))
      );
      const inspectRankingsOut = await runtime.processGatewayReadCommandEvent(
        mapInteractionOrThrow(createInteraction("admin", [
          { name: "action", value: "inspect_rankings" },
        { name: "ranking_type", value: "hunter" },
        { name: "limit", value: 3 }
      ], playerId))
    );
    const setMultiplierOut = await runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(createInteraction("admin", [
        { name: "action", value: "set_reward_multiplier" },
        { name: "reward_multiplier", value: 1.5 }
      ], playerId))
    );
    const inspectTuningOut = await runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(createInteraction("admin", [
        { name: "action", value: "inspect_tuning" }
      ], playerId))
    );
    const activateEventOut = await runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(createInteraction("admin", [
        { name: "action", value: "activate_world_event" },
        { name: "world_event_id", value: "world-event-admin-controls-001" }
      ], playerId))
    );
    const worldSummaryOut = await runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(createInteraction("admin", [
        { name: "action", value: "inspect_world_summary" }
      ], playerId))
    );
  
      assert.equal(findResponse(inspectPartyOut, "admin").payload.ok, true);
      assert.equal(findResponse(inspectGuildOut, "admin").payload.ok, true);
      const inventoryResponse = findResponse(inspectInventoryOut, "admin");
      assert.equal(inventoryResponse.payload.ok, true);
      assert.equal(inventoryResponse.payload.data.result.inventory_summary.inventory_id, "inv-admin-controls-001");
      const worldEventResponse = findResponse(inspectWorldEventOut, "admin");
      assert.equal(worldEventResponse.payload.ok, true);
      assert.equal(worldEventResponse.payload.data.result.world_event.event_id, "world-event-admin-controls-001");
      const rankingResponse = findResponse(inspectRankingsOut, "admin");
      assert.equal(rankingResponse.payload.ok, true);
    assert.equal(Array.isArray(rankingResponse.payload.data.result.rankings), true);
    assert.equal(findResponse(setMultiplierOut, "admin").payload.ok, true);
    const tuningResponse = findResponse(inspectTuningOut, "admin");
    assert.equal(tuningResponse.payload.ok, true);
    assert.equal(tuningResponse.payload.data.result.tuning.reward_multiplier, 1.5);
      assert.equal(findResponse(activateEventOut, "admin").payload.ok, true);
      assert.equal(findResponse(worldSummaryOut, "admin").payload.ok, true);
    }, results);

    await runTest("admin_inspection_helpers_are_read_only", async () => {
      const adapter = createInMemoryAdapter();
      const accountPersistence = new AccountPersistenceBridge({ adapter });
      const characterPersistence = new CharacterPersistenceBridge({ adapter });
      const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
      const worldEventManager = new WorldEventManager({ store: new InMemoryWorldEventStore() });
      const playerId = "player-admin-readonly-001";
      const runtime = createReadCommandRuntime({
        accountPersistence,
        characterPersistence,
        inventoryPersistence,
        worldEventManager,
        adminAccessControl: createAdminAccessControl([playerId])
      });

      accountPersistence.findOrCreateAccountByDiscordUserId({ discord_user_id: playerId });
      inventoryPersistence.saveInventory(
        createInventoryRecord({
          inventory_id: "inv-admin-readonly-001",
          owner_type: "player",
          owner_id: playerId,
          stackable_items: [{ item_id: "item-readonly-001", quantity: 4 }]
        })
      );
      worldEventManager.createWorldEvent({
        event_id: "world-event-readonly-001",
        event_name: "Readonly Event",
        event_type: "seasonal",
        event_scope: "global",
        event_state: { status: "scheduled" },
        start_time: "2026-03-01T00:00:00.000Z",
        end_time: "2026-03-31T00:00:00.000Z",
        participation_rules: {},
        reward_rules: {},
        active_flag: false
      });

      const inventoryBefore = JSON.stringify(inventoryPersistence.loadInventoryById("inv-admin-readonly-001").payload.inventory);
      const worldEventBefore = JSON.stringify(worldEventManager.getWorldEvent("world-event-readonly-001"));

      const inspectInventoryOut = await runtime.processGatewayReadCommandEvent(
        mapInteractionOrThrow(createInteraction("admin", [
          { name: "action", value: "inspect_inventory" },
          { name: "inventory_id", value: "inv-admin-readonly-001" }
        ], playerId))
      );
      const inspectWorldEventOut = await runtime.processGatewayReadCommandEvent(
        mapInteractionOrThrow(createInteraction("admin", [
          { name: "action", value: "inspect_world_event" },
          { name: "world_event_id", value: "world-event-readonly-001" }
        ], playerId))
      );

      const inventoryAfter = JSON.stringify(inventoryPersistence.loadInventoryById("inv-admin-readonly-001").payload.inventory);
      const worldEventAfter = JSON.stringify(worldEventManager.getWorldEvent("world-event-readonly-001"));

      assert.equal(findResponse(inspectInventoryOut, "admin").payload.ok, true);
      assert.equal(findResponse(inspectWorldEventOut, "admin").payload.ok, true);
      assert.equal(inventoryAfter, inventoryBefore);
      assert.equal(worldEventAfter, worldEventBefore);
    }, results);

  await runTest("admin_content_refresh_failure_is_safe_and_non_corrupting", async () => {
    const adapter = createInMemoryAdapter();
    const accountPersistence = new AccountPersistenceBridge({ adapter });
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const playerId = "player-admin-refresh-001";
    const runtime = createReadCommandRuntime({
      accountPersistence,
      characterPersistence,
      inventoryPersistence,
      adminAccessControl: createAdminAccessControl([playerId]),
      loadContentBundle: function loadContentBundle() {
        return {
          ok: false,
          error: "forced_content_refresh_failure",
          payload: {}
        };
      }
    });
    accountPersistence.findOrCreateAccountByDiscordUserId({ discord_user_id: playerId });

    const out = await runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(createInteraction("admin", [
        { name: "action", value: "refresh_content" }
      ], playerId))
    );
    const response = findResponse(out, "admin");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, false);
    assert.equal(response.payload.error, "forced_content_refresh_failure");
  }, results);

  await runTest("end_to_end_equip_runtime_flow_updates_persistence", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({ characterPersistence, inventoryPersistence });
    const playerId = "player-equip-runtime-001";
    const inventoryId = "inv-equip-runtime-001";
    const characterId = "char-equip-runtime-001";

    characterPersistence.saveCharacter(
      createCharacterRecord({
        character_id: characterId,
        player_id: playerId,
        name: "Equip Hero",
        class: "fighter",
        race: "human",
        inventory_id: inventoryId,
        equipment: {}
      })
    );
    inventoryPersistence.saveInventory(
      createInventoryRecord({
        inventory_id: inventoryId,
        owner_type: "player",
        owner_id: playerId,
        equipment_items: [
          {
            item_id: "item-sword-runtime-001",
            item_name: "Runtime Sword",
            quantity: 1,
            owner_player_id: playerId,
            metadata: {}
          }
        ]
      })
    );

    const event = mapInteractionOrThrow(createInteraction("equip", [
      { name: "item_id", value: "item-sword-runtime-001" },
      { name: "slot", value: "main_hand" }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    assert.equal(out.ok, true);
    const response = findResponse(out, "equip");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);

    const loadedCharacter = characterPersistence.loadCharacterById(characterId);
    assert.equal(loadedCharacter.ok, true);
    assert.equal(loadedCharacter.payload.character.equipment.main_hand, "item-sword-runtime-001");

    const loadedInventory = inventoryPersistence.loadInventoryById(inventoryId);
    assert.equal(loadedInventory.ok, true);
    assert.equal(loadedInventory.payload.inventory.equipment_items[0].metadata.equipped, true);
    assert.equal(loadedInventory.payload.inventory.equipment_items[0].metadata.equipped_slot, "main_hand");
  }, results);

  await runTest("end_to_end_identify_attune_and_unattune_flow_updates_world_state", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({
      characterPersistence,
      inventoryPersistence,
      loadContentBundle() {
        return {
          ok: true,
          payload: {
            content: {
              items: [{
                item_id: "item_ring_of_protection",
                name: "Ring of Protection",
                item_type: "equipment",
                equip_slot: "ring",
                metadata: {
                  magical: true,
                  requires_attunement: true,
                  rarity: "rare"
                }
              }]
            }
          }
        };
      }
    });
    const playerId = "player-runtime-magical-001";
    const characterId = "char-runtime-magical-001";
    const inventoryId = "inv-runtime-magical-001";

    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: characterId,
      player_id: playerId,
      name: "Magic Hero",
      race: "human",
      class: "wizard",
      inventory_id: inventoryId
    }));
    inventoryPersistence.saveInventory(createInventoryRecord({
      inventory_id: inventoryId,
      owner_type: "player",
      owner_id: playerId,
      equipment_items: [{
        item_id: "item_mysterious_ring",
        item_name: "Mysterious Ring",
        item_type: "unidentified",
        quantity: 1,
        owner_player_id: playerId,
        metadata: {
          public_label: "Mysterious Ring",
          hidden_item_ref: "item_ring_of_protection"
        }
      }]
    }));

    const identifyEvent = mapInteractionOrThrow(createInteraction("identify", [
      { name: "item_id", value: "item_mysterious_ring" }
    ], playerId));
    const identifyOut = await runtime.processGatewayReadCommandEvent(identifyEvent);
    const identifyResponse = findResponse(identifyOut, "identify");
    assert.equal(Boolean(identifyResponse), true);
    assert.equal(identifyResponse.payload.ok, true);
    assert.equal(identifyResponse.payload.data.item.item_id, "item_ring_of_protection");

    const attuneEvent = mapInteractionOrThrow(createInteraction("attune", [
      { name: "item_id", value: "item_ring_of_protection" }
    ], playerId));
    const attuneOut = await runtime.processGatewayReadCommandEvent(attuneEvent);
    const attuneResponse = findResponse(attuneOut, "attune");
    assert.equal(Boolean(attuneResponse), true);
    assert.equal(attuneResponse.payload.ok, true);
    assert.equal(attuneResponse.payload.data.item.is_attuned, true);

    const inventoryEvent = mapInteractionOrThrow(createInteraction("inventory", [], playerId));
    const inventoryOut = await runtime.processGatewayReadCommandEvent(inventoryEvent);
    const inventoryResponse = findResponse(inventoryOut, "inventory");
    assert.equal(Boolean(inventoryResponse), true);
    assert.equal(inventoryResponse.payload.data.inventory.attuned_count, 1);
    assert.equal(inventoryResponse.payload.data.inventory.magical_count, 1);

    const unattuneEvent = mapInteractionOrThrow(createInteraction("unattune", [
      { name: "item_id", value: "item_ring_of_protection" }
    ], playerId));
    const unattuneOut = await runtime.processGatewayReadCommandEvent(unattuneEvent);
    const unattuneResponse = findResponse(unattuneOut, "unattune");
    assert.equal(Boolean(unattuneResponse), true);
    assert.equal(unattuneResponse.payload.ok, true);
    assert.equal(unattuneResponse.payload.data.item.is_attuned, false);
  }, results);

  await runTest("end_to_end_unequip_runtime_flow_updates_persistence", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({ characterPersistence, inventoryPersistence });
    const playerId = "player-unequip-runtime-001";
    const inventoryId = "inv-unequip-runtime-001";
    const characterId = "char-unequip-runtime-001";

    characterPersistence.saveCharacter(
      createCharacterRecord({
        character_id: characterId,
        player_id: playerId,
        name: "Unequip Hero",
        class: "fighter",
        race: "human",
        inventory_id: inventoryId,
        equipment: {
          main_hand: "item-sword-runtime-002"
        }
      })
    );
    inventoryPersistence.saveInventory(
      createInventoryRecord({
        inventory_id: inventoryId,
        owner_type: "player",
        owner_id: playerId,
        equipment_items: [
          {
            item_id: "item-sword-runtime-002",
            item_name: "Runtime Sword 2",
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

    const event = mapInteractionOrThrow(createInteraction("unequip", [
      { name: "slot", value: "main_hand" },
      { name: "item_id", value: "item-sword-runtime-002" }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    assert.equal(out.ok, true);
    const response = findResponse(out, "unequip");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);

    const loadedCharacter = characterPersistence.loadCharacterById(characterId);
    assert.equal(loadedCharacter.ok, true);
    assert.equal(loadedCharacter.payload.character.equipment.main_hand, null);

    const loadedInventory = inventoryPersistence.loadInventoryById(inventoryId);
    assert.equal(loadedInventory.ok, true);
    assert.equal(loadedInventory.payload.inventory.equipment_items[0].metadata.equipped, false);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        loadedInventory.payload.inventory.equipment_items[0].metadata,
        "equipped_slot"
      ),
      false
    );
  }, results);

  await runTest("equip_invalid_item_id_returns_structured_failure", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({ characterPersistence, inventoryPersistence });
    const playerId = "player-equip-invalid-item-001";
    const inventoryId = "inv-equip-invalid-item-001";

    characterPersistence.saveCharacter(
      createCharacterRecord({
        character_id: "char-equip-invalid-item-001",
        player_id: playerId,
        name: "Invalid Item Hero",
        class: "fighter",
        race: "human",
        inventory_id: inventoryId
      })
    );
    inventoryPersistence.saveInventory(
      createInventoryRecord({
        inventory_id: inventoryId,
        owner_type: "player",
        owner_id: playerId,
        equipment_items: []
      })
    );

    const event = mapInteractionOrThrow(createInteraction("equip", [
      { name: "item_id", value: "item-does-not-exist" },
      { name: "slot", value: "main_hand" }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    const response = findResponse(out, "equip");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, false);
    assert.equal(response.payload.error, "item_id not found in linked inventory");
  }, results);

  await runTest("equip_ownership_failure_returns_structured_failure", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({ characterPersistence, inventoryPersistence });
    const playerId = "player-equip-owner-001";
    const inventoryId = "inv-equip-owner-001";

    characterPersistence.saveCharacter(
      createCharacterRecord({
        character_id: "char-equip-owner-001",
        player_id: playerId,
        name: "Ownership Hero",
        class: "fighter",
        race: "human",
        inventory_id: inventoryId
      })
    );
    inventoryPersistence.saveInventory(
      createInventoryRecord({
        inventory_id: inventoryId,
        owner_type: "player",
        owner_id: playerId,
        equipment_items: [
          {
            item_id: "item-owned-by-other",
            item_name: "Other Owner Sword",
            quantity: 1,
            owner_player_id: "different-player",
            metadata: {}
          }
        ]
      })
    );

    const event = mapInteractionOrThrow(createInteraction("equip", [
      { name: "item_id", value: "item-owned-by-other" },
      { name: "slot", value: "main_hand" }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    const response = findResponse(out, "equip");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, false);
    assert.equal(response.payload.error, "ownership validation failed for equip request");
  }, results);

  await runTest("equip_slot_conflict_returns_structured_failure", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({ characterPersistence, inventoryPersistence });
    const playerId = "player-equip-slot-conflict-001";
    const inventoryId = "inv-equip-slot-conflict-001";
    const characterId = "char-equip-slot-conflict-001";

    characterPersistence.saveCharacter(
      createCharacterRecord({
        character_id: characterId,
        player_id: playerId,
        name: "Slot Conflict Hero",
        class: "fighter",
        race: "human",
        inventory_id: inventoryId,
        equipment: {
          main_hand: "item-existing-main-hand"
        }
      })
    );
    inventoryPersistence.saveInventory(
      createInventoryRecord({
        inventory_id: inventoryId,
        owner_type: "player",
        owner_id: playerId,
        equipment_items: [
          {
            item_id: "item-new-main-hand",
            item_name: "New Main Hand Sword",
            quantity: 1,
            owner_player_id: playerId,
            metadata: {}
          }
        ]
      })
    );

    const event = mapInteractionOrThrow(createInteraction("equip", [
      { name: "item_id", value: "item-new-main-hand" },
      { name: "slot", value: "main_hand" }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    const response = findResponse(out, "equip");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, false);
    assert.equal(response.payload.error, "slot already occupied by another item");
  }, results);

  await runTest("end_to_end_dungeon_enter_runtime_flow_persists_session", async () => {
    const adapter = createInMemoryAdapter();
    const sessionPersistence = new SessionPersistenceBridge({ adapter });
    const sessionManager = new DungeonSessionManagerCore();
    const runtime = createReadCommandRuntime({ sessionPersistence, sessionManager });
    const playerId = "player-runtime-dungeon-enter-001";

    const event = mapInteractionOrThrow(createInteraction("dungeon", [
      {
        type: 1,
        name: "enter",
        options: [
          { name: "dungeon_id", value: "dungeon-runtime-001" },
          { name: "party_id", value: "party-runtime-001" }
        ]
      }
    ], playerId));

    const out = await runtime.processGatewayReadCommandEvent(event);
    assert.equal(out.ok, true);
    const response = findResponse(out, "dungeon_enter");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.enter_status, "created");

    const sessions = sessionPersistence.listSessions();
    assert.equal(sessions.ok, true);
    assert.equal(sessions.payload.sessions.length, 1);
    assert.equal(sessions.payload.sessions[0].dungeon_id, "dungeon-runtime-001");
    assert.equal(sessions.payload.sessions[0].party.party_id, "party-runtime-001");
  }, results);

  await runTest("duplicate_dungeon_enter_prevents_duplicate_session_creation", async () => {
    const adapter = createInMemoryAdapter();
    const sessionPersistence = new SessionPersistenceBridge({ adapter });
    const sessionManager = new DungeonSessionManagerCore();
    const runtime = createReadCommandRuntime({ sessionPersistence, sessionManager });
    const playerId = "player-runtime-dungeon-duplicate-001";

    const event = mapInteractionOrThrow(createInteraction("dungeon", [
      {
        type: 1,
        name: "enter",
        options: [{ name: "dungeon_id", value: "dungeon-runtime-dup-001" }]
      }
    ], playerId));

    const firstOut = await runtime.processGatewayReadCommandEvent(event);
    const secondOut = await runtime.processGatewayReadCommandEvent(event);
    const firstResponse = findResponse(firstOut, "dungeon_enter");
    const secondResponse = findResponse(secondOut, "dungeon_enter");

    assert.equal(firstResponse.payload.data.enter_status, "created");
    assert.equal(secondResponse.payload.data.enter_status, "already_exists");

    const sessions = sessionPersistence.listSessions();
    assert.equal(sessions.ok, true);
    assert.equal(sessions.payload.sessions.length, 1);
  }, results);

  await runTest("end_to_end_leave_runtime_flow_deletes_session", async () => {
    const adapter = createInMemoryAdapter();
    const sessionPersistence = new SessionPersistenceBridge({ adapter });
    const sessionManager = new DungeonSessionManagerCore();
    const runtime = createReadCommandRuntime({ sessionPersistence, sessionManager });
    const playerId = "player-runtime-session-leave-001";
    const sessionId = "session-" + playerId + "-dungeon-runtime-leave-001";

    const enterEvent = mapInteractionOrThrow(createInteraction("dungeon", [
      {
        type: 1,
        name: "enter",
        options: [{ name: "dungeon_id", value: "dungeon-runtime-leave-001" }]
      }
    ], playerId));
    await runtime.processGatewayReadCommandEvent(enterEvent);

    const leaveEvent = mapInteractionOrThrow(createInteraction("leave", [
      { name: "session_id", value: sessionId }
    ], playerId));
    const leaveOut = await runtime.processGatewayReadCommandEvent(leaveEvent);
    assert.equal(leaveOut.ok, true);
    const response = findResponse(leaveOut, "leave_session");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.deleted, true);

    const sessions = sessionPersistence.listSessions();
    assert.equal(sessions.ok, true);
    assert.equal(sessions.payload.sessions.length, 0);
  }, results);

  await runTest("end_to_end_move_runtime_flow_through_session_domain", async () => {
    const adapter = createInMemoryAdapter();
    const sessionPersistence = new SessionPersistenceBridge({ adapter });
    const sessionManager = new DungeonSessionManagerCore();
    const runtime = createReadCommandRuntime({ sessionPersistence, sessionManager });
    const playerId = "player-runtime-move-session-001";
    const sessionId = "session-runtime-move-session-001";

    sessionManager.createSession({
      session_id: sessionId,
      dungeon_id: "dungeon-runtime-move-001",
      status: "active"
    });
    sessionManager.setParty({
      session_id: sessionId,
      party: {
        party_id: "party-runtime-move-001",
        leader_id: playerId,
        members: [playerId]
      }
    });
    sessionManager.addMultipleRoomsToSession({
      session_id: sessionId,
      rooms: [
        createRoomObject({
          room_id: "room-runtime-move-A",
          room_type: "empty",
          exits: [{ direction: "east", to_room_id: "room-runtime-move-B" }]
        }),
        createRoomObject({
          room_id: "room-runtime-move-B",
          room_type: "empty",
          exits: [{ direction: "west", to_room_id: "room-runtime-move-A" }]
        })
      ]
    });
    sessionManager.setStartRoom({
      session_id: sessionId,
      room_id: "room-runtime-move-A"
    });
    sessionPersistence.saveSession(sessionManager.getSessionById(sessionId).payload.session);

    const event = mapInteractionOrThrow(createInteraction("move", [
      { name: "direction", value: "east" },
      { name: "session_id", value: sessionId }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    assert.equal(out.ok, true);
    const response = findResponse(out, "move");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.session_id, sessionId);
    assert.equal(response.payload.data.to_room_id, "room-runtime-move-B");
    assert.equal(response.payload.data.room.room_id, "room-runtime-move-B");
    assert.equal(Array.isArray(response.payload.data.room.exits), true);

    const loadedSession = sessionPersistence.loadSessionById(sessionId);
    assert.equal(loadedSession.ok, true);
    assert.equal(loadedSession.payload.session.current_room_id, "room-runtime-move-B");
  }, results);

  await runTest("end_to_end_interact_runtime_flow_unlocks_and_opens_locked_chest_with_reward", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const sessionPersistence = new SessionPersistenceBridge({ adapter });
    const sessionManager = new DungeonSessionManagerCore();
    const runtime = createReadCommandRuntime({
      characterPersistence,
      inventoryPersistence,
      sessionPersistence,
      sessionManager
    });
    const playerId = "player-runtime-interact-001";
    const sessionId = "session-runtime-interact-001";
    const inventoryId = "inv-runtime-interact-001";

    characterPersistence.saveCharacter(createCharacterRecord({
      character_id: "char-runtime-interact-001",
      player_id: playerId,
      name: "Interact Hero",
      race: "human",
      class: "rogue",
      level: 1,
      inventory_id: inventoryId
    }));
    inventoryPersistence.saveInventory(createInventoryRecord({
      inventory_id: inventoryId,
      owner_type: "player",
      owner_id: playerId
    }));

    sessionManager.createSession({
      session_id: sessionId,
      dungeon_id: "dungeon-runtime-interact-001",
      status: "active"
    });
    sessionManager.setParty({
      session_id: sessionId,
      party: {
        party_id: "party-runtime-interact-001",
        leader_id: playerId,
        members: [{ player_id: playerId }]
      }
    });
    sessionManager.addRoomToSession({
      session_id: sessionId,
      room: createRoomObject({
        room_id: "room-runtime-interact-001",
        room_type: "empty",
        objects: [{
          object_id: "obj-chest-runtime-001",
          object_type: "chest",
          is_locked: true,
          metadata: {
            locked: true,
            loot_table: {
              loot_table_id: "loot-chest-runtime-001",
              guaranteed_entries: [
                {
                  item_id: "item_rat_tail",
                  item_name: "Rat Tail",
                  quantity: 1,
                  rarity: "common"
                }
              ],
              weighted_entries: []
            }
          }
        }]
      })
    });
    const setStartOut = sessionManager.setStartRoom({
      session_id: sessionId,
      room_id: "room-runtime-interact-001"
    });
    sessionPersistence.saveSession(setStartOut.payload.session);

    const unlockEvent = mapInteractionOrThrow(createInteraction("interact", [
      { name: "object_id", value: "obj-chest-runtime-001" },
      { name: "action", value: "unlock" },
      { name: "session_id", value: sessionId }
    ], playerId));
    const unlockOut = await runtime.processGatewayReadCommandEvent(unlockEvent);
    assert.equal(unlockOut.ok, true);
    const unlockResponse = findResponse(unlockOut, "interact");
    assert.equal(Boolean(unlockResponse), true);
    assert.equal(unlockResponse.payload.ok, true);
    assert.equal(unlockResponse.payload.data.interaction_action, "unlocked");
    assert.equal(unlockResponse.payload.data.reward_status, "none");

    const openEvent = mapInteractionOrThrow(createInteraction("interact", [
      { name: "object_id", value: "obj-chest-runtime-001" },
      { name: "action", value: "open" },
      { name: "session_id", value: sessionId }
    ], playerId));
    const openOut = await runtime.processGatewayReadCommandEvent(openEvent);
    assert.equal(openOut.ok, true);
    const openResponse = findResponse(openOut, "interact");
    assert.equal(Boolean(openResponse), true);
    assert.equal(openResponse.payload.ok, true);
    assert.equal(openResponse.payload.data.interaction_action, "opened");
    assert.equal(openResponse.payload.data.reward_status, "granted");
    assert.equal(openResponse.payload.data.room.room_id, "room-runtime-interact-001");
    assert.equal(Array.isArray(openResponse.payload.data.room.visible_objects), true);
    assert.equal(openResponse.payload.data.room.visible_objects[0].object_id, "obj-chest-runtime-001");

    const reloadedInventory = inventoryPersistence.loadInventoryById(inventoryId);
    assert.equal(reloadedInventory.ok, true);
    const ratTailEntry = reloadedInventory.payload.inventory.stackable_items.find((entry) => {
      return String(entry.item_id || "") === "item_rat_tail";
    });
    assert.equal(Boolean(ratTailEntry), true);
    assert.equal(ratTailEntry.quantity, 1);

    const duplicateOpenOut = await runtime.processGatewayReadCommandEvent(openEvent);
    assert.equal(duplicateOpenOut.ok, true);
    const duplicateOpenResponse = findResponse(duplicateOpenOut, "interact");
    assert.equal(Boolean(duplicateOpenResponse), true);
    assert.equal(duplicateOpenResponse.payload.ok, false);
    assert.equal(duplicateOpenResponse.payload.error, "object already opened");
  }, results);

  await runTest("end_to_end_interact_runtime_flow_supports_utility_spell_hooks", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const sessionPersistence = new SessionPersistenceBridge({ adapter });
    const sessionManager = new DungeonSessionManagerCore();
    const runtime = createReadCommandRuntime({
      characterPersistence,
      sessionPersistence,
      sessionManager,
      loadContentBundle() {
        return {
          ok: true,
          payload: {
            content: {
              spells: [
                {
                  spell_id: "light",
                  name: "Light",
                  effect: {
                    utility_ref: "spell_light_emits_bright_light"
                  }
                }
              ]
            }
          }
        };
      }
    });
    const playerId = "player-runtime-interact-spell-001";
    const sessionId = "session-runtime-interact-spell-001";

    const utilityCharacter = createCharacterRecord({
      character_id: "char-runtime-interact-spell-001",
      player_id: playerId,
      name: "Spell Utility Hero",
      race: "human",
      class: "wizard",
      level: 1
    });
    utilityCharacter.spellbook = {
      known_spell_ids: ["light"]
    };
    characterPersistence.saveCharacter(utilityCharacter);

    sessionManager.createSession({
      session_id: sessionId,
      dungeon_id: "dungeon-runtime-interact-spell-001",
      status: "active"
    });
    sessionManager.setParty({
      session_id: sessionId,
      party: {
        party_id: "party-runtime-interact-spell-001",
        leader_id: playerId,
        members: [{ player_id: playerId }]
      }
    });
    sessionManager.addRoomToSession({
      session_id: sessionId,
      room: createRoomObject({
        room_id: "room-runtime-interact-spell-001",
        room_type: "empty",
        objects: [{
          object_id: "obj-lore-runtime-spell-001",
          object_type: "lore_object",
          metadata: {
            requires_light: true,
            is_dark: true
          }
        }]
      })
    });
    const setStartOut = sessionManager.setStartRoom({
      session_id: sessionId,
      room_id: "room-runtime-interact-spell-001"
    });
    sessionPersistence.saveSession(setStartOut.payload.session);

    const blockedEvent = mapInteractionOrThrow(createInteraction("interact", [
      { name: "object_id", value: "obj-lore-runtime-spell-001" },
      { name: "action", value: "read" },
      { name: "session_id", value: sessionId }
    ], playerId));
    const blockedOut = await runtime.processGatewayReadCommandEvent(blockedEvent);
    const blockedResponse = findResponse(blockedOut, "interact");
    assert.equal(Boolean(blockedResponse), true);
    assert.equal(blockedResponse.payload.ok, false);
    assert.equal(blockedResponse.payload.error, "object requires light");

    const litEvent = mapInteractionOrThrow(createInteraction("interact", [
      { name: "object_id", value: "obj-lore-runtime-spell-001" },
      { name: "action", value: "read" },
      { name: "spell_id", value: "light" },
      { name: "session_id", value: sessionId }
    ], playerId));
    const litOut = await runtime.processGatewayReadCommandEvent(litEvent);
    const litResponse = findResponse(litOut, "interact");
    assert.equal(Boolean(litResponse), true);
    assert.equal(litResponse.payload.ok, true);
    assert.equal(litResponse.payload.data.interaction_action, "read");
    assert.equal(litResponse.payload.data.spell_effect.spell_id, "light");
    assert.equal(litResponse.payload.data.object_state.is_lit, true);
    assert.equal(litResponse.payload.data.room.room_id, "room-runtime-interact-spell-001");
    assert.equal(Array.isArray(litResponse.payload.data.room.visible_objects), true);
    assert.equal(litResponse.payload.data.room.visible_objects[0].object_id, "obj-lore-runtime-spell-001");
  }, results);

  await runTest("end_to_end_interact_runtime_flow_supports_knock_and_skill_hooks", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const sessionPersistence = new SessionPersistenceBridge({ adapter });
    const sessionManager = new DungeonSessionManagerCore();
    const runtime = createReadCommandRuntime({
      characterPersistence,
      sessionPersistence,
      sessionManager,
      loadContentBundle() {
        return {
          ok: true,
          payload: {
            content: {
              spells: [
                {
                  spell_id: "knock",
                  name: "Knock",
                  effect: {
                    utility_ref: "spell_knock_unlocks_object"
                  }
                }
              ]
            }
          }
        };
      }
    });
    const playerId = "player-runtime-interact-knock-001";
    const sessionId = "session-runtime-interact-knock-001";

    const utilityCharacter = createCharacterRecord({
      character_id: "char-runtime-interact-knock-001",
      player_id: playerId,
      name: "Knock Utility Hero",
      race: "human",
      class: "wizard",
      level: 1
    });
    utilityCharacter.spellbook = {
      known_spell_ids: ["knock"]
    };
    utilityCharacter.skills = {
      arcana: true
    };
    characterPersistence.saveCharacter(utilityCharacter);

    sessionManager.createSession({
      session_id: sessionId,
      dungeon_id: "dungeon-runtime-interact-knock-001",
      status: "active"
    });
    sessionManager.setParty({
      session_id: sessionId,
      party: {
        party_id: "party-runtime-interact-knock-001",
        leader_id: playerId,
        members: [{ player_id: playerId }]
      }
    });
    sessionManager.addRoomToSession({
      session_id: sessionId,
      room: createRoomObject({
        room_id: "room-runtime-interact-knock-001",
        room_type: "empty",
        objects: [
          {
            object_id: "obj-door-runtime-knock-001",
            object_type: "door",
            is_locked: true,
            metadata: {
              locked: true,
              to_room_id: "room-next"
            }
          },
          {
            object_id: "obj-lore-runtime-arcana-001",
            object_type: "lore_object",
            metadata: {
              required_skill: "arcana",
              required_skill_action: "read"
            }
          }
        ]
      })
    });
    const setStartOut = sessionManager.setStartRoom({
      session_id: sessionId,
      room_id: "room-runtime-interact-knock-001"
    });
    sessionPersistence.saveSession(setStartOut.payload.session);

    const knockEvent = mapInteractionOrThrow(createInteraction("interact", [
      { name: "object_id", value: "obj-door-runtime-knock-001" },
      { name: "action", value: "unlock" },
      { name: "spell_id", value: "knock" },
      { name: "session_id", value: sessionId }
    ], playerId));
    const knockOut = await runtime.processGatewayReadCommandEvent(knockEvent);
    const knockResponse = findResponse(knockOut, "interact");
    assert.equal(Boolean(knockResponse), true);
    assert.equal(knockResponse.payload.ok, true);
    assert.equal(knockResponse.payload.data.spell_effect.spell_id, "knock");
    assert.equal(knockResponse.payload.data.object_state.is_unlocked, true);

    const arcanaEvent = mapInteractionOrThrow(createInteraction("interact", [
      { name: "object_id", value: "obj-lore-runtime-arcana-001" },
      { name: "action", value: "read" },
      { name: "session_id", value: sessionId }
    ], playerId));
    const arcanaOut = await runtime.processGatewayReadCommandEvent(arcanaEvent);
    const arcanaResponse = findResponse(arcanaOut, "interact");
    assert.equal(Boolean(arcanaResponse), true);
    assert.equal(arcanaResponse.payload.ok, true);
    assert.equal(arcanaResponse.payload.data.skill_check.skill_id, "arcana");
    assert.equal(arcanaResponse.payload.data.skill_check.passed, true);
  }, results);

  await runTest("end_to_end_interact_runtime_flow_supports_tool_and_identify_hooks", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const sessionPersistence = new SessionPersistenceBridge({ adapter });
    const sessionManager = new DungeonSessionManagerCore();
    const runtime = createReadCommandRuntime({
      characterPersistence,
      sessionPersistence,
      sessionManager,
      loadContentBundle() {
        return {
          ok: true,
          payload: {
            content: {
              spells: [
                {
                  spell_id: "identify",
                  name: "Identify",
                  effect: {
                    utility_ref: "spell_identify_reveals_object_nature"
                  }
                }
              ],
              items: [
                {
                  item_id: "item_ring_of_protection",
                  name: "Ring of Protection",
                  item_type: "equipment",
                  metadata: {
                    magical: true,
                    requires_attunement: true
                  }
                }
              ]
            }
          }
        };
      }
    });
    const playerId = "player-runtime-interact-tool-001";
    const sessionId = "session-runtime-interact-tool-001";

    const utilityCharacter = createCharacterRecord({
      character_id: "char-runtime-interact-tool-001",
      player_id: playerId,
      name: "Tool Utility Hero",
      race: "human",
      class: "rogue",
      level: 1
    });
    utilityCharacter.spellbook = {
      known_spell_ids: ["identify"]
    };
    utilityCharacter.applied_proficiencies = {
      tools: ["thieves_tools"]
    };
    characterPersistence.saveCharacter(utilityCharacter);

    sessionManager.createSession({
      session_id: sessionId,
      dungeon_id: "dungeon-runtime-interact-tool-001",
      status: "active"
    });
    sessionManager.setParty({
      session_id: sessionId,
      party: {
        party_id: "party-runtime-interact-tool-001",
        leader_id: playerId,
        members: [{ player_id: playerId }]
      }
    });
    sessionManager.addRoomToSession({
      session_id: sessionId,
      room: createRoomObject({
        room_id: "room-runtime-interact-tool-001",
        room_type: "empty",
        objects: [
          {
            object_id: "obj-door-runtime-tool-001",
            object_type: "door",
            is_locked: true,
            metadata: {
              locked: true,
              required_tool: "thieves_tools",
              required_tool_action: "unlock"
            }
          },
          {
            object_id: "obj-relic-runtime-identify-001",
            object_type: "shrine",
            metadata: {
              hidden_item_ref: "item_ring_of_protection",
              identify_reveal: "Ring of Protection"
            }
          }
        ]
      })
    });
    const setStartOut = sessionManager.setStartRoom({
      session_id: sessionId,
      room_id: "room-runtime-interact-tool-001"
    });
    sessionPersistence.saveSession(setStartOut.payload.session);

    const unlockEvent = mapInteractionOrThrow(createInteraction("interact", [
      { name: "object_id", value: "obj-door-runtime-tool-001" },
      { name: "action", value: "unlock" },
      { name: "session_id", value: sessionId }
    ], playerId));
    const unlockOut = await runtime.processGatewayReadCommandEvent(unlockEvent);
    const unlockResponse = findResponse(unlockOut, "interact");
    assert.equal(Boolean(unlockResponse), true);
    assert.equal(unlockResponse.payload.ok, true);
    assert.equal(unlockResponse.payload.data.tool_check.tool_id, "thieves_tools");
    assert.equal(unlockResponse.payload.data.tool_check.passed, true);

    const identifyEvent = mapInteractionOrThrow(createInteraction("interact", [
      { name: "object_id", value: "obj-relic-runtime-identify-001" },
      { name: "action", value: "use" },
      { name: "spell_id", value: "identify" },
      { name: "session_id", value: sessionId }
    ], playerId));
    const identifyOut = await runtime.processGatewayReadCommandEvent(identifyEvent);
    const identifyResponse = findResponse(identifyOut, "interact");
    assert.equal(Boolean(identifyResponse), true);
    assert.equal(identifyResponse.payload.ok, true);
    assert.equal(identifyResponse.payload.data.spell_effect.spell_id, "identify");
    assert.equal(identifyResponse.payload.data.spell_effect.identified_item_id, "item_ring_of_protection");
  }, results);

  await runTest("end_to_end_interact_runtime_flow_reports_linked_object_effects", async () => {
    const adapter = createInMemoryAdapter();
    const sessionPersistence = new SessionPersistenceBridge({ adapter });
    const sessionManager = new DungeonSessionManagerCore();
    const runtime = createReadCommandRuntime({
      sessionPersistence,
      sessionManager
    });
    const playerId = "player-runtime-interact-link-001";
    const sessionId = "session-runtime-interact-link-001";

    sessionManager.createSession({
      session_id: sessionId,
      dungeon_id: "dungeon-runtime-interact-link-001",
      status: "active"
    });
    sessionManager.setParty({
      session_id: sessionId,
      party: {
        party_id: "party-runtime-interact-link-001",
        leader_id: playerId,
        members: [{ player_id: playerId }]
      }
    });
    sessionManager.addRoomToSession({
      session_id: sessionId,
      room: createRoomObject({
        room_id: "room-runtime-interact-link-001",
        room_type: "empty",
        objects: [
          {
            object_id: "obj-lever-runtime-link-001",
            object_type: "lever",
            metadata: {
              linked_object_id: "obj-door-runtime-link-001"
            }
          },
          {
            object_id: "obj-door-runtime-link-001",
            object_type: "door",
            is_locked: true,
            metadata: {
              locked: true
            }
          }
        ]
      })
    });
    const setStartOut = sessionManager.setStartRoom({
      session_id: sessionId,
      room_id: "room-runtime-interact-link-001"
    });
    sessionPersistence.saveSession(setStartOut.payload.session);

    const event = mapInteractionOrThrow(createInteraction("interact", [
      { name: "object_id", value: "obj-lever-runtime-link-001" },
      { name: "action", value: "activate" },
      { name: "session_id", value: sessionId }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    const response = findResponse(out, "interact");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.interaction_effects[0].effect_type, "linked_object_opened");
    assert.equal(response.payload.data.interaction_effects[0].object_id, "obj-door-runtime-link-001");
  }, results);

  await runTest("end_to_end_interact_runtime_flow_reports_shrine_blessing_effects", async () => {
    const adapter = createInMemoryAdapter();
    const sessionPersistence = new SessionPersistenceBridge({ adapter });
    const sessionManager = new DungeonSessionManagerCore();
    const runtime = createReadCommandRuntime({
      sessionPersistence,
      sessionManager
    });
    const playerId = "player-runtime-interact-shrine-001";
    const sessionId = "session-runtime-interact-shrine-001";

    sessionManager.createSession({
      session_id: sessionId,
      dungeon_id: "dungeon-runtime-interact-shrine-001",
      status: "active"
    });
    sessionManager.setParty({
      session_id: sessionId,
      party: {
        party_id: "party-runtime-interact-shrine-001",
        leader_id: playerId,
        members: [{ player_id: playerId }]
      }
    });
    sessionManager.addRoomToSession({
      session_id: sessionId,
      room: createRoomObject({
        room_id: "room-runtime-interact-shrine-001",
        room_type: "empty",
        objects: [
          {
            object_id: "obj-shrine-runtime-001",
            object_type: "shrine",
            metadata: {
              blessing_key: "shrine:moon_guard"
            }
          }
        ]
      })
    });
    const setStartOut = sessionManager.setStartRoom({
      session_id: sessionId,
      room_id: "room-runtime-interact-shrine-001"
    });
    sessionPersistence.saveSession(setStartOut.payload.session);

    const event = mapInteractionOrThrow(createInteraction("interact", [
      { name: "object_id", value: "obj-shrine-runtime-001" },
      { name: "action", value: "use" },
      { name: "session_id", value: sessionId }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    const response = findResponse(out, "interact");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.interaction_effects[0].effect_type, "blessing_granted");
    assert.equal(response.payload.data.interaction_effects[0].blessing_key, "shrine:moon_guard");
  }, results);

  await runTest("end_to_end_interact_runtime_flow_reports_exploration_side_effects", async () => {
    const adapter = createInMemoryAdapter();
    const sessionPersistence = new SessionPersistenceBridge({ adapter });
    const sessionManager = new DungeonSessionManagerCore();
    const runtime = createReadCommandRuntime({
      sessionPersistence,
      sessionManager
    });
    const playerId = "player-runtime-interact-explore-001";
    const sessionId = "session-runtime-interact-explore-001";

    sessionManager.createSession({
      session_id: sessionId,
      dungeon_id: "dungeon-runtime-interact-explore-001",
      status: "active"
    });
    sessionManager.setParty({
      session_id: sessionId,
      party: {
        party_id: "party-runtime-interact-explore-001",
        leader_id: playerId,
        members: [{ player_id: playerId }]
      }
    });
    sessionManager.addRoomToSession({
      session_id: sessionId,
      room: createRoomObject({
        room_id: "room-runtime-interact-explore-001",
        room_type: "empty",
        objects: [
          {
            object_id: "obj-shrine-runtime-explore-001",
            object_type: "shrine",
            metadata: {
              blessing_key: "shrine:wayfinder",
              clear_movement_lock: true,
              reveal_room_ids: ["room-hidden-runtime-001"]
            }
          }
        ]
      })
    });
    const setStartOut = sessionManager.setStartRoom({
      session_id: sessionId,
      room_id: "room-runtime-interact-explore-001"
    });
    const liveSession = setStartOut.payload.session;
    liveSession.movement_locked = true;
    sessionManager.sessions.set(sessionId, liveSession);
    sessionPersistence.saveSession(liveSession);

    const event = mapInteractionOrThrow(createInteraction("interact", [
      { name: "object_id", value: "obj-shrine-runtime-explore-001" },
      { name: "action", value: "use" },
      { name: "session_id", value: sessionId }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    const response = findResponse(out, "interact");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.interaction_effects.some((entry) => entry.effect_type === "movement_lock_cleared"), true);
    assert.equal(response.payload.data.interaction_effects.some((entry) => entry.effect_type === "room_revealed" && entry.room_id === "room-hidden-runtime-001"), true);
  }, results);

  await runTest("end_to_end_attack_runtime_flow_through_combat_domain", async () => {
    const adapter = createInMemoryAdapter();
    const combatManager = new CombatManager();
    const combatPersistence = new CombatPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({ combatManager, combatPersistence });
    const playerId = "player-runtime-attack-001";
    const combatId = "combat-runtime-attack-001";
    createActiveCombat(combatManager, combatId, playerId, "enemy-runtime-attack-001");

    const event = mapInteractionOrThrow(createInteraction("attack", [
      { name: "target_id", value: "enemy-runtime-attack-001" },
      { name: "combat_id", value: combatId }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    assert.equal(out.ok, true);
    const response = findResponse(out, "attack");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.combat_id, combatId);
    assert.equal(response.payload.data.target_id, "enemy-runtime-attack-001");
    assert.equal(response.payload.data.damage_type, "bludgeoning");
    assert.equal(Boolean(response.payload.data.damage_result), true);
    assert.equal(response.payload.data.combat_summary.combat_id, combatId);
    assert.equal(Array.isArray(response.payload.data.combat_summary.participants), true);

    const snapshots = combatPersistence.listCombatSnapshots();
    assert.equal(snapshots.ok, true);
    assert.equal(snapshots.payload.snapshots.length >= 1, true);
  }, results);

  await runTest("end_to_end_cast_runtime_flow_through_combat_domain", async () => {
    const adapter = createInMemoryAdapter();
    const combatManager = new CombatManager();
    const combatPersistence = new CombatPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({ combatManager, combatPersistence });
    const playerId = "player-runtime-cast-001";
    const combatId = "combat-runtime-cast-001";
    createActiveCombat(combatManager, combatId, playerId, "enemy-runtime-cast-001");

    const combat = combatManager.getCombatById(combatId).payload.combat;
    const caster = combat.participants.find((entry) => entry.participant_id === playerId);
    caster.spellbook = {
      known_spell_ids: ["fire_bolt"]
    };
    caster.spellsave_dc = 13;
    caster.spell_attack_bonus = 5;
    combatManager.combats.set(combatId, combat);

    const event = mapInteractionOrThrow(createInteraction("cast", [
      { name: "spell_id", value: "fire_bolt" },
      { name: "target_id", value: "enemy-runtime-cast-001" },
      { name: "combat_id", value: combatId }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    assert.equal(out.ok, true);
    const response = findResponse(out, "cast");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.combat_id, combatId);
    assert.equal(response.payload.data.spell_id, "fire_bolt");
    assert.equal(response.payload.data.damage_type, "fire");
    assert.equal(response.payload.data.combat_summary.combat_id, combatId);
    assert.equal(Array.isArray(response.payload.data.combat_summary.participants), true);
    assert.equal(Array.isArray(response.payload.data.actor_spells), true);
    assert.equal(response.payload.data.actor_spells[0].spell_id, "fire_bolt");

    const snapshots = combatPersistence.listCombatSnapshots();
    assert.equal(snapshots.ok, true);
    assert.equal(snapshots.payload.snapshots.length >= 1, true);
  }, results);

  await runTest("combat_read_runtime_flow_resolves_active_combat_from_session", async () => {
    const adapter = createInMemoryAdapter();
    const sessionPersistence = new SessionPersistenceBridge({ adapter });
    const combatManager = new CombatManager();
    const combatPersistence = new CombatPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({
      sessionPersistence,
      combatManager,
      combatPersistence
    });
    const playerId = "player-runtime-combat-read-001";
    const combatId = "combat-runtime-read-001";
    createActiveCombat(combatManager, combatId, playerId, "enemy-runtime-read-001");
    const seededCombat = combatManager.getCombatById(combatId).payload.combat;
    seededCombat.participants[0].concentration = {
      is_concentrating: true,
      source_spell_id: "shield_of_faith",
      started_at_round: 1
    };
    seededCombat.conditions = [
      {
        condition_id: "condition-runtime-read-001",
        condition_type: "bless",
        target_actor_id: playerId
      }
    ];
    combatManager.combats.set(combatId, seededCombat);
    combatPersistence.saveCombatSnapshot({
      combat_state: combatManager.getCombatById(combatId).payload.combat
    });
    sessionPersistence.saveSession({
      session_id: "session-runtime-combat-read-001",
      dungeon_id: "dungeon-runtime-combat-read-001",
      status: "active",
      current_room_id: "room-runtime-combat-read-001",
      party: {
        leader_id: playerId,
        members: [{ player_id: playerId }]
      },
      active_combat_id: combatId,
      rooms: [
        createRoomObject({
          room_id: "room-runtime-combat-read-001",
          room_type: "encounter",
          exits: []
        })
      ]
    });

    const event = mapInteractionOrThrow(createInteraction("combat", [], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    assert.equal(out.ok, true);
    const response = findResponse(out, "combat");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.combat_id, combatId);
    assert.equal(response.payload.data.combat_summary.combat_id, combatId);
    assert.equal(Array.isArray(response.payload.data.combat_summary.participants), true);
    assert.equal(Array.isArray(response.payload.data.actor_spells), true);
    assert.equal(response.payload.data.actor_spells.length, 0);
    assert.deepEqual(response.payload.data.combat_summary.initiative_order, [playerId, "enemy-runtime-read-001"]);
    assert.equal(response.payload.data.combat_summary.turn_index, 0);
    const summaryHero = response.payload.data.combat_summary.participants.find((entry) => entry.participant_id === playerId);
    assert.equal(summaryHero.name, "Runtime Player");
    assert.equal(summaryHero.map_marker, "H1");
    assert.equal(summaryHero.condition_count, 1);
    assert.equal(summaryHero.concentration.is_concentrating, true);
    assert.equal(summaryHero.concentration.source_spell_id, "shield_of_faith");
  }, results);

  await runTest("duplicate_replay_cast_request_is_rejected_cleanly", async () => {
    const adapter = createInMemoryAdapter();
    const combatManager = new CombatManager();
    const combatPersistence = new CombatPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({ combatManager, combatPersistence });
    const playerId = "player-runtime-cast-duplicate-001";
    const combatId = "combat-runtime-cast-duplicate-001";
    createActiveCombat(combatManager, combatId, playerId, "enemy-runtime-cast-duplicate-001");

    const combat = combatManager.getCombatById(combatId).payload.combat;
    const caster = combat.participants.find((entry) => entry.participant_id === playerId);
    caster.spellbook = {
      known_spell_ids: ["fire_bolt"]
    };
    caster.spellsave_dc = 13;
    caster.spell_attack_bonus = 5;
    combatManager.combats.set(combatId, combat);

    const event = createEvent(EVENT_TYPES.PLAYER_CAST_SPELL, {
      spell_id: "fire_bolt",
      target_id: "enemy-runtime-cast-duplicate-001",
      request_id: "cast-replay-001"
    }, {
      source: "gateway.discord",
      target_system: "combat_system",
      player_id: playerId,
      combat_id: combatId
    });

    const first = await runtime.processGatewayReadCommandEvent(event);
    const second = await runtime.processGatewayReadCommandEvent(event);
    const firstResponse = findResponse(first, "cast");
    const secondResponse = findResponse(second, "cast");

    assert.equal(Boolean(firstResponse), true);
    assert.equal(Boolean(secondResponse), true);
    assert.equal(firstResponse.payload.ok, true);
    assert.equal(secondResponse.payload.ok, false);
    assert.equal(secondResponse.payload.error, "duplicate mutation request");
  }, results);

  await runTest("end_to_end_use_runtime_flow_through_combat_domain", async () => {
    const adapter = createInMemoryAdapter();
    const combatManager = new CombatManager();
    const combatPersistence = new CombatPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({
      combatManager,
      combatPersistence,
      inventoryPersistence
    });
    const playerId = "player-runtime-use-001";
    const combatId = "combat-runtime-use-001";
    const inventoryId = "inv-runtime-use-001";

    createActiveCombat(
      combatManager,
      combatId,
      playerId,
      "enemy-runtime-use-001",
      { x: 0, y: 0 },
      { x: 1, y: 0 }
    );

    inventoryPersistence.saveInventory(
      createInventoryRecord({
        inventory_id: inventoryId,
        owner_type: "player",
        owner_id: playerId,
        stackable_items: [
          {
            item_id: "item-runtime-heal-001",
            item_name: "Runtime Heal Potion",
            item_type: "consumable",
            quantity: 2,
            owner_player_id: playerId,
            metadata: {
              heal_amount: 5
            }
          }
        ]
      })
    );

    const event = mapInteractionOrThrow(createInteraction("use", [
      { name: "item_id", value: "item-runtime-heal-001" },
      { name: "combat_id", value: combatId }
    ], playerId));
    const out = await runtime.processGatewayReadCommandEvent(event);
    assert.equal(out.ok, true);
    const response = findResponse(out, "use");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.combat_id, combatId);
    assert.equal(response.payload.data.item_id, "item-runtime-heal-001");
    assert.equal(Array.isArray(response.payload.data.removed_conditions), true);

    const reloadedInventory = inventoryPersistence.listInventories();
    const playerInventory = reloadedInventory.payload.inventories.find((inventory) => {
      return String(inventory.owner_id || "") === playerId;
    });
    assert.equal(Boolean(playerInventory), true);
    assert.equal(playerInventory.stackable_items[0].quantity, 1);
  }, results);

  await runTest("end_to_end_use_runtime_flow_through_world_domain_without_combat_id", async () => {
    const adapter = createInMemoryAdapter();
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({
      inventoryPersistence,
      characterPersistence
    });
    const playerId = "player-runtime-world-use-001";
    const inventoryId = "inv-runtime-world-use-001";
    const characterId = "char-runtime-world-use-001";

    characterPersistence.saveCharacter(
      createCharacterRecord({
        character_id: characterId,
        player_id: playerId,
        name: "Runtime Use Hero",
        inventory_id: inventoryId,
        current_hitpoints: 4,
        hitpoint_max: 10,
        temporary_hitpoints: 1
      })
    );

    inventoryPersistence.saveInventory(
      createInventoryRecord({
        inventory_id: inventoryId,
        owner_type: "player",
        owner_id: playerId,
        stackable_items: [
          {
            item_id: "item-runtime-world-heal-001",
            item_name: "Runtime World Heal Potion",
            item_type: "consumable",
            quantity: 2,
            owner_player_id: playerId,
            metadata: {
              heal_amount: 5,
              temporary_hitpoints: 6
            }
          }
        ]
      })
    );

    const event = mapInteractionOrThrow(createInteraction("use", [
      { name: "item_id", value: "item-runtime-world-heal-001" }
    ], playerId));

    const out = await runtime.processGatewayReadCommandEvent(event);
    assert.equal(out.ok, true);
    const response = findResponse(out, "use");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.combat_id, null);
    assert.equal(response.payload.data.item_id, "item-runtime-world-heal-001");
    assert.equal(response.payload.data.hp_before, 4);
    assert.equal(response.payload.data.hp_after, 9);
    assert.equal(response.payload.data.temporary_hp_before, 1);
    assert.equal(response.payload.data.temporary_hp_after, 6);

    const listed = inventoryPersistence.listInventories();
    const playerInventory = listed.payload.inventories.find((inventory) => {
      return String(inventory.owner_id || "") === playerId;
    });
    assert.equal(Boolean(playerInventory), true);
    assert.equal(playerInventory.stackable_items[0].quantity, 1);

    const loadedCharacter = characterPersistence.loadCharacterById(characterId);
    assert.equal(loadedCharacter.ok, true);
    assert.equal(loadedCharacter.payload.character.current_hitpoints, 9);
    assert.equal(loadedCharacter.payload.character.temporary_hitpoints, 6);
  }, results);

  await runTest("player_dodge_request_is_processed_on_canonical_combat_path", async () => {
    const adapter = createInMemoryAdapter();
    const combatManager = new CombatManager();
    const combatPersistence = new CombatPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({ combatManager, combatPersistence });
    const playerId = "player-runtime-dodge-001";
    const combatId = "combat-runtime-dodge-001";
    createActiveCombat(combatManager, combatId, playerId, "enemy-runtime-dodge-001");

    const event = createEvent(EVENT_TYPES.PLAYER_DODGE, {
      command_name: "dodge",
      request_id: "dodge-request-001"
    }, {
      source: "gateway.discord",
      target_system: "combat_system",
      player_id: playerId,
      combat_id: combatId
    });

    const out = await runtime.processGatewayReadCommandEvent(event);
    const response = findResponse(out, "dodge");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.is_dodging, true);
    assert.equal(response.payload.data.combat_summary.combat_id, combatId);
  }, results);

  await runTest("invalid_state_rejections_for_active_action_commands", async () => {
    const adapter = createInMemoryAdapter();
    const runtime = createReadCommandRuntime({
      sessionPersistence: new SessionPersistenceBridge({ adapter }),
      sessionManager: new DungeonSessionManagerCore(),
      combatManager: new CombatManager(),
      combatPersistence: new CombatPersistenceBridge({ adapter }),
      inventoryPersistence: new InventoryPersistenceBridge({ adapter })
    });
    const playerId = "player-runtime-invalid-state-001";

    const noSessionMove = await runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(createInteraction("move", [
        { name: "direction", value: "north" },
        { name: "session_id", value: "session-missing-001" }
      ], playerId))
    );
    const moveResponse = findResponse(noSessionMove, "move");
    assert.equal(moveResponse.payload.ok, false);

    const noCombatAttack = await runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(createInteraction("attack", [
        { name: "target_id", value: "enemy-missing" },
        { name: "combat_id", value: "combat-missing-001" }
      ], playerId))
    );
    const attackResponse = findResponse(noCombatAttack, "attack");
    assert.equal(attackResponse.payload.ok, false);

    const noCombatUse = await runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(createInteraction("use", [
        { name: "item_id", value: "item-missing-001" },
        { name: "combat_id", value: "combat-missing-001" }
      ], playerId))
    );
    const useResponse = findResponse(noCombatUse, "use");
    assert.equal(useResponse.payload.ok, false);
  }, results);

  await runTest("unknown_target_system_returns_structured_gateway_validation_error_response", async () => {
    const runtime = createReadCommandRuntime();
    const event = createEvent(EVENT_TYPES.PLAYER_PROFILE_REQUESTED, {
      command_name: "profile"
    }, {
      source: "gateway.discord",
      target_system: "unknown_system",
      player_id: "player-runtime-unknown-target-001"
    });

    const out = await runtime.processGatewayReadCommandEvent(event);
    assert.equal(out.ok, true);
    const response = findResponse(out, "validation_error");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, false);
    assert.equal(response.payload.error, "event target_system is not supported by command intake");
  }, results);

  await runTest("structurally_valid_but_unhandled_event_returns_structured_gateway_routing_error_response", async () => {
    const runtime = createReadCommandRuntime();
    const event = createEvent(EVENT_TYPES.PLAYER_MOVE, {
      direction: "north"
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: "player-runtime-unhandled-001",
      session_id: "session-runtime-unhandled-001"
    });

    const out = await runtime.processGatewayReadCommandEvent(event);
    assert.equal(out.ok, true);
    const response = findResponse(out, "routing_error");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, false);
    assert.equal(response.payload.data.reason, "unhandled_event");
  }, results);

  await runTest("malformed_payload_failing_deeper_validation_returns_structured_failure_response", async () => {
    const adapter = createInMemoryAdapter();
    const characterPersistence = new CharacterPersistenceBridge({ adapter });
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const runtime = createReadCommandRuntime({ characterPersistence, inventoryPersistence });
    const playerId = "player-runtime-deep-validate-001";
    const inventoryId = "inv-runtime-deep-validate-001";

    characterPersistence.saveCharacter(
      createCharacterRecord({
        character_id: "char-runtime-deep-validate-001",
        player_id: playerId,
        name: "Deep Validate Hero",
        class: "fighter",
        race: "human",
        inventory_id: inventoryId
      })
    );
    inventoryPersistence.saveInventory(
      createInventoryRecord({
        inventory_id: inventoryId,
        owner_type: "player",
        owner_id: playerId,
        equipment_items: []
      })
    );

    const event = createEvent(EVENT_TYPES.PLAYER_EQUIP_REQUESTED, {
      command_name: "equip"
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: playerId
    });

    const out = await runtime.processGatewayReadCommandEvent(event);
    assert.equal(out.ok, true);
    const response = findResponse(out, "equip");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, false);
    assert.equal(response.payload.error, "item_id is required");
  }, results);

  await runTest("missing_event_version_returns_structured_validation_error_response", async () => {
    const runtime = createReadCommandRuntime();
    const event = createEvent(EVENT_TYPES.PLAYER_PROFILE_REQUESTED, {
      command_name: "profile"
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: "player-runtime-contract-missing-version-001"
    });
    delete event.event_version;

    const out = await runtime.processGatewayReadCommandEvent(event);
    assert.equal(out.ok, true);
    const response = findResponse(out, "validation_error");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, false);
    assert.equal(response.payload.error, "event is missing required field: event_version");
  }, results);

  await runTest("unsupported_event_version_returns_structured_validation_error_response", async () => {
    const runtime = createReadCommandRuntime();
    const event = createEvent(EVENT_TYPES.PLAYER_ATTACK, {
      target_id: "enemy-1"
    }, {
      source: "gateway.discord",
      target_system: "combat_system",
      player_id: "player-runtime-contract-version-001",
      combat_id: "combat-runtime-contract-version-001",
      event_version: 2
    });

    const out = await runtime.processGatewayReadCommandEvent(event);
    assert.equal(out.ok, true);
    const response = findResponse(out, "validation_error");
    assert.equal(Boolean(response), true);
    assert.equal(response.payload.ok, false);
    assert.equal(response.payload.error, "unsupported event_version: 2");
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
  runReadCommandRuntimeTests()
    .then(function done(summary) {
      console.log(JSON.stringify(summary, null, 2));
      if (!summary.ok) process.exitCode = 1;
    })
    .catch(function failed(error) {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  runReadCommandRuntimeTests
};


