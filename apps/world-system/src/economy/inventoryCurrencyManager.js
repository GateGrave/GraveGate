"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildResult(ok, event_type, payload) {
  return {
    ok: Boolean(ok),
    event_type,
    payload: payload || {}
  };
}

function createInventoryCurrencyManager(input) {
  const data = input || {};
  const inventoryService = data.inventoryService;

  function loadInventoryByPlayerId(playerId) {
    if (!inventoryService || typeof inventoryService.listInventories !== "function") {
      return null;
    }
    const listed = inventoryService.listInventories();
    if (!listed || listed.ok !== true || !listed.payload) {
      return null;
    }
    const rows = Array.isArray(listed.payload.inventories) ? listed.payload.inventories : [];
    return rows.find((entry) => String(entry && entry.owner_id || "") === String(playerId || "")) || null;
  }

  function saveInventoryCurrency(inventory, nextGold) {
    const safeInventory = inventory && typeof inventory === "object" ? clone(inventory) : null;
    if (!safeInventory) {
      return buildResult(false, "currency_update_failed", {
        reason: "inventory_not_found"
      });
    }
    safeInventory.currency = safeInventory.currency && typeof safeInventory.currency === "object"
      ? clone(safeInventory.currency)
      : {};
    safeInventory.currency.gold = Math.max(0, Math.floor(Number(nextGold || 0)));

    const saved = inventoryService.saveInventory(safeInventory);
    if (!saved || saved.ok !== true) {
      return buildResult(false, "currency_update_failed", {
        reason: "inventory_save_failed",
        error: saved && saved.error ? saved.error : null
      });
    }

    return buildResult(true, "currency_updated", {
      balance_after: safeInventory.currency.gold,
      inventory_id: safeInventory.inventory_id
    });
  }

  return {
    getCurrencyAccount(player_id) {
      const inventory = loadInventoryByPlayerId(player_id);
      const gold = Number.isFinite(Number(inventory && inventory.currency && inventory.currency.gold))
        ? Math.max(0, Math.floor(Number(inventory.currency.gold)))
        : 0;
      return {
        player_id: String(player_id || ""),
        gold_balance: gold,
        balances: { gold }
      };
    },
    hasSufficientFunds(inputData) {
      const playerId = inputData && inputData.player_id ? String(inputData.player_id) : "";
      const amount = Number.isFinite(inputData && inputData.amount) ? Math.max(0, Math.floor(Number(inputData.amount))) : NaN;
      if (!playerId || !Number.isFinite(amount)) {
        return false;
      }
      const account = this.getCurrencyAccount(playerId);
      return Number(account.gold_balance || 0) >= amount;
    },
    addCurrency(inputData) {
      const playerId = inputData && inputData.player_id ? String(inputData.player_id) : "";
      const amount = Number.isFinite(inputData && inputData.amount) ? Math.max(0, Math.floor(Number(inputData.amount))) : NaN;
      if (!playerId || !Number.isFinite(amount)) {
        return buildResult(false, "currency_update_failed", { reason: "invalid_currency_request" });
      }
      const inventory = loadInventoryByPlayerId(playerId);
      if (!inventory) {
        return buildResult(false, "currency_update_failed", { reason: "inventory_not_found" });
      }
      const current = Number.isFinite(Number(inventory.currency && inventory.currency.gold))
        ? Math.max(0, Math.floor(Number(inventory.currency.gold)))
        : 0;
      return saveInventoryCurrency(inventory, current + amount);
    },
    subtractCurrency(inputData) {
      const playerId = inputData && inputData.player_id ? String(inputData.player_id) : "";
      const amount = Number.isFinite(inputData && inputData.amount) ? Math.max(0, Math.floor(Number(inputData.amount))) : NaN;
      if (!playerId || !Number.isFinite(amount)) {
        return buildResult(false, "currency_update_failed", { reason: "invalid_currency_request" });
      }
      const inventory = loadInventoryByPlayerId(playerId);
      if (!inventory) {
        return buildResult(false, "currency_update_failed", { reason: "inventory_not_found" });
      }
      const current = Number.isFinite(Number(inventory.currency && inventory.currency.gold))
        ? Math.max(0, Math.floor(Number(inventory.currency.gold)))
        : 0;
      if (current < amount) {
        return buildResult(false, "currency_subtract_rejected", {
          reason: "insufficient_funds",
          balance_current: current,
          amount_requested: amount
        });
      }
      return saveInventoryCurrency(inventory, current - amount);
    }
  };
}

module.exports = {
  createInventoryCurrencyManager
};
