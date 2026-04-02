"use strict";

const assert = require("assert");
const { resolveActiveCharacterForPlayer } = require("../resolveActiveCharacter");
const { processPlayerActiveCharacterRequest } = require("../processPlayerActiveCharacterRequest");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createCharacterListContext(options) {
  const cfg = options || {};
  const characters = Array.isArray(cfg.characters) ? cfg.characters : [];
  const account = cfg.account || null;
  const accountLookupError = cfg.account_lookup_error || null;

  return {
    characterPersistence: {
      listCharacters() {
        return {
          ok: true,
          payload: {
            characters: JSON.parse(JSON.stringify(characters))
          }
        };
      }
    },
    accountService: cfg.include_account_service === false
      ? null
      : {
        getAccountByDiscordUserId(discordUserId) {
          if (accountLookupError) {
            return { ok: false, error: accountLookupError };
          }
          if (!account || String(account.discord_user_id || "") !== String(discordUserId || "")) {
            return { ok: false, error: "account not found" };
          }
          return {
            ok: true,
            payload: {
              account: JSON.parse(JSON.stringify(account))
            }
          };
        }
      }
  };
}

function runActiveCharacterPlayerStateTests() {
  const results = [];

  runTest("resolve_active_character_prefers_account_active_character", () => {
    const context = createCharacterListContext({
      account: {
        account_id: "account-active-001",
        discord_user_id: "player-active-001",
        active_character_id: "char-active-002"
      },
      characters: [
        {
          character_id: "char-active-001",
          account_id: "account-active-001",
          player_id: "player-active-001",
          name: "Inactive Hero"
        },
        {
          character_id: "char-active-002",
          account_id: "account-active-001",
          player_id: "player-active-001",
          name: "Active Hero"
        }
      ]
    });

    const out = resolveActiveCharacterForPlayer(context, "player-active-001");

    assert.equal(out.ok, true);
    assert.equal(out.payload.resolution, "account_active_character");
    assert.equal(out.payload.character.character_id, "char-active-002");
    assert.equal(out.payload.character.name, "Active Hero");
  }, results);

  runTest("resolve_active_character_falls_back_to_first_owned_character_when_active_character_missing", () => {
    const context = createCharacterListContext({
      account: {
        account_id: "account-active-002",
        discord_user_id: "player-active-002",
        active_character_id: "char-missing-999"
      },
      characters: [
        {
          character_id: "char-owned-001",
          account_id: "account-active-002",
          player_id: "player-active-002",
          name: "Owned Hero"
        },
        {
          character_id: "char-other-001",
          account_id: "account-other-002",
          player_id: "player-other-002",
          name: "Other Hero"
        }
      ]
    });

    const out = resolveActiveCharacterForPlayer(context, "player-active-002");

    assert.equal(out.ok, true);
    assert.equal(out.payload.resolution, "account_owned_fallback");
    assert.equal(out.payload.character.character_id, "char-owned-001");
  }, results);

  runTest("resolve_active_character_falls_back_to_player_id_when_account_lookup_is_unavailable", () => {
    const context = createCharacterListContext({
      include_account_service: false,
      characters: [
        {
          character_id: "char-player-fallback-001",
          player_id: "player-fallback-001",
          name: "Fallback Hero"
        }
      ]
    });

    const out = resolveActiveCharacterForPlayer(context, "player-fallback-001");

    assert.equal(out.ok, true);
    assert.equal(out.payload.resolution, "player_id_fallback");
    assert.equal(out.payload.character.character_id, "char-player-fallback-001");
  }, results);

  runTest("process_player_active_character_request_sets_owned_character_on_account", () => {
    let setActiveCall = null;
    const context = {
      accountService: {
        findOrCreateAccountByDiscordUserId({ discord_user_id }) {
          return {
            ok: true,
            payload: {
              account: {
                account_id: "account-switch-001",
                discord_user_id
              },
              created: false
            }
          };
        },
        setActiveCharacter(accountId, characterId) {
          setActiveCall = { accountId, characterId };
          return {
            ok: true,
            payload: {
              account: {
                account_id: accountId,
                discord_user_id: "player-switch-001",
                active_character_id: characterId
              },
              active_character_id: characterId
            }
          };
        }
      }
    };

    const out = processPlayerActiveCharacterRequest({
      context,
      player_id: "player-switch-001",
      character_id: "char-switch-002"
    });

    assert.equal(out.ok, true);
    assert.deepEqual(setActiveCall, {
      accountId: "account-switch-001",
      characterId: "char-switch-002"
    });
    assert.equal(out.payload.active_character_id, "char-switch-002");
    assert.equal(out.payload.account.active_character_id, "char-switch-002");
  }, results);

  runTest("process_player_active_character_request_returns_structured_failure_when_account_rejects_character", () => {
    const context = {
      accountService: {
        findOrCreateAccountByDiscordUserId() {
          return {
            ok: true,
            payload: {
              account: {
                account_id: "account-switch-002",
                discord_user_id: "player-switch-002"
              },
              created: false
            }
          };
        },
        setActiveCharacter() {
          return {
            ok: false,
            error: "character is not owned by account"
          };
        }
      }
    };

    const out = processPlayerActiveCharacterRequest({
      context,
      player_id: "player-switch-002",
      character_id: "char-other-999"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "player_set_active_character_failed");
    assert.equal(out.error, "character is not owned by account");
    assert.equal(out.payload.account_id, "account-switch-002");
    assert.equal(out.payload.character_id, "char-other-999");
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
  const summary = runActiveCharacterPlayerStateTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runActiveCharacterPlayerStateTests
};
