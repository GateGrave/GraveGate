"use strict";

class ProcessedGuildProgressionStore {
  constructor() {
    this.processed = new Set();
  }

  has(progressionKey) {
    if (!progressionKey) return false;
    return this.processed.has(String(progressionKey));
  }

  add(progressionKey) {
    if (!progressionKey) return;
    this.processed.add(String(progressionKey));
  }
}

const DEFAULT_GUILD_LEVEL_THRESHOLDS = {
  1: 0,
  2: 100,
  3: 300,
  4: 600,
  5: 1000
};

const DEFAULT_GUILD_MILESTONES = {
  2: "guild_banner_unlock",
  3: "guild_storage_upgrade_tier_1",
  4: "guild_raid_entry_unlock",
  5: "guild_storage_upgrade_tier_2"
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortedThresholdLevels(thresholds) {
  return Object.keys(thresholds)
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);
}

function resolveLevelFromXp(guildXp, thresholds) {
  const levels = sortedThresholdLevels(thresholds);
  let level = levels[0] || 1;
  for (const candidate of levels) {
    if (guildXp >= thresholds[candidate]) {
      level = candidate;
    } else {
      break;
    }
  }
  return level;
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

function ensureGuildProgressionFields(guild) {
  const history = Array.isArray(guild.progression_history) ? guild.progression_history : [];
  const milestones = Array.isArray(guild.milestones_unlocked) ? guild.milestones_unlocked : [];
  return {
    ...guild,
    progression_history: history,
    milestones_unlocked: milestones
  };
}

function addGuildXp(input) {
  const data = input || {};
  const guildManager = data.guildManager;
  const guild_id = data.guild_id;
  const xpGain = Math.floor(Number(data.xp_gain));
  const thresholds = data.levelThresholds || DEFAULT_GUILD_LEVEL_THRESHOLDS;
  const milestones = data.milestones || DEFAULT_GUILD_MILESTONES;
  const processedStore = data.processedProgressionStore || null;
  const progressionKey =
    data.progression_key ||
    data.event_id ||
    null;

  if (!guildManager) return createFailure("guild_xp_gain_failed", "guild_manager_required");
  if (!guild_id || String(guild_id).trim() === "") return createFailure("guild_xp_gain_failed", "guild_id_required");
  if (!Number.isFinite(xpGain) || xpGain <= 0) {
    return createFailure("guild_xp_gain_failed", "invalid_xp_gain", {
      xp_gain: data.xp_gain
    });
  }

  if (progressionKey && processedStore && typeof processedStore.has === "function") {
    if (processedStore.has(progressionKey)) {
      return createSuccess("guild_xp_gain_skipped", {
        reason: "duplicate_progression_key",
        progression_key: progressionKey
      });
    }
  }

  const guild = guildManager.getGuild(guild_id);
  if (!guild) return createFailure("guild_xp_gain_failed", "guild_not_found");

  const current = ensureGuildProgressionFields(guild);
  const beforeLevel = Number.isFinite(current.guild_level) ? Math.max(1, Math.floor(current.guild_level)) : 1;
  const beforeXp = Number.isFinite(current.guild_xp) ? Math.max(0, Math.floor(current.guild_xp)) : 0;
  const afterXp = beforeXp + xpGain;
  const computedLevel = resolveLevelFromXp(afterXp, thresholds);
  const afterLevel = Math.max(beforeLevel, computedLevel);

  const unlockedMilestones = [];
  const nextMilestones = new Set(current.milestones_unlocked);
  for (const levelValue of Object.keys(milestones)) {
    const levelInt = Number(levelValue);
    if (!Number.isFinite(levelInt)) continue;
    if (levelInt <= afterLevel && !nextMilestones.has(milestones[levelValue])) {
      nextMilestones.add(milestones[levelValue]);
      unlockedMilestones.push({
        level: levelInt,
        milestone_id: milestones[levelValue]
      });
    }
  }

  const levelUps = [];
  if (afterLevel > beforeLevel) {
    for (let level = beforeLevel + 1; level <= afterLevel; level += 1) {
      levelUps.push({
        level,
        threshold_xp: thresholds[level] ?? null,
        milestone: milestones[level] || null
      });
    }
  }

  const nextHistory = [
    ...current.progression_history,
    {
      type: "xp_gain",
      xp_gain: xpGain,
      xp_before: beforeXp,
      xp_after: afterXp,
      level_before: beforeLevel,
      level_after: afterLevel,
      level_ups: clone(levelUps),
      unlocked_milestones: clone(unlockedMilestones),
      progression_key: progressionKey,
      created_at: new Date().toISOString()
    }
  ];

  const updated = guildManager.updateGuild(guild_id, {
    guild_xp: afterXp,
    guild_level: afterLevel,
    milestones_unlocked: Array.from(nextMilestones.values()),
    progression_history: nextHistory
  });

  if (progressionKey && processedStore && typeof processedStore.add === "function") {
    processedStore.add(progressionKey);
  }

  return createSuccess("guild_xp_gained", {
    guild_id: updated.guild_id,
    xp_before: beforeXp,
    xp_after: updated.guild_xp,
    xp_gain: xpGain,
    level_before: beforeLevel,
    level_after: updated.guild_level,
    leveled_up: updated.guild_level > beforeLevel,
    level_ups: levelUps,
    unlocked_milestones: unlockedMilestones
  });
}

function checkGuildLevelUp(input) {
  const data = input || {};
  const guildManager = data.guildManager;
  const guild_id = data.guild_id;
  const thresholds = data.levelThresholds || DEFAULT_GUILD_LEVEL_THRESHOLDS;
  const milestones = data.milestones || DEFAULT_GUILD_MILESTONES;

  if (!guildManager) return createFailure("guild_level_check_failed", "guild_manager_required");
  if (!guild_id || String(guild_id).trim() === "") return createFailure("guild_level_check_failed", "guild_id_required");

  const guild = guildManager.getGuild(guild_id);
  if (!guild) return createFailure("guild_level_check_failed", "guild_not_found");

  const current = ensureGuildProgressionFields(guild);
  const expectedLevel = resolveLevelFromXp(current.guild_xp || 0, thresholds);
  const levelBefore = Number.isFinite(current.guild_level) ? Math.max(1, Math.floor(current.guild_level)) : 1;

  if (expectedLevel <= levelBefore) {
    return createSuccess("guild_level_check_complete", {
      guild_id: current.guild_id,
      leveled_up: false,
      level_before: levelBefore,
      level_after: levelBefore
    });
  }

  const levelUps = [];
  for (let level = levelBefore + 1; level <= expectedLevel; level += 1) {
    levelUps.push({
      level,
      threshold_xp: thresholds[level] ?? null,
      milestone: milestones[level] || null
    });
  }

  const updated = guildManager.updateGuild(guild_id, {
    guild_level: expectedLevel
  });

  return createSuccess("guild_level_up", {
    guild_id: updated.guild_id,
    leveled_up: true,
    level_before: levelBefore,
    level_after: expectedLevel,
    level_ups: levelUps
  });
}

function getGuildMilestones(input) {
  const data = input || {};
  const guildManager = data.guildManager;
  const guild_id = data.guild_id;
  const milestones = data.milestones || DEFAULT_GUILD_MILESTONES;

  if (!guildManager) return createFailure("guild_milestones_failed", "guild_manager_required");
  if (!guild_id || String(guild_id).trim() === "") return createFailure("guild_milestones_failed", "guild_id_required");

  const guild = guildManager.getGuild(guild_id);
  if (!guild) return createFailure("guild_milestones_failed", "guild_not_found");
  const current = ensureGuildProgressionFields(guild);
  const unlocked = new Set(current.milestones_unlocked);

  const allMilestones = Object.keys(milestones)
    .map((lvl) => ({
      level: Number(lvl),
      milestone_id: milestones[lvl],
      unlocked: unlocked.has(milestones[lvl])
    }))
    .sort((a, b) => a.level - b.level);

  return createSuccess("guild_milestones_listed", {
    guild_id: current.guild_id,
    milestones: allMilestones
  });
}

module.exports = {
  ProcessedGuildProgressionStore,
  DEFAULT_GUILD_LEVEL_THRESHOLDS,
  DEFAULT_GUILD_MILESTONES,
  addGuildXp,
  checkGuildLevelUp,
  getGuildMilestones
};

