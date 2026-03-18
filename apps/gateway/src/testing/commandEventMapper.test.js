"use strict";

const assert = require("assert");
const { isValidEvent } = require("../../../../packages/shared-types/event-schema");
const { mapSlashCommandToGatewayEvent } = require("../discord/commandEventMapper");
const { translateSlashCommandToInternalEvent } = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createInteraction(commandName, overrides) {
  return {
    commandName,
    user: { id: "player-001" },
    guildId: "guild-001",
    channelId: "channel-001",
    options: { data: [] },
    ...overrides
  };
}

function runCommandEventMapperTests() {
  const results = [];

  runTest("help_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(createInteraction("help"));
    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "gateway_help_requested");
    assert.equal(out.payload.event.target_system, "controller");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("profile_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(createInteraction("profile"));
    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_profile_requested");
    assert.equal(out.payload.event.target_system, "world_system");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("combat_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("combat", {
        options: { data: [{ name: "combat_id", value: "combat-001" }] }
      })
    );
    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_combat_requested");
    assert.equal(out.payload.event.target_system, "combat_system");
    assert.equal(out.payload.event.payload.combat_id, "combat-001");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("inventory_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(createInteraction("inventory"));
    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_inventory_requested");
    assert.equal(out.payload.event.target_system, "world_system");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("shop_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("shop", {
        options: { data: [{ name: "action", value: "buy" }, { name: "item_id", value: "item_healing_potion" }, { name: "quantity", value: 1 }] }
      })
    );
    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_shop_requested");
    assert.equal(out.payload.event.target_system, "world_system");
    assert.equal(out.payload.event.payload.action, "buy");
    assert.equal(out.payload.event.payload.item_id, "item_healing_potion");
    assert.equal(out.payload.event.payload.vendor_id, "vendor_starter_quartermaster");
  }, results);

  runTest("craft_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("craft", {
        options: { data: [{ name: "action", value: "make" }, { name: "recipe_id", value: "recipe_torch_pack" }] }
      })
    );
    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_craft_requested");
    assert.equal(out.payload.event.target_system, "world_system");
    assert.equal(out.payload.event.payload.action, "make");
    assert.equal(out.payload.event.payload.recipe_id, "recipe_torch_pack");
  }, results);

  runTest("trade_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("trade", {
        options: {
          data: [
            { name: "action", value: "propose" },
            { name: "counterparty_player_id", value: "player-002" },
            { name: "offered_item_id", value: "item_bandage_roll" },
            { name: "offered_quantity", value: 1 },
            { name: "requested_currency", value: 5 }
          ]
        }
      })
    );
    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_trade_requested");
    assert.equal(out.payload.event.target_system, "world_system");
    assert.equal(out.payload.event.payload.action, "propose");
    assert.equal(out.payload.event.payload.counterparty_player_id, "player-002");
    assert.equal(out.payload.event.payload.offered_item_id, "item_bandage_roll");
    assert.equal(out.payload.event.payload.requested_currency, 5);
  }, results);

  runTest("trade_propose_can_open_gateway_wizard_with_counterparty_only", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("trade", {
        options: {
          data: [
            { name: "action", value: "propose" },
            { name: "counterparty_player_id", value: "player-002" }
          ]
        }
      })
    );
    assert.equal(out.ok, true);
    assert.equal(out.payload.event.payload.action, "propose");
    assert.equal(out.payload.event.payload.counterparty_player_id, "player-002");
    assert.equal(out.payload.event.payload.offered_item_id, null);
    assert.equal(out.payload.event.payload.offered_currency, 0);
  }, results);

  runTest("admin_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("admin", {
        options: {
          data: [
            { name: "action", value: "inspect_account_character" },
            { name: "character_id", value: "char-admin-001" }
          ]
        }
      })
    );
    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_admin_requested");
    assert.equal(out.payload.event.target_system, "world_system");
    assert.equal(out.payload.event.payload.action, "inspect_account_character");
    assert.equal(out.payload.event.payload.character_id, "char-admin-001");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("start_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(createInteraction("start"));
    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_start_requested");
    assert.equal(out.payload.event.target_system, "world_system");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("start_command_only_accepts_name_input_for_bootstrap", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("start", {
        options: {
          data: [
            { name: "name", value: "  Nova  " },
            { name: "race_id", value: " Dragonborn " },
            { name: "class_id", value: " Sorcerer " }
          ]
        }
      })
    );
    assert.equal(out.ok, true);
    assert.equal(out.payload.event.payload.requested_character_name, "Nova");
    assert.equal(out.payload.event.payload.race_id, undefined);
    assert.equal(out.payload.event.payload.class_id, undefined);
  }, results);

  runTest("equip_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("equip", {
        options: { data: [{ name: "item_id", value: "item-sword-001" }, { name: "slot", value: "main_hand" }] }
      })
    );
    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_equip_requested");
    assert.equal(out.payload.event.target_system, "world_system");
    assert.equal(out.payload.event.payload.item_id, "item-sword-001");
    assert.equal(out.payload.event.payload.slot, "main_hand");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("unequip_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("unequip", {
        options: { data: [{ name: "slot", value: "main_hand" }] }
      })
    );
    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_unequip_requested");
    assert.equal(out.payload.event.target_system, "world_system");
    assert.equal(out.payload.event.payload.slot, "main_hand");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("identify_attune_and_unattune_commands_map_to_canonical_event_shape", () => {
    const identifyOut = mapSlashCommandToGatewayEvent(
      createInteraction("identify", {
        options: { data: [{ name: "item_id", value: "item_mysterious_ring" }] }
      })
    );
    const attuneOut = mapSlashCommandToGatewayEvent(
      createInteraction("attune", {
        options: { data: [{ name: "item_id", value: "item_ring_of_protection" }] }
      })
    );
    const unattuneOut = mapSlashCommandToGatewayEvent(
      createInteraction("unattune", {
        options: { data: [{ name: "item_id", value: "item_ring_of_protection" }] }
      })
    );

    assert.equal(identifyOut.ok, true);
    assert.equal(attuneOut.ok, true);
    assert.equal(unattuneOut.ok, true);
    assert.equal(identifyOut.payload.event.event_type, "player_identify_item_requested");
    assert.equal(attuneOut.payload.event.event_type, "player_attune_item_requested");
    assert.equal(unattuneOut.payload.event.event_type, "player_unattune_item_requested");
    assert.equal(identifyOut.payload.event.target_system, "world_system");
    assert.equal(attuneOut.payload.event.target_system, "world_system");
    assert.equal(unattuneOut.payload.event.target_system, "world_system");
    assert.equal(identifyOut.payload.event.payload.item_id, "item_mysterious_ring");
    assert.equal(attuneOut.payload.event.payload.item_id, "item_ring_of_protection");
    assert.equal(unattuneOut.payload.event.payload.item_id, "item_ring_of_protection");
  }, results);

  runTest("feat_command_maps_to_canonical_event_shape", () => {
    const listOut = mapSlashCommandToGatewayEvent(
      createInteraction("feat", {
        options: { data: [{ name: "action", value: "list" }] }
      })
    );
    const takeOut = mapSlashCommandToGatewayEvent(
      createInteraction("feat", {
        options: { data: [{ name: "action", value: "take" }, { name: "feat_id", value: "alert" }] }
      })
    );

    assert.equal(listOut.ok, true);
    assert.equal(takeOut.ok, true);
    assert.equal(listOut.payload.event.event_type, "player_feat_requested");
    assert.equal(takeOut.payload.event.event_type, "player_feat_requested");
    assert.equal(listOut.payload.event.payload.action, "list");
    assert.equal(takeOut.payload.event.payload.action, "take");
    assert.equal(takeOut.payload.event.payload.feat_id, "alert");
    assert.equal(takeOut.payload.event.payload.ability_id, null);
  }, results);

  runTest("feat_command_maps_optional_ability_choice", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("feat", {
        options: { data: [{ name: "action", value: "take" }, { name: "feat_id", value: "resilient" }, { name: "ability_id", value: "wisdom" }] }
      })
    );

    assert.equal(out.ok, true);
    assert.equal(out.payload.event.payload.feat_id, "resilient");
    assert.equal(out.payload.event.payload.ability_id, "wisdom");
  }, results);

  runTest("dungeon_enter_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("dungeon", {
        options: {
          data: [
            {
              type: 1,
              name: "enter",
              options: [
                { name: "dungeon_id", value: "dungeon-001" },
                { name: "party_id", value: "party-001" }
              ]
            }
          ]
        }
      })
    );

    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_enter_dungeon");
    assert.equal(out.payload.event.target_system, "session_system");
    assert.equal(out.payload.event.payload.subcommand, "enter");
    assert.equal(out.payload.event.payload.dungeon_id, "dungeon-001");
    assert.equal(out.payload.event.payload.party_id, "party-001");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("leave_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("leave", {
        options: { data: [{ name: "session_id", value: "session-001" }] }
      })
    );

    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_leave_session");
    assert.equal(out.payload.event.target_system, "session_system");
    assert.equal(out.payload.event.session_id, "session-001");
    assert.equal(out.payload.event.payload.session_id, "session-001");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("interact_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("interact", {
        options: {
          data: [
            { name: "object_id", value: "obj-chest-001" },
            { name: "action", value: "unlock" },
            { name: "spell_id", value: "light" },
            { name: "session_id", value: "session-250" }
          ]
        }
      })
    );

    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_interact_object");
    assert.equal(out.payload.event.target_system, "session_system");
    assert.equal(out.payload.event.session_id, "session-250");
    assert.equal(out.payload.event.payload.object_id, "obj-chest-001");
    assert.equal(out.payload.event.payload.action, "unlock");
    assert.equal(out.payload.event.payload.spell_id, "light");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("move_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("move", {
        options: { data: [{ name: "direction", value: "north" }, { name: "session_id", value: "session-100" }] }
      })
    );

    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_move");
    assert.equal(out.payload.event.target_system, "session_system");
    assert.equal(out.payload.event.session_id, "session-100");
    assert.equal(out.payload.event.payload.direction, "north");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("attack_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("attack", {
        options: {
          data: [
            { name: "target_id", value: "enemy-001" },
            { name: "combat_id", value: "combat-200" },
            { name: "session_id", value: "session-200" }
          ]
        }
      })
    );

    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_attack");
    assert.equal(out.payload.event.target_system, "combat_system");
    assert.equal(out.payload.event.combat_id, "combat-200");
    assert.equal(out.payload.event.session_id, "session-200");
    assert.equal(out.payload.event.payload.target_id, "enemy-001");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("dodge_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("dodge", {
        options: {
          data: [
            { name: "combat_id", value: "combat-207" }
          ]
        }
      })
    );

    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_dodge");
    assert.equal(out.payload.event.target_system, "combat_system");
    assert.equal(out.payload.event.combat_id, "combat-207");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("dash_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("dash", {
        options: {
          data: [
            { name: "combat_id", value: "combat-207b" }
          ]
        }
      })
    );

    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_dash");
    assert.equal(out.payload.event.target_system, "combat_system");
    assert.equal(out.payload.event.combat_id, "combat-207b");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("grapple_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("grapple", {
        options: {
          data: [
            { name: "target_id", value: "enemy-020" },
            { name: "combat_id", value: "combat-207c" }
          ]
        }
      })
    );

    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_grapple");
    assert.equal(out.payload.event.target_system, "combat_system");
    assert.equal(out.payload.event.combat_id, "combat-207c");
    assert.equal(out.payload.event.payload.target_id, "enemy-020");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("escape_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("escape", {
        options: {
          data: [
            { name: "combat_id", value: "combat-207d" }
          ]
        }
      })
    );

    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_escape_grapple");
    assert.equal(out.payload.event.target_system, "combat_system");
    assert.equal(out.payload.event.combat_id, "combat-207d");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("shove_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("shove", {
        options: {
          data: [
            { name: "target_id", value: "enemy-021" },
            { name: "shove_mode", value: "push" },
            { name: "combat_id", value: "combat-207e" }
          ]
        }
      })
    );

    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_shove");
    assert.equal(out.payload.event.target_system, "combat_system");
    assert.equal(out.payload.event.combat_id, "combat-207e");
    assert.equal(out.payload.event.payload.target_id, "enemy-021");
    assert.equal(out.payload.event.payload.shove_mode, "push");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("assist_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("assist", {
        options: {
          data: [
            { name: "target_id", value: "ally-001" },
            { name: "combat_id", value: "combat-206" }
          ]
        }
      })
    );

    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_help_action");
    assert.equal(out.payload.event.target_system, "combat_system");
    assert.equal(out.payload.event.combat_id, "combat-206");
    assert.equal(out.payload.event.payload.target_id, "ally-001");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("ready_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("ready", {
        options: {
          data: [
            { name: "combat_id", value: "combat-206b" },
            { name: "trigger_type", value: "enemy_enters_reach" },
            { name: "readied_action_type", value: "attack" },
            { name: "target_id", value: "enemy-002" }
          ]
        }
      })
    );

    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_ready_action");
    assert.equal(out.payload.event.target_system, "combat_system");
    assert.equal(out.payload.event.combat_id, "combat-206b");
    assert.equal(out.payload.event.payload.trigger_type, "enemy_enters_reach");
    assert.equal(out.payload.event.payload.readied_action_type, "attack");
    assert.equal(out.payload.event.payload.target_id, "enemy-002");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("disengage_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("disengage", {
        options: {
          data: [
            { name: "combat_id", value: "combat-208" }
          ]
        }
      })
    );

    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_disengage");
    assert.equal(out.payload.event.target_system, "combat_system");
    assert.equal(out.payload.event.combat_id, "combat-208");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("cast_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("cast", {
        options: {
          data: [
            { name: "spell_id", value: "magic_missile" },
            { name: "target_id", value: "enemy-009" },
            { name: "combat_id", value: "combat-209" }
          ]
        }
      })
    );

    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_cast_spell");
    assert.equal(out.payload.event.target_system, "combat_system");
    assert.equal(out.payload.event.combat_id, "combat-209");
    assert.equal(out.payload.event.payload.spell_id, "magic_missile");
    assert.equal(out.payload.event.payload.target_id, "enemy-009");
    assert.deepEqual(out.payload.event.payload.target_ids, ["enemy-009"]);
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("cast_command_maps_additional_target_ids", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("cast", {
        options: {
          data: [
            { name: "spell_id", value: "bless" },
            { name: "target_id", value: "ally-001" },
            { name: "additional_target_ids", value: "ally-002, ally-003" },
            { name: "combat_id", value: "combat-209" }
          ]
        }
      })
    );

    assert.equal(out.ok, true);
    assert.deepEqual(out.payload.event.payload.target_ids, ["ally-001", "ally-002", "ally-003"]);
  }, results);

  runTest("use_command_maps_to_canonical_event_shape", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("use", {
        options: {
          data: [
            { name: "item_id", value: "item-potion-001" },
            { name: "target_id", value: "ally-001" },
            { name: "session_id", value: "session-300" }
          ]
        }
      })
    );

    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "player_use_item");
    assert.equal(out.payload.event.target_system, "world_system");
    assert.equal(out.payload.event.session_id, "session-300");
    assert.equal(out.payload.event.payload.item_id, "item-potion-001");
    assert.equal(out.payload.event.payload.target_id, "ally-001");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("move_with_combat_id_routes_to_combat_system", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("move", {
        options: {
          data: [
            { name: "direction", value: "east" },
            { name: "combat_id", value: "combat-999" }
          ]
        }
      })
    );
    assert.equal(out.ok, true);
    assert.equal(out.payload.event.target_system, "combat_system");
    assert.equal(out.payload.event.combat_id, "combat-999");
  }, results);

  runTest("missing_command_name_fails_safely", () => {
    const out = mapSlashCommandToGatewayEvent(createInteraction(""));
    assert.equal(out.ok, false);
    assert.equal(out.error, "interaction.commandName is required");
  }, results);

  runTest("invalid_options_are_handled_safely", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("help", {
        options: { data: [{ name: "foo" }, null] }
      })
    );
    assert.equal(out.ok, true);
    assert.equal(Array.isArray(out.payload.event.payload.command_options), true);
    assert.equal(out.payload.event.payload.command_options.length, 2);
  }, results);

  runTest("admin_invalid_action_fails_safely", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("admin", {
        options: { data: [{ name: "action", value: "destroy_everything" }] }
      })
    );
    assert.equal(out.ok, false);
    assert.equal(out.error, "admin command requires a valid action");
  }, results);

  runTest("admin_spawn_monster_missing_required_ids_fails_safely", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("admin", {
        options: { data: [{ name: "action", value: "spawn_monster" }] }
      })
    );
    assert.equal(out.ok, false);
    assert.equal(out.error, "spawn_monster requires combat_id and monster_id");
  }, results);

  runTest("admin_world_controls_and_tuning_map_safely", () => {
      const inspectParty = mapSlashCommandToGatewayEvent(
        createInteraction("admin", {
          options: { data: [{ name: "action", value: "inspect_party" }, { name: "party_id", value: "party-777" }] }
        })
      );
      const inspectInventory = mapSlashCommandToGatewayEvent(
        createInteraction("admin", {
          options: { data: [{ name: "action", value: "inspect_inventory" }, { name: "inventory_id", value: "inv-777" }] }
        })
      );
      const inspectGuild = mapSlashCommandToGatewayEvent(
        createInteraction("admin", {
          options: { data: [{ name: "action", value: "inspect_guild" }, { name: "guild_id", value: "guild-777" }] }
        })
      );
      const inspectWorldEvent = mapSlashCommandToGatewayEvent(
        createInteraction("admin", {
          options: { data: [{ name: "action", value: "inspect_world_event" }, { name: "world_event_id", value: "we-777" }] }
        })
      );
    const inspectRankings = mapSlashCommandToGatewayEvent(
      createInteraction("admin", {
        options: {
          data: [
            { name: "action", value: "inspect_rankings" },
            { name: "ranking_type", value: "hunter" },
            { name: "limit", value: 5 }
          ]
        }
      })
    );
    const setMultiplier = mapSlashCommandToGatewayEvent(
      createInteraction("admin", {
        options: {
          data: [
            { name: "action", value: "set_reward_multiplier" },
            { name: "reward_multiplier", value: 1.25 }
          ]
        }
      })
    );
    const refreshContent = mapSlashCommandToGatewayEvent(
      createInteraction("admin", {
        options: { data: [{ name: "action", value: "refresh_content" }] }
      })
    );
  
      assert.equal(inspectParty.ok, true);
      assert.equal(inspectInventory.ok, true);
      assert.equal(inspectGuild.ok, true);
      assert.equal(inspectWorldEvent.ok, true);
      assert.equal(inspectRankings.ok, true);
      assert.equal(setMultiplier.ok, true);
    assert.equal(refreshContent.ok, true);
    assert.equal(inspectRankings.payload.event.payload.limit, 5);
    assert.equal(setMultiplier.payload.event.payload.reward_multiplier, 1.25);
  }, results);

  runTest("admin_new_actions_missing_required_options_fail_safely", () => {
      const inspectParty = mapSlashCommandToGatewayEvent(
        createInteraction("admin", {
          options: { data: [{ name: "action", value: "inspect_party" }] }
        })
      );
      const inspectInventory = mapSlashCommandToGatewayEvent(
        createInteraction("admin", {
          options: { data: [{ name: "action", value: "inspect_inventory" }] }
        })
      );
      const inspectGuild = mapSlashCommandToGatewayEvent(
        createInteraction("admin", {
          options: { data: [{ name: "action", value: "inspect_guild" }] }
        })
      );
    const inspectRankings = mapSlashCommandToGatewayEvent(
      createInteraction("admin", {
        options: { data: [{ name: "action", value: "inspect_rankings" }] }
      })
    );
      const activateEvent = mapSlashCommandToGatewayEvent(
        createInteraction("admin", {
          options: { data: [{ name: "action", value: "inspect_world_event" }] }
        })
      );
      const inspectWorldEvent = activateEvent;
      const activateEventAction = mapSlashCommandToGatewayEvent(
        createInteraction("admin", {
          options: { data: [{ name: "action", value: "activate_world_event" }] }
        })
      );
    const setMultiplier = mapSlashCommandToGatewayEvent(
      createInteraction("admin", {
        options: { data: [{ name: "action", value: "set_reward_multiplier" }] }
      })
    );

      assert.equal(inspectParty.ok, false);
      assert.equal(inspectParty.error, "inspect_party requires party_id");
      assert.equal(inspectInventory.ok, false);
      assert.equal(inspectInventory.error, "inspect_inventory requires inventory_id");
      assert.equal(inspectGuild.ok, false);
      assert.equal(inspectGuild.error, "inspect_guild requires guild_id");
      assert.equal(inspectRankings.ok, false);
      assert.equal(inspectRankings.error, "inspect_rankings requires ranking_type");
      assert.equal(inspectWorldEvent.ok, false);
      assert.equal(inspectWorldEvent.error, "inspect_world_event requires world_event_id");
      assert.equal(activateEventAction.ok, false);
      assert.equal(activateEventAction.error, "activate_world_event requires world_event_id");
      assert.equal(setMultiplier.ok, false);
      assert.equal(setMultiplier.error, "set_reward_multiplier requires reward_multiplier");
    }, results);

  runTest("equip_missing_item_id_fails_safely", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("equip", {
        options: { data: [{ name: "slot", value: "off_hand" }] }
      })
    );
    assert.equal(out.ok, false);
    assert.equal(out.error, "equip command requires item_id");
  }, results);

  runTest("unequip_missing_slot_fails_safely", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("unequip", {
        options: { data: [{ name: "item_id", value: "item-shield-001" }] }
      })
    );
    assert.equal(out.ok, false);
    assert.equal(out.error, "unequip command requires slot");
  }, results);

  runTest("dungeon_enter_missing_dungeon_id_fails_safely", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("dungeon", {
        options: {
          data: [
            {
              type: 1,
              name: "enter",
              options: [{ name: "party_id", value: "party-001" }]
            }
          ]
        }
      })
    );
    assert.equal(out.ok, false);
    assert.equal(out.error, "dungeon enter requires dungeon_id");
  }, results);

  runTest("dungeon_missing_enter_subcommand_fails_safely", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("dungeon", {
        options: { data: [] }
      })
    );
    assert.equal(out.ok, false);
    assert.equal(out.error, "dungeon command requires enter subcommand");
  }, results);

  runTest("move_invalid_direction_fails_safely", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("move", {
        options: { data: [{ name: "direction", value: "sideways" }] }
      })
    );
    assert.equal(out.ok, false);
    assert.equal(out.error, "move command has invalid direction");
  }, results);

  runTest("move_missing_all_navigation_inputs_fails_safely", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("move", {
        options: { data: [] }
      })
    );
    assert.equal(out.ok, false);
    assert.equal(out.error, "move command requires direction, destination_id, or target coordinates");
  }, results);

  runTest("attack_missing_target_id_fails_safely", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("attack", {
        options: { data: [{ name: "combat_id", value: "combat-1" }] }
      })
    );
    assert.equal(out.ok, false);
    assert.equal(out.error, "attack command requires target_id");
  }, results);

  runTest("cast_missing_spell_id_fails_safely", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("cast", {
        options: { data: [{ name: "combat_id", value: "combat-1" }] }
      })
    );
    assert.equal(out.ok, false);
    assert.equal(out.error, "cast command requires spell_id");
  }, results);

  runTest("use_missing_item_and_ability_fails_safely", () => {
    const out = mapSlashCommandToGatewayEvent(
      createInteraction("use", {
        options: { data: [{ name: "target_id", value: "target-1" }] }
      })
    );
    assert.equal(out.ok, false);
    assert.equal(out.error, "use command requires item_id or ability_id");
  }, results);

  runTest("gateway_translation_is_side_effect_free", () => {
    const interaction = createInteraction("profile", {
      options: { data: [{ name: "tab", value: "stats" }] }
    });
    const before = JSON.parse(JSON.stringify(interaction));
    const event = translateSlashCommandToInternalEvent(interaction);

    assert.equal(event !== null, true);
    assert.deepEqual(interaction, before);
  }, results);

  runTest("ping_mapping_does_not_regress", () => {
    const out = mapSlashCommandToGatewayEvent(createInteraction("ping"));
    assert.equal(out.ok, true);
    assert.equal(out.payload.event.event_type, "gateway_ping_requested");
    assert.equal(isValidEvent(out.payload.event), true);
  }, results);

  runTest("repeated_start_input_maps_deterministically_without_gateway_mutations", () => {
    const a = mapSlashCommandToGatewayEvent(
      createInteraction("start", { options: { data: [{ name: "name", value: "Kira" }] } })
    );
    const b = mapSlashCommandToGatewayEvent(
      createInteraction("start", { options: { data: [{ name: "name", value: "Kira" }] } })
    );

    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(a.payload.event.event_type, b.payload.event.event_type);
    assert.equal(a.payload.event.target_system, b.payload.event.target_system);
    assert.equal(a.payload.event.payload.requested_character_name, b.payload.event.payload.requested_character_name);
  }, results);

  runTest("equip_and_unequip_payloads_only_include_normalized_identifiers", () => {
    const equipOut = mapSlashCommandToGatewayEvent(
      createInteraction("equip", {
        options: { data: [{ name: "item_id", value: " item-axe-001 " }, { name: "slot", value: " off_hand " }] }
      })
    );
    const unequipOut = mapSlashCommandToGatewayEvent(
      createInteraction("unequip", {
        options: { data: [{ name: "slot", value: " off_hand " }, { name: "item_id", value: " item-axe-001 " }] }
      })
    );

    assert.equal(equipOut.ok, true);
    assert.equal(unequipOut.ok, true);
    assert.equal(equipOut.payload.event.payload.item_id, "item-axe-001");
    assert.equal(equipOut.payload.event.payload.slot, "off_hand");
    assert.equal(unequipOut.payload.event.payload.slot, "off_hand");
    assert.equal(unequipOut.payload.event.payload.item_id, "item-axe-001");
    assert.equal("result" in equipOut.payload.event.payload, false);
    assert.equal("updated_inventory" in equipOut.payload.event.payload, false);
  }, results);

  runTest("dungeon_and_leave_payloads_only_include_lifecycle_identifiers", () => {
    const dungeonOut = mapSlashCommandToGatewayEvent(
      createInteraction("dungeon", {
        options: {
          data: [
            {
              type: 1,
              name: "enter",
              options: [{ name: "dungeon_id", value: " dungeon-002 " }]
            }
          ]
        }
      })
    );
    const leaveOut = mapSlashCommandToGatewayEvent(
      createInteraction("leave", {
        options: { data: [{ name: "session_id", value: " session-002 " }] }
      })
    );

    assert.equal(dungeonOut.ok, true);
    assert.equal(leaveOut.ok, true);
    assert.equal(dungeonOut.payload.event.payload.dungeon_id, "dungeon-002");
    assert.equal(leaveOut.payload.event.payload.session_id, "session-002");
    assert.equal("session_created" in dungeonOut.payload.event.payload, false);
    assert.equal("encounter_started" in dungeonOut.payload.event.payload, false);
  }, results);

  runTest("action_payloads_only_include_normalized_action_identifiers", () => {
    const moveOut = mapSlashCommandToGatewayEvent(
      createInteraction("move", {
        options: { data: [{ name: "direction", value: " NORTH " }, { name: "session_id", value: " session-41 " }] }
      })
    );
    const attackOut = mapSlashCommandToGatewayEvent(
      createInteraction("attack", {
        options: {
          data: [
            { name: "target_id", value: " enemy-42 " },
            { name: "combat_id", value: " combat-42 " }
          ]
        }
      })
    );
    const useOut = mapSlashCommandToGatewayEvent(
      createInteraction("use", {
        options: { data: [{ name: "ability_id", value: " ability-heal-1 " }] }
      })
    );

    assert.equal(moveOut.ok, true);
    assert.equal(attackOut.ok, true);
    assert.equal(useOut.ok, true);
    assert.equal(moveOut.payload.event.payload.direction, "north");
    assert.equal(moveOut.payload.event.session_id, "session-41");
    assert.equal(attackOut.payload.event.payload.target_id, "enemy-42");
    assert.equal(attackOut.payload.event.combat_id, "combat-42");
    assert.equal(useOut.payload.event.payload.ability_id, "ability-heal-1");
    assert.equal("damage_total" in attackOut.payload.event.payload, false);
    assert.equal("movement_result" in moveOut.payload.event.payload, false);
    assert.equal("item_applied" in useOut.payload.event.payload, false);
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
  const summary = runCommandEventMapperTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCommandEventMapperTests
};
