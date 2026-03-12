"use strict";

const { InMemoryAccountStore: DatabaseAccountStore } = require("../../../database/src/world-storage/accounts.store");

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

class AccountRepository {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new DatabaseAccountStore();
  }

  saveAccount(account) {
    try {
      if (!account || !account.account_id) {
        return failure("account_repository_save_failed", "account.account_id is required");
      }

      const saved = this.store.saveAccount(account);
      return success("account_repository_saved", {
        account: clone(saved)
      });
    } catch (error) {
      return failure("account_repository_save_failed", error.message);
    }
  }

  loadAccountById(accountId) {
    if (!accountId || String(accountId).trim() === "") {
      return failure("account_repository_load_failed", "account_id is required");
    }

    const loaded = this.store.loadAccount(String(accountId));
    if (!loaded) {
      return failure("account_repository_load_failed", "account not found", {
        account_id: String(accountId)
      });
    }

    return success("account_repository_loaded", {
      account: clone(loaded)
    });
  }

  loadAccountByDiscordUserId(discordUserId) {
    if (!discordUserId || String(discordUserId).trim() === "") {
      return failure("account_repository_load_failed", "discord_user_id is required");
    }

    const loaded = this.store.loadAccountByDiscordUserId(String(discordUserId));
    if (!loaded) {
      return failure("account_repository_load_failed", "account not found", {
        discord_user_id: String(discordUserId)
      });
    }

    return success("account_repository_loaded", {
      account: clone(loaded)
    });
  }

  listStoredAccounts() {
    let list = [];

    if (typeof this.store.listAccounts === "function") {
      list = this.store.listAccounts();
    } else if (this.store.accountsById && typeof this.store.accountsById.values === "function") {
      list = Array.from(this.store.accountsById.values());
    }

    return success("account_repository_listed", {
      accounts: clone(list)
    });
  }
}

module.exports = {
  AccountRepository
};
