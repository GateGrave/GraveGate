"use strict";

const { RAID_SCHEMA, VALID_RAID_STATUSES, createRaidRecord } = require("./raid.schema");
const { InMemoryRaidStore, RaidManager } = require("./raid.manager");
const {
  joinRaidParty,
  leaveRaidParty,
  markRaidPartyReady,
  markRaidPlayerReady,
  setRaidCoordinationLock,
  validateMultiPartyParticipation
} = require("./raid-coordination.flow");

const defaultRaidManager = new RaidManager();

function createRaidInstance(input) {
  return defaultRaidManager.createRaidInstance(input);
}

function getRaidInstance(raid_id) {
  return defaultRaidManager.getRaidInstance(raid_id);
}

function updateRaidInstance(raid_id, updater) {
  return defaultRaidManager.updateRaidInstance(raid_id, updater);
}

function deleteRaidInstance(raid_id) {
  return defaultRaidManager.deleteRaidInstance(raid_id);
}

function listRaidParticipants(raid_id) {
  return defaultRaidManager.listRaidParticipants(raid_id);
}

module.exports = {
  RAID_SCHEMA,
  VALID_RAID_STATUSES,
  createRaidRecord,
  InMemoryRaidStore,
  RaidManager,
  defaultRaidManager,
  createRaidInstance,
  getRaidInstance,
  updateRaidInstance,
  deleteRaidInstance,
  listRaidParticipants,
  joinRaidParty,
  leaveRaidParty,
  markRaidPartyReady,
  markRaidPlayerReady,
  setRaidCoordinationLock,
  validateMultiPartyParticipation
};
