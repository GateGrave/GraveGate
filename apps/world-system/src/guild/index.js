"use strict";

const { GUILD_SCHEMA, createGuildRecord } = require("./guild.schema");
const { InMemoryGuildStore, GuildManager } = require("./guild.manager");
const { GUILD_STORAGE_SCHEMA, createGuildStorageRecord } = require("./guild-storage.schema");
const { InMemoryGuildStorageStore, GuildStorageManager } = require("./guild-storage.manager");
const {
  InMemoryGuildInviteStore,
  inviteMemberToGuild,
  acceptGuildInvite,
  declineGuildInvite,
  leaveGuild,
  kickGuildMember,
  promoteGuildOfficer,
  demoteGuildOfficer,
  transferGuildLeadership
} = require("./guild-membership.flow");
const {
  ProcessedGuildStorageWithdrawalStore,
  depositItemToGuildStorage,
  withdrawItemFromGuildStorage,
  listGuildStorageContents
} = require("./guild-shared-storage.flow");
const {
  ProcessedGuildProgressionStore,
  DEFAULT_GUILD_LEVEL_THRESHOLDS,
  DEFAULT_GUILD_MILESTONES,
  addGuildXp,
  checkGuildLevelUp,
  getGuildMilestones
} = require("./guild-progression.system");
const { GuildPersistenceBridge } = require("./guild.persistence");

const defaultGuildManager = new GuildManager();
const defaultGuildStorageManager = new GuildStorageManager();

function createGuild(input) {
  return defaultGuildManager.createGuild(input);
}

function getGuild(guild_id) {
  return defaultGuildManager.getGuild(guild_id);
}

function updateGuild(guild_id, updater) {
  return defaultGuildManager.updateGuild(guild_id, updater);
}

function deleteGuild(guild_id) {
  return defaultGuildManager.deleteGuild(guild_id);
}

function listGuildMembers(guild_id) {
  return defaultGuildManager.listGuildMembers(guild_id);
}

function listGuildOfficers(guild_id) {
  return defaultGuildManager.listGuildOfficers(guild_id);
}

function getGuildStorage(guild_id) {
  return defaultGuildStorageManager.getGuildStorage(guild_id);
}

function ensureGuildStorage(guild_id) {
  return defaultGuildStorageManager.ensureGuildStorage(guild_id);
}

module.exports = {
  GUILD_SCHEMA,
  createGuildRecord,
  InMemoryGuildStore,
  GuildManager,
  defaultGuildManager,
  createGuild,
  getGuild,
  updateGuild,
  deleteGuild,
  listGuildMembers,
  listGuildOfficers,
  GUILD_STORAGE_SCHEMA,
  createGuildStorageRecord,
  InMemoryGuildStorageStore,
  GuildStorageManager,
  defaultGuildStorageManager,
  getGuildStorage,
  ensureGuildStorage,
  InMemoryGuildInviteStore,
  inviteMemberToGuild,
  acceptGuildInvite,
  declineGuildInvite,
  leaveGuild,
  kickGuildMember,
  promoteGuildOfficer,
  demoteGuildOfficer,
  transferGuildLeadership,
  ProcessedGuildStorageWithdrawalStore,
  depositItemToGuildStorage,
  withdrawItemFromGuildStorage,
  listGuildStorageContents,
  ProcessedGuildProgressionStore,
  DEFAULT_GUILD_LEVEL_THRESHOLDS,
  DEFAULT_GUILD_MILESTONES,
  addGuildXp,
  checkGuildLevelUp,
  getGuildMilestones,
  GuildPersistenceBridge
};
