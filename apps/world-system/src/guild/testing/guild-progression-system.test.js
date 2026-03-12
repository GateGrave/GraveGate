"use strict";

const assert = require("assert");
const {
  GuildManager,
  InMemoryGuildStore,
  ProcessedGuildProgressionStore,
  addGuildXp,
  checkGuildLevelUp,
  getGuildMilestones
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createManager() {
  const guildManager = new GuildManager({
    store: new InMemoryGuildStore()
  });
  guildManager.createGuild({
    guild_id: "guild-001",
    guild_name: "Iron Wolves",
    guild_tag: "IWLF",
    leader_id: "player-001",
    officer_ids: ["player-002"],
    member_ids: ["player-001", "player-002", "player-003"],
    guild_level: 1,
    guild_xp: 0,
    guild_status: "active"
  });
  return guildManager;
}

function runGuildProgressionSystemTests() {
  const results = [];

  runTest("xp_gain", () => {
    const guildManager = createManager();
    const out = addGuildXp({
      guildManager,
      guild_id: "guild-001",
      xp_gain: 50
    });
    assert.equal(out.ok, true);
    assert.equal(out.payload.xp_after, 50);
  }, results);

  runTest("no_level_up_when_below_threshold", () => {
    const guildManager = createManager();
    const out = addGuildXp({
      guildManager,
      guild_id: "guild-001",
      xp_gain: 99
    });
    assert.equal(out.ok, true);
    assert.equal(out.payload.leveled_up, false);
    assert.equal(guildManager.getGuild("guild-001").guild_level, 1);
  }, results);

  runTest("level_up_at_threshold", () => {
    const guildManager = createManager();
    const out = addGuildXp({
      guildManager,
      guild_id: "guild-001",
      xp_gain: 100
    });
    assert.equal(out.ok, true);
    assert.equal(out.payload.leveled_up, true);
    assert.equal(guildManager.getGuild("guild-001").guild_level, 2);
  }, results);

  runTest("multi_level_gain_handling", () => {
    const guildManager = createManager();
    const out = addGuildXp({
      guildManager,
      guild_id: "guild-001",
      xp_gain: 650
    });
    assert.equal(out.ok, true);
    assert.equal(guildManager.getGuild("guild-001").guild_level, 4);
    assert.ok(Array.isArray(out.payload.level_ups));
    assert.ok(out.payload.level_ups.length >= 3);
  }, results);

  runTest("milestone_unlock_tracking", () => {
    const guildManager = createManager();
    addGuildXp({
      guildManager,
      guild_id: "guild-001",
      xp_gain: 350
    });
    const milestones = getGuildMilestones({
      guildManager,
      guild_id: "guild-001"
    });
    assert.equal(milestones.ok, true);
    assert.ok(milestones.payload.milestones.some((x) => x.unlocked === true));
  }, results);

  runTest("malformed_xp_input_rejection", () => {
    const guildManager = createManager();
    const out = addGuildXp({
      guildManager,
      guild_id: "guild-001",
      xp_gain: -5
    });
    assert.equal(out.ok, false);
    assert.equal(out.payload.reason, "invalid_xp_gain");
  }, results);

  runTest("duplicate_progression_result_prevention", () => {
    const guildManager = createManager();
    const processed = new ProcessedGuildProgressionStore();

    const first = addGuildXp({
      guildManager,
      guild_id: "guild-001",
      xp_gain: 100,
      processedProgressionStore: processed,
      progression_key: "prog-001"
    });
    const second = addGuildXp({
      guildManager,
      guild_id: "guild-001",
      xp_gain: 100,
      processedProgressionStore: processed,
      progression_key: "prog-001"
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.event_type, "guild_xp_gain_skipped");
    assert.equal(guildManager.getGuild("guild-001").guild_xp, 100);
  }, results);

  runTest("check_guild_level_up_helper", () => {
    const guildManager = createManager();
    guildManager.updateGuild("guild-001", {
      guild_xp: 120,
      guild_level: 1
    });

    const out = checkGuildLevelUp({
      guildManager,
      guild_id: "guild-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.leveled_up, true);
    assert.equal(guildManager.getGuild("guild-001").guild_level, 2);
  }, results);

  const passed = results.filter((x) => x.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    totals: {
      total: results.length,
      passed,
      failed
    },
    results
  };
}

if (require.main === module) {
  const summary = runGuildProgressionSystemTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runGuildProgressionSystemTests
};

