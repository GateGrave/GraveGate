"use strict";

// State layer notes (documentation-only scaffolding).
// These notes explain where data belongs. They do not implement storage.
const STATE_LAYERS = {
  WORLD_STATE: {
    name: "world_state",
    purpose: "Long-lived global data shared across the game world.",
    examples: ["characters", "inventories", "global progression"]
  },
  SESSION_STATE: {
    name: "session_state",
    purpose: "Data for one active run or party session.",
    examples: ["party members", "current dungeon node", "session progress"]
  },
  COMBAT_STATE: {
    name: "combat_state",
    purpose: "Isolated data for one combat instance only.",
    examples: ["turn order", "temporary effects", "combat log snapshot"],
    isolation_rule: "Every combat record should be keyed by combat_id."
  }
};

// Event flow notes for beginners:
// 1) Gateway creates standard events.
// 2) Queue is the only path between systems.
// 3) Router dispatches by event_type.
// 4) Handlers may emit follow-up events.
// 5) Database remains the source of truth.
const EVENT_FLOW_NOTES = [
  "Gateway emits JSON events only; no gameplay logic in gateway.",
  "Queue handles communication between systems in FIFO order.",
  "Router chooses handlers using event_type values.",
  "Systems do not call each other directly; they emit events.",
  "Database is authoritative and should persist important state."
];

// Event contract notes for Stage 15 content growth.
// Keep this lightweight so schemas can evolve without a framework migration.
const EVENT_CONTRACT_NOTES = [
  "All events must include event_version. Current supported version: 1.",
  "Gateway-created events should use createEvent(...) from shared-types.",
  "Controller validates event contract/version before routing.",
  "World/session/combat handlers must preserve top-level event shape when emitting follow-up events.",
  "If contract fields need changes, introduce a new event_version and keep old version support explicit."
];

module.exports = {
  STATE_LAYERS,
  EVENT_FLOW_NOTES,
  EVENT_CONTRACT_NOTES
};
