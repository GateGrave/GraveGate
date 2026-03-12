"use strict";

// Sessions track temporary dungeon/party run context.
// Session State can be short-lived but should still be persisted when needed
// so the database remains authoritative for recoverable progress.
const sessionsSchema = {
  table: "sessions",
  description: "Session metadata and progression for a single run/activity.",
  primaryKey: "session_id",
  columns: {
    session_id: "string",
    guild_id: "string",
    state: "string",
    party_member_ids: "json",
    current_node_id: "string",
    started_at: "datetime",
    ended_at: "datetime"
  }
};

module.exports = {
  sessionsSchema
};