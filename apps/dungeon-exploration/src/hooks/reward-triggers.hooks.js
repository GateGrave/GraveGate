"use strict";

const REWARD_TRIGGER_TYPES = {
  ENCOUNTER_CLEARED: "encounter_cleared",
  BOSS_DEFEATED: "boss_defeated",
  CHEST_OPENED: "chest_opened",
  DUNGEON_COMPLETED: "dungeon_completed"
};

function createRewardTriggerPayload(trigger_type, context) {
  const data = context || {};

  return {
    event_type: "reward_triggered",
    trigger_type,
    session_id: data.session_id || null,
    party_id: data.party_id || null,
    player_id: data.player_id || null,
    source_id: data.source_id || null,
    source_type: data.source_type || null,
    reward_status: "pending_generation",
    // Reward generation is intentionally deferred to a later loot system phase.
    reward_stub: {
      xp: null,
      gold: null,
      items: []
    },
    metadata: data.metadata || {},
    triggered_at: new Date().toISOString()
  };
}

function onEncounterCleared(context) {
  return createRewardTriggerPayload(REWARD_TRIGGER_TYPES.ENCOUNTER_CLEARED, {
    ...context,
    source_type: "encounter"
  });
}

function onBossDefeated(context) {
  return createRewardTriggerPayload(REWARD_TRIGGER_TYPES.BOSS_DEFEATED, {
    ...context,
    source_type: "boss"
  });
}

function onChestOpened(context) {
  return createRewardTriggerPayload(REWARD_TRIGGER_TYPES.CHEST_OPENED, {
    ...context,
    source_type: "chest"
  });
}

function onDungeonCompleted(context) {
  return createRewardTriggerPayload(REWARD_TRIGGER_TYPES.DUNGEON_COMPLETED, {
    ...context,
    source_type: "dungeon"
  });
}

module.exports = {
  REWARD_TRIGGER_TYPES,
  createRewardTriggerPayload,
  onEncounterCleared,
  onBossDefeated,
  onChestOpened,
  onDungeonCompleted
};

