"use strict";

function success(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {},
    error: null
  };
}

function failure(eventType, message, payload) {
  return {
    ok: false,
    event_type: eventType,
    payload: payload || {},
    error: message
  };
}

function processPlayerActiveCharacterRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const playerId = String(data.player_id || "").trim();
  const characterId = String(data.character_id || "").trim();

  if (!playerId) {
    return failure("player_set_active_character_failed", "player_id is required");
  }
  if (!characterId) {
    return failure("player_set_active_character_failed", "character_id is required");
  }
  if (!context.accountService || typeof context.accountService.findOrCreateAccountByDiscordUserId !== "function") {
    return failure("player_set_active_character_failed", "accountService is required");
  }
  if (typeof context.accountService.setActiveCharacter !== "function") {
    return failure("player_set_active_character_failed", "accountService.setActiveCharacter is required");
  }

  const accountOut = context.accountService.findOrCreateAccountByDiscordUserId({
    discord_user_id: playerId
  });
  if (!accountOut.ok) {
    return failure("player_set_active_character_failed", accountOut.error || "failed to resolve account", {
      player_id: playerId
    });
  }

  const account = accountOut.payload.account || {};
  const setOut = context.accountService.setActiveCharacter(String(account.account_id || ""), characterId);
  if (!setOut.ok) {
    return failure("player_set_active_character_failed", setOut.error || "failed to set active character", {
      account_id: String(account.account_id || ""),
      character_id: characterId
    });
  }

  return success("player_set_active_character_succeeded", {
    account: setOut.payload.account || account,
    active_character_id: String(setOut.payload.active_character_id || characterId)
  });
}

module.exports = {
  processPlayerActiveCharacterRequest
};
