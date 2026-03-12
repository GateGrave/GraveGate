"use strict";

const CONTRACT_SCHEMA = {
  contract_id: "string",
  contract_type: "string",
  target_data: "object",
  reward_data: "object",
  claim_state: "string",
  claimed_by: "string|null",
  completion_state: "string",
  expiry: "string (ISO date)|null",
  created_at: "string (ISO date)",
  updated_at: "string (ISO date)"
};

const VALID_CLAIM_STATES = ["unclaimed", "claimed", "cancelled", "expired"];
const VALID_COMPLETION_STATES = ["incomplete", "completed", "expired"];

class InMemoryContractStore {
  constructor() {
    this.contracts = new Map();
  }

  save(contractRecord) {
    this.contracts.set(contractRecord.contract_id, contractRecord);
    return contractRecord;
  }

  load(contractId) {
    if (!contractId) return null;
    return this.contracts.get(String(contractId)) || null;
  }

  list() {
    return Array.from(this.contracts.values());
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(fieldName + " must be an object");
  }
  return value;
}

function toIsoTimeOrNull(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(fieldName + " must be a valid datetime");
  }
  return date.toISOString();
}

function createContractRecord(input) {
  const data = input || {};

  if (!data.contract_id || String(data.contract_id).trim() === "") {
    throw new Error("createContract requires contract_id");
  }
  if (!data.contract_type || String(data.contract_type).trim() === "") {
    throw new Error("createContract requires contract_type");
  }

  const claimState = data.claim_state ? String(data.claim_state) : "unclaimed";
  const completionState = data.completion_state ? String(data.completion_state) : "incomplete";
  if (!VALID_CLAIM_STATES.includes(claimState)) {
    throw new Error("claim_state is invalid");
  }
  if (!VALID_COMPLETION_STATES.includes(completionState)) {
    throw new Error("completion_state is invalid");
  }

  const now = new Date().toISOString();
  return {
    contract_id: String(data.contract_id),
    contract_type: String(data.contract_type),
    target_data: ensureObject(data.target_data, "target_data"),
    reward_data: ensureObject(data.reward_data, "reward_data"),
    claim_state: claimState,
    claimed_by: data.claimed_by ? String(data.claimed_by) : null,
    completion_state: completionState,
    expiry: toIsoTimeOrNull(data.expiry, "expiry"),
    created_at: data.created_at || now,
    updated_at: data.updated_at || now
  };
}

function isContractExpired(contractRecord, atTime) {
  if (!contractRecord || !contractRecord.expiry) return false;
  const now = atTime ? new Date(atTime) : new Date();
  if (Number.isNaN(now.getTime())) return false;
  return now.getTime() > new Date(contractRecord.expiry).getTime();
}

function createResult(ok, eventType, payload) {
  return {
    ok,
    event_type: eventType,
    payload: payload || {}
  };
}

class ContractHuntBoardManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryContractStore();
  }

  createContract(input) {
    const contract = createContractRecord(input);
    if (this.store.load(contract.contract_id)) {
      throw new Error("createContract requires unique contract_id");
    }
    this.store.save(contract);
    return clone(contract);
  }

  getContract(contract_id) {
    const found = this.store.load(contract_id);
    return found ? clone(found) : null;
  }

  claimContract(input) {
    const data = input || {};
    const contractId = data.contract_id;
    const playerId = data.player_id;
    const allowDuplicateClaim = data.allow_duplicate_claim === true;

    if (!contractId || !playerId) {
      return createResult(false, "contract_claim_rejected", { reason: "contract_id_and_player_id_required" });
    }

    const current = this.store.load(contractId);
    if (!current) {
      return createResult(false, "contract_claim_rejected", { reason: "contract_not_found" });
    }

    if (isContractExpired(current, data.at_time)) {
      const expired = this.expireContract({ contract_id: contractId, at_time: data.at_time });
      return createResult(false, "contract_claim_rejected", {
        reason: "contract_expired",
        contract: expired.payload.contract
      });
    }

    if (current.completion_state === "completed" && !allowDuplicateClaim) {
      return createResult(false, "contract_claim_rejected", { reason: "contract_already_completed" });
    }

    if (current.claim_state === "claimed" && !allowDuplicateClaim) {
      return createResult(false, "contract_claim_rejected", {
        reason: "already_claimed",
        claimed_by: current.claimed_by
      });
    }

    const updated = createContractRecord({
      ...current,
      claim_state: "claimed",
      claimed_by: String(playerId),
      updated_at: new Date().toISOString()
    });
    this.store.save(updated);

    return createResult(true, "contract_claimed", {
      contract_id: updated.contract_id,
      claimed_by: updated.claimed_by,
      contract: clone(updated)
    });
  }

  cancelClaim(input) {
    const data = input || {};
    const contractId = data.contract_id;
    const playerId = data.player_id;
    const forceCancel = data.force_cancel === true;

    if (!contractId || !playerId) {
      return createResult(false, "contract_cancel_rejected", { reason: "contract_id_and_player_id_required" });
    }

    const current = this.store.load(contractId);
    if (!current) {
      return createResult(false, "contract_cancel_rejected", { reason: "contract_not_found" });
    }

    if (current.claim_state !== "claimed" || !current.claimed_by) {
      return createResult(false, "contract_cancel_rejected", { reason: "stale_claim_state" });
    }

    if (!forceCancel && current.claimed_by !== String(playerId)) {
      return createResult(false, "contract_cancel_rejected", { reason: "not_claim_owner" });
    }

    if (current.completion_state === "completed") {
      return createResult(false, "contract_cancel_rejected", { reason: "contract_already_completed" });
    }

    const updated = createContractRecord({
      ...current,
      claim_state: "cancelled",
      claimed_by: null,
      updated_at: new Date().toISOString()
    });
    this.store.save(updated);

    return createResult(true, "contract_claim_cancelled", {
      contract_id: updated.contract_id,
      contract: clone(updated)
    });
  }

  // Alias that matches the external flow naming convention.
  cancelContractClaim(input) {
    return this.cancelClaim(input);
  }

  completeContract(input) {
    const data = input || {};
    const contractId = data.contract_id;
    const playerId = data.player_id;
    const allowDuplicateCompletion = data.allow_duplicate_completion === true;

    if (!contractId || !playerId) {
      return createResult(false, "contract_complete_rejected", { reason: "contract_id_and_player_id_required" });
    }

    const current = this.store.load(contractId);
    if (!current) {
      return createResult(false, "contract_complete_rejected", { reason: "contract_not_found" });
    }

    if (isContractExpired(current, data.at_time)) {
      const expired = this.expireContract({ contract_id: contractId, at_time: data.at_time });
      return createResult(false, "contract_complete_rejected", {
        reason: "contract_expired",
        contract: expired.payload.contract
      });
    }

    if (current.completion_state === "completed" && !allowDuplicateCompletion) {
      return createResult(false, "contract_complete_rejected", { reason: "already_completed" });
    }

    if (current.claim_state !== "claimed" || current.claimed_by !== String(playerId)) {
      return createResult(false, "contract_complete_rejected", { reason: "not_claimed_by_player" });
    }

    const updated = createContractRecord({
      ...current,
      completion_state: "completed",
      updated_at: new Date().toISOString()
    });
    this.store.save(updated);

    // Contract board only emits completion payload. Reward granting happens elsewhere.
    return createResult(true, "contract_completed", {
      contract_id: updated.contract_id,
      claimed_by: updated.claimed_by,
      reward_data: clone(updated.reward_data),
      contract: clone(updated)
    });
  }

  expireContract(input) {
    const data = input || {};
    const contractId = data.contract_id;
    if (!contractId) {
      return createResult(false, "contract_expire_rejected", { reason: "contract_id_required" });
    }

    const current = this.store.load(contractId);
    if (!current) {
      return createResult(false, "contract_expire_rejected", { reason: "contract_not_found" });
    }

    if (current.completion_state === "completed") {
      return createResult(false, "contract_expire_rejected", { reason: "contract_already_completed" });
    }

    const updated = createContractRecord({
      ...current,
      claim_state: "expired",
      completion_state: "expired",
      claimed_by: current.claimed_by,
      updated_at: new Date().toISOString()
    });
    this.store.save(updated);

    return createResult(true, "contract_expired", {
      contract_id: updated.contract_id,
      contract: clone(updated)
    });
  }
}

module.exports = {
  CONTRACT_SCHEMA,
  VALID_CLAIM_STATES,
  VALID_COMPLETION_STATES,
  InMemoryContractStore,
  ContractHuntBoardManager,
  createContractRecord,
  isContractExpired
};
