"use strict";

const assert = require("assert");
const { grantLootToInventory } = require("../flow/grantLootToInventory");
const { createInMemoryAdapter } = require("../../../../database/src/adapters/inMemoryAdapter");
const { InventoryPersistenceBridge } = require("../../../../inventory-system/src/inventory.persistence");
const { CharacterPersistenceBridge } = require("../../character/character.persistence");
const { createInventoryRecord } = require("../../../../inventory-system/src/inventory.schema");
const { createCharacterRecord } = require("../../character/character.schema");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runGrantLootToInventoryTests() {
  const results = [];

  runTest("granting_loot_into_empty_inventory", () => {
    const inventory = { inventory_id: "inv-001", items: [] };
    const out = grantLootToInventory({
      inventory,
      loot_bundle: {
        drop_id: "drop-001",
        source_type: "encounter_clear",
        source_id: "enc-001",
        entries: [
          { item_id: "item-001", item_name: "Potion", quantity: 2, rarity: "common" }
        ]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "loot_granted_to_inventory");
    assert.equal(out.payload.inventory.items.length, 1);
    assert.equal(out.payload.inventory.items[0].quantity, 2);
  }, results);

  runTest("stacking_duplicate_items", () => {
    const inventory = {
      inventory_id: "inv-002",
      owner_player_id: "player-1",
      items: [
        { item_id: "item-coin", quantity: 5, owner_player_id: "player-1", stackable: true }
      ]
    };

    const out = grantLootToInventory({
      inventory,
      loot_bundle: {
        entries: [
          { item_id: "item-coin", quantity: 3, target_player_id: "player-1" }
        ]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.inventory.items.length, 1);
    assert.equal(out.payload.inventory.items[0].quantity, 8);
  }, results);

  runTest("preserving_separate_items_when_not_stackable", () => {
    const inventory = {
      inventory_id: "inv-003",
      owner_player_id: "player-1",
      items: [
        { item_id: "item-relic", quantity: 1, owner_player_id: "player-1", stackable: false }
      ]
    };

    const out = grantLootToInventory({
      inventory,
      loot_bundle: {
        entries: [
          { item_id: "item-relic", quantity: 1, stackable: false, target_player_id: "player-1" }
        ]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.inventory.items.length, 2);
  }, results);

  runTest("handling_missing_inventory_failure", () => {
    const out = grantLootToInventory({
      loot_bundle: {
        entries: [{ item_id: "item-001", quantity: 1 }]
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "loot_grant_failed");
    assert.equal(out.error, "inventory is required");
  }, results);

  runTest("malformed_reward_entries_fail_safely_without_mutation", () => {
    const inventory = {
      inventory_id: "inv-invalid-001",
      owner_id: "player-invalid-001",
      currency: { gold: 7, silver: 0, copper: 0 },
      stackable_items: [],
      equipment_items: [],
      quest_items: [],
      metadata: {}
    };

    const out = grantLootToInventory({
      inventory,
      reward_update: { gold: 25, xp: 100 },
      loot_bundle: {
        entries: [
          { item_id: "", quantity: 1 }
        ]
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "loot_grant_failed");
    assert.equal(out.error, "loot_bundle contains invalid entries");
    assert.equal(inventory.currency.gold, 7);
    assert.equal(inventory.stackable_items.length, 0);
    assert.equal(Array.isArray(out.payload.invalid_entries), true);
  }, results);

  runTest("granting_individually_targeted_loot_correctly", () => {
    const inventory = { inventory_id: "inv-004", items: [] };

    const out = grantLootToInventory({
      inventory,
      loot_bundle: {
        entries: [
          { item_id: "item-ring", quantity: 1, target_player_id: "player-99" }
        ]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.inventory.items[0].owner_player_id, "player-99");
    assert.equal(out.payload.granted_items[0].owner_player_id, "player-99");
  }, results);

  runTest("duplicate_reward_key_is_skipped_without_double_grant", () => {
    const inventory = {
      inventory_id: "inv-dup-001",
      owner_id: "player-dup-001",
      currency: { gold: 0, silver: 0, copper: 0 },
      stackable_items: [],
      equipment_items: [],
      quest_items: [],
      metadata: {}
    };

    const first = grantLootToInventory({
      inventory,
      grant_key: "reward-key-dup-001",
      loot_bundle: {
        entries: [{ item_id: "item-dup", quantity: 2 }]
      }
    });
    const second = grantLootToInventory({
      inventory,
      grant_key: "reward-key-dup-001",
      loot_bundle: {
        entries: [{ item_id: "item-dup", quantity: 2 }]
      }
    });

    assert.equal(first.ok, true);
    assert.equal(first.event_type, "loot_granted_to_inventory");
    assert.equal(second.ok, true);
    assert.equal(second.event_type, "loot_grant_skipped");
    assert.equal(inventory.stackable_items.length, 1);
    assert.equal(inventory.stackable_items[0].quantity, 2);
  }, results);

  runTest("reward_currency_and_xp_apply_once_with_persistence", () => {
    const adapter = createInMemoryAdapter();
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const characterPersistence = new CharacterPersistenceBridge({ adapter });

    inventoryPersistence.saveInventory(
      createInventoryRecord({
        inventory_id: "inv-reward-001",
        owner_type: "player",
        owner_id: "player-reward-001"
      })
    );
    characterPersistence.saveCharacter(
      createCharacterRecord({
        character_id: "char-reward-001",
        player_id: "player-reward-001",
        name: "Reward Hero",
        race: "human",
        class: "fighter",
        level: 1,
        xp: 0,
        inventory_id: "inv-reward-001"
      })
    );

    const inventoryService = {
      getInventory(inventoryId) {
        return inventoryPersistence.loadInventoryById(inventoryId);
      },
      saveInventory(inventory) {
        return inventoryPersistence.saveInventory(inventory);
      }
    };

    const first = grantLootToInventory({
      inventory_service: inventoryService,
      inventory_id: "inv-reward-001",
      owner_id: "player-reward-001",
      characterPersistence,
      reward_update: { gold: 25, xp: 300, reward_key: "reward-progression-001" },
      loot_bundle: {
        entries: [{ item_id: "item-reward-coin", quantity: 1 }]
      }
    });
    const second = grantLootToInventory({
      inventory_service: inventoryService,
      inventory_id: "inv-reward-001",
      owner_id: "player-reward-001",
      characterPersistence,
      reward_update: { gold: 25, xp: 300, reward_key: "reward-progression-001" },
      loot_bundle: {
        entries: [{ item_id: "item-reward-coin", quantity: 1 }]
      }
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.event_type, "loot_grant_skipped");

    const reloadedInventory = inventoryPersistence.loadInventoryById("inv-reward-001");
    assert.equal(reloadedInventory.ok, true);
    assert.equal(reloadedInventory.payload.inventory.currency.gold, 25);
    assert.equal(reloadedInventory.payload.inventory.stackable_items[0].quantity, 1);

    const reloadedCharacter = characterPersistence.loadCharacterById("char-reward-001");
    assert.equal(reloadedCharacter.ok, true);
    assert.equal(reloadedCharacter.payload.character.xp, 300);
    assert.equal(reloadedCharacter.payload.character.level, 2);
  }, results);

  runTest("xp_reward_without_resolvable_character_fails_safely", () => {
    const out = grantLootToInventory({
      inventory: {
        inventory_id: "inv-xp-fail-001",
        owner_id: "player-xp-fail-001",
        stackable_items: [],
        equipment_items: [],
        quest_items: [],
        currency: { gold: 0, silver: 0, copper: 0 },
        metadata: {}
      },
      reward_update: { xp: 100 },
      loot_bundle: {
        entries: [{ item_id: "item-any", quantity: 1 }]
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "loot_grant_failed");
    assert.equal(out.error, "xp reward target character could not be resolved");
  }, results);

  runTest("invalid_currency_and_xp_payloads_do_not_mutate_state", () => {
    const inventory = {
      inventory_id: "inv-invalid-progression-001",
      owner_id: "player-invalid-progression-001",
      currency: { gold: 2, silver: 0, copper: 0 },
      stackable_items: [],
      equipment_items: [],
      quest_items: [],
      metadata: {}
    };

    const out = grantLootToInventory({
      inventory,
      reward_update: { gold: "bad", xp: -50, reward_key: "invalid-progression-001" },
      loot_bundle: {
        entries: [{ item_id: "item-safe", quantity: 1 }]
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.inventory.currency.gold, 2);
    assert.equal(out.payload.metadata.reward_update.gold, undefined);
    assert.equal(out.payload.metadata.progression.reason, "xp_delta_not_provided");
    assert.equal(out.payload.metadata.progression.xp_delta, 0);
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
  const summary = runGrantLootToInventoryTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runGrantLootToInventoryTests
};
