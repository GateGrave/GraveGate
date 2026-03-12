"use strict";

const assert = require("assert");
const { AccountService } = require("../account.service");
const { AccountManager, InMemoryAccountStore } = require("../account.manager");
const { CharacterService } = require("../../character/character.service");
const { CharacterManager, InMemoryCharacterStore } = require("../../character/character.manager");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createAccountService() {
  return new AccountService({
    manager: new AccountManager({
      store: new InMemoryAccountStore()
    })
  });
}

function createCharacterService() {
  return new CharacterService({
    manager: new CharacterManager({
      store: new InMemoryCharacterStore()
    })
  });
}

function runAccountOwnershipFoundationTests() {
  const results = [];

  runTest("create_account_for_discord_user", () => {
    const service = createAccountService();
    const out = service.createAccount({
      account_id: "account-foundation-001",
      discord_user_id: "discord-user-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "account_service_created");
    assert.equal(out.payload.account.account_id, "account-foundation-001");
    assert.equal(out.payload.account.discord_user_id, "discord-user-001");
  }, results);

  runTest("find_existing_account_by_discord_user_id", () => {
    const service = createAccountService();
    service.createAccount({
      account_id: "account-foundation-002",
      discord_user_id: "discord-user-002"
    });

    const out = service.getAccountByDiscordUserId("discord-user-002");
    assert.equal(out.ok, true);
    assert.equal(out.payload.account.account_id, "account-foundation-002");
  }, results);

  runTest("find_or_create_returns_same_account_on_repeated_calls", () => {
    const service = createAccountService();

    const first = service.findOrCreateAccountByDiscordUserId({
      discord_user_id: "discord-user-003"
    });
    const second = service.findOrCreateAccountByDiscordUserId({
      discord_user_id: "discord-user-003"
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.payload.account.account_id, second.payload.account.account_id);
    assert.equal(first.payload.created, true);
    assert.equal(second.payload.created, false);
  }, results);

  runTest("character_can_be_created_under_account_id", () => {
    const accountService = createAccountService();
    const characterService = createCharacterService();

    const accountOut = accountService.findOrCreateAccountByDiscordUserId({
      discord_user_id: "discord-user-004"
    });

    const created = characterService.createCharacter({
      character_id: "char-foundation-001",
      account_id: accountOut.payload.account.account_id,
      player_id: "discord-user-004",
      name: "Account Hero"
    });

    assert.equal(created.ok, true);
    assert.equal(created.payload.character.account_id, accountOut.payload.account.account_id);
  }, results);

  runTest("multiple_characters_can_exist_under_one_account", () => {
    const accountService = createAccountService();
    const characterService = createCharacterService();

    const accountOut = accountService.findOrCreateAccountByDiscordUserId({
      discord_user_id: "discord-user-005"
    });
    const accountId = accountOut.payload.account.account_id;

    characterService.createCharacter({
      character_id: "char-foundation-002",
      account_id: accountId,
      player_id: "discord-user-005",
      name: "Multi One"
    });
    characterService.createCharacter({
      character_id: "char-foundation-003",
      account_id: accountId,
      player_id: "discord-user-005",
      name: "Multi Two"
    });

    const listed = characterService.listCharacters();
    assert.equal(listed.ok, true);

    const forAccount = listed.payload.characters.filter((character) => {
      return String(character.account_id || "") === String(accountId);
    });
    assert.equal(forAccount.length, 2);
  }, results);

  runTest("account_defaults_to_three_max_slots", () => {
    const service = createAccountService();
    const out = service.findOrCreateAccountByDiscordUserId({
      discord_user_id: "discord-user-006"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.account.max_character_slots, 3);
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
  const summary = runAccountOwnershipFoundationTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runAccountOwnershipFoundationTests
};
