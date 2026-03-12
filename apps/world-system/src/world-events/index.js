"use strict";

const { WORLD_EVENT_SCHEMA, createWorldEventRecord } = require("./world-event.schema");
const { InMemoryWorldEventStore, WorldEventManager } = require("./world-event.manager");
const {
  WORLD_BOSS_SCHEMA,
  InMemoryWorldBossStore,
  ProcessedWorldBossRewardClaimStore,
  WorldBossManager,
  registerWorldBossParticipation,
  trackWorldBossContribution,
  markWorldBossDefeated,
  generateWorldBossRewardTrigger,
  claimWorldBossReward
} = require("./world-boss.system");
const {
  SEASONAL_EVENT_SCHEMA,
  InMemorySeasonalEventStore,
  SeasonalEventManager,
  createSeasonalEventRecord,
  isSeasonalEventActiveWindow,
  validateSeasonalParticipation,
  getSeasonalRewardVariantHooks
} = require("./seasonal-event.system");

const defaultWorldEventManager = new WorldEventManager();
const defaultWorldBossManager = new WorldBossManager();
const defaultSeasonalEventManager = new SeasonalEventManager();

function createWorldEvent(input) {
  return defaultWorldEventManager.createWorldEvent(input);
}

function getWorldEvent(event_id) {
  return defaultWorldEventManager.getWorldEvent(event_id);
}

function updateWorldEvent(event_id, updater) {
  return defaultWorldEventManager.updateWorldEvent(event_id, updater);
}

function closeWorldEvent(event_id, options) {
  return defaultWorldEventManager.closeWorldEvent(event_id, options);
}

function listActiveWorldEvents() {
  return defaultWorldEventManager.listActiveWorldEvents();
}

function createSeasonalEvent(input) {
  return defaultSeasonalEventManager.createSeasonalEvent(input);
}

function getSeasonalEvent(event_id) {
  return defaultSeasonalEventManager.getSeasonalEvent(event_id);
}

function updateSeasonalEvent(event_id, updater) {
  return defaultSeasonalEventManager.updateSeasonalEvent(event_id, updater);
}

function retireSeasonalEvent(event_id, options) {
  return defaultSeasonalEventManager.retireSeasonalEvent(event_id, options);
}

module.exports = {
  WORLD_EVENT_SCHEMA,
  createWorldEventRecord,
  InMemoryWorldEventStore,
  WorldEventManager,
  defaultWorldEventManager,
  WORLD_BOSS_SCHEMA,
  InMemoryWorldBossStore,
  ProcessedWorldBossRewardClaimStore,
  WorldBossManager,
  defaultWorldBossManager,
  SEASONAL_EVENT_SCHEMA,
  InMemorySeasonalEventStore,
  SeasonalEventManager,
  createSeasonalEventRecord,
  defaultSeasonalEventManager,
  createWorldEvent,
  getWorldEvent,
  updateWorldEvent,
  closeWorldEvent,
  listActiveWorldEvents,
  createSeasonalEvent,
  getSeasonalEvent,
  updateSeasonalEvent,
  retireSeasonalEvent,
  isSeasonalEventActiveWindow,
  validateSeasonalParticipation,
  getSeasonalRewardVariantHooks,
  registerWorldBossParticipation,
  trackWorldBossContribution,
  markWorldBossDefeated,
  generateWorldBossRewardTrigger,
  claimWorldBossReward
};
