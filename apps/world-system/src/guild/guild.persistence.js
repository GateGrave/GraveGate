"use strict";

const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { validateAdapterContract } = require("../../../database/src/adapters/databaseAdapter.interface");
const { createGuildRecord } = require("./guild.schema");

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

class GuildPersistenceBridge {
  constructor(options) {
    const cfg = options || {};
    this.adapter = cfg.adapter || createInMemoryAdapter();
    this.collection = cfg.collection ? String(cfg.collection) : "guilds";

    const contract = validateAdapterContract(this.adapter);
    if (!contract.ok) {
      throw new Error(contract.error);
    }
  }

  saveGuild(guild) {
    if (!guild || typeof guild !== "object" || Array.isArray(guild)) {
      return failure("guild_persistence_save_failed", "guild must be an object");
    }

    let normalized;
    try {
      normalized = createGuildRecord(guild);
    } catch (error) {
      return failure("guild_persistence_save_failed", error.message);
    }

    const guildId = String(normalized.guild_id);
    const out = this.adapter.save(this.collection, guildId, normalized);
    if (!out.ok) {
      return failure("guild_persistence_save_failed", out.error || "adapter save failed", {
        adapter_result: out
      });
    }

    return success("guild_persistence_saved", {
      guild: clone(out.payload.record)
    });
  }

  loadGuildById(guildId) {
    if (!guildId || String(guildId).trim() === "") {
      return failure("guild_persistence_load_failed", "guild_id is required");
    }

    const out = this.adapter.getById(this.collection, String(guildId));
    if (!out.ok) {
      return failure("guild_persistence_load_failed", out.error || "adapter getById failed", {
        adapter_result: out
      });
    }
    if (!out.payload.record) {
      return failure("guild_persistence_load_failed", "guild not found", {
        guild_id: String(guildId)
      });
    }

    return success("guild_persistence_loaded", {
      guild: clone(out.payload.record)
    });
  }

  listGuilds() {
    const out = this.adapter.list(this.collection);
    if (!out.ok) {
      return failure("guild_persistence_list_failed", out.error || "adapter list failed", {
        adapter_result: out
      });
    }

    const guilds = Array.isArray(out.payload.records)
      ? out.payload.records.map(function mapRow(row) {
          return clone(row.record);
        })
      : [];

    return success("guild_persistence_listed", {
      guilds
    });
  }

  deleteGuild(guildId) {
    if (!guildId || String(guildId).trim() === "") {
      return failure("guild_persistence_delete_failed", "guild_id is required");
    }

    const out = this.adapter.delete(this.collection, String(guildId));
    if (!out.ok) {
      return failure("guild_persistence_delete_failed", out.error || "adapter delete failed", {
        adapter_result: out
      });
    }

    return success("guild_persistence_deleted", {
      guild_id: String(guildId),
      deleted: Boolean(out.payload.deleted)
    });
  }
}

module.exports = {
  GuildPersistenceBridge
};

