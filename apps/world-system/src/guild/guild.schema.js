"use strict";

const GUILD_SCHEMA = {
  guild_id: "string",
  guild_name: "string",
  guild_tag: "string",
  leader_id: "string",
  officer_ids: "array",
  member_ids: "array",
  guild_level: "number",
  guild_xp: "number",
  guild_status: "string",
  milestones_unlocked: "array",
  progression_history: "array",
  created_at: "string (ISO date)",
  updated_at: "string (ISO date)"
};

function normalizeIdArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(fieldName + " must be an array");
  }

  const normalized = value.map((entry) => String(entry)).filter((entry) => entry.trim() !== "");
  const unique = Array.from(new Set(normalized));
  return unique;
}

function createGuildRecord(input) {
  const data = input || {};

  if (!data.guild_id || String(data.guild_id).trim() === "") {
    throw new Error("createGuild requires guild_id");
  }
  if (!data.guild_name || String(data.guild_name).trim() === "") {
    throw new Error("createGuild requires guild_name");
  }
  if (!data.guild_tag || String(data.guild_tag).trim() === "") {
    throw new Error("createGuild requires guild_tag");
  }
  if (!data.leader_id || String(data.leader_id).trim() === "") {
    throw new Error("createGuild requires leader_id");
  }

  const memberIds = normalizeIdArray(data.member_ids || [], "member_ids");
  const officerIds = normalizeIdArray(data.officer_ids || [], "officer_ids");
  const leaderId = String(data.leader_id);

  if (memberIds.length === 0) {
    throw new Error("createGuild requires at least one member_id");
  }
  if (!memberIds.includes(leaderId)) {
    throw new Error("leader_id must be included in member_ids");
  }

  const officersAreMembers = officerIds.every((id) => memberIds.includes(id));
  if (!officersAreMembers) {
    throw new Error("officer_ids must all be included in member_ids");
  }

  const guildLevel = Number.isFinite(data.guild_level) ? Math.max(1, Math.floor(data.guild_level)) : 1;
  const guildXp = Number.isFinite(data.guild_xp) ? Math.max(0, Math.floor(data.guild_xp)) : 0;
  const guildStatus = data.guild_status ? String(data.guild_status) : "active";
  const milestonesUnlocked = normalizeIdArray(data.milestones_unlocked || [], "milestones_unlocked");
  const progressionHistory = Array.isArray(data.progression_history) ? data.progression_history : [];
  const now = new Date().toISOString();

  return {
    guild_id: String(data.guild_id),
    guild_name: String(data.guild_name),
    guild_tag: String(data.guild_tag),
    leader_id: leaderId,
    officer_ids: officerIds,
    member_ids: memberIds,
    guild_level: guildLevel,
    guild_xp: guildXp,
    guild_status: guildStatus,
    milestones_unlocked: milestonesUnlocked,
    progression_history: progressionHistory,
    created_at: data.created_at || now,
    updated_at: data.updated_at || now
  };
}

module.exports = {
  GUILD_SCHEMA,
  createGuildRecord
};
