"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

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

function loadCharacters(context) {
  if (context.characterPersistence && typeof context.characterPersistence.listCharacters === "function") {
    const listed = context.characterPersistence.listCharacters();
    if (!listed.ok) {
      return failure("active_character_resolution_failed", listed.error || "failed to list characters");
    }
    const persistenceCharacters = Array.isArray(listed.payload.characters) ? listed.payload.characters : [];
    return success("active_character_characters_loaded", {
      characters: clone(persistenceCharacters)
    });
  }

  if (context.characterRepository && typeof context.characterRepository.listStoredCharacters === "function") {
    const listed = context.characterRepository.listStoredCharacters();
    if (!listed.ok) {
      return failure("active_character_resolution_failed", listed.error || "failed to list characters");
    }
    return success("active_character_characters_loaded", {
      characters: Array.isArray(listed.payload.characters) ? clone(listed.payload.characters) : []
    });
  }

  return failure("active_character_resolution_failed", "character persistence/repository is not available");
}

function isCharacterOwnedByAccount(character, account) {
  if (!character || !account) {
    return false;
  }
  if (String(character.account_id || "") === String(account.account_id || "")) {
    return true;
  }
  return !character.account_id && String(character.player_id || "") === String(account.discord_user_id || "");
}

function resolveActiveCharacterForPlayer(context, playerId) {
  const safePlayerId = String(playerId || "").trim();
  if (!safePlayerId) {
    return failure("active_character_resolution_failed", "player_id is required");
  }

  const listed = loadCharacters(context || {});
  if (!listed.ok) {
    return listed;
  }

  const characters = Array.isArray(listed.payload.characters) ? listed.payload.characters : [];
  const fallbackCharacter = characters.find((entry) => String(entry.player_id || "") === safePlayerId) || null;
  const accountService = context && context.accountService;

  if (!accountService || typeof accountService.getAccountByDiscordUserId !== "function") {
    return success("active_character_resolved", {
      character: clone(fallbackCharacter),
      account: null,
      resolution: fallbackCharacter ? "player_id_fallback" : "not_found"
    });
  }

  const accountOut = accountService.getAccountByDiscordUserId(safePlayerId);
  if (!accountOut.ok) {
    return success("active_character_resolved", {
      character: clone(fallbackCharacter),
      account: null,
      resolution: fallbackCharacter ? "player_id_fallback" : "not_found"
    });
  }

  const account = accountOut.payload.account || null;
  const ownedCharacters = characters.filter((entry) => isCharacterOwnedByAccount(entry, account));
  const activeCharacterId = account && account.active_character_id ? String(account.active_character_id) : "";
  const activeCharacter = activeCharacterId
    ? ownedCharacters.find((entry) => String(entry.character_id || "") === activeCharacterId) || null
    : null;

  if (activeCharacter) {
    return success("active_character_resolved", {
      character: clone(activeCharacter),
      account: clone(account),
      resolution: "account_active_character"
    });
  }

  if (ownedCharacters.length > 0) {
    return success("active_character_resolved", {
      character: clone(ownedCharacters[0]),
      account: clone(account),
      resolution: activeCharacterId ? "account_owned_fallback" : "account_first_character"
    });
  }

  return success("active_character_resolved", {
    character: clone(fallbackCharacter),
    account: clone(account),
    resolution: fallbackCharacter ? "player_id_fallback" : "not_found"
  });
}

module.exports = {
  resolveActiveCharacterForPlayer
};
