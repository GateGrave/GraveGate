"use strict";

const assert = require("assert");
const {
  SeasonalEventManager,
  InMemorySeasonalEventStore,
  createSeasonalEventRecord,
  isSeasonalEventActiveWindow,
  validateSeasonalParticipation,
  getSeasonalRewardVariantHooks
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
  return new SeasonalEventManager({
    store: new InMemorySeasonalEventStore()
  });
}

function baseSeasonalEvent(overrides) {
  return {
    event_id: "seasonal-001",
    season_code: "spring_2026",
    event_name: "Spring Bloom Hunt",
    event_definition: { narrative: "Collect bloom shards." },
    start_time: "2026-03-01T00:00:00.000Z",
    end_time: "2026-03-31T23:59:59.000Z",
    participation_rules: { min_level: 5 },
    reward_variant_hooks: { variant_key: "spring_2026_rewards" },
    recurrence_template: null,
    active_flag: true,
    retired_flag: false,
    ...(overrides || {})
  };
}

function runSeasonalEventSystemTests() {
  const results = [];

  runTest("seasonal_event_creation", () => {
    const manager = createManager();
    const created = manager.createSeasonalEvent(baseSeasonalEvent());
    assert.equal(created.event_id, "seasonal-001");
    assert.equal(created.season_code, "spring_2026");
  }, results);

  runTest("active_window_validation", () => {
    const manager = createManager();
    const created = manager.createSeasonalEvent(baseSeasonalEvent());

    const activeAtMid = isSeasonalEventActiveWindow(created, "2026-03-15T12:00:00.000Z");
    const inactiveBefore = isSeasonalEventActiveWindow(created, "2026-02-28T23:59:59.000Z");

    assert.equal(activeAtMid, true);
    assert.equal(inactiveBefore, false);
  }, results);

  runTest("participation_gating", () => {
    const manager = createManager();
    const created = manager.createSeasonalEvent(baseSeasonalEvent());

    const allowed = validateSeasonalParticipation({
      eventRecord: created,
      playerProfile: { player_id: "player-001", level: 10 },
      at_time: "2026-03-20T00:00:00.000Z"
    });
    const rejected = validateSeasonalParticipation({
      eventRecord: created,
      playerProfile: { player_id: "player-002", level: 2 },
      at_time: "2026-03-20T00:00:00.000Z"
    });

    assert.equal(allowed.ok, true);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.payload.reason, "min_level_not_met");
  }, results);

  runTest("retirement_flow", () => {
    const manager = createManager();
    manager.createSeasonalEvent(baseSeasonalEvent());

    const retired = manager.retireSeasonalEvent("seasonal-001", { reason: "season_ended" });
    assert.equal(retired.retired_flag, true);
    assert.equal(retired.active_flag, false);
  }, results);

  runTest("malformed_seasonal_event_rejection", () => {
    assert.throws(() => createSeasonalEventRecord({}), /event_id/);
    assert.throws(() => createSeasonalEventRecord(baseSeasonalEvent({ event_name: "" })), /event_name/);
    assert.throws(
      () => createSeasonalEventRecord(baseSeasonalEvent({ start_time: "not-a-date" })),
      /start_time must be a valid datetime/
    );
  }, results);

  runTest("inactive_seasonal_event_handling", () => {
    const manager = createManager();
    const created = manager.createSeasonalEvent(baseSeasonalEvent({ active_flag: false }));
    const active = isSeasonalEventActiveWindow(created, "2026-03-15T00:00:00.000Z");
    const participation = validateSeasonalParticipation({
      eventRecord: created,
      playerProfile: { player_id: "player-001", level: 10 },
      at_time: "2026-03-15T00:00:00.000Z"
    });

    assert.equal(active, false);
    assert.equal(participation.ok, false);
    assert.equal(participation.payload.reason, "event_not_active");
  }, results);

  runTest("future_recurring_template_safe_structure_validity", () => {
    const manager = createManager();
    const created = manager.createSeasonalEvent(
      baseSeasonalEvent({
        event_id: "seasonal-002",
        season_code: "winter_template",
        recurrence_template: {
          recurrence_type: "yearly",
          recurrence_window: { month: 12, day_start: 1, day_end: 31 },
          template_rules: { scale_rewards_by_year: true }
        },
        reward_variant_hooks: {
          variant_key: "winter_rewards",
          hook_ids: ["hook-winter-loot", "hook-winter-title"]
        }
      })
    );

    const hooks = getSeasonalRewardVariantHooks(created);
    assert.equal(typeof created.recurrence_template, "object");
    assert.equal(created.recurrence_template.recurrence_type, "yearly");
    assert.equal(hooks.variant_key, "winter_rewards");
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
  const summary = runSeasonalEventSystemTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runSeasonalEventSystemTests
};

