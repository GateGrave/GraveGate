"use strict";

const assert = require("assert");
const {
  applyGeneratedLootToInventory,
  InventoryGrantAdapter,
  ProcessedLootGrantStore,
  LootDropManager
} = require("../index");
const { InMemoryInventoryStore, InMemoryItemStore } = require("../../../../database/src/world-storage");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createWorldStorage() {
  return {
    inventories: new InMemoryInventoryStore(),
    items: new InMemoryItemStore()
  };
}

function seedItemTypes(worldStorage) {
  worldStorage.items.saveItem({ item_id: "item-stack", item_type: "stackable", rarity: "common" });
  worldStorage.items.saveItem({ item_id: "item-sword", item_type: "equipment", rarity: "uncommon" });
  worldStorage.items.saveItem({ item_id: "item-potion", item_type: "consumable", rarity: "common" });
  worldStorage.items.saveItem({ item_id: "item-orb", item_type: "magical", rarity: "rare" });
  worldStorage.items.saveItem({ item_id: "item-unknown", item_type: "unidentified", rarity: "rare" });
}

function makeLootPayload(drops, overrides) {
  return {
    source_type: "enemy",
    source_id: "goblin",
    party_id: "party-001",
    player_id: "char-001",
    generated_from_event_id: "evt-loot-grant-001",
    loot_result: {
      all_drops: drops
    },
    ...(overrides || {})
  };
}

function runLootGrantIntegrationTests() {
  const results = [];

  runTest("stackable_item_grant_merges_correctly", () => {
    const worldStorage = createWorldStorage();
    seedItemTypes(worldStorage);
    worldStorage.inventories.saveInventory({
      inventory_id: "inv-001",
      owner_character_id: "char-001",
      item_entries: [
        {
          entry_id: "entry-existing",
          item_id: "item-stack",
          entry_type: "stackable",
          quantity: 2,
          rarity: "common",
          location: "backpack"
        }
      ]
    });

    const out = applyGeneratedLootToInventory({
      loot_payload: makeLootPayload([{ item_id: "item-stack", quantity: 3, rarity: "common" }]),
      inventory_id: "inv-001",
      owner_character_id: "char-001",
      worldStorage,
      lootDropManager: new LootDropManager()
    });

    const inv = worldStorage.inventories.loadInventory("inv-001");
    const entry = inv.item_entries.find((x) => x.item_id === "item-stack" && x.entry_type === "stackable");

    assert.equal(out.event_type, "loot_grant_success");
    assert.ok(entry);
    assert.equal(entry.quantity, 5);
  }, results);

  runTest("equipment_item_grant_inserts_correctly", () => {
    const worldStorage = createWorldStorage();
    seedItemTypes(worldStorage);

    applyGeneratedLootToInventory({
      loot_payload: makeLootPayload([{ item_id: "item-sword", quantity: 1, rarity: "uncommon" }]),
      inventory_id: "inv-002",
      owner_character_id: "char-001",
      worldStorage,
      lootDropManager: new LootDropManager()
    });

    const inv = worldStorage.inventories.loadInventory("inv-002");
    const entries = inv.item_entries.filter((x) => x.item_id === "item-sword" && x.entry_type === "equipment");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].quantity, 1);
  }, results);

  runTest("consumable_grant_works_correctly", () => {
    const worldStorage = createWorldStorage();
    seedItemTypes(worldStorage);

    applyGeneratedLootToInventory({
      loot_payload: makeLootPayload([{ item_id: "item-potion", quantity: 4, rarity: "common" }]),
      inventory_id: "inv-003",
      owner_character_id: "char-001",
      worldStorage,
      lootDropManager: new LootDropManager()
    });

    const inv = worldStorage.inventories.loadInventory("inv-003");
    const entry = inv.item_entries.find((x) => x.item_id === "item-potion" && x.entry_type === "consumable");
    assert.ok(entry);
    assert.equal(entry.quantity, 4);
  }, results);

  runTest("magical_unidentified_grant_works_correctly", () => {
    const worldStorage = createWorldStorage();
    seedItemTypes(worldStorage);

    applyGeneratedLootToInventory({
      loot_payload: makeLootPayload([
        { item_id: "item-orb", quantity: 1, rarity: "rare" },
        { item_id: "item-unknown", quantity: 1, rarity: "rare" }
      ]),
      inventory_id: "inv-004",
      owner_character_id: "char-001",
      worldStorage,
      lootDropManager: new LootDropManager()
    });

    const inv = worldStorage.inventories.loadInventory("inv-004");
    const magical = inv.item_entries.find((x) => x.item_id === "item-orb" && x.entry_type === "magical");
    const unidentified = inv.item_entries.find(
      (x) => x.item_id === "item-unknown" && x.entry_type === "unidentified"
    );
    assert.ok(magical);
    assert.ok(unidentified);
  }, results);

  runTest("failed_inventory_write_does_not_mark_loot_as_granted", () => {
    const worldStorage = createWorldStorage();
    seedItemTypes(worldStorage);
    const lootDropManager = new LootDropManager();

    const failingAdapter = new InventoryGrantAdapter({
      inventoryStore: worldStorage.inventories,
      itemStore: worldStorage.items
    });
    failingAdapter.addDropToInventory = () => {
      throw new Error("forced_inventory_write_failure");
    };

    const out = applyGeneratedLootToInventory({
      loot_payload: makeLootPayload([{ item_id: "item-stack", quantity: 1, rarity: "common" }]),
      inventory_id: "inv-005",
      owner_character_id: "char-001",
      worldStorage,
      inventoryAdapter: failingAdapter,
      lootDropManager
    });

    const drops = lootDropManager.listLootDropsBySource("enemy", "goblin");
    assert.equal(out.ok, false);
    assert.equal(out.event_type, "loot_grant_failed");
    assert.equal(drops.length, 1);
    assert.equal(drops[0].granted, false);
  }, results);

  runTest("partial_success_is_represented_correctly", () => {
    const worldStorage = createWorldStorage();
    seedItemTypes(worldStorage);
    const lootDropManager = new LootDropManager();

    const out = applyGeneratedLootToInventory({
      loot_payload: makeLootPayload([
        { item_id: "item-stack", quantity: 2, rarity: "common" },
        { item_id: null, quantity: 1, rarity: "common" }
      ]),
      inventory_id: "inv-006",
      owner_character_id: "char-001",
      worldStorage,
      lootDropManager
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "loot_grant_partial_success");
    assert.equal(out.payload.status, "partial_success");
    assert.equal(out.payload.totals.granted, 1);
    assert.equal(out.payload.totals.failed, 1);
  }, results);

  runTest("duplicate_grant_attempts_do_not_double_apply_unless_allowed", () => {
    const worldStorage = createWorldStorage();
    seedItemTypes(worldStorage);
    const lootDropManager = new LootDropManager();
    const dedupeStore = new ProcessedLootGrantStore();
    const payload = makeLootPayload([{ item_id: "item-stack", quantity: 3, rarity: "common" }], {
      generated_from_event_id: "evt-dupe-grant-001"
    });

    const first = applyGeneratedLootToInventory({
      loot_payload: payload,
      inventory_id: "inv-007",
      owner_character_id: "char-001",
      worldStorage,
      lootDropManager,
      processedGrantStore: dedupeStore
    });
    const second = applyGeneratedLootToInventory({
      loot_payload: payload,
      inventory_id: "inv-007",
      owner_character_id: "char-001",
      worldStorage,
      lootDropManager,
      processedGrantStore: dedupeStore
    });
    const thirdAllowed = applyGeneratedLootToInventory({
      loot_payload: payload,
      inventory_id: "inv-007",
      owner_character_id: "char-001",
      worldStorage,
      lootDropManager,
      processedGrantStore: dedupeStore,
      allow_duplicate_grants: true
    });

    const inv = worldStorage.inventories.loadInventory("inv-007");
    const entry = inv.item_entries.find((x) => x.item_id === "item-stack" && x.entry_type === "stackable");

    assert.equal(first.event_type, "loot_grant_success");
    assert.equal(second.event_type, "loot_grant_skipped");
    assert.equal(second.payload.reason, "duplicate_grant_attempt");
    assert.equal(thirdAllowed.event_type, "loot_grant_success");
    // first apply (3) + third apply (3) ; second skipped
    assert.equal(entry.quantity, 6);
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
  const summary = runLootGrantIntegrationTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runLootGrantIntegrationTests
};

