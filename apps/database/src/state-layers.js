"use strict";

// State layer definitions for Phase 1 scaffolding.
// These definitions document boundaries; they do not implement storage logic.

// WORLD STATE (persistent, global):
// - Long-lived entities shared across the whole game world.
// - Examples: characters, inventories, account-level progression, static world data.
// - Database is authoritative for all persistent world records.
const WORLD_STATE = {
  name: "world_state",
  persistence: "persistent",
  authoritative_store: "database",
  includes: ["characters", "inventories", "global progression", "world metadata"]
};

// SESSION STATE (semi-persistent, run-scoped):
// - Data for one party run, dungeon session, or activity.
// - Examples: active party members, current dungeon node, session progress.
// - May be cached in memory, but database should remain source of truth for recovery.
const SESSION_STATE = {
  name: "session_state",
  persistence: "recoverable",
  authoritative_store: "database",
  includes: ["session metadata", "party composition", "session progress", "run checkpoints"]
};

// COMBAT STATE (isolated per encounter):
// - Data for one combat instance only.
// - Examples: turn order, initiative, per-entity temporary effects, HP snapshots.
// - Combat instances must be isolated; never mix states across combat_instance_id.
const COMBAT_STATE = {
  name: "combat_state",
  persistence: "encounter-scoped",
  authoritative_store: "database",
  includes: ["turn order", "initiative", "temporary combat effects", "combat log snapshot"],
  isolation_key: "combat_instance_id",
  isolation_rule: "Every combat query and write must include combat_instance_id."
};

module.exports = {
  WORLD_STATE,
  SESSION_STATE,
  COMBAT_STATE
};