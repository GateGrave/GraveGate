"use strict";

const assert = require("assert");
const { InMemoryInventoryStore } = require("../../../../database/src/world-storage");
const {
  GuildManager,
  InMemoryGuildStore,
  GuildStorageManager,
  InMemoryGuildStorageStore,
  ProcessedGuildStorageWithdrawalStore,
  depositItemToGuildStorage,
  withdrawItemFromGuildStorage,
  listGuildStorageContents
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createContext() {
  const guildManager = new GuildManager({ store: new InMemoryGuildStore() });
  const guildStorageManager = new GuildStorageManager({ store: new InMemoryGuildStorageStore() });
  const inventoryStore = new InMemoryInventoryStore();
  const processedWithdrawalStore = new ProcessedGuildStorageWithdrawalStore();

  guildManager.createGuild({
    guild_id: "guild-001",
    guild_name: "Iron Wolves",
    guild_tag: "IWLF",
    leader_id: "player-001",
    officer_ids: ["player-002"],
    member_ids: ["player-001", "player-002", "player-003"],
    guild_level: 1,
    guild_xp: 0,
    guild_status: "active"
  });

  inventoryStore.saveInventory({
    inventory_id: "inv-player-001",
    owner_character_id: "player-001",
    item_entries: [{ entry_id: "e1", item_id: "item-herb", quantity: 5, entry_type: "stackable" }]
  });
  inventoryStore.saveInventory({
    inventory_id: "inv-player-002",
    owner_character_id: "player-002",
    item_entries: [{ entry_id: "e2", item_id: "item-herb", quantity: 1, entry_type: "stackable" }]
  });
  inventoryStore.saveInventory({
    inventory_id: "inv-player-003",
    owner_character_id: "player-003",
    item_entries: [{ entry_id: "e3", item_id: "item-herb", quantity: 1, entry_type: "stackable" }]
  });

  guildStorageManager.ensureGuildStorage("guild-001");

  return {
    guildManager,
    guildStorageManager,
    inventoryStore,
    processedWithdrawalStore
  };
}

function itemQtyFromInventory(inventory, itemId) {
  return (inventory.item_entries || [])
    .filter((x) => x.item_id === itemId)
    .reduce((sum, x) => sum + (Number.isFinite(x.quantity) ? x.quantity : 1), 0);
}

function itemQtyFromStorage(storageItems, itemId) {
  return (storageItems || [])
    .filter((x) => x.item_id === itemId)
    .reduce((sum, x) => sum + (Number.isFinite(x.quantity) ? x.quantity : 0), 0);
}

function runGuildSharedStorageTests() {
  const results = [];

  runTest("successful_deposit", () => {
    const ctx = createContext();
    const out = depositItemToGuildStorage({
      ...ctx,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      inventory_id: "inv-player-001",
      item_id: "item-herb",
      quantity: 2
    });

    assert.equal(out.ok, true);
    const inv = ctx.inventoryStore.loadInventory("inv-player-001");
    const storage = ctx.guildStorageManager.getGuildStorage("guild-001");
    assert.equal(itemQtyFromInventory(inv, "item-herb"), 3);
    assert.equal(itemQtyFromStorage(storage.storage_items, "item-herb"), 2);
  }, results);

  runTest("successful_withdrawal", () => {
    const ctx = createContext();
    depositItemToGuildStorage({
      ...ctx,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      inventory_id: "inv-player-001",
      item_id: "item-herb",
      quantity: 2
    });

    const out = withdrawItemFromGuildStorage({
      ...ctx,
      guild_id: "guild-001",
      acting_player_id: "player-002",
      inventory_id: "inv-player-002",
      item_id: "item-herb",
      quantity: 1,
      processedWithdrawalStore: ctx.processedWithdrawalStore,
      withdrawal_key: "w-success-001"
    });

    assert.equal(out.ok, true);
    const inv = ctx.inventoryStore.loadInventory("inv-player-002");
    const storage = ctx.guildStorageManager.getGuildStorage("guild-001");
    assert.equal(itemQtyFromInventory(inv, "item-herb"), 2);
    assert.equal(itemQtyFromStorage(storage.storage_items, "item-herb"), 1);
  }, results);

  runTest("insufficient_quantity_deposit_rejection", () => {
    const ctx = createContext();
    const out = depositItemToGuildStorage({
      ...ctx,
      guild_id: "guild-001",
      acting_player_id: "player-002",
      inventory_id: "inv-player-002",
      item_id: "item-herb",
      quantity: 10
    });
    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "insufficient_quantity_in_inventory");
  }, results);

  runTest("insufficient_quantity_withdrawal_rejection", () => {
    const ctx = createContext();
    depositItemToGuildStorage({
      ...ctx,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      inventory_id: "inv-player-001",
      item_id: "item-herb",
      quantity: 1
    });

    const out = withdrawItemFromGuildStorage({
      ...ctx,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      inventory_id: "inv-player-001",
      item_id: "item-herb",
      quantity: 99,
      processedWithdrawalStore: ctx.processedWithdrawalStore,
      withdrawal_key: "w-insufficient-001"
    });
    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "insufficient_quantity_in_storage");
  }, results);

  runTest("invalid_permission_rejection", () => {
    const ctx = createContext();
    depositItemToGuildStorage({
      ...ctx,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      inventory_id: "inv-player-001",
      item_id: "item-herb",
      quantity: 2
    });

    const out = withdrawItemFromGuildStorage({
      ...ctx,
      guild_id: "guild-001",
      acting_player_id: "player-003",
      inventory_id: "inv-player-003",
      item_id: "item-herb",
      quantity: 1,
      processedWithdrawalStore: ctx.processedWithdrawalStore,
      withdrawal_key: "w-permission-001"
    });
    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "insufficient_permissions");
  }, results);

  runTest("duplicate_withdrawal_prevention", () => {
    const ctx = createContext();
    depositItemToGuildStorage({
      ...ctx,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      inventory_id: "inv-player-001",
      item_id: "item-herb",
      quantity: 3
    });

    const first = withdrawItemFromGuildStorage({
      ...ctx,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      inventory_id: "inv-player-001",
      item_id: "item-herb",
      quantity: 1,
      processedWithdrawalStore: ctx.processedWithdrawalStore,
      withdrawal_key: "w-dupe-001"
    });
    const second = withdrawItemFromGuildStorage({
      ...ctx,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      inventory_id: "inv-player-001",
      item_id: "item-herb",
      quantity: 1,
      processedWithdrawalStore: ctx.processedWithdrawalStore,
      withdrawal_key: "w-dupe-001"
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.event_type, "guild_storage_withdraw_skipped");
  }, results);

  runTest("failed_deposit_does_not_remove_item_incorrectly", () => {
    const ctx = createContext();
    const before = JSON.stringify(ctx.inventoryStore.loadInventory("inv-player-001"));

    const originalSave = ctx.guildStorageManager.saveGuildStorage.bind(ctx.guildStorageManager);
    ctx.guildStorageManager.saveGuildStorage = () => {
      throw new Error("forced_storage_write_failure");
    };

    const out = depositItemToGuildStorage({
      ...ctx,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      inventory_id: "inv-player-001",
      item_id: "item-herb",
      quantity: 2
    });
    const after = JSON.stringify(ctx.inventoryStore.loadInventory("inv-player-001"));
    ctx.guildStorageManager.saveGuildStorage = originalSave;

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "storage_write_failed");
    assert.equal(after, before);
  }, results);

  runTest("failed_withdrawal_does_not_duplicate_item", () => {
    const ctx = createContext();
    depositItemToGuildStorage({
      ...ctx,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      inventory_id: "inv-player-001",
      item_id: "item-herb",
      quantity: 2
    });

    const originalSaveInventory = ctx.inventoryStore.saveInventory.bind(ctx.inventoryStore);
    ctx.inventoryStore.saveInventory = (inventory) => {
      throw new Error("forced_inventory_write_failure");
    };

    const beforeStorage = JSON.stringify(ctx.guildStorageManager.getGuildStorage("guild-001"));
    const out = withdrawItemFromGuildStorage({
      ...ctx,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      inventory_id: "inv-player-001",
      item_id: "item-herb",
      quantity: 1,
      processedWithdrawalStore: ctx.processedWithdrawalStore,
      withdrawal_key: "w-rollback-001"
    });
    const afterStorage = JSON.stringify(ctx.guildStorageManager.getGuildStorage("guild-001"));
    ctx.inventoryStore.saveInventory = originalSaveInventory;

    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "inventory_write_failed");
    assert.equal(afterStorage, beforeStorage);
  }, results);

  runTest("storage_listing_correctness", () => {
    const ctx = createContext();
    depositItemToGuildStorage({
      ...ctx,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      inventory_id: "inv-player-001",
      item_id: "item-herb",
      quantity: 2
    });

    const out = listGuildStorageContents({
      ...ctx,
      guild_id: "guild-001",
      acting_player_id: "player-002"
    });
    assert.equal(out.ok, true);
    assert.equal(Array.isArray(out.payload.storage_items), true);
    assert.equal(itemQtyFromStorage(out.payload.storage_items, "item-herb"), 2);
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
  const summary = runGuildSharedStorageTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runGuildSharedStorageTests
};
