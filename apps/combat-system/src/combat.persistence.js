"use strict";

const { createInMemoryAdapter } = require("../../database/src/adapters/inMemoryAdapter");
const { validateAdapterContract } = require("../../database/src/adapters/databaseAdapter.interface");
const { createCombatSnapshot } = require("./snapshots/create-combat-snapshot");

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

class CombatPersistenceBridge {
  constructor(options) {
    const cfg = options || {};
    this.adapter = cfg.adapter || createInMemoryAdapter();
    this.collection = cfg.collection ? String(cfg.collection) : "combat_snapshots";

    const contract = validateAdapterContract(this.adapter);
    if (!contract.ok) {
      throw new Error(contract.error);
    }
  }

  validateStoredSnapshotShape(snapshot) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return { ok: false, error: "stored snapshot data is not an object" };
    }
    if (!snapshot.snapshot_id || String(snapshot.snapshot_id).trim() === "") {
      return { ok: false, error: "stored snapshot data is missing snapshot_id" };
    }
    if (!snapshot.combat_id || String(snapshot.combat_id).trim() === "") {
      return { ok: false, error: "stored snapshot data is missing combat_id" };
    }
    return { ok: true, error: null };
  }

  saveCombatSnapshot(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return failure("combat_snapshot_persistence_save_failed", "snapshot input must be an object");
    }

    let snapshot = null;
    if (input.snapshot && typeof input.snapshot === "object" && !Array.isArray(input.snapshot)) {
      snapshot = clone(input.snapshot);
    } else if (input.combat_state && typeof input.combat_state === "object") {
      snapshot = createCombatSnapshot(input.combat_state);
    } else if (input.combat_id && input.snapshot_timestamp) {
      snapshot = clone(input);
    } else {
      return failure(
        "combat_snapshot_persistence_save_failed",
        "snapshot, combat_state, or snapshot-like object is required"
      );
    }

    if (!snapshot.snapshot_id || String(snapshot.snapshot_id).trim() === "") {
      return failure("combat_snapshot_persistence_save_failed", "snapshot_id is required");
    }

    const saveOut = typeof this.adapter.saveCombat === "function"
      ? this.adapter.saveCombat(String(snapshot.snapshot_id), snapshot)
      : this.adapter.save(this.collection, String(snapshot.snapshot_id), snapshot);
    if (!saveOut.ok) {
      return failure("combat_snapshot_persistence_save_failed", saveOut.error || "adapter save failed", {
        adapter_result: saveOut
      });
    }

    return success("combat_snapshot_persistence_saved", {
      snapshot: clone(saveOut.payload.record)
    });
  }

  loadCombatSnapshotById(snapshotId) {
    if (!snapshotId || String(snapshotId).trim() === "") {
      return failure("combat_snapshot_persistence_load_failed", "snapshot_id is required");
    }

    const out = typeof this.adapter.getCombatById === "function"
      ? this.adapter.getCombatById(String(snapshotId))
      : this.adapter.getById(this.collection, String(snapshotId));
    if (!out.ok) {
      return failure("combat_snapshot_persistence_load_failed", out.error || "adapter getById failed", {
        adapter_result: out
      });
    }
    if (!out.payload.record) {
      return failure("combat_snapshot_persistence_load_failed", "snapshot not found", {
        snapshot_id: String(snapshotId)
      });
    }

    const validation = this.validateStoredSnapshotShape(out.payload.record);
    if (!validation.ok) {
      return failure("combat_snapshot_persistence_load_failed", validation.error, {
        snapshot_id: String(snapshotId)
      });
    }

    return success("combat_snapshot_persistence_loaded", { snapshot: clone(out.payload.record) });
  }

  listCombatSnapshots() {
    const out = typeof this.adapter.listCombats === "function"
      ? this.adapter.listCombats()
      : this.adapter.list(this.collection);
    if (!out.ok) {
      return failure("combat_snapshot_persistence_list_failed", out.error || "adapter list failed", {
        adapter_result: out
      });
    }

    const snapshots = [];
    if (Array.isArray(out.payload.records)) {
      for (const row of out.payload.records) {
        const validation = this.validateStoredSnapshotShape(row.record);
        if (!validation.ok) {
          return failure("combat_snapshot_persistence_list_failed", validation.error, {
            row_id: row && row.id ? String(row.id) : null
          });
        }
        snapshots.push(clone(row.record));
      }
    }

    return success("combat_snapshot_persistence_listed", {
      snapshots
    });
  }

  deleteCombatSnapshot(snapshotId) {
    if (!snapshotId || String(snapshotId).trim() === "") {
      return failure("combat_snapshot_persistence_delete_failed", "snapshot_id is required");
    }

    const out = typeof this.adapter.deleteCombat === "function"
      ? this.adapter.deleteCombat(String(snapshotId))
      : this.adapter.delete(this.collection, String(snapshotId));
    if (!out.ok) {
      return failure("combat_snapshot_persistence_delete_failed", out.error || "adapter delete failed", {
        adapter_result: out
      });
    }

    return success("combat_snapshot_persistence_deleted", {
      snapshot_id: String(snapshotId),
      deleted: Boolean(out.payload.deleted)
    });
  }
}

module.exports = {
  CombatPersistenceBridge
};
