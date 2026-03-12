"use strict";

// Combats must be isolated per combat_instance_id.
// Combat State should never leak data between simultaneous combats.
const combatsSchema = {
  table: "combats",
  description: "Isolated combat instance snapshots and turn-order state.",
  primaryKey: "combat_instance_id",
  columns: {
    combat_instance_id: "string",
    session_id: "string",
    status: "string",
    round_number: "number",
    turn_order: "json",
    participant_states: "json",
    started_at: "datetime",
    ended_at: "datetime"
  },
  isolationRule: "All reads/writes must filter by combat_instance_id."
};

module.exports = {
  combatsSchema
};