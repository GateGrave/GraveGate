"use strict";

const assert = require("assert");
const { createEventBus } = require("../eventBus");
const { createOrchestrator } = require("../orchestrator");

function runTest(name, fn, results) {
  return Promise.resolve()
    .then(fn)
    .then(function onPass() {
      results.push({ name, ok: true });
    })
    .catch(function onFail(error) {
      results.push({ name, ok: false, reason: error.message });
    });
}

async function runOrchestratorTests() {
  const results = [];

  await runTest("single_event_processing", async () => {
    const bus = createEventBus();
    const orchestrator = createOrchestrator({ eventBus: bus });

    const out = await orchestrator.run({
      event_type: "single_event",
      payload: { x: 1 },
      metadata: {}
    });

    assert.equal(out.ok, true);
    assert.equal(out.events_processed.length, 1);
    assert.equal(out.events_processed[0].event_type, "single_event");
    assert.equal(out.final_state.halted_reason, "completed");
  }, results);

  await runTest("chained_events_processing", async () => {
    const bus = createEventBus();

    bus.subscribe("start", function onStart() {
      return {
        event_type: "middle",
        payload: {},
        metadata: {}
      };
    });

    bus.subscribe("middle", function onMiddle() {
      return {
        event_type: "end",
        payload: {},
        metadata: {}
      };
    });

    const orchestrator = createOrchestrator({ eventBus: bus });
    const out = await orchestrator.run({
      event_type: "start",
      payload: {},
      metadata: {}
    });

    assert.equal(out.ok, true);
    assert.equal(out.events_processed.length, 3);
    assert.equal(out.events_processed[0].event_type, "start");
    assert.equal(out.events_processed[1].event_type, "middle");
    assert.equal(out.events_processed[2].event_type, "end");
  }, results);

  await runTest("event_chains_terminate_correctly", async () => {
    const bus = createEventBus();

    bus.subscribe("tick", function onTick(event) {
      const count = Number(event.payload.count || 0);
      if (count >= 2) {
        return null;
      }
      return {
        event_type: "tick",
        payload: { count: count + 1 },
        metadata: {}
      };
    });

    const orchestrator = createOrchestrator({ eventBus: bus, max_events: 10 });
    const out = await orchestrator.run({
      event_type: "tick",
      payload: { count: 0 },
      metadata: {}
    });

    assert.equal(out.ok, true);
    assert.equal(out.events_processed.length, 3);
    assert.equal(out.final_state.halted_reason, "completed");
  }, results);

  await runTest("orchestrator_does_not_infinite_loop", async () => {
    const bus = createEventBus();

    bus.subscribe("loop", function onLoop() {
      return {
        event_type: "loop",
        payload: {},
        metadata: {}
      };
    });

    const orchestrator = createOrchestrator({ eventBus: bus, max_events: 5 });
    const out = await orchestrator.run({
      event_type: "loop",
      payload: {},
      metadata: {}
    });

    assert.equal(out.ok, false);
    assert.equal(out.events_processed.length, 5);
    assert.equal(out.final_state.halted_reason, "max_events_reached");
  }, results);

  await runTest("async_chained_events_processing", async () => {
    const bus = createEventBus();

    bus.subscribe("start_async", async function onStartAsync() {
      await Promise.resolve();
      return {
        event_type: "end_async",
        payload: {},
        metadata: {}
      };
    });

    const orchestrator = createOrchestrator({ eventBus: bus });
    const out = await orchestrator.run({
      event_type: "start_async",
      payload: {},
      metadata: {}
    });

    assert.equal(out.ok, true);
    assert.equal(out.events_processed.length, 2);
    assert.equal(out.events_processed[0].event_type, "start_async");
    assert.equal(out.events_processed[1].event_type, "end_async");
  }, results);

  await runTest("async_handler_rejection_is_surface_in_final_state_errors", async () => {
    const bus = createEventBus();
    bus.subscribe("reject_async", async function rejectHandler() {
      throw new Error("async orchestrator handler failure");
    });

    const orchestrator = createOrchestrator({ eventBus: bus });
    const out = await orchestrator.run({
      event_type: "reject_async",
      payload: {},
      metadata: {}
    });

    assert.equal(out.ok, false);
    assert.equal(out.events_processed.length, 1);
    assert.equal(Array.isArray(out.final_state.errors), true);
    assert.equal(out.final_state.errors.length, 1);
    assert.equal(out.final_state.errors[0].message, "async orchestrator handler failure");
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
  runOrchestratorTests()
    .then(function done(summary) {
      console.log(JSON.stringify(summary, null, 2));
      if (!summary.ok) {
        process.exitCode = 1;
      }
    })
    .catch(function failed(error) {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  runOrchestratorTests
};
