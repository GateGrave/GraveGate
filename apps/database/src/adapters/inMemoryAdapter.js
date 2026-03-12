"use strict";

const { validateAdapterContract } = require("./databaseAdapter.interface");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCollectionName(collection) {
  if (!collection || String(collection).trim() === "") {
    return null;
  }
  return String(collection);
}

function normalizeId(id) {
  if (!id || String(id).trim() === "") {
    return null;
  }
  return String(id);
}

class InMemoryAdapter {
  constructor() {
    this.collections = new Map();
  }

  getCollectionStore(collection) {
    const key = normalizeCollectionName(collection);
    if (!key) return null;

    if (!this.collections.has(key)) {
      this.collections.set(key, new Map());
    }

    return this.collections.get(key);
  }

  getById(collection, id) {
    const collectionKey = normalizeCollectionName(collection);
    const idKey = normalizeId(id);
    if (!collectionKey) {
      return { ok: false, payload: {}, error: "collection is required" };
    }
    if (!idKey) {
      return { ok: false, payload: {}, error: "id is required" };
    }

    const store = this.getCollectionStore(collectionKey);
    const record = store.get(idKey) || null;
    return {
      ok: true,
      payload: {
        collection: collectionKey,
        id: idKey,
        record: record ? clone(record) : null
      },
      error: null
    };
  }

  list(collection) {
    const collectionKey = normalizeCollectionName(collection);
    if (!collectionKey) {
      return { ok: false, payload: {}, error: "collection is required" };
    }

    const store = this.getCollectionStore(collectionKey);
    const records = Array.from(store.entries()).map(function mapEntry(entry) {
      return {
        id: entry[0],
        record: clone(entry[1])
      };
    });

    return {
      ok: true,
      payload: {
        collection: collectionKey,
        records
      },
      error: null
    };
  }

  save(collection, id, record) {
    const collectionKey = normalizeCollectionName(collection);
    const idKey = normalizeId(id);
    if (!collectionKey) {
      return { ok: false, payload: {}, error: "collection is required" };
    }
    if (!idKey) {
      return { ok: false, payload: {}, error: "id is required" };
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return { ok: false, payload: {}, error: "record must be an object" };
    }

    const store = this.getCollectionStore(collectionKey);
    const next = clone(record);
    store.set(idKey, next);

    return {
      ok: true,
      payload: {
        collection: collectionKey,
        id: idKey,
        record: clone(next)
      },
      error: null
    };
  }

  delete(collection, id) {
    const collectionKey = normalizeCollectionName(collection);
    const idKey = normalizeId(id);
    if (!collectionKey) {
      return { ok: false, payload: {}, error: "collection is required" };
    }
    if (!idKey) {
      return { ok: false, payload: {}, error: "id is required" };
    }

    const store = this.getCollectionStore(collectionKey);
    const existed = store.has(idKey);
    if (existed) {
      store.delete(idKey);
    }

    return {
      ok: true,
      payload: {
        collection: collectionKey,
        id: idKey,
        deleted: existed
      },
      error: null
    };
  }

  // Session-specific helpers keep bridge code simple while preserving generic adapter behavior.
  saveSession(session) {
    if (!session || typeof session !== "object" || Array.isArray(session)) {
      return { ok: false, payload: {}, error: "session must be an object" };
    }
    const sessionId = normalizeId(session.session_id);
    if (!sessionId) {
      return { ok: false, payload: {}, error: "session.session_id is required" };
    }
    return this.save("dungeon_sessions", sessionId, session);
  }

  getSessionById(sessionId) {
    return this.getById("dungeon_sessions", sessionId);
  }

  listSessions() {
    return this.list("dungeon_sessions");
  }

  deleteSession(sessionId) {
    return this.delete("dungeon_sessions", sessionId);
  }

  saveCombat(combatOrId, maybeCombat) {
    if (maybeCombat !== undefined) {
      const combatId = normalizeId(combatOrId);
      if (!combatId) {
        return { ok: false, payload: {}, error: "combat_id is required" };
      }
      return this.save("combats", combatId, maybeCombat);
    }

    const combat = combatOrId;
    if (!combat || typeof combat !== "object" || Array.isArray(combat)) {
      return { ok: false, payload: {}, error: "combat must be an object" };
    }
    const combatId = normalizeId(combat.combat_id);
    if (!combatId) {
      return { ok: false, payload: {}, error: "combat.combat_id is required" };
    }
    return this.save("combats", combatId, combat);
  }

  getCombatById(combatId) {
    return this.getById("combats", combatId);
  }

  listCombats() {
    return this.list("combats");
  }

  deleteCombat(combatId) {
    return this.delete("combats", combatId);
  }

  saveParty(party) {
    if (!party || typeof party !== "object" || Array.isArray(party)) {
      return { ok: false, payload: {}, error: "party must be an object" };
    }
    const partyId = normalizeId(party.party_id);
    if (!partyId) {
      return { ok: false, payload: {}, error: "party.party_id is required" };
    }
    return this.save("parties", partyId, party);
  }

  getPartyById(partyId) {
    return this.getById("parties", partyId);
  }

  listParties() {
    return this.list("parties");
  }

  deleteParty(partyId) {
    return this.delete("parties", partyId);
  }
}

function createInMemoryAdapter() {
  const adapter = new InMemoryAdapter();
  const contract = validateAdapterContract(adapter);
  if (!contract.ok) {
    throw new Error(contract.error);
  }
  return adapter;
}

module.exports = {
  InMemoryAdapter,
  createInMemoryAdapter
};
