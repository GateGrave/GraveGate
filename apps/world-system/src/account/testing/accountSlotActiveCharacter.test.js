"use strict";

const assert = require("assert");
const { createInMemoryAdapter } = require("../../../../database/src/adapters/inMemoryAdapter");
const { AccountService } = require("../account.service");
const { AccountPersistenceBridge } = require("../account.persistence");
const { createAccountRecord } = require("../account.schema");
const { CharacterPersistenceBridge } = require("../../character/character.persistence");
const { createCharacterRecord } = require("../../character/character.schema");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createContext() {
  const adapter = createInMemoryAdapter();
  const accountPersistence = new AccountPersistenceBridge({ adapter });
  const characterPersistence = new CharacterPersistenceBridge({ adapter });
  const accountService = new AccountService({
    accountPersistence,
    characterPersistence
  });

  return {
    adapter,
    accountPersistence,
    characterPersistence,
    accountService
  };
}

function seedAccount(ctx, accountId, discordUserId, maxSlots) {
  const account = createAccountRecord({
    account_id: accountId,
    discord_user_id: discordUserId,
    max_character_slots: maxSlots
  });
  const saved = ctx.accountPersistence.saveAccount(account);
  if (!saved.ok) {
    throw new Error(saved.error || "failed to seed account");
  }
  return saved.payload.account;
}

function seedCharacter(ctx, characterId, accountId, playerId) {
  const character = createCharacterRecord({
    character_id: characterId,
    account_id: accountId,
    player_id: playerId,
    name: "Hero-" + characterId,
    race: "human",
    class: "fighter"
  });

  const saved = ctx.characterPersistence.saveCharacter(character);
  if (!saved.ok) {
    throw new Error(saved.error || "failed to seed character");
  }

  return saved.payload.character;
}

function runAccountSlotActiveCharacterTests() {
  const results = [];

  runTest("account_with_0_1_2_3_characters_reports_correct_slot_availability", () => {
    const ctx = createContext();
    const account = seedAccount(ctx, "account-slot-001", "discord-slot-001", 3);

    let availability = ctx.accountService.hasFreeCharacterSlot(account.account_id);
    assert.equal(availability.ok, true);
    assert.equal(availability.payload.character_count, 0);
    assert.equal(availability.payload.has_free_slot, true);

    seedCharacter(ctx, "char-slot-001", account.account_id, "discord-slot-001");
    availability = ctx.accountService.hasFreeCharacterSlot(account.account_id);
    assert.equal(availability.ok, true);
    assert.equal(availability.payload.character_count, 1);
    assert.equal(availability.payload.has_free_slot, true);

    seedCharacter(ctx, "char-slot-002", account.account_id, "discord-slot-001");
    availability = ctx.accountService.hasFreeCharacterSlot(account.account_id);
    assert.equal(availability.ok, true);
    assert.equal(availability.payload.character_count, 2);
    assert.equal(availability.payload.has_free_slot, true);

    seedCharacter(ctx, "char-slot-003", account.account_id, "discord-slot-001");
    availability = ctx.accountService.hasFreeCharacterSlot(account.account_id);
    assert.equal(availability.ok, true);
    assert.equal(availability.payload.character_count, 3);
    assert.equal(availability.payload.has_free_slot, false);
  }, results);

  runTest("creating_first_character_auto_sets_active_character", () => {
    const ctx = createContext();
    const account = seedAccount(ctx, "account-slot-002", "discord-slot-002", 3);

    const created = seedCharacter(ctx, "char-slot-active-001", account.account_id, "discord-slot-002");

    const register = ctx.accountService.registerCharacterForAccount(account.account_id, created.character_id);
    assert.equal(register.ok, true);
    assert.equal(register.payload.auto_set_active, true);

    const active = ctx.accountService.getActiveCharacter(account.account_id);
    assert.equal(active.ok, true);
    assert.equal(active.payload.character.character_id, "char-slot-active-001");
  }, results);

  runTest("setting_active_character_works_for_owned_character", () => {
    const ctx = createContext();
    const account = seedAccount(ctx, "account-slot-003", "discord-slot-003", 3);

    const c1 = seedCharacter(ctx, "char-slot-owned-001", account.account_id, "discord-slot-003");
    const c2 = seedCharacter(ctx, "char-slot-owned-002", account.account_id, "discord-slot-003");

    ctx.accountService.registerCharacterForAccount(account.account_id, c1.character_id);
    const setActive = ctx.accountService.setActiveCharacter(account.account_id, c2.character_id);
    assert.equal(setActive.ok, true);

    const active = ctx.accountService.getActiveCharacter(account.account_id);
    assert.equal(active.ok, true);
    assert.equal(active.payload.character.character_id, c2.character_id);
  }, results);

  runTest("registering_second_character_does_not_replace_existing_active_character", () => {
    const ctx = createContext();
    const account = seedAccount(ctx, "account-slot-003b", "discord-slot-003b", 3);

    const first = seedCharacter(ctx, "char-slot-owned-010", account.account_id, "discord-slot-003b");
    const firstRegister = ctx.accountService.registerCharacterForAccount(account.account_id, first.character_id);
    const second = seedCharacter(ctx, "char-slot-owned-011", account.account_id, "discord-slot-003b");
    const secondRegister = ctx.accountService.registerCharacterForAccount(account.account_id, second.character_id);

    assert.equal(firstRegister.ok, true);
    assert.equal(firstRegister.payload.auto_set_active, true);
    assert.equal(secondRegister.ok, true);
    assert.equal(secondRegister.payload.auto_set_active, false);

    const active = ctx.accountService.getActiveCharacter(account.account_id);
    assert.equal(active.ok, true);
    assert.equal(active.payload.character.character_id, first.character_id);
  }, results);

  runTest("setting_active_character_fails_for_unowned_character", () => {
    const ctx = createContext();
    const ownedAccount = seedAccount(ctx, "account-slot-004", "discord-slot-004", 3);
    const otherAccount = seedAccount(ctx, "account-slot-005", "discord-slot-005", 3);

    const owned = seedCharacter(ctx, "char-slot-owned-003", ownedAccount.account_id, "discord-slot-004");
    const other = seedCharacter(ctx, "char-slot-other-001", otherAccount.account_id, "discord-slot-005");

    ctx.accountService.registerCharacterForAccount(ownedAccount.account_id, owned.character_id);
    const out = ctx.accountService.setActiveCharacter(ownedAccount.account_id, other.character_id);

    assert.equal(out.ok, false);
    assert.equal(out.error, "character is not owned by account");
  }, results);

  runTest("slot_limit_blocks_4th_character_when_max_is_3", () => {
    const ctx = createContext();
    const account = seedAccount(ctx, "account-slot-006", "discord-slot-006", 3);

    seedCharacter(ctx, "char-slot-limit-001", account.account_id, "discord-slot-006");
    seedCharacter(ctx, "char-slot-limit-002", account.account_id, "discord-slot-006");
    seedCharacter(ctx, "char-slot-limit-003", account.account_id, "discord-slot-006");

    const enforce = ctx.accountService.ensureCanCreateCharacter(account.account_id);
    assert.equal(enforce.ok, false);
    assert.equal(enforce.event_type, "account_service_slot_enforcement_failed");
    assert.equal(enforce.error, "character slot limit reached");
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
  const summary = runAccountSlotActiveCharacterTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runAccountSlotActiveCharacterTests
};
