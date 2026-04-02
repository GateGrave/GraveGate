"use strict";

const assert = require("assert");
const { createInMemoryAdapter } = require("../../../../database/src/adapters/inMemoryAdapter");
const { AccountPersistenceBridge } = require("../../account/account.persistence");
const { AccountService } = require("../../account/account.service");
const { CharacterPersistenceBridge } = require("../character.persistence");
const { InventoryPersistenceBridge } = require("../../../../inventory-system/src/inventory.persistence");
const { bootstrapPlayerStart } = require("../flow/bootstrapPlayerStart");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createBootstrapContext() {
  const adapter = createInMemoryAdapter();
  const accountPersistence = new AccountPersistenceBridge({ adapter });
  const characterPersistence = new CharacterPersistenceBridge({ adapter });
  const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
  const accountService = new AccountService({
    accountPersistence,
    characterPersistence
  });

  return {
    adapter,
    context: {
      accountPersistence,
      accountService,
      characterPersistence,
      inventoryPersistence
    },
    accountPersistence,
    characterPersistence,
    inventoryPersistence,
    accountService
  };
}

function loadCharacterOrThrow(characterPersistence, characterId) {
  const loaded = characterPersistence.loadCharacterById(characterId);
  if (!loaded.ok) {
    throw new Error(loaded.error || "failed to load character");
  }
  return loaded.payload.character;
}

function loadAccountOrThrow(accountService, playerId) {
  const loaded = accountService.getAccountByDiscordUserId(playerId);
  if (!loaded.ok) {
    throw new Error(loaded.error || "failed to load account");
  }
  return loaded.payload.account;
}

function runBootstrapPlayerStartTests() {
  const results = [];

  runTest("bootstrap_start_creates_unique_inventory_and_sets_latest_character_active", () => {
    const setup = createBootstrapContext();

    const first = bootstrapPlayerStart({
      player_id: "player-bootstrap-001",
      requested_character_name: "First Hero",
      context: setup.context
    });
    const second = bootstrapPlayerStart({
      player_id: "player-bootstrap-001",
      requested_character_name: "Second Hero",
      context: setup.context
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.payload.active_character_set, true);
    assert.equal(second.payload.active_character_set, true);
    assert.equal(first.payload.slot_status.used_slots, 1);
    assert.equal(first.payload.slot_status.remaining_slots, 2);
    assert.equal(second.payload.slot_status.used_slots, 2);
    assert.equal(second.payload.slot_status.remaining_slots, 1);
    assert.notEqual(first.payload.character.character_id, second.payload.character.character_id);
    assert.notEqual(first.payload.inventory.inventory_id, second.payload.inventory.inventory_id);
    assert.equal(first.payload.character.inventory_id, first.payload.inventory.inventory_id);
    assert.equal(second.payload.character.inventory_id, second.payload.inventory.inventory_id);

    const account = loadAccountOrThrow(setup.accountService, "player-bootstrap-001");
    assert.equal(account.active_character_id, second.payload.character.character_id);
  }, results);

  runTest("bootstrap_start_applies_complete_selection_set_and_persists_background_truth", () => {
    const setup = createBootstrapContext();

    const out = bootstrapPlayerStart({
      player_id: "player-bootstrap-002",
      requested_character_name: "Configured Hero",
      race_id: "human",
      background_id: "soldier",
      class_id: "fighter",
      secondary_class_id: "rogue",
      stats: {
        strength: 15,
        dexterity: 14,
        constitution: 13,
        intelligence: 12,
        wisdom: 10,
        charisma: 8
      },
      context: setup.context
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.point_buy_summary.total_cost, 27);
    assert.equal(out.payload.slot_status.used_slots, 1);
    assert.equal(out.payload.slot_status.remaining_slots, 2);
    assert.equal(out.payload.slot_status.max_character_slots, 3);
    assert.equal(out.payload.character.background_id, "soldier");
    assert.equal(out.payload.character.background, "soldier");
    assert.equal(out.payload.character.race_id, "human");
    assert.equal(out.payload.character.class_id, "fighter");
    assert.equal(out.payload.character.gestalt_progression.track_b_class_key, "rogue");
    assert.equal(out.payload.character.metadata.start_configuration.background_id, "soldier");
    assert.equal(out.payload.character.metadata.start_configuration.secondary_class_id, "rogue");

    const reloaded = loadCharacterOrThrow(setup.characterPersistence, out.payload.character.character_id);
    assert.equal(reloaded.background_id, "soldier");
    assert.equal(reloaded.metadata.start_configuration.background_id, "soldier");

    const account = loadAccountOrThrow(setup.accountService, "player-bootstrap-002");
    assert.equal(account.active_character_id, out.payload.character.character_id);
  }, results);

  runTest("bootstrap_start_rejects_partial_selection_sets_without_background", () => {
    const setup = createBootstrapContext();

    const out = bootstrapPlayerStart({
      player_id: "player-bootstrap-003",
      requested_character_name: "Broken Hero",
      race_id: "human",
      class_id: "fighter",
      secondary_class_id: "rogue",
      context: setup.context
    });

    assert.equal(out.ok, false);
    assert.equal(
      out.error,
      "race_id, background_id, class_id, and secondary_class_id are required together when applying start selections"
    );
  }, results);

  runTest("bootstrap_start_respects_account_slot_cap_on_fourth_character", () => {
    const setup = createBootstrapContext();

    const first = bootstrapPlayerStart({
      player_id: "player-bootstrap-slotcap-001",
      requested_character_name: "Hero One",
      context: setup.context
    });
    const second = bootstrapPlayerStart({
      player_id: "player-bootstrap-slotcap-001",
      requested_character_name: "Hero Two",
      context: setup.context
    });
    const third = bootstrapPlayerStart({
      player_id: "player-bootstrap-slotcap-001",
      requested_character_name: "Hero Three",
      context: setup.context
    });
    const fourth = bootstrapPlayerStart({
      player_id: "player-bootstrap-slotcap-001",
      requested_character_name: "Hero Four",
      context: setup.context
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(third.ok, true);
    assert.equal(fourth.ok, false);
    assert.equal(fourth.error, "character slot limit reached");
    assert.equal(third.payload.slot_status.used_slots, 3);
    assert.equal(third.payload.slot_status.remaining_slots, 0);
    assert.equal(third.payload.slot_status.max_character_slots, 3);

    const account = loadAccountOrThrow(setup.accountService, "player-bootstrap-slotcap-001");
    assert.equal(account.active_character_id, third.payload.character.character_id);
  }, results);

  const passed = results.filter((entry) => entry.ok).length;
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
  const summary = runBootstrapPlayerStartTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runBootstrapPlayerStartTests
};
