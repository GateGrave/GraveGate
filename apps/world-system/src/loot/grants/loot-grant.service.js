"use strict";

const { InventoryGrantAdapter } = require("./inventory-grant.adapter");
const { LootDropManager } = require("../loot-drop.manager");

class ProcessedLootGrantStore {
  constructor() {
    this.processed = new Set();
  }

  has(grantKey) {
    if (!grantKey) return false;
    return this.processed.has(grantKey);
  }

  add(grantKey) {
    if (!grantKey) return;
    this.processed.add(grantKey);
  }
}

function createLootRecordForDrop(drop, source, meta, index) {
  return {
    loot_id: `loot-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    source_type: String(source.source_type || "unknown"),
    source_id: String(source.source_id || "unknown"),
    party_id: source.party_id || null,
    player_id: source.player_id || null,
    item_id: String(drop.item_id),
    quantity: Number.isFinite(drop.quantity) ? drop.quantity : 1,
    rarity: String(drop.rarity || "common"),
    drop_type: String(drop.drop_type || "generated"),
    granted: false,
    created_at: new Date().toISOString(),
    metadata: meta || {}
  };
}

function computeGrantStatus(successCount, failureCount) {
  if (successCount > 0 && failureCount === 0) return "success";
  if (successCount > 0 && failureCount > 0) return "partial_success";
  return "failure";
}

/**
 * Grant generated loot into inventory through a clean adapter boundary.
 * Input expects a structured loot-generated style payload:
 * {
 *   source_type, source_id, party_id?, player_id?,
 *   loot_result: { all_drops: [...] } OR { all_drops: [...] }
 * }
 */
function applyGeneratedLootToInventory(input) {
  const data = input || {};
  const payload = data.loot_payload || {};
  const worldStorage = data.worldStorage || null;

  if (!worldStorage?.inventories || !worldStorage?.items) {
    return {
      ok: false,
      event_type: "loot_grant_failed",
      payload: {
        status: "failure",
        reason: "world_storage_inventory_and_item_store_required"
      }
    };
  }

  const allDrops = Array.isArray(payload.loot_result?.all_drops)
    ? payload.loot_result.all_drops
    : Array.isArray(payload.all_drops)
      ? payload.all_drops
      : [];

  if (allDrops.length === 0) {
    return {
      ok: false,
      event_type: "loot_grant_failed",
      payload: {
        status: "failure",
        reason: "no_generated_drops_found"
      }
    };
  }

  const adapter = data.inventoryAdapter || new InventoryGrantAdapter({
    inventoryStore: worldStorage.inventories,
    itemStore: worldStorage.items
  });

  const lootManager = data.lootDropManager || new LootDropManager();
  const inventoryId = data.inventory_id || payload.inventory_id || `inv-${payload.player_id || "unknown"}`;
  const ownerCharacterId = data.owner_character_id || payload.player_id || "unknown";
  const processedGrantStore = data.processedGrantStore || null;
  const allowDuplicateGrants = Boolean(data.allow_duplicate_grants);

  const source = {
    source_type: payload.source_type,
    source_id: payload.source_id,
    party_id: payload.party_id || payload.context?.party_id || null,
    player_id: payload.player_id || payload.context?.player_id || null
  };
  const grantKey =
    data.grant_key ||
    payload.grant_key ||
    payload.generated_from_event_id ||
    `${source.source_type || "unknown"}:${source.source_id || "unknown"}:${ownerCharacterId}:${inventoryId}`;

  if (!allowDuplicateGrants && processedGrantStore && typeof processedGrantStore.has === "function") {
    if (processedGrantStore.has(grantKey)) {
      return {
        ok: true,
        event_type: "loot_grant_skipped",
        payload: {
          status: "skipped",
          reason: "duplicate_grant_attempt",
          grant_key: grantKey,
          source_type: source.source_type || null,
          source_id: source.source_id || null,
          inventory_id: inventoryId,
          owner_character_id: ownerCharacterId,
          totals: {
            drops_received: allDrops.length,
            granted: 0,
            failed: 0
          },
          drop_results: [],
          grant_status: "skipped",
          processed_at: new Date().toISOString()
        }
      };
    }
  }

  const perDropResults = [];
  let successCount = 0;
  let failureCount = 0;

  allDrops.forEach((drop, index) => {
    const lootRecord = lootManager.createLootDrop(
      createLootRecordForDrop(drop, source, { grant_batch: data.grant_batch_id || null }, index)
    );

    let grantResult;
    try {
      grantResult = adapter.addDropToInventory({
        inventory_id: inventoryId,
        owner_character_id: ownerCharacterId,
        drop
      });
    } catch (error) {
      grantResult = {
        ok: false,
        reason: "inventory_write_failed",
        message: error.message
      };
    }

    if (grantResult.ok) {
      lootManager.updateLootDrop(lootRecord.loot_id, {
        granted: true
      });
      successCount += 1;
    } else {
      failureCount += 1;
    }

    perDropResults.push({
      loot_id: lootRecord.loot_id,
      item_id: drop.item_id,
      requested_quantity: drop.quantity,
      granted: grantResult.ok,
      result: grantResult
    });
  });

  const status = computeGrantStatus(successCount, failureCount);
  const eventType =
    status === "success"
      ? "loot_grant_success"
      : status === "partial_success"
        ? "loot_grant_partial_success"
        : "loot_grant_failed";

  if (!allowDuplicateGrants && processedGrantStore && typeof processedGrantStore.add === "function") {
    processedGrantStore.add(grantKey);
  }

  return {
    ok: status !== "failure",
    event_type: eventType,
    payload: {
      status,
      grant_key: grantKey,
      source_type: source.source_type || null,
      source_id: source.source_id || null,
      inventory_id: inventoryId,
      owner_character_id: ownerCharacterId,
      totals: {
        drops_received: allDrops.length,
        granted: successCount,
        failed: failureCount
      },
      drop_results: perDropResults,
      grant_status: status,
      processed_at: new Date().toISOString()
    }
  };
}

module.exports = {
  InventoryGrantAdapter,
  ProcessedLootGrantStore,
  applyGeneratedLootToInventory
};
