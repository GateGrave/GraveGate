"use strict";

const { AccountManager } = require("./account.manager");

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

class AccountService {
  constructor(options) {
    const cfg = options || {};
    this.manager = cfg.manager || new AccountManager({ store: cfg.store });
    this.accountPersistence = cfg.accountPersistence || null;
    this.characterPersistence = cfg.characterPersistence || null;
    this.characterRepository = cfg.characterRepository || null;
  }

  _listCharactersFromSource() {
    if (this.characterPersistence && typeof this.characterPersistence.listCharacters === "function") {
      const listed = this.characterPersistence.listCharacters();
      if (!listed.ok) {
        return failure("account_service_character_lookup_failed", listed.error || "failed to list characters", {
          source: "characterPersistence",
          persistence_result: listed
        });
      }

      return success("account_service_characters_listed", {
        source: "characterPersistence",
        characters: clone(Array.isArray(listed.payload.characters) ? listed.payload.characters : [])
      });
    }

    if (this.characterRepository && typeof this.characterRepository.listStoredCharacters === "function") {
      const listed = this.characterRepository.listStoredCharacters();
      if (!listed.ok) {
        return failure("account_service_character_lookup_failed", listed.error || "failed to list characters", {
          source: "characterRepository",
          repository_result: listed
        });
      }

      return success("account_service_characters_listed", {
        source: "characterRepository",
        characters: clone(Array.isArray(listed.payload.characters) ? listed.payload.characters : [])
      });
    }

    return failure(
      "account_service_character_lookup_failed",
      "characterPersistence/characterRepository is required for account character methods"
    );
  }

  _loadAccountByIdInternal(accountId) {
    if (this.accountPersistence && typeof this.accountPersistence.loadAccountById === "function") {
      return this.accountPersistence.loadAccountById(accountId);
    }
    return this.manager.getAccountById(accountId);
  }

  _saveAccountInternal(account) {
    if (this.accountPersistence && typeof this.accountPersistence.saveAccount === "function") {
      return this.accountPersistence.saveAccount(account);
    }
    if (!this.manager || !this.manager.store || typeof this.manager.store.saveAccount !== "function") {
      return failure("account_service_save_failed", "no account save path available");
    }
    const saved = this.manager.store.saveAccount(account);
    return success("account_saved", { account: saved });
  }

  _isCharacterOwnedByAccount(character, account) {
    if (!character || typeof character !== "object" || !account || typeof account !== "object") {
      return false;
    }

    if (String(character.account_id || "") === String(account.account_id || "")) {
      return true;
    }

    // Backward compatibility for older records created before account_id was introduced.
    return (
      !character.account_id &&
      String(character.player_id || "") !== "" &&
      String(character.player_id || "") === String(account.discord_user_id || "")
    );
  }

  createAccount(input) {
    const out = this.manager.createAccount(input);
    if (!out.ok) {
      return failure("account_service_create_failed", out.error, { manager_result: out });
    }

    return success("account_service_created", {
      account: clone(out.payload.account)
    });
  }

  getAccountById(accountId) {
    const out = this._loadAccountByIdInternal(accountId);
    if (!out.ok) {
      return failure("account_service_fetch_failed", out.error, { manager_result: out });
    }

    return success("account_service_found", {
      account: clone(out.payload.account)
    });
  }

  getAccountByDiscordUserId(discordUserId) {
    let out = null;
    if (
      this.accountPersistence &&
      typeof this.accountPersistence.loadAccountByDiscordUserId === "function"
    ) {
      out = this.accountPersistence.loadAccountByDiscordUserId(discordUserId);
    } else {
      out = this.manager.getAccountByDiscordUserId(discordUserId);
    }

    if (!out.ok) {
      return failure("account_service_fetch_failed", out.error, { manager_result: out });
    }

    return success("account_service_found", {
      account: clone(out.payload.account)
    });
  }

  listAccounts() {
    let out = null;
    if (this.accountPersistence && typeof this.accountPersistence.listAccounts === "function") {
      out = this.accountPersistence.listAccounts();
    } else {
      out = this.manager.listAccounts();
    }

    if (!out.ok) {
      return failure("account_service_list_failed", out.error || "failed to list accounts", { manager_result: out });
    }

    return success("account_service_listed", {
      accounts: clone(out.payload.accounts)
    });
  }

  findOrCreateAccountByDiscordUserId(input) {
    let out = null;

    if (
      this.accountPersistence &&
      typeof this.accountPersistence.findOrCreateAccountByDiscordUserId === "function"
    ) {
      out = this.accountPersistence.findOrCreateAccountByDiscordUserId(input);
    } else {
      out = this.manager.findOrCreateAccountByDiscordUserId(input);
    }

    if (!out.ok) {
      return failure("account_service_find_or_create_failed", out.error, { manager_result: out });
    }

    return success("account_service_found_or_created", {
      account: clone(out.payload.account),
      created: Boolean(out.payload.created)
    });
  }

  listCharactersForAccount(accountId) {
    if (!accountId || String(accountId).trim() === "") {
      return failure("account_service_list_characters_failed", "account_id is required");
    }

    const accountOut = this._loadAccountByIdInternal(accountId);
    if (!accountOut.ok) {
      return failure("account_service_list_characters_failed", accountOut.error || "account not found", {
        account_result: accountOut
      });
    }

    const listed = this._listCharactersFromSource();
    if (!listed.ok) {
      return failure("account_service_list_characters_failed", listed.error, {
        source_result: listed
      });
    }

    const account = accountOut.payload.account;
    const ownedCharacters = listed.payload.characters.filter((character) =>
      this._isCharacterOwnedByAccount(character, account)
    );

    return success("account_service_characters_listed", {
      account: clone(account),
      characters: clone(ownedCharacters)
    });
  }

  countCharactersForAccount(accountId) {
    const listed = this.listCharactersForAccount(accountId);
    if (!listed.ok) {
      return failure("account_service_character_count_failed", listed.error, {
        list_result: listed
      });
    }

    return success("account_service_character_counted", {
      account: clone(listed.payload.account),
      character_count: listed.payload.characters.length
    });
  }

  hasFreeCharacterSlot(accountId) {
    const counted = this.countCharactersForAccount(accountId);
    if (!counted.ok) {
      return failure("account_service_slot_check_failed", counted.error, {
        count_result: counted
      });
    }

    const account = counted.payload.account;
    const characterCount = counted.payload.character_count;
    const maxSlots = Number.isFinite(account.max_character_slots) ? Number(account.max_character_slots) : 3;
    const hasFree = characterCount < maxSlots;

    return success("account_service_slot_checked", {
      account: clone(account),
      character_count: characterCount,
      max_character_slots: maxSlots,
      has_free_slot: hasFree
    });
  }

  ensureCanCreateCharacter(accountId) {
    const slotOut = this.hasFreeCharacterSlot(accountId);
    if (!slotOut.ok) {
      return failure("account_service_slot_enforcement_failed", slotOut.error, {
        slot_result: slotOut
      });
    }

    if (!slotOut.payload.has_free_slot) {
      return failure("account_service_slot_enforcement_failed", "character slot limit reached", {
        account_id: String(accountId),
        character_count: slotOut.payload.character_count,
        max_character_slots: slotOut.payload.max_character_slots
      });
    }

    return success("account_service_slot_enforced", {
      account: clone(slotOut.payload.account),
      character_count: slotOut.payload.character_count,
      max_character_slots: slotOut.payload.max_character_slots
    });
  }

  setActiveCharacter(accountId, characterId) {
    if (!accountId || String(accountId).trim() === "") {
      return failure("account_service_set_active_failed", "account_id is required");
    }
    if (!characterId || String(characterId).trim() === "") {
      return failure("account_service_set_active_failed", "character_id is required");
    }

    const listed = this.listCharactersForAccount(accountId);
    if (!listed.ok) {
      return failure("account_service_set_active_failed", listed.error, { list_result: listed });
    }

    const account = listed.payload.account;
    const owned = listed.payload.characters.find(
      (character) => String(character.character_id || "") === String(characterId)
    );
    if (!owned) {
      return failure(
        "account_service_set_active_failed",
        "character is not owned by account",
        {
          account_id: String(accountId),
          character_id: String(characterId)
        }
      );
    }

    const updated = Object.assign({}, account, {
      active_character_id: String(characterId),
      updated_at: new Date().toISOString()
    });

    const saved = this._saveAccountInternal(updated);
    if (!saved.ok) {
      return failure("account_service_set_active_failed", saved.error || "failed to save account", {
        save_result: saved
      });
    }

    return success("account_service_active_character_set", {
      account: clone(saved.payload.account || updated),
      active_character_id: String(characterId)
    });
  }

  getActiveCharacter(accountId) {
    if (!accountId || String(accountId).trim() === "") {
      return failure("account_service_get_active_failed", "account_id is required");
    }

    const listed = this.listCharactersForAccount(accountId);
    if (!listed.ok) {
      return failure("account_service_get_active_failed", listed.error, { list_result: listed });
    }

    const account = listed.payload.account;
    const activeId = account.active_character_id ? String(account.active_character_id) : null;
    if (!activeId) {
      return success("account_service_active_character_loaded", {
        account: clone(account),
        character: null
      });
    }

    const found = listed.payload.characters.find(
      (character) => String(character.character_id || "") === activeId
    );

    if (!found) {
      return failure("account_service_get_active_failed", "active character is not owned by account", {
        account_id: String(accountId),
        active_character_id: activeId
      });
    }

    return success("account_service_active_character_loaded", {
      account: clone(account),
      character: clone(found)
    });
  }

  registerCharacterForAccount(accountId, characterId) {
    const listed = this.listCharactersForAccount(accountId);
    if (!listed.ok) {
      return failure("account_service_register_character_failed", listed.error, {
        list_result: listed
      });
    }

    const account = listed.payload.account;
    const ownedCharacter = listed.payload.characters.find(
      (character) => String(character.character_id || "") === String(characterId || "")
    );
    if (!ownedCharacter) {
      return failure("account_service_register_character_failed", "character is not owned by account", {
        account_id: String(accountId),
        character_id: String(characterId || "")
      });
    }

    // First owned character becomes active automatically.
    if (!account.active_character_id && listed.payload.characters.length === 1) {
      const activeSet = this.setActiveCharacter(accountId, characterId);
      if (!activeSet.ok) {
        return failure("account_service_register_character_failed", activeSet.error, {
          active_set_result: activeSet
        });
      }

      return success("account_service_character_registered", {
        account: clone(activeSet.payload.account),
        auto_set_active: true
      });
    }

    return success("account_service_character_registered", {
      account: clone(account),
      auto_set_active: false
    });
  }
}

module.exports = {
  AccountService
};
