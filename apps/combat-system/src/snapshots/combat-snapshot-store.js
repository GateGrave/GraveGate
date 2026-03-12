"use strict";

const fs = require("fs");
const path = require("path");
const { createCombatSnapshot } = require("./create-combat-snapshot");

class CombatSnapshotStore {
  constructor(options) {
    const input = options || {};
    this.snapshotsByCombatId = new Map();
    this.persistToDisk = input.persist_to_disk !== false;
    this.snapshotsDir =
      input.snapshots_dir ||
      path.join(process.cwd(), "apps", "combat-system", "data", "snapshots");

    if (this.persistToDisk) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
      this.loadFromDisk();
    }
  }

  getSnapshotFilePath(combatId) {
    return path.join(this.snapshotsDir, `${combatId}.latest.json`);
  }

  loadFromDisk() {
    const files = fs.readdirSync(this.snapshotsDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".latest.json")) {
        continue;
      }

      const fullPath = path.join(this.snapshotsDir, file.name);
      const raw = fs.readFileSync(fullPath, "utf-8");
      const snapshot = JSON.parse(raw);
      if (!snapshot || !snapshot.combat_id) {
        continue;
      }

      this.snapshotsByCombatId.set(snapshot.combat_id, [snapshot]);
    }
  }

  saveSnapshot(combatState) {
    const snapshot = createCombatSnapshot(combatState);
    const existing = this.snapshotsByCombatId.get(snapshot.combat_id) || [];
    existing.push(snapshot);
    this.snapshotsByCombatId.set(snapshot.combat_id, existing);

    if (this.persistToDisk) {
      fs.writeFileSync(
        this.getSnapshotFilePath(snapshot.combat_id),
        JSON.stringify(snapshot, null, 2),
        "utf-8"
      );
    }

    return snapshot;
  }

  getLatestSnapshot(combatId) {
    const entries = this.snapshotsByCombatId.get(combatId) || [];
    return entries.length > 0 ? entries[entries.length - 1] : null;
  }

  recoverCombatState(combatId) {
    const latest = this.getLatestSnapshot(combatId);
    if (!latest) {
      return null;
    }

    return latest.combat_state || null;
  }
}

module.exports = {
  CombatSnapshotStore
};
