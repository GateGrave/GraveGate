"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeListFromStore(store) {
  if (!store || typeof store.list !== "function") return [];
  return clone(store.list());
}

function clearStore(store) {
  if (!store) return;
  const mapKeys = ["accounts", "shops", "transactions"];
  for (const key of mapKeys) {
    if (store[key] instanceof Map) {
      store[key].clear();
    }
  }
}

function createEconomySnapshot(input) {
  const data = input || {};
  const currencyManager = data.currencyManager;
  const npcShopManager = data.npcShopManager;
  const playerShopManager = data.playerShopManager;
  const transactionManager = data.transactionManager || null;

  if (!currencyManager || !npcShopManager || !playerShopManager) {
    return {
      ok: false,
      event_type: "economy_snapshot_failed",
      payload: {
        reason: "currency_npc_shop_and_player_shop_managers_required"
      }
    };
  }

  const currencyAccounts = safeListFromStore(currencyManager.store);
  const npcShops = safeListFromStore(npcShopManager.store);
  const playerShops = safeListFromStore(playerShopManager.store);
  const transactions = transactionManager ? safeListFromStore(transactionManager.store) : [];

  const activeListings = [];
  for (const shop of playerShops) {
    const listings = Array.isArray(shop.listings) ? shop.listings : [];
    for (const listing of listings) {
      if (listing.listing_active !== false) {
        activeListings.push({
          shop_id: shop.shop_id,
          owner_player_id: shop.owner_player_id,
          listing: clone(listing)
        });
      }
    }
  }

  return {
    ok: true,
    event_type: "economy_snapshot_created",
    payload: {
      snapshot_id: `econ-snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      created_at: new Date().toISOString(),
      currency_accounts: currencyAccounts,
      npc_shops: npcShops,
      player_shops: playerShops,
      active_listings: activeListings,
      transactions
    }
  };
}

function restoreEconomySnapshot(input) {
  const data = input || {};
  const snapshot = data.snapshot;
  const currencyManager = data.currencyManager;
  const npcShopManager = data.npcShopManager;
  const playerShopManager = data.playerShopManager;
  const transactionManager = data.transactionManager || null;

  if (!snapshot || typeof snapshot !== "object") {
    return {
      ok: false,
      event_type: "economy_snapshot_restore_failed",
      payload: {
        reason: "snapshot_object_required"
      }
    };
  }
  if (!Array.isArray(snapshot.currency_accounts) || !Array.isArray(snapshot.npc_shops) || !Array.isArray(snapshot.player_shops)) {
    return {
      ok: false,
      event_type: "economy_snapshot_restore_failed",
      payload: {
        reason: "snapshot_missing_required_arrays"
      }
    };
  }
  if (!currencyManager || !npcShopManager || !playerShopManager) {
    return {
      ok: false,
      event_type: "economy_snapshot_restore_failed",
      payload: {
        reason: "currency_npc_shop_and_player_shop_managers_required"
      }
    };
  }

  clearStore(currencyManager.store);
  clearStore(npcShopManager.store);
  clearStore(playerShopManager.store);
  if (transactionManager) {
    clearStore(transactionManager.store);
  }

  for (const account of snapshot.currency_accounts) {
    currencyManager.store.save(clone(account));
  }
  for (const shop of snapshot.npc_shops) {
    npcShopManager.store.save(clone(shop));
  }
  for (const shop of snapshot.player_shops) {
    playerShopManager.store.save(clone(shop));
  }
  if (transactionManager && Array.isArray(snapshot.transactions)) {
    for (const row of snapshot.transactions) {
      transactionManager.store.save(clone(row));
    }
  }

  return {
    ok: true,
    event_type: "economy_snapshot_restored",
    payload: {
      restored_at: new Date().toISOString(),
      counts: {
        currency_accounts: snapshot.currency_accounts.length,
        npc_shops: snapshot.npc_shops.length,
        player_shops: snapshot.player_shops.length,
        transactions: Array.isArray(snapshot.transactions) ? snapshot.transactions.length : 0
      }
    }
  };
}

module.exports = {
  createEconomySnapshot,
  restoreEconomySnapshot
};

