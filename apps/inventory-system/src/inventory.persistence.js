"use strict";

const { createInMemoryAdapter } = require("../../database/src/adapters/inMemoryAdapter");
const { validateAdapterContract } = require("../../database/src/adapters/databaseAdapter.interface");
const { createInventoryRecord } = require("./inventory.schema");

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

class InventoryPersistenceBridge {
  constructor(options) {
    const cfg = options || {};
    this.adapter = cfg.adapter || createInMemoryAdapter();
    this.collection = cfg.collection ? String(cfg.collection) : "inventories";

    const contract = validateAdapterContract(this.adapter);
    if (!contract.ok) {
      throw new Error(contract.error);
    }
  }

  saveInventory(inventory) {
    if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) {
      return failure("inventory_persistence_save_failed", "inventory must be an object");
    }

    const normalized = createInventoryRecord(inventory);
    const inventoryId = normalized.inventory_id;
    if (!inventoryId || String(inventoryId).trim() === "") {
      return failure("inventory_persistence_save_failed", "inventory.inventory_id is required");
    }

    const out = this.adapter.save(this.collection, String(inventoryId), normalized);
    if (!out.ok) {
      return failure("inventory_persistence_save_failed", out.error || "adapter save failed", {
        adapter_result: out
      });
    }

    return success("inventory_persistence_saved", {
      inventory: clone(out.payload.record)
    });
  }

  loadInventoryById(inventoryId) {
    if (!inventoryId || String(inventoryId).trim() === "") {
      return failure("inventory_persistence_load_failed", "inventory_id is required");
    }

    const out = this.adapter.getById(this.collection, String(inventoryId));
    if (!out.ok) {
      return failure("inventory_persistence_load_failed", out.error || "adapter getById failed", {
        adapter_result: out
      });
    }
    if (!out.payload.record) {
      return failure("inventory_persistence_load_failed", "inventory not found", {
        inventory_id: String(inventoryId)
      });
    }

    return success("inventory_persistence_loaded", {
      inventory: clone(out.payload.record)
    });
  }

  listInventories() {
    const out = this.adapter.list(this.collection);
    if (!out.ok) {
      return failure("inventory_persistence_list_failed", out.error || "adapter list failed", {
        adapter_result: out
      });
    }

    const inventories = Array.isArray(out.payload.records)
      ? out.payload.records.map(function mapRow(row) {
          return clone(row.record);
        })
      : [];

    return success("inventory_persistence_listed", {
      inventories
    });
  }

  deleteInventory(inventoryId) {
    if (!inventoryId || String(inventoryId).trim() === "") {
      return failure("inventory_persistence_delete_failed", "inventory_id is required");
    }

    const out = this.adapter.delete(this.collection, String(inventoryId));
    if (!out.ok) {
      return failure("inventory_persistence_delete_failed", out.error || "adapter delete failed", {
        adapter_result: out
      });
    }

    return success("inventory_persistence_deleted", {
      inventory_id: String(inventoryId),
      deleted: Boolean(out.payload.deleted)
    });
  }
}

module.exports = {
  InventoryPersistenceBridge
};

