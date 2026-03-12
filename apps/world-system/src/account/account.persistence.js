"use strict";

const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { validateAdapterContract } = require("../../../database/src/adapters/databaseAdapter.interface");
const { createAccountRecord } = require("./account.schema");

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

class AccountPersistenceBridge {
  constructor(options) {
    const cfg = options || {};
    this.adapter = cfg.adapter || createInMemoryAdapter();
    this.collection = cfg.collection ? String(cfg.collection) : "accounts";

    const contract = validateAdapterContract(this.adapter);
    if (!contract.ok) {
      throw new Error(contract.error);
    }
  }

  saveAccount(account) {
    if (!account || typeof account !== "object" || Array.isArray(account)) {
      return failure("account_persistence_save_failed", "account must be an object");
    }

    const accountId = account.account_id ? String(account.account_id).trim() : "";
    if (!accountId) {
      return failure("account_persistence_save_failed", "account.account_id is required");
    }

    const saved = this.adapter.save(this.collection, accountId, account);
    if (!saved.ok) {
      return failure("account_persistence_save_failed", saved.error || "adapter save failed", {
        adapter_result: saved
      });
    }

    return success("account_persistence_saved", {
      account: clone(saved.payload.record)
    });
  }

  loadAccountById(accountId) {
    if (!accountId || String(accountId).trim() === "") {
      return failure("account_persistence_load_failed", "account_id is required");
    }

    const loaded = this.adapter.getById(this.collection, String(accountId));
    if (!loaded.ok) {
      return failure("account_persistence_load_failed", loaded.error || "adapter getById failed", {
        adapter_result: loaded
      });
    }
    if (!loaded.payload.record) {
      return failure("account_persistence_load_failed", "account not found", {
        account_id: String(accountId)
      });
    }

    return success("account_persistence_loaded", {
      account: clone(loaded.payload.record)
    });
  }

  listAccounts() {
    const listed = this.adapter.list(this.collection);
    if (!listed.ok) {
      return failure("account_persistence_list_failed", listed.error || "adapter list failed", {
        adapter_result: listed
      });
    }

    const accounts = Array.isArray(listed.payload.records)
      ? listed.payload.records.map((row) => clone(row.record))
      : [];

    return success("account_persistence_listed", {
      accounts
    });
  }

  loadAccountByDiscordUserId(discordUserId) {
    const key = String(discordUserId || "").trim();
    if (!key) {
      return failure("account_persistence_load_failed", "discord_user_id is required");
    }

    const listed = this.listAccounts();
    if (!listed.ok) {
      return listed;
    }

    const found = listed.payload.accounts.find((account) => String(account.discord_user_id || "") === key) || null;
    if (!found) {
      return failure("account_persistence_load_failed", "account not found", {
        discord_user_id: key
      });
    }

    return success("account_persistence_loaded", {
      account: clone(found)
    });
  }

  findOrCreateAccountByDiscordUserId(input) {
    const data = input || {};
    const discordUserId = String(data.discord_user_id || "").trim();
    if (!discordUserId) {
      return failure("account_persistence_find_or_create_failed", "discord_user_id is required");
    }

    const existing = this.loadAccountByDiscordUserId(discordUserId);
    if (existing.ok) {
      return success("account_persistence_found", {
        account: clone(existing.payload.account),
        created: false
      });
    }

    if (existing.error !== "account not found") {
      return failure("account_persistence_find_or_create_failed", existing.error || "failed to load account", {
        persistence_result: existing
      });
    }

    let created = null;
    try {
      created = createAccountRecord({
        discord_user_id: discordUserId,
        max_character_slots: data.max_character_slots
      });
    } catch (error) {
      return failure("account_persistence_find_or_create_failed", error.message);
    }

    const saved = this.saveAccount(created);
    if (!saved.ok) {
      return failure("account_persistence_find_or_create_failed", saved.error || "failed to save account", {
        persistence_result: saved
      });
    }

    return success("account_persistence_created", {
      account: clone(saved.payload.account),
      created: true
    });
  }
}

module.exports = {
  AccountPersistenceBridge
};
