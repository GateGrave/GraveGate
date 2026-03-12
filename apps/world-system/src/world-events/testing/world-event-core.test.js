"use strict";

const assert = require("assert");
const {
  WorldEventManager,
  InMemoryWorldEventStore,
  createWorldEventRecord
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
  return new WorldEventManager({
    store: new InMemoryWorldEventStore()
  });
}

function baseEvent(overrides) {
  return {
    event_id: "world-event-001",
    event_name: "Harvest Moon Festival",
    event_type: "seasonal",
    event_scope: "global",
    event_state: { status: "scheduled" },
    start_time: "2026-03-10T00:00:00.000Z",
    end_time: "2026-03-20T00:00:00.000Z",
    participation_rules: { min_level: 1 },
    reward_rules: { base_reward_table: "table-festival-001" },
    active_flag: true,
    ...(overrides || {})
  };
}

function runWorldEventCoreTests() {
  const results = [];

  runTest("event_creation", () => {
    const manager = createManager();
    const created = manager.createWorldEvent(baseEvent());
    assert.equal(created.event_id, "world-event-001");
    assert.equal(created.event_name, "Harvest Moon Festival");
  }, results);

  runTest("event_update", () => {
    const manager = createManager();
    manager.createWorldEvent(baseEvent());
    const updated = manager.updateWorldEvent("world-event-001", {
      event_name: "Harvest Moon Festival Prime",
      event_state: { status: "active" }
    });
    assert.equal(updated.event_name, "Harvest Moon Festival Prime");
    assert.equal(updated.event_state.status, "active");
  }, results);

  runTest("event_close", () => {
    const manager = createManager();
    manager.createWorldEvent(baseEvent());
    const closed = manager.closeWorldEvent("world-event-001");
    assert.equal(closed.active_flag, false);
    assert.equal(closed.event_state.status, "closed");
    assert.ok(typeof closed.end_time === "string");
  }, results);

  runTest("active_event_listing", () => {
    const manager = createManager();
    manager.createWorldEvent(baseEvent({ event_id: "world-event-001" }));
    manager.createWorldEvent(baseEvent({ event_id: "world-event-002", event_name: "Goblin Hunt" }));
    manager.closeWorldEvent("world-event-002");

    const active = manager.listActiveWorldEvents();
    assert.equal(active.length, 1);
    assert.equal(active[0].event_id, "world-event-001");
  }, results);

  runTest("malformed_event_rejection", () => {
    assert.throws(() => createWorldEventRecord({}), /event_id/);
    assert.throws(() => createWorldEventRecord(baseEvent({ event_name: "" })), /event_name/);
    assert.throws(() => createWorldEventRecord(baseEvent({ event_state: "bad" })), /event_state must be an object/);
  }, results);

  runTest("invalid_time_range_handling", () => {
    assert.throws(
      () =>
        createWorldEventRecord(
          baseEvent({
            start_time: "2026-03-20T00:00:00.000Z",
            end_time: "2026-03-10T00:00:00.000Z"
          })
        ),
      /end_time must be greater than or equal to start_time/
    );
  }, results);

  runTest("inactive_event_handling", () => {
    const manager = createManager();
    manager.createWorldEvent(baseEvent({ event_id: "world-event-001", active_flag: true }));
    manager.createWorldEvent(baseEvent({ event_id: "world-event-002", active_flag: false }));

    const active = manager.listActiveWorldEvents();
    assert.equal(active.length, 1);
    assert.equal(active[0].event_id, "world-event-001");
  }, results);

  runTest("duplicate_event_id_handling", () => {
    const manager = createManager();
    manager.createWorldEvent(baseEvent());
    assert.throws(() => manager.createWorldEvent(baseEvent({ event_name: "Duplicate Event" })), /unique event_id/);
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
  const summary = runWorldEventCoreTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runWorldEventCoreTests
};

