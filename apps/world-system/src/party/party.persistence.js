"use strict";

const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { validateAdapterContract } = require("../../../database/src/adapters/databaseAdapter.interface");
const { createPartyRecord } = require("./party.schema");

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

class PartyPersistenceBridge {
  constructor(options) {
    const cfg = options || {};
    this.adapter = cfg.adapter || createInMemoryAdapter();
    this.collection = cfg.collection ? String(cfg.collection) : "parties";

    const contract = validateAdapterContract(this.adapter);
    if (!contract.ok) {
      throw new Error(contract.error);
    }
  }

  saveParty(party) {
    if (!party || typeof party !== "object" || Array.isArray(party)) {
      return failure("party_persistence_save_failed", "party must be an object");
    }
    const partyId = String(party.party_id || "").trim();
    if (!partyId) {
      return failure("party_persistence_save_failed", "party.party_id is required");
    }

    const saved = typeof this.adapter.saveParty === "function"
      ? this.adapter.saveParty(party)
      : this.adapter.save(this.collection, partyId, party);
    if (!saved.ok) {
      return failure("party_persistence_save_failed", saved.error || "adapter save failed", {
        adapter_result: saved
      });
    }

    return success("party_persistence_saved", {
      party: clone(saved.payload.record)
    });
  }

  loadPartyById(partyId) {
    const id = String(partyId || "").trim();
    if (!id) {
      return failure("party_persistence_load_failed", "party_id is required");
    }

    const loaded = typeof this.adapter.getPartyById === "function"
      ? this.adapter.getPartyById(id)
      : this.adapter.getById(this.collection, id);
    if (!loaded.ok) {
      return failure("party_persistence_load_failed", loaded.error || "adapter getById failed", {
        adapter_result: loaded
      });
    }
    if (!loaded.payload.record) {
      return failure("party_persistence_load_failed", "party not found", {
        party_id: id
      });
    }

    return success("party_persistence_loaded", {
      party: clone(loaded.payload.record)
    });
  }

  listParties() {
    const listed = typeof this.adapter.listParties === "function"
      ? this.adapter.listParties()
      : this.adapter.list(this.collection);
    if (!listed.ok) {
      return failure("party_persistence_list_failed", listed.error || "adapter list failed", {
        adapter_result: listed
      });
    }

    const parties = Array.isArray(listed.payload.records)
      ? listed.payload.records.map((row) => clone(row.record))
      : [];

    return success("party_persistence_listed", {
      parties
    });
  }

  deleteParty(partyId) {
    const id = String(partyId || "").trim();
    if (!id) {
      return failure("party_persistence_delete_failed", "party_id is required");
    }

    const out = typeof this.adapter.deleteParty === "function"
      ? this.adapter.deleteParty(id)
      : this.adapter.delete(this.collection, id);
    if (!out.ok) {
      return failure("party_persistence_delete_failed", out.error || "adapter delete failed", {
        adapter_result: out
      });
    }

    return success("party_persistence_deleted", {
      party_id: id,
      deleted: Boolean(out.payload.deleted)
    });
  }

  findOrCreateParty(input) {
    const data = input || {};
    const partyId = data.party_id ? String(data.party_id).trim() : "";
    const leaderPlayerId = String(data.leader_player_id || "").trim();
    if (!leaderPlayerId) {
      return failure("party_persistence_find_or_create_failed", "leader_player_id is required");
    }

    if (partyId) {
      const loaded = this.loadPartyById(partyId);
      if (loaded.ok) {
        return success("party_persistence_found", {
          party: clone(loaded.payload.party),
          created: false
        });
      }
      if (loaded.error !== "party not found") {
        return failure("party_persistence_find_or_create_failed", loaded.error || "failed to load party", {
          persistence_result: loaded
        });
      }
    }

    let created = null;
    try {
      created = createPartyRecord({
        party_id: partyId || undefined,
        leader_player_id: leaderPlayerId,
        member_player_ids: Array.isArray(data.member_player_ids) ? data.member_player_ids : [leaderPlayerId]
      });
    } catch (error) {
      return failure("party_persistence_find_or_create_failed", error.message);
    }

    const saved = this.saveParty(created);
    if (!saved.ok) {
      return failure("party_persistence_find_or_create_failed", saved.error || "failed to save party", {
        persistence_result: saved
      });
    }

    return success("party_persistence_created", {
      party: clone(saved.payload.party),
      created: true
    });
  }
}

module.exports = {
  PartyPersistenceBridge
};

