"use strict";

const { createGuildRecord } = require("./guild.schema");

class InMemoryGuildStore {
  constructor() {
    this.guilds = new Map();
  }

  save(guild) {
    this.guilds.set(guild.guild_id, guild);
    return guild;
  }

  load(guildId) {
    if (!guildId) return null;
    return this.guilds.get(String(guildId)) || null;
  }

  remove(guildId) {
    if (!guildId) return false;
    return this.guilds.delete(String(guildId));
  }

  list() {
    return Array.from(this.guilds.values());
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class GuildManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryGuildStore();
  }

  createGuild(input) {
    const draft = createGuildRecord(input);
    const existing = this.store.load(draft.guild_id);
    if (existing) {
      throw new Error("createGuild requires unique guild_id");
    }
    this.store.save(draft);
    return clone(draft);
  }

  getGuild(guild_id) {
    const guild = this.store.load(guild_id);
    return guild ? clone(guild) : null;
  }

  updateGuild(guild_id, updater) {
    const current = this.store.load(guild_id);
    if (!current) return null;

    let nextPatch;
    if (typeof updater === "function") {
      nextPatch = updater(clone(current));
    } else {
      nextPatch = updater || {};
    }

    const merged = {
      ...current,
      ...nextPatch,
      guild_id: current.guild_id,
      created_at: current.created_at,
      updated_at: new Date().toISOString()
    };

    const validated = createGuildRecord(merged);
    this.store.save(validated);
    return clone(validated);
  }

  deleteGuild(guild_id) {
    return this.store.remove(guild_id);
  }

  listGuildMembers(guild_id) {
    const guild = this.store.load(guild_id);
    if (!guild) return [];
    return clone(guild.member_ids || []);
  }

  listGuildOfficers(guild_id) {
    const guild = this.store.load(guild_id);
    if (!guild) return [];
    return clone(guild.officer_ids || []);
  }
}

module.exports = {
  InMemoryGuildStore,
  GuildManager
};

