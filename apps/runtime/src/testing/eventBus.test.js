"use strict";

const assert = require("assert");
const { createEventBus } = require("../eventBus");

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

async function runEventBusTests() {
  const results = [];

  await runTest("subscribing_handlers_works", async () => {
    const bus = createEventBus();
    const sub = bus.subscribe("player_move", function handler() {
      return null;
    });

    assert.equal(sub.ok, true);
    assert.equal(sub.event_type, "event_bus_subscribed");
    assert.equal(sub.payload.event_type, "player_move");
    assert.equal(typeof sub.unsubscribe, "function");
  }, results);

  await runTest("publishing_triggers_handlers", async () => {
    const bus = createEventBus();
    let called = 0;

    bus.subscribe("player_move", function handler(event) {
      called += 1;
      assert.equal(event.event_type, "player_move");
      return null;
    });

    const out = await bus.publish({
      event_type: "player_move",
      payload: { direction: "north" },
      metadata: { source: "test" }
    });

    assert.equal(called, 1);
    assert.equal(out.ok, true);
    assert.equal(Array.isArray(out.events_emitted), true);
    assert.equal(out.events_emitted.length, 0);
    assert.equal(out.errors.length, 0);
  }, results);

  await runTest("multiple_handlers_can_run", async () => {
    const bus = createEventBus();
    let callCount = 0;

    bus.subscribe("combat_started", function first() {
      callCount += 1;
      return null;
    });
    bus.subscribe("combat_started", function second() {
      callCount += 1;
      return null;
    });

    const out = await bus.publish({
      event_type: "combat_started",
      payload: { combat_id: "combat-1" },
      metadata: {}
    });

    assert.equal(callCount, 2);
    assert.equal(out.ok, true);
    assert.equal(out.errors.length, 0);
  }, results);

  await runTest("emitted_events_are_returned", async () => {
    const bus = createEventBus();

    bus.subscribe("player_attack", function emitFollowUp() {
      return {
        event_type: "damage_resolution_requested",
        payload: { attacker_id: "p1", target_id: "p2" },
        metadata: { source: "combat-system" }
      };
    });

    bus.subscribe("player_attack", function emitMultiple() {
      return [
        {
          event_type: "reaction_window_opened",
          payload: { target_id: "p2" },
          metadata: {}
        }
      ];
    });

    const out = await bus.publish({
      event_type: "player_attack",
      payload: { attacker_id: "p1", target_id: "p2" },
      metadata: {}
    });

    assert.equal(out.ok, true);
    assert.equal(out.events_emitted.length, 2);
    assert.equal(out.events_emitted[0].event_type, "damage_resolution_requested");
    assert.equal(out.events_emitted[1].event_type, "reaction_window_opened");
  }, results);

  await runTest("async_handlers_can_emit_follow_up_events", async () => {
    const bus = createEventBus();
    bus.subscribe("player_use_item", async function asyncEmit(event) {
      await Promise.resolve();
      return {
        event_type: "item_effect_applied",
        payload: { item_id: event.payload.item_id },
        metadata: {}
      };
    });

    const out = await bus.publish({
      event_type: "player_use_item",
      payload: { item_id: "item-001" },
      metadata: {}
    });

    assert.equal(out.ok, true);
    assert.equal(out.events_emitted.length, 1);
    assert.equal(out.events_emitted[0].event_type, "item_effect_applied");
  }, results);

  await runTest("async_handler_rejection_is_returned_as_structured_error", async () => {
    const bus = createEventBus();
    bus.subscribe("player_use_item", async function rejectAsync() {
      throw new Error("async handler failed");
    });

    const out = await bus.publish({
      event_type: "player_use_item",
      payload: { item_id: "item-002" },
      metadata: {}
    });

    assert.equal(out.ok, false);
    assert.equal(out.events_emitted.length, 0);
    assert.equal(out.errors.length, 1);
    assert.equal(out.errors[0].message, "async handler failed");
  }, results);

  await runTest("publishing_with_no_handlers_does_not_crash", async () => {
    const bus = createEventBus();
    const out = await bus.publish({
      event_type: "loot_generated",
      payload: { drop_id: "drop-1" },
      metadata: {}
    });

    assert.equal(out.ok, true);
    assert.equal(out.events_emitted.length, 0);
    assert.equal(out.errors.length, 0);
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
  runEventBusTests()
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
  runEventBusTests
};
