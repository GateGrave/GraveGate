"use strict";

const { createPartyRecord, normalizePlayerIdList } = require("./party.schema");

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

class InMemoryPartyStore {
  constructor() {
    this.partiesById = new Map();
  }

  saveParty(party) {
    this.partiesById.set(String(party.party_id), clone(party));
    return clone(party);
  }

  loadPartyById(partyId) {
    if (!partyId || String(partyId).trim() === "") {
      return null;
    }
    return clone(this.partiesById.get(String(partyId)) || null);
  }

  listParties() {
    return Array.from(this.partiesById.values()).map(clone);
  }

  deleteParty(partyId) {
    const id = String(partyId || "").trim();
    if (!id) {
      return false;
    }
    const existed = this.partiesById.has(id);
    if (existed) {
      this.partiesById.delete(id);
    }
    return existed;
  }
}

class PartyManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryPartyStore();
  }

  createParty(input) {
    let record = null;
    try {
      record = createPartyRecord(input);
    } catch (error) {
      return failure("party_create_failed", error.message);
    }

    const existing = this.store.loadPartyById(record.party_id);
    if (existing) {
      return failure("party_create_failed", "party_id already exists", {
        party_id: record.party_id
      });
    }

    const saved = this.store.saveParty(record);
    return success("party_created", {
      party: saved
    });
  }

  getPartyById(partyId) {
    const id = String(partyId || "").trim();
    if (!id) {
      return failure("party_fetch_failed", "party_id is required");
    }

    const loaded = this.store.loadPartyById(id);
    if (!loaded) {
      return failure("party_fetch_failed", "party not found", {
        party_id: id
      });
    }

    return success("party_found", {
      party: loaded
    });
  }

  listParties() {
    return success("party_listed", {
      parties: this.store.listParties()
    });
  }

  inviteMember(input) {
    const data = input || {};
    const partyId = String(data.party_id || "").trim();
    const actingPlayerId = String(data.acting_player_id || "").trim();
    const targetPlayerId = String(data.target_player_id || "").trim();

    if (!partyId) {
      return failure("party_invite_failed", "party_id is required");
    }
    if (!actingPlayerId) {
      return failure("party_invite_failed", "acting_player_id is required");
    }
    if (!targetPlayerId) {
      return failure("party_invite_failed", "target_player_id is required");
    }

    const loaded = this.getPartyById(partyId);
    if (!loaded.ok) {
      return failure("party_invite_failed", loaded.error, {
        manager_result: loaded
      });
    }

    const party = loaded.payload.party;
    if (String(party.status || "") !== "active") {
      return failure("party_invite_failed", "party is not active", {
        party_id: partyId,
        status: party.status || null
      });
    }

    if (String(party.leader_player_id || "") !== actingPlayerId) {
      return failure("party_invite_failed", "only party leader can invite members", {
        party_id: partyId,
        acting_player_id: actingPlayerId
      });
    }

    party.member_player_ids = normalizePlayerIdList(party.member_player_ids);
    party.invited_player_ids = normalizePlayerIdList(party.invited_player_ids);

    if (party.member_player_ids.includes(targetPlayerId)) {
      return failure("party_invite_failed", "target player is already a party member", {
        party_id: partyId,
        target_player_id: targetPlayerId
      });
    }
    if (party.invited_player_ids.includes(targetPlayerId)) {
      return failure("party_invite_failed", "target player already has a pending invite", {
        party_id: partyId,
        target_player_id: targetPlayerId
      });
    }

    party.invited_player_ids.push(targetPlayerId);
    party.updated_at = new Date().toISOString();
    const saved = this.store.saveParty(party);
    return success("party_member_invited", {
      party: saved,
      invited_player_id: targetPlayerId
    });
  }

  joinParty(input) {
    const data = input || {};
    const partyId = String(data.party_id || "").trim();
    const playerId = String(data.player_id || "").trim();

    if (!partyId) {
      return failure("party_join_failed", "party_id is required");
    }
    if (!playerId) {
      return failure("party_join_failed", "player_id is required");
    }

    const loaded = this.getPartyById(partyId);
    if (!loaded.ok) {
      return failure("party_join_failed", loaded.error, {
        manager_result: loaded
      });
    }

    const party = loaded.payload.party;
    if (String(party.status || "") !== "active") {
      return failure("party_join_failed", "party is not active", {
        party_id: partyId,
        status: party.status || null
      });
    }

    party.member_player_ids = normalizePlayerIdList(party.member_player_ids);
    party.invited_player_ids = normalizePlayerIdList(party.invited_player_ids);

    if (party.member_player_ids.includes(playerId)) {
      return failure("party_join_failed", "player is already a party member", {
        party_id: partyId,
        player_id: playerId
      });
    }

    const inviteIndex = party.invited_player_ids.indexOf(playerId);
    if (inviteIndex < 0) {
      return failure("party_join_failed", "party invite not found for player", {
        party_id: partyId,
        player_id: playerId
      });
    }

    party.invited_player_ids.splice(inviteIndex, 1);
    party.member_player_ids.push(playerId);
    party.updated_at = new Date().toISOString();
    const saved = this.store.saveParty(party);

    return success("party_member_joined", {
      party: saved,
      player_id: playerId
    });
  }

  leaveParty(input) {
    const data = input || {};
    const partyId = String(data.party_id || "").trim();
    const playerId = String(data.player_id || "").trim();

    if (!partyId) {
      return failure("party_leave_failed", "party_id is required");
    }
    if (!playerId) {
      return failure("party_leave_failed", "player_id is required");
    }

    const loaded = this.getPartyById(partyId);
    if (!loaded.ok) {
      return failure("party_leave_failed", loaded.error, {
        manager_result: loaded
      });
    }

    const party = loaded.payload.party;
    party.member_player_ids = normalizePlayerIdList(party.member_player_ids);
    party.invited_player_ids = normalizePlayerIdList(party.invited_player_ids);
    const memberIndex = party.member_player_ids.indexOf(playerId);
    if (memberIndex < 0) {
      return failure("party_leave_failed", "player is not a party member", {
        party_id: partyId,
        player_id: playerId
      });
    }

    if (String(party.leader_player_id || "") === playerId) {
      return failure("party_leave_failed", "party leader cannot leave without disbanding", {
        party_id: partyId,
        player_id: playerId
      });
    }

    party.member_player_ids.splice(memberIndex, 1);
    party.updated_at = new Date().toISOString();
    const saved = this.store.saveParty(party);
    return success("party_member_left", {
      party: saved,
      player_id: playerId
    });
  }

  removeMember(input) {
    const data = input || {};
    const partyId = String(data.party_id || "").trim();
    const actingPlayerId = String(data.acting_player_id || "").trim();
    const targetPlayerId = String(data.target_player_id || "").trim();

    if (!partyId) {
      return failure("party_remove_member_failed", "party_id is required");
    }
    if (!actingPlayerId) {
      return failure("party_remove_member_failed", "acting_player_id is required");
    }
    if (!targetPlayerId) {
      return failure("party_remove_member_failed", "target_player_id is required");
    }

    const loaded = this.getPartyById(partyId);
    if (!loaded.ok) {
      return failure("party_remove_member_failed", loaded.error, {
        manager_result: loaded
      });
    }

    const party = loaded.payload.party;
    if (String(party.leader_player_id || "") !== actingPlayerId) {
      return failure("party_remove_member_failed", "only party leader can remove members", {
        party_id: partyId,
        acting_player_id: actingPlayerId
      });
    }
    if (String(party.leader_player_id || "") === targetPlayerId) {
      return failure("party_remove_member_failed", "party leader cannot remove themself", {
        party_id: partyId,
        target_player_id: targetPlayerId
      });
    }

    party.member_player_ids = normalizePlayerIdList(party.member_player_ids);
    const memberIndex = party.member_player_ids.indexOf(targetPlayerId);
    if (memberIndex < 0) {
      return failure("party_remove_member_failed", "target player is not a party member", {
        party_id: partyId,
        target_player_id: targetPlayerId
      });
    }

    party.member_player_ids.splice(memberIndex, 1);
    party.updated_at = new Date().toISOString();
    const saved = this.store.saveParty(party);
    return success("party_member_removed", {
      party: saved,
      removed_player_id: targetPlayerId
    });
  }

  disbandParty(input) {
    const data = input || {};
    const partyId = String(data.party_id || "").trim();
    const actingPlayerId = String(data.acting_player_id || "").trim();
    if (!partyId) {
      return failure("party_disband_failed", "party_id is required");
    }
    if (!actingPlayerId) {
      return failure("party_disband_failed", "acting_player_id is required");
    }

    const loaded = this.getPartyById(partyId);
    if (!loaded.ok) {
      return failure("party_disband_failed", loaded.error, {
        manager_result: loaded
      });
    }

    const party = loaded.payload.party;
    if (String(party.leader_player_id || "") !== actingPlayerId) {
      return failure("party_disband_failed", "only party leader can disband", {
        party_id: partyId,
        acting_player_id: actingPlayerId
      });
    }

    const deleted = this.store.deleteParty(partyId);
    return success("party_disbanded", {
      party_id: partyId,
      deleted
    });
  }
}

module.exports = {
  InMemoryPartyStore,
  PartyManager
};

