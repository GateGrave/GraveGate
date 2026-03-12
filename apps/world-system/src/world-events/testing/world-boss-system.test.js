"use strict";

const assert = require("assert");
const {
  WorldEventManager,
  InMemoryWorldEventStore,
  WorldBossManager,
  InMemoryWorldBossStore,
  ProcessedWorldBossRewardClaimStore,
  registerWorldBossParticipation,
  trackWorldBossContribution,
  markWorldBossDefeated,
  generateWorldBossRewardTrigger,
  claimWorldBossReward
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createContext() {
  const worldEventManager = new WorldEventManager({
    store: new InMemoryWorldEventStore()
  });
  const worldBossManager = new WorldBossManager({
    store: new InMemoryWorldBossStore()
  });
  const rewardClaimStore = new ProcessedWorldBossRewardClaimStore();

  worldEventManager.createWorldEvent({
    event_id: "event-boss-001",
    event_name: "Eclipse Wyrm",
    event_type: "world_boss",
    event_scope: "global",
    event_state: { status: "active" },
    start_time: "2026-03-10T00:00:00.000Z",
    end_time: "2026-03-20T00:00:00.000Z",
    participation_rules: { min_level: 10 },
    reward_rules: { table_id: "boss-001-rewards" },
    active_flag: true
  });

  return {
    worldEventManager,
    worldBossManager,
    rewardClaimStore
  };
}

function bindBoss(ctx, overrides) {
  return ctx.worldBossManager.bindWorldBossToEvent({
    worldEventManager: ctx.worldEventManager,
    boss_id: "boss-001",
    event_id: "event-boss-001",
    boss_name: "Eclipse Wyrm",
    ...(overrides || {})
  });
}

function runWorldBossSystemTests() {
  const results = [];

  runTest("world_boss_participation_registration", () => {
    const ctx = createContext();
    bindBoss(ctx);
    const out = registerWorldBossParticipation({
      worldBossManager: ctx.worldBossManager,
      boss_id: "boss-001",
      player_id: "player-001"
    });

    assert.equal(out.ok, true);
    const boss = ctx.worldBossManager.getWorldBoss("boss-001");
    assert.equal(boss.participation_player_ids.includes("player-001"), true);
  }, results);

  runTest("boss_defeat_state", () => {
    const ctx = createContext();
    bindBoss(ctx);
    const out = markWorldBossDefeated({
      worldBossManager: ctx.worldBossManager,
      boss_id: "boss-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.defeat_state, true);
  }, results);

  runTest("reward_trigger_generation", () => {
    const ctx = createContext();
    bindBoss(ctx);
    registerWorldBossParticipation({
      worldBossManager: ctx.worldBossManager,
      boss_id: "boss-001",
      player_id: "player-001"
    });
    markWorldBossDefeated({
      worldBossManager: ctx.worldBossManager,
      boss_id: "boss-001"
    });

    const trigger = generateWorldBossRewardTrigger({
      worldBossManager: ctx.worldBossManager,
      boss_id: "boss-001"
    });

    assert.equal(trigger.ok, true);
    assert.equal(trigger.payload.eligible_player_ids.includes("player-001"), true);
  }, results);

  runTest("duplicate_reward_claim_prevention", () => {
    const ctx = createContext();
    bindBoss(ctx);
    registerWorldBossParticipation({
      worldBossManager: ctx.worldBossManager,
      boss_id: "boss-001",
      player_id: "player-001"
    });
    markWorldBossDefeated({
      worldBossManager: ctx.worldBossManager,
      boss_id: "boss-001"
    });

    const first = claimWorldBossReward({
      worldBossManager: ctx.worldBossManager,
      rewardClaimStore: ctx.rewardClaimStore,
      boss_id: "boss-001",
      player_id: "player-001"
    });
    const second = claimWorldBossReward({
      worldBossManager: ctx.worldBossManager,
      rewardClaimStore: ctx.rewardClaimStore,
      boss_id: "boss-001",
      player_id: "player-001"
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.payload.reason, "duplicate_reward_claim");
  }, results);

  runTest("malformed_boss_event_handling", () => {
    const ctx = createContext();
    const missingBossId = ctx.worldBossManager.bindWorldBossToEvent({
      worldEventManager: ctx.worldEventManager,
      boss_id: "",
      event_id: "event-boss-001"
    });
    assert.equal(missingBossId.ok, false);
  }, results);

  runTest("optional_contribution_tracking_structure_validity", () => {
    const ctx = createContext();
    bindBoss(ctx);
    const tracked = trackWorldBossContribution({
      worldBossManager: ctx.worldBossManager,
      boss_id: "boss-001",
      player_id: "player-002",
      contribution_value: 150
    });

    assert.equal(tracked.ok, true);
    const boss = ctx.worldBossManager.getWorldBoss("boss-001");
    assert.equal(typeof boss.contribution_map, "object");
    assert.equal(boss.contribution_map["player-002"], 150);
  }, results);

  runTest("inactive_event_rejection", () => {
    const ctx = createContext();
    ctx.worldEventManager.updateWorldEvent("event-boss-001", {
      active_flag: false
    });
    const bind = bindBoss(ctx);
    assert.equal(bind.ok, false);
    assert.equal(bind.payload.reason, "event_inactive");
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
  const summary = runWorldBossSystemTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runWorldBossSystemTests
};

