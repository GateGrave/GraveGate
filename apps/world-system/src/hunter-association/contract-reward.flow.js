"use strict";

const { grantLootToInventory } = require("../loot/flow/grantLootToInventory");

class ProcessedContractRewardStore {
  constructor() {
    this.claims = new Set();
  }

  has(claimKey) {
    if (!claimKey) return false;
    return this.claims.has(String(claimKey));
  }

  add(claimKey) {
    if (!claimKey) return;
    this.claims.add(String(claimKey));
  }
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

function toLootEntries(rewardData, contractId) {
  const items = Array.isArray(rewardData && rewardData.items) ? rewardData.items : [];
  return items
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      item_id: String(entry.item_id || "").trim(),
      quantity: Number.isFinite(entry.quantity) ? Math.max(1, Math.floor(Number(entry.quantity))) : 1,
      item_name: entry.item_name ? String(entry.item_name) : undefined,
      rarity: entry.rarity ? String(entry.rarity) : undefined,
      stackable: entry.stackable !== false,
      metadata: {
        ...(entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata) ? entry.metadata : {}),
        source_type: "hunter_contract",
        source_id: contractId
      }
    }))
    .filter((entry) => entry.item_id !== "");
}

function normalizeRewardUpdate(rewardData, claimKey) {
  const currency = rewardData && rewardData.currency && typeof rewardData.currency === "object" && !Array.isArray(rewardData.currency)
    ? rewardData.currency
    : {};

  return {
    reward_key: claimKey,
    gold: Number.isFinite(rewardData && rewardData.gold) ? Math.max(0, Math.floor(Number(rewardData.gold))) : 0,
    silver: Number.isFinite(currency.silver) ? Math.max(0, Math.floor(Number(currency.silver))) : 0,
    copper: Number.isFinite(currency.copper) ? Math.max(0, Math.floor(Number(currency.copper))) : 0,
    xp: Number.isFinite(rewardData && rewardData.xp) ? Math.max(0, Math.floor(Number(rewardData.xp))) : 0
  };
}

function executeCanonicalContractReward(input) {
  const data = input || {};
  const rewardData = data.reward_data && typeof data.reward_data === "object" ? data.reward_data : {};
  return grantLootToInventory({
    inventory: data.inventory,
    inventory_id: data.inventory_id,
    inventory_service: data.inventory_service,
    inventory_ref: data.inventory_ref,
    resolve_inventory_fn: data.resolve_inventory_fn,
    owner_id: data.owner_id || data.player_id,
    owner_player_id: data.owner_player_id || data.player_id,
    owner_type: data.owner_type || "player",
    character_id: data.character_id,
    characterPersistence: data.characterPersistence,
    character_service: data.character_service,
    resolve_character_id_fn: data.resolve_character_id_fn,
    loot_bundle: {
      drop_id: "contract-reward-" + data.contract_id,
      source_type: "hunter_contract",
      source_id: data.contract_id,
      entries: toLootEntries(rewardData, data.contract_id),
      metadata: {
        reward_key: data.claim_key,
        reward_update: normalizeRewardUpdate(rewardData, data.claim_key)
      }
    },
    reward_update: normalizeRewardUpdate(rewardData, data.claim_key),
    grant_key: data.claim_key,
    processed_grant_store: data.processed_grant_store || null
  });
}

function processContractCompletionReward(input) {
  const data = input || {};
  const contractManager = data.contractManager;
  const rewardProcessor = data.rewardProcessor;
  const processedRewardStore = data.processedRewardStore || new ProcessedContractRewardStore();
  const contractId = String(data.contract_id || "").trim();
  const playerId = String(data.player_id || "").trim();
  const claimKey = contractId + ":" + playerId;

  if (!contractManager || typeof contractManager.completeContract !== "function") {
    return failure("contract_reward_processing_failed", "contractManager with completeContract is required");
  }
  if (!contractId || !playerId) {
    return failure("contract_reward_processing_failed", "contract_id and player_id are required");
  }
  if (processedRewardStore.has(claimKey)) {
    return failure("contract_reward_processing_failed", "duplicate_contract_reward_claim", {
      claim_key: claimKey
    });
  }

  let completion;
  const currentContract =
    typeof contractManager.getContract === "function"
      ? contractManager.getContract(contractId)
      : null;

  if (
    currentContract &&
    currentContract.completion_state === "completed" &&
    String(currentContract.claimed_by || "") === playerId
  ) {
    completion = {
      ok: true,
      event_type: "contract_completed",
      payload: {
        contract_id: currentContract.contract_id,
        claimed_by: currentContract.claimed_by,
        reward_data: currentContract.reward_data || {},
        contract: currentContract
      }
    };
  } else {
    completion = contractManager.completeContract({
      contract_id: contractId,
      player_id: playerId
    });
    if (!completion.ok) {
      return failure("contract_reward_processing_failed", completion.payload.reason || completion.error || "contract completion failed", {
        completion_result: completion
      });
    }
  }

  const rewardResult = typeof rewardProcessor === "function"
    ? rewardProcessor({
      contract_id: contractId,
      player_id: playerId,
      reward_data: completion.payload.reward_data || {},
      contract: completion.payload.contract || null
    })
    : executeCanonicalContractReward({
    contract_id: contractId,
    player_id: playerId,
    claim_key: claimKey,
    reward_data: completion.payload.reward_data || {},
    contract: completion.payload.contract || null,
    inventory: data.inventory,
    inventory_id: data.inventory_id,
    inventory_service: data.inventory_service,
    inventory_ref: data.inventory_ref,
    resolve_inventory_fn: data.resolve_inventory_fn,
    owner_id: data.owner_id,
    owner_player_id: data.owner_player_id,
    owner_type: data.owner_type,
    character_id: data.character_id,
    characterPersistence: data.characterPersistence,
    character_service: data.character_service,
    resolve_character_id_fn: data.resolve_character_id_fn,
    processed_grant_store: data.processed_grant_store || null
  });
  if (!rewardResult || rewardResult.ok !== true) {
    return failure("contract_reward_processing_failed", "reward processor failed", {
      completion_result: completion,
      reward_result: rewardResult || null
    });
  }

  processedRewardStore.add(claimKey);
  return success("contract_reward_processed", {
    contract_id: contractId,
    player_id: playerId,
    claim_key: claimKey,
    reward_result: rewardResult.payload || {}
  });
}

module.exports = {
  ProcessedContractRewardStore,
  processContractCompletionReward
};
