"use strict";

const assert = require("assert");
const { createEvent } = require("../../../../packages/shared-types");
const { validateIncomingGatewayEvent } = require("..");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runControllerValidationTests() {
  const results = [];

  runTest("valid_help_event_passes_controller_validation", () => {
    const event = createEvent("gateway_help_requested", { command_name: "help" }, {
      source: "gateway.discord",
      target_system: "controller",
      player_id: "player-1"
    });
    const out = validateIncomingGatewayEvent(event);
    assert.equal(out.ok, true);
  }, results);

  runTest("valid_ping_event_passes_controller_validation", () => {
    const event = createEvent("gateway_ping_requested", { command_name: "ping" }, {
      source: "gateway.discord",
      target_system: "controller",
      player_id: "player-1"
    });
    const out = validateIncomingGatewayEvent(event);
    assert.equal(out.ok, true);
  }, results);

  runTest("valid_start_event_passes_controller_validation", () => {
    const event = createEvent("player_start_requested", { command_name: "start" }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: "player-1"
    });
    const out = validateIncomingGatewayEvent(event);
    assert.equal(out.ok, true);
  }, results);

  runTest("valid_admin_event_passes_controller_validation", () => {
    const event = createEvent("player_admin_requested", { action: "inspect_account_character" }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: "player-1"
    });
    const out = validateIncomingGatewayEvent(event);
    assert.equal(out.ok, true);
  }, results);

  runTest("valid_equip_event_passes_controller_validation", () => {
    const event = createEvent("player_equip_requested", { item_id: "item-1", slot: "main_hand" }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: "player-1"
    });
    const out = validateIncomingGatewayEvent(event);
    assert.equal(out.ok, true);
  }, results);

  runTest("valid_dungeon_enter_event_passes_controller_validation", () => {
    const event = createEvent("player_enter_dungeon", { dungeon_id: "dungeon-1", party_id: "party-1" }, {
      source: "gateway.discord",
      target_system: "session_system",
      player_id: "player-1"
    });
    const out = validateIncomingGatewayEvent(event);
    assert.equal(out.ok, true);
  }, results);

  runTest("valid_move_event_passes_controller_validation", () => {
    const event = createEvent("player_move", { direction: "north", session_id: "session-1" }, {
      source: "gateway.discord",
      target_system: "session_system",
      player_id: "player-1",
      session_id: "session-1"
    });
    const out = validateIncomingGatewayEvent(event);
    assert.equal(out.ok, true);
  }, results);

  runTest("valid_attack_event_passes_controller_validation_for_combat_scope", () => {
    const event = createEvent("player_attack", { target_id: "enemy-1", combat_id: "combat-1" }, {
      source: "gateway.discord",
      target_system: "combat_system",
      player_id: "player-1",
      combat_id: "combat-1"
    });
    const out = validateIncomingGatewayEvent(event);
    assert.equal(out.ok, true);
  }, results);

  runTest("valid_inventory_event_passes_controller_validation_for_world_scope", () => {
    const event = createEvent("player_inventory_requested", { command_name: "inventory" }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: "player-1"
    });
    const out = validateIncomingGatewayEvent(event);
    assert.equal(out.ok, true);
  }, results);

  runTest("invalid_event_shape_fails_controller_validation", () => {
    const out = validateIncomingGatewayEvent({ event_type: "gateway_help_requested" });
    assert.equal(out.ok, false);
    assert.equal(out.error, "event is missing required field: event_id");
    assert.equal(out.payload.error_code, "event_missing_required_field");
  }, results);

  runTest("unsupported_event_type_fails_controller_validation", () => {
    const event = createEvent("unsupported_event_type", { target_id: "enemy-1" }, {
      source: "gateway.discord",
      target_system: "controller",
      player_id: "player-1"
    });
    const out = validateIncomingGatewayEvent(event);
    assert.equal(out.ok, false);
    assert.equal(out.error, "event type is not supported by command intake");
  }, results);

  runTest("unknown_target_system_fails_controller_validation", () => {
    const event = createEvent("player_inventory_requested", { command_name: "inventory" }, {
      source: "gateway.discord",
      target_system: "mystery_system",
      player_id: "player-1"
    });
    const out = validateIncomingGatewayEvent(event);
    assert.equal(out.ok, false);
    assert.equal(out.error, "event target_system is not supported by command intake");
  }, results);

  runTest("missing_event_version_fails_contract_validation", () => {
    const event = createEvent("gateway_help_requested", { command_name: "help" }, {
      source: "gateway.discord",
      target_system: "controller",
      player_id: "player-1"
    });
    delete event.event_version;

    const out = validateIncomingGatewayEvent(event);
    assert.equal(out.ok, false);
    assert.equal(out.error, "event is missing required field: event_version");
    assert.equal(out.payload.error_code, "event_missing_required_field");
  }, results);

  runTest("unsupported_event_version_fails_contract_validation", () => {
    const event = createEvent("player_move", { direction: "north", session_id: "session-1" }, {
      source: "gateway.discord",
      target_system: "session_system",
      player_id: "player-1",
      session_id: "session-1",
      event_version: 999
    });

    const out = validateIncomingGatewayEvent(event);
    assert.equal(out.ok, false);
    assert.equal(out.error, "unsupported event_version: 999");
    assert.equal(out.payload.error_code, "event_version_unsupported");
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
  const summary = runControllerValidationTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

module.exports = {
  runControllerValidationTests
};
