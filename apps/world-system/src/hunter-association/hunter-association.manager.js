"use strict";

const {
  createHunterAssociationRecord,
  createHunterProfileRecord
} = require("./hunter-association.schema");

class InMemoryHunterAssociationStore {
  constructor() {
    this.associations = new Map();
  }

  save(record) {
    this.associations.set(record.association_id, record);
    return record;
  }

  load(associationId) {
    if (!associationId) return null;
    return this.associations.get(String(associationId)) || null;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class HunterAssociationManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryHunterAssociationStore();
  }

  createHunterAssociation(input) {
    const draft = createHunterAssociationRecord(input);
    if (this.store.load(draft.association_id)) {
      throw new Error("createHunterAssociation requires unique association_id");
    }
    this.store.save(draft);
    return clone(draft);
  }

  getHunterAssociation(association_id) {
    const loaded = this.store.load(association_id);
    return loaded ? clone(loaded) : null;
  }

  updateHunterAssociation(association_id, updater) {
    const current = this.store.load(association_id);
    if (!current) return null;

    const patch = typeof updater === "function" ? updater(clone(current)) : updater || {};
    const merged = {
      ...current,
      ...patch,
      association_id: current.association_id,
      updated_at: new Date().toISOString()
    };
    const validated = createHunterAssociationRecord(merged);
    this.store.save(validated);
    return clone(validated);
  }

  createHunterProfile(input) {
    const data = input || {};
    if (!data.association_id) {
      throw new Error("createHunterProfile requires association_id");
    }

    const association = this.store.load(data.association_id);
    if (!association) {
      throw new Error("association not found");
    }

    const profile = createHunterProfileRecord(data, association);
    if (association.hunter_profiles[profile.player_id]) {
      throw new Error("hunter profile already exists");
    }

    const updatedAssociation = {
      ...association,
      hunter_profiles: {
        ...association.hunter_profiles,
        [profile.player_id]: profile
      },
      updated_at: new Date().toISOString()
    };
    this.store.save(updatedAssociation);
    return clone(profile);
  }

  getHunterProfile(association_id, player_id) {
    const association = this.store.load(association_id);
    if (!association) return null;
    if (!player_id) return null;

    const profile = association.hunter_profiles[String(player_id)] || null;
    return profile ? clone(profile) : null;
  }

  updateHunterProfile(association_id, player_id, updater) {
    const association = this.store.load(association_id);
    if (!association) return null;
    const currentProfile = association.hunter_profiles[String(player_id)];
    if (!currentProfile) return null;

    const patch = typeof updater === "function" ? updater(clone(currentProfile)) : updater || {};
    const mergedCandidate = {
      ...currentProfile,
      ...patch,
      player_id: currentProfile.player_id,
      created_at: currentProfile.created_at
    };

    const validated = createHunterProfileRecord(mergedCandidate, association);
    const updatedProfile = {
      ...validated,
      created_at: currentProfile.created_at,
      updated_at: new Date().toISOString()
    };

    const updatedAssociation = {
      ...association,
      hunter_profiles: {
        ...association.hunter_profiles,
        [String(player_id)]: updatedProfile
      },
      updated_at: new Date().toISOString()
    };

    this.store.save(updatedAssociation);
    return clone(updatedProfile);
  }

  listActiveContracts(association_id) {
    const association = this.store.load(association_id);
    if (!association) return [];
    return clone(association.active_contracts || []);
  }

  listCompletedContracts(association_id) {
    const association = this.store.load(association_id);
    if (!association) return [];
    return clone(association.completed_contracts || []);
  }
}

module.exports = {
  InMemoryHunterAssociationStore,
  HunterAssociationManager
};

