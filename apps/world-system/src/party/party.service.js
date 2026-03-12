"use strict";

const { PartyManager } = require("./party.manager");

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

class PartyService {
  constructor(options) {
    const cfg = options || {};
    this.manager = cfg.manager || new PartyManager({ store: cfg.store });
    this.partyPersistence = cfg.partyPersistence || null;
  }

  _save(party) {
    if (this.partyPersistence && typeof this.partyPersistence.saveParty === "function") {
      return this.partyPersistence.saveParty(party);
    }
    return success("party_service_save_skipped", {
      party: clone(party)
    });
  }

  _load(partyId) {
    if (this.partyPersistence && typeof this.partyPersistence.loadPartyById === "function") {
      return this.partyPersistence.loadPartyById(partyId);
    }
    return this.manager.getPartyById(partyId);
  }

  createParty(input) {
    const out = this.manager.createParty(input);
    if (!out.ok) {
      return failure("party_service_create_failed", out.error, {
        manager_result: out
      });
    }

    const saved = this._save(out.payload.party);
    if (!saved.ok) {
      return failure("party_service_create_failed", saved.error || "failed to persist party", {
        persistence_result: saved
      });
    }

    return success("party_service_created", {
      party: clone(saved.payload.party)
    });
  }

  getPartyById(partyId) {
    const out = this._load(partyId);
    if (!out.ok) {
      return failure("party_service_fetch_failed", out.error || "party not found", {
        load_result: out
      });
    }
    return success("party_service_found", {
      party: clone(out.payload.party)
    });
  }

  listParties() {
    if (this.partyPersistence && typeof this.partyPersistence.listParties === "function") {
      const listed = this.partyPersistence.listParties();
      if (!listed.ok) {
        return failure("party_service_list_failed", listed.error || "failed to list parties", {
          persistence_result: listed
        });
      }
      return success("party_service_listed", {
        parties: clone(listed.payload.parties || [])
      });
    }

    const listed = this.manager.listParties();
    if (!listed.ok) {
      return failure("party_service_list_failed", listed.error || "failed to list parties", {
        manager_result: listed
      });
    }
    return success("party_service_listed", {
      parties: clone(listed.payload.parties || [])
    });
  }

  inviteMember(input) {
    const out = this.manager.inviteMember(input);
    if (!out.ok) {
      return failure("party_service_invite_failed", out.error, {
        manager_result: out
      });
    }

    const saved = this._save(out.payload.party);
    if (!saved.ok) {
      return failure("party_service_invite_failed", saved.error || "failed to persist party invite", {
        persistence_result: saved
      });
    }

    return success("party_service_member_invited", {
      party: clone(saved.payload.party),
      invited_player_id: out.payload.invited_player_id
    });
  }

  joinParty(input) {
    const out = this.manager.joinParty(input);
    if (!out.ok) {
      return failure("party_service_join_failed", out.error, {
        manager_result: out
      });
    }

    const saved = this._save(out.payload.party);
    if (!saved.ok) {
      return failure("party_service_join_failed", saved.error || "failed to persist joined party", {
        persistence_result: saved
      });
    }

    return success("party_service_member_joined", {
      party: clone(saved.payload.party),
      player_id: out.payload.player_id
    });
  }

  leaveParty(input) {
    const out = this.manager.leaveParty(input);
    if (!out.ok) {
      return failure("party_service_leave_failed", out.error, {
        manager_result: out
      });
    }

    const saved = this._save(out.payload.party);
    if (!saved.ok) {
      return failure("party_service_leave_failed", saved.error || "failed to persist leaving party", {
        persistence_result: saved
      });
    }

    return success("party_service_member_left", {
      party: clone(saved.payload.party),
      player_id: out.payload.player_id
    });
  }

  removeMember(input) {
    const out = this.manager.removeMember(input);
    if (!out.ok) {
      return failure("party_service_remove_member_failed", out.error, {
        manager_result: out
      });
    }

    const saved = this._save(out.payload.party);
    if (!saved.ok) {
      return failure("party_service_remove_member_failed", saved.error || "failed to persist member removal", {
        persistence_result: saved
      });
    }

    return success("party_service_member_removed", {
      party: clone(saved.payload.party),
      removed_player_id: out.payload.removed_player_id
    });
  }

  disbandParty(input) {
    const out = this.manager.disbandParty(input);
    if (!out.ok) {
      return failure("party_service_disband_failed", out.error, {
        manager_result: out
      });
    }

    if (this.partyPersistence && typeof this.partyPersistence.deleteParty === "function") {
      const deleted = this.partyPersistence.deleteParty(out.payload.party_id);
      if (!deleted.ok) {
        return failure("party_service_disband_failed", deleted.error || "failed to persist party delete", {
          persistence_result: deleted
        });
      }
      return success("party_service_disbanded", {
        party_id: out.payload.party_id,
        deleted: Boolean(deleted.payload.deleted)
      });
    }

    return success("party_service_disbanded", {
      party_id: out.payload.party_id,
      deleted: Boolean(out.payload.deleted)
    });
  }
}

module.exports = {
  PartyService
};

