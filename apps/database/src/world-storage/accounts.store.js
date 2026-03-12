"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class InMemoryAccountStore {
  constructor() {
    this.accountsById = new Map();
  }

  saveAccount(account) {
    const accountId = String(account.account_id);
    this.accountsById.set(accountId, clone(account));
    return clone(account);
  }

  loadAccount(accountId) {
    if (!accountId || String(accountId).trim() === "") {
      return null;
    }

    const loaded = this.accountsById.get(String(accountId));
    return loaded ? clone(loaded) : null;
  }

  loadAccountByDiscordUserId(discordUserId) {
    const key = String(discordUserId || "").trim();
    if (!key) {
      return null;
    }

    const all = this.listAccounts();
    return all.find((account) => String(account.discord_user_id || "") === key) || null;
  }

  listAccounts() {
    return Array.from(this.accountsById.values()).map(clone);
  }
}

module.exports = {
  InMemoryAccountStore
};
