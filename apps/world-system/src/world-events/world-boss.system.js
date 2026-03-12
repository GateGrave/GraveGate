"use strict";

const WORLD_BOSS_SCHEMA = {
  boss_id: "string",
  event_id: "string",
  boss_name: "string",
  participation_player_ids: "array",
  contribution_map: "object",
  defeat_state: "boolean",
  reward_triggered: "boolean",
  active_flag: "boolean",
  created_at: "string (ISO date)",
  updated_at: "string (ISO date)"
};

class InMemoryWorldBossStore {
  constructor() {
    this.bosses = new Map();
  }

  save(record) {
    this.bosses.set(record.boss_id, record);
    return record;
  }

  load(bossId) {
    if (!bossId) return null;
    return this.bosses.get(String(bossId)) || null;
  }
}

class ProcessedWorldBossRewardClaimStore {
  constructor() {
    this.claims = new Set();
  }

  has(claimKey) {
    if (!claimKey) return false;
    return this.claims.has(String(claimKey));
  }

  add(claimKey) {
    if (!claimKey) return;
    this.claims.add(String(claimKey));
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFailure(eventType, reason, extra) {
  return {
    ok: false,
    event_type: eventType,
    payload: {
      reason,
      ...(extra || {})
    }
  };
}

function createSuccess(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {}
  };
}

class WorldBossManager {
  constructor(options) {
    const cfg = options || {};
    this.store = cfg.store || new InMemoryWorldBossStore();
  }

  createWorldBossRecord(input) {
    const data = input || {};
    if (!data.boss_id || String(data.boss_id).trim() === "") {
      throw new Error("createWorldBossRecord requires boss_id");
    }
    if (!data.event_id || String(data.event_id).trim() === "") {
      throw new Error("createWorldBossRecord requires event_id");
    }
    if (!data.boss_name || String(data.boss_name).trim() === "") {
      throw new Error("createWorldBossRecord requires boss_name");
    }
    const now = new Date().toISOString();
    const participation = Array.isArray(data.participation_player_ids)
      ? Array.from(new Set(data.participation_player_ids.map((x) => String(x)).filter((x) => x.trim() !== "")))
      : [];
    const contributions =
      data.contribution_map && typeof data.contribution_map === "object" && !Array.isArray(data.contribution_map)
        ? data.contribution_map
        : {};

    return {
      boss_id: String(data.boss_id),
      event_id: String(data.event_id),
      boss_name: String(data.boss_name),
      participation_player_ids: participation,
      contribution_map: contributions,
      defeat_state: Boolean(data.defeat_state),
      reward_triggered: Boolean(data.reward_triggered),
      active_flag: data.active_flag !== false,
      created_at: data.created_at || now,
      updated_at: data.updated_at || now
    };
  }

  bindWorldBossToEvent(input) {
    const data = input || {};
    const worldEventManager = data.worldEventManager;
    if (!worldEventManager) return createFailure("world_boss_bind_failed", "world_event_manager_required");

    const event = worldEventManager.getWorldEvent(data.event_id);
    if (!event) return createFailure("world_boss_bind_failed", "event_not_found");
    if (event.active_flag !== true) return createFailure("world_boss_bind_failed", "event_inactive");

    let record;
    try {
      record = this.createWorldBossRecord({
        boss_id: data.boss_id,
        event_id: event.event_id,
        boss_name: data.boss_name || event.event_name
      });
    } catch (error) {
      return createFailure("world_boss_bind_failed", error.message);
    }

    if (this.store.load(record.boss_id)) {
      return createFailure("world_boss_bind_failed", "boss_id_already_bound");
    }

    this.store.save(record);
    return createSuccess("world_boss_bound", {
      boss_id: record.boss_id,
      event_id: record.event_id,
      boss_name: record.boss_name
    });
  }

  getWorldBoss(boss_id) {
    const boss = this.store.load(boss_id);
    return boss ? clone(boss) : null;
  }

  updateWorldBoss(boss_id, patch) {
    const current = this.store.load(boss_id);
    if (!current) return null;
    const merged = {
      ...current,
      ...(patch || {}),
      boss_id: current.boss_id,
      event_id: current.event_id,
      updated_at: new Date().toISOString()
    };
    const validated = this.createWorldBossRecord(merged);
    this.store.save(validated);
    return clone(validated);
  }
}

function registerWorldBossParticipation(input) {
  const data = input || {};
  const manager = data.worldBossManager;
  if (!manager) return createFailure("world_boss_participation_failed", "world_boss_manager_required");
  if (!data.boss_id) return createFailure("world_boss_participation_failed", "boss_id_required");
  if (!data.player_id) return createFailure("world_boss_participation_failed", "player_id_required");

  const boss = manager.getWorldBoss(data.boss_id);
  if (!boss) return createFailure("world_boss_participation_failed", "boss_not_found");
  if (boss.active_flag !== true) return createFailure("world_boss_participation_failed", "boss_inactive");

  const playerId = String(data.player_id);
  const nextParticipants = Array.from(
    new Set([...(boss.participation_player_ids || []), playerId])
  );
  const updated = manager.updateWorldBoss(boss.boss_id, {
    participation_player_ids: nextParticipants
  });

  return createSuccess("world_boss_participation_registered", {
    boss_id: updated.boss_id,
    player_id: playerId,
    participant_count: updated.participation_player_ids.length
  });
}

function trackWorldBossContribution(input) {
  const data = input || {};
  const manager = data.worldBossManager;
  if (!manager) return createFailure("world_boss_contribution_failed", "world_boss_manager_required");
  if (!data.boss_id) return createFailure("world_boss_contribution_failed", "boss_id_required");
  if (!data.player_id) return createFailure("world_boss_contribution_failed", "player_id_required");

  const contribution = Number(data.contribution_value);
  if (!Number.isFinite(contribution) || contribution < 0) {
    return createFailure("world_boss_contribution_failed", "invalid_contribution_value");
  }

  const boss = manager.getWorldBoss(data.boss_id);
  if (!boss) return createFailure("world_boss_contribution_failed", "boss_not_found");
  if (boss.active_flag !== true) return createFailure("world_boss_contribution_failed", "boss_inactive");

  const playerId = String(data.player_id);
  const contributionMap = {
    ...(boss.contribution_map || {})
  };
  const current = Number(contributionMap[playerId] || 0);
  contributionMap[playerId] = current + contribution;

  const nextParticipants = Array.from(
    new Set([...(boss.participation_player_ids || []), playerId])
  );

  const updated = manager.updateWorldBoss(boss.boss_id, {
    contribution_map: contributionMap,
    participation_player_ids: nextParticipants
  });

  return createSuccess("world_boss_contribution_tracked", {
    boss_id: updated.boss_id,
    player_id: playerId,
    contribution_total: updated.contribution_map[playerId]
  });
}

function markWorldBossDefeated(input) {
  const data = input || {};
  const manager = data.worldBossManager;
  if (!manager) return createFailure("world_boss_defeat_failed", "world_boss_manager_required");
  if (!data.boss_id) return createFailure("world_boss_defeat_failed", "boss_id_required");

  const boss = manager.getWorldBoss(data.boss_id);
  if (!boss) return createFailure("world_boss_defeat_failed", "boss_not_found");
  if (boss.active_flag !== true) return createFailure("world_boss_defeat_failed", "boss_inactive");

  const updated = manager.updateWorldBoss(boss.boss_id, {
    defeat_state: true,
    active_flag: false,
    reward_triggered: Boolean(data.reward_trigger_immediate)
  });

  return createSuccess("world_boss_defeated", {
    boss_id: updated.boss_id,
    event_id: updated.event_id,
    defeat_state: updated.defeat_state,
    reward_triggered: updated.reward_triggered
  });
}

function generateWorldBossRewardTrigger(input) {
  const data = input || {};
  const manager = data.worldBossManager;
  if (!manager) return createFailure("world_boss_reward_trigger_failed", "world_boss_manager_required");
  if (!data.boss_id) return createFailure("world_boss_reward_trigger_failed", "boss_id_required");

  const boss = manager.getWorldBoss(data.boss_id);
  if (!boss) return createFailure("world_boss_reward_trigger_failed", "boss_not_found");
  if (!boss.defeat_state) return createFailure("world_boss_reward_trigger_failed", "boss_not_defeated");

  const participants = Array.isArray(boss.participation_player_ids)
    ? boss.participation_player_ids
    : [];
  const updated = manager.updateWorldBoss(boss.boss_id, {
    reward_triggered: true
  });

  return createSuccess("world_boss_reward_triggered", {
    boss_id: updated.boss_id,
    event_id: updated.event_id,
    eligible_player_ids: participants,
    contribution_map: clone(updated.contribution_map || {})
  });
}

function claimWorldBossReward(input) {
  const data = input || {};
  const manager = data.worldBossManager;
  const claimStore = data.rewardClaimStore || null;
  const allowDuplicateClaims = Boolean(data.allow_duplicate_claims);

  if (!manager) return createFailure("world_boss_reward_claim_failed", "world_boss_manager_required");
  if (!data.boss_id) return createFailure("world_boss_reward_claim_failed", "boss_id_required");
  if (!data.player_id) return createFailure("world_boss_reward_claim_failed", "player_id_required");

  const boss = manager.getWorldBoss(data.boss_id);
  if (!boss) return createFailure("world_boss_reward_claim_failed", "boss_not_found");
  if (!boss.defeat_state) return createFailure("world_boss_reward_claim_failed", "boss_not_defeated");

  const playerId = String(data.player_id);
  if (!(boss.participation_player_ids || []).includes(playerId)) {
    return createFailure("world_boss_reward_claim_failed", "player_not_eligible");
  }

  const claimKey = data.claim_key || `${boss.boss_id}:${playerId}`;
  if (!allowDuplicateClaims && claimStore && typeof claimStore.has === "function") {
    if (claimStore.has(claimKey)) {
      return createFailure("world_boss_reward_claim_failed", "duplicate_reward_claim", {
        claim_key: claimKey
      });
    }
  }

  if (!allowDuplicateClaims && claimStore && typeof claimStore.add === "function") {
    claimStore.add(claimKey);
  }

  return createSuccess("world_boss_reward_claimed", {
    boss_id: boss.boss_id,
    player_id: playerId,
    claim_key: claimKey
  });
}

module.exports = {
  WORLD_BOSS_SCHEMA,
  InMemoryWorldBossStore,
  ProcessedWorldBossRewardClaimStore,
  WorldBossManager,
  registerWorldBossParticipation,
  trackWorldBossContribution,
  markWorldBossDefeated,
  generateWorldBossRewardTrigger,
  claimWorldBossReward
};

