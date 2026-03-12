"use strict";

const assert = require("assert");
const { loadDungeonContent } = require("../../../world-system/src/content");
const { runTutorialDungeonContentHarness } = require("./tutorialDungeonContentHarness");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runTutorialDungeonContentHarnessTests() {
  const results = [];

  runTest("tutorial_dungeon_loads", () => {
    const out = loadDungeonContent();
    assert.equal(out.ok, true);
    const tutorial = out.payload.entries.find((entry) => entry.dungeon_id === "dungeon_tutorial_path");
    assert.equal(Boolean(tutorial), true);
    assert.equal(tutorial.start_room_id, "room_tutorial_entry");
  }, results);

  runTest("movement_and_encounter_trigger_work", () => {
    const out = runTutorialDungeonContentHarness({
      player_id: "player-tutorial-move-001",
      session_id: "session-tutorial-move-001",
      inventory_id: "inv-tutorial-move-001"
    });

    assert.equal(out.ok, true);
    const reloadedSession = out.payload.reloaded_session;
    assert.equal(Array.isArray(reloadedSession.discovered_rooms), true);
    assert.equal(reloadedSession.discovered_rooms.includes("room_tutorial_encounter"), true);
    assert.equal(Array.isArray(reloadedSession.event_log), true);

    const resolvedEntry = reloadedSession.event_log.some((entry) => {
      return entry && entry.event_type === "dungeon_room_entry_resolved" && entry.outcome === "encounter";
    });
    assert.equal(resolvedEntry, true);
  }, results);

  runTest("dungeon_enter_succeeds", () => {
    const out = runTutorialDungeonContentHarness({
      player_id: "player-tutorial-enter-001",
      session_id: "session-tutorial-enter-001",
      inventory_id: "inv-tutorial-enter-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.entry_room_id, "room_tutorial_entry");
    assert.equal(out.payload.dungeon_id, "dungeon_tutorial_path");
  }, results);

  runTest("expanded_dungeon_variant_is_accessible_in_harness", () => {
    const out = runTutorialDungeonContentHarness({
      player_id: "player-forest-variant-001",
      session_id: "session-forest-variant-001",
      inventory_id: "inv-forest-variant-001",
      dungeon_id: "dungeon_forest_ruins"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.dungeon_id, "dungeon_forest_ruins");

    const encounterResolved = out.payload.reloaded_session.event_log.some((entry) => {
      return entry && entry.event_type === "dungeon_room_entry_resolved" && entry.outcome === "encounter";
    });
    assert.equal(encounterResolved, true);
  }, results);

  runTest("content_pack_2_dungeon_variant_loop_succeeds", () => {
    const out = runTutorialDungeonContentHarness({
      player_id: "player-spider-variant-001",
      session_id: "session-spider-variant-001",
      inventory_id: "inv-spider-variant-001",
      dungeon_id: "dungeon_spider_den"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.dungeon_id, "dungeon_spider_den");
    assert.equal(out.payload.encounter_monster_id, "monster_giant_spiderling");
  }, results);

  runTest("representative_loot_path_uses_dungeon_reward_item_reference", () => {
    const out = runTutorialDungeonContentHarness({
      player_id: "player-crypt-reward-001",
      session_id: "session-crypt-reward-001",
      inventory_id: "inv-crypt-reward-001",
      dungeon_id: "dungeon_fallen_crypt"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.reward_item_id, "item_smoke_bomb");
    const reloadedInventory = out.payload.reloaded_inventory;
    const hasSmokeBombReward = reloadedInventory.stackable_items.some((entry) => {
      return entry && entry.item_id === "item_smoke_bomb" && Number(entry.quantity) >= 2;
    });
    assert.equal(hasSmokeBombReward, true);
  }, results);

  runTest("tiered_reward_curve_metadata_is_resolved_in_harness_flow", () => {
    const out = runTutorialDungeonContentHarness({
      player_id: "player-crypt-curve-001",
      session_id: "session-crypt-curve-001",
      inventory_id: "inv-crypt-curve-001",
      dungeon_id: "dungeon_fallen_crypt"
    });

    assert.equal(out.ok, true);
    const consumeStep = out.payload.log.find((step) => {
      return step && step.step === "consume_reward_hook";
    });
    assert.equal(Boolean(consumeStep), true);
    assert.equal(consumeStep.result.ok, true);
    const curve = consumeStep.result.payload.next_step.roll_input.metadata.reward_curve;
    assert.equal(typeof curve, "object");
    assert.equal(Number(curve.guaranteed_quantity_bonus) >= 1, true);
    assert.equal(Number(curve.quantity_multiplier) >= 1, true);
  }, results);

  runTest("completion_reward_path_persists_cleanly", () => {
    const out = runTutorialDungeonContentHarness({
      player_id: "player-tutorial-reward-001",
      session_id: "session-tutorial-reward-001",
      inventory_id: "inv-tutorial-reward-001"
    });

    assert.equal(out.ok, true);
    const reloadedSession = out.payload.reloaded_session;
    const reloadedInventory = out.payload.reloaded_inventory;

    assert.equal(reloadedSession.current_room_id, "room_tutorial_exit");
    assert.equal(Array.isArray(reloadedSession.cleared_rooms), true);
    assert.equal(reloadedSession.cleared_rooms.includes("room_tutorial_encounter"), true);

    assert.equal(Array.isArray(reloadedInventory.stackable_items), true);
    const hasRewardMaterial = reloadedInventory.stackable_items.some((entry) => {
      return entry && entry.item_id === "item_rat_tail" && Number(entry.quantity) >= 1;
    });
    assert.equal(hasRewardMaterial, true);
  }, results);

  runTest("invalid_dungeon_reference_fails_cleanly", () => {
    const out = runTutorialDungeonContentHarness({
      player_id: "player-tutorial-invalid-dungeon-001",
      session_id: "session-tutorial-invalid-dungeon-001",
      inventory_id: "inv-tutorial-invalid-dungeon-001",
      dungeon_id: "dungeon_does_not_exist"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "tutorial_dungeon_slice_failed");
    assert.equal(typeof out.error, "string");
    assert.equal(out.error.includes("tutorial dungeon"), true);
  }, results);

  runTest("invalid_room_connection_fails_cleanly", () => {
    const out = runTutorialDungeonContentHarness({
      player_id: "player-tutorial-invalid-link-001",
      session_id: "session-tutorial-invalid-link-001",
      inventory_id: "inv-tutorial-invalid-link-001",
      // Entry room links only to encounter room; direct move to exit should fail.
      first_move_target_room_id: "room_tutorial_exit"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "tutorial_dungeon_slice_failed");
    assert.equal(typeof out.error, "string");
    assert.equal(out.error.includes("connected"), true);
  }, results);

  const passed = results.filter((x) => x.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    totals: { total: results.length, passed, failed },
    results
  };
}

if (require.main === module) {
  const summary = runTutorialDungeonContentHarnessTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runTutorialDungeonContentHarnessTests
};
