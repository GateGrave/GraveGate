"use strict";

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

class InMemoryAccountStore {
  constructor() {
    this.accountsById = new Map();
  }

  saveAccount(account) {
    this.accountsById.set(String(account.account_id), clone(account));
    return clone(account);
  }

  loadAccount(accountId) {
    if (!accountId || String(accountId).trim() === "") {
      return null;
    }
    return clone(this.accountsById.get(String(accountId)) || null);
  }

  listAccounts() {
    return Array.from(this.accountsById.values()).map(clone);
  }

  loadAccountByDiscordUserId(discordUserId) {
    const key = String(discordUserId || "").trim();
    if (!key) {
      return null;
    }

    const allAccounts = this.listAccounts();
    return allAccounts.find((account) => String(account.discord_user_id || "") === key) || null;
  }
}

class AccountManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryAccountStore();
  }

  createAccount(input) {
    try {
      const record = createAccountRecord(input);
      const existing = this.store.loadAccountByDiscordUserId(record.discord_user_id);
      if (existing) {
        return failure("account_create_failed", "account already exists for discord_user_id", {
          discord_user_id: record.discord_user_id,
          account: existing
        });
      }

      const saved = this.store.saveAccount(record);
      return success("account_created", {
        account: saved
      });
    } catch (error) {
      return failure("account_create_failed", error.message);
    }
  }

  getAccountById(accountId) {
    if (!accountId || String(accountId).trim() === "") {
      return failure("account_fetch_failed", "account_id is required");
    }

    const loaded = this.store.loadAccount(accountId);
    if (!loaded) {
      return failure("account_fetch_failed", "account not found", {
        account_id: String(accountId)
      });
    }

    return success("account_found", {
      account: loaded
    });
  }

  getAccountByDiscordUserId(discordUserId) {
    if (!discordUserId || String(discordUserId).trim() === "") {
      return failure("account_fetch_failed", "discord_user_id is required");
    }

    const loaded = this.store.loadAccountByDiscordUserId(discordUserId);
    if (!loaded) {
      return failure("account_fetch_failed", "account not found", {
        discord_user_id: String(discordUserId)
      });
    }

    return success("account_found", {
      account: loaded
    });
  }

  listAccounts() {
    return success("account_listed", {
      accounts: this.store.listAccounts()
    });
  }

  findOrCreateAccountByDiscordUserId(input) {
    const data = input || {};
    const discordUserId = String(data.discord_user_id || "").trim();
    if (!discordUserId) {
      return failure("account_find_or_create_failed", "discord_user_id is required");
    }

    const existing = this.store.loadAccountByDiscordUserId(discordUserId);
    if (existing) {
      return success("account_found", {
        account: existing,
        created: false
      });
    }

    const created = this.createAccount({
      discord_user_id: discordUserId,
      max_character_slots: data.max_character_slots
    });

    if (!created.ok) {
      return failure("account_find_or_create_failed", created.error || "failed to create account", {
        manager_result: created
      });
    }

    return success("account_created", {
      account: created.payload.account,
      created: true
    });
  }
}

module.exports = {
  InMemoryAccountStore,
  AccountManager
};
