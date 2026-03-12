"use strict";

const assert = require("assert");
const { handleGatewayInteraction, __test } = require("../index");

async function runTest(name, fn, results) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createInteraction(commandName, options, playerId) {
  const replyCalls = [];
  const followUpCalls = [];
  const updateCalls = [];

  return {
    commandName: commandName,
    user: { id: playerId || "player-gateway-runtime-001" },
    guildId: "guild-gateway-runtime-001",
    channelId: "channel-gateway-runtime-001",
    options: {
      data: Array.isArray(options) ? options : []
    },
    replied: false,
    isChatInputCommand() {
      return true;
    },
    isButton() {
      return false;
    },
    isStringSelectMenu() {
      return false;
    },
    async reply(payload) {
      replyCalls.push(payload);
      this.replied = true;
    },
    async followUp(payload) {
      followUpCalls.push(payload);
      this.replied = true;
    },
    async update(payload) {
      updateCalls.push(payload);
      this.replied = true;
    },
    _replyCalls: replyCalls,
    _followUpCalls: followUpCalls,
    _updateCalls: updateCalls
  };
}

function createButtonInteraction(customId, playerId) {
  const replyCalls = [];
  const followUpCalls = [];
  const updateCalls = [];

  return {
    customId,
    user: { id: playerId || "player-gateway-runtime-001" },
    replied: false,
    deferred: false,
    isChatInputCommand() {
      return false;
    },
    isButton() {
      return true;
    },
    isStringSelectMenu() {
      return false;
    },
    async reply(payload) {
      replyCalls.push(payload);
      this.replied = true;
    },
    async followUp(payload) {
      followUpCalls.push(payload);
      this.replied = true;
    },
    async update(payload) {
      updateCalls.push(payload);
      this.replied = true;
    },
    _replyCalls: replyCalls,
    _followUpCalls: followUpCalls,
    _updateCalls: updateCalls
  };
}

function createSelectInteraction(customId, value, playerId) {
  const interaction = createButtonInteraction(customId, playerId);
  interaction.values = [value];
  interaction.isButton = function isButton() {
    return false;
  };
  interaction.isStringSelectMenu = function isStringSelectMenu() {
    return true;
  };
  return interaction;
}

async function runGatewayRuntimeIntegrationTests() {
  const results = [];

  await runTest("gateway_routes_help_command_to_runtime_path", async () => {
    let receivedEvent = null;
    const runtime = {
      processGatewayReadCommandEvent(event) {
        receivedEvent = event;
        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "help",
                  ok: true,
                  data: {
                    commands: ["/help"]
                  },
                  error: null
                }
              }
            ],
            events_processed: [event],
            final_state: {}
          },
          error: null
        };
      }
    };

    const interaction = createInteraction("help", [], "player-gateway-help-001");
    const out = await handleGatewayInteraction(interaction, runtime);

    assert.equal(out.ok, true);
    assert.equal(Boolean(receivedEvent), true);
    assert.equal(receivedEvent.event_type, "gateway_help_requested");
    assert.equal(interaction._replyCalls.length, 1);
    assert.equal(interaction._replyCalls[0].content, "help completed.");
  }, results);

  await runTest("gateway_routes_ping_command_to_runtime_path", async () => {
    let receivedEvent = null;
    const runtime = {
      processGatewayReadCommandEvent(event) {
        receivedEvent = event;
        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "ping",
                  ok: true,
                  data: {
                    message: "Pong!"
                  },
                  error: null
                }
              }
            ],
            events_processed: [event],
            final_state: {}
          },
          error: null
        };
      }
    };

    const interaction = createInteraction("ping", [], "player-gateway-ping-001");
    const out = await handleGatewayInteraction(interaction, runtime);

    assert.equal(out.ok, true);
    assert.equal(Boolean(receivedEvent), true);
    assert.equal(receivedEvent.event_type, "gateway_ping_requested");
    assert.equal(interaction._replyCalls.length, 1);
    assert.equal(interaction._replyCalls[0].content, "Pong!");
  }, results);

  await runTest("gateway_routes_profile_command_to_runtime_path", async () => {
    let receivedEvent = null;
    const runtime = {
      processGatewayReadCommandEvent(event) {
        receivedEvent = event;
        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "profile",
                  ok: true,
                  data: {
                    profile_found: true,
                    character: {
                      name: "Profile Hero",
                      race: "human",
                      class: "fighter",
                      secondary_class_id: "wizard",
                      level: 5,
                      xp: 650,
                      base_stats: {
                        strength: 15,
                        dexterity: 12,
                        constitution: 14,
                        intelligence: 10,
                        wisdom: 8,
                        charisma: 13
                      },
                      stats: {
                        strength: 15,
                        dexterity: 12,
                        constitution: 14,
                        intelligence: 10,
                        wisdom: 8,
                        charisma: 13
                      }
                    }
                  },
                  error: null
                }
              }
            ],
            events_processed: [event],
            final_state: {}
          },
          error: null
        };
      }
    };

    const interaction = createInteraction("profile", [], "player-gateway-profile-001");
    const out = await handleGatewayInteraction(interaction, runtime);

    assert.equal(out.ok, true);
    assert.equal(Boolean(receivedEvent), true);
    assert.equal(receivedEvent.event_type, "player_profile_requested");
    assert.equal(interaction._replyCalls.length, 1);
    assert.equal(interaction._replyCalls[0].content.includes("Name: Profile Hero"), true);
    assert.equal(interaction._replyCalls[0].content.includes("Track B: wizard"), true);
  }, results);

  await runTest("gateway_routes_inventory_command_to_runtime_path_with_summary", async () => {
    let receivedEvent = null;
    const runtime = {
      processGatewayReadCommandEvent(event) {
        receivedEvent = event;
        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "inventory",
                  ok: true,
                  data: {
                    inventory_found: true,
                    inventory: {
                      inventory_id: "inv-gateway-profile-001",
                      currency: { gold: 42 },
                      stackable_count: 3,
                      equipment_count: 2,
                      quest_count: 1
                    }
                  },
                  error: null
                }
              }
            ],
            events_processed: [event],
            final_state: {}
          },
          error: null
        };
      }
    };

    const interaction = createInteraction("inventory", [], "player-gateway-inventory-001");
    const out = await handleGatewayInteraction(interaction, runtime);

    assert.equal(out.ok, true);
    assert.equal(Boolean(receivedEvent), true);
    assert.equal(receivedEvent.event_type, "player_inventory_requested");
    assert.equal(interaction._replyCalls.length, 1);
    assert.equal(interaction._replyCalls[0].content.includes("Gold: 42"), true);
    assert.equal(interaction._replyCalls[0].content.includes("Equipment: 2"), true);
  }, results);

  await runTest("gateway_formats_combat_attack_response_with_turn_and_ai_summary", async () => {
    const runtime = {
      processGatewayReadCommandEvent(event) {
        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "attack",
                  ok: true,
                  data: {
                    attacker_id: "hero-001",
                    target_id: "monster-001",
                    hit: true,
                    damage_dealt: 4,
                    target_hp_after: 3,
                    active_participant_id: "hero-001",
                    combat_completed: false,
                    ai_turns: [
                      {
                        actor_id: "monster-001",
                        action_type: "attack",
                        target_id: "hero-001"
                      }
                    ]
                  },
                  error: null
                }
              }
            ],
            events_processed: [event],
            final_state: {}
          },
          error: null
        };
      }
    };

    const interaction = createInteraction("attack", [
      { name: "target_id", value: "monster-001" },
      { name: "combat_id", value: "combat-gateway-attack-001" }
    ], "player-gateway-attack-001");
    const out = await handleGatewayInteraction(interaction, runtime);

    assert.equal(out.ok, true);
    assert.equal(interaction._replyCalls.length, 1);
    assert.equal(interaction._replyCalls[0].content.includes("Damage: 4"), true);
    assert.equal(interaction._replyCalls[0].content.includes("Next Turn: hero-001"), true);
    assert.equal(interaction._replyCalls[0].content.includes("monster-001 attacked hero-001"), true);
  }, results);

  await runTest("gateway_formats_spell_effect_details_in_cast_response", async () => {
    const runtime = {
      processGatewayReadCommandEvent(event) {
        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "cast",
                  ok: true,
                  data: {
                    spell_name: "Mage Armor",
                    caster_id: "caster-001",
                    target_id: "ally-001",
                    resolution_type: "none",
                    damage_type: null,
                    hit: null,
                    saved: null,
                    damage_result: null,
                    healing_result: null,
                    defense_result: {
                      armor_class_before: 11,
                      armor_class_after: 16
                    },
                    applied_conditions: [
                      { condition_type: "mage_armor" }
                    ],
                    active_participant_id: "enemy-001",
                    ai_turns: [],
                    combat_completed: false,
                    winner_team: null
                  },
                  error: null
                }
              }
            ],
            events_processed: [event],
            final_state: {}
          },
          error: null
        };
      }
    };

    const interaction = createInteraction("cast", [
      { name: "spell_id", value: "mage_armor" },
      { name: "target_id", value: "ally-001" },
      { name: "combat_id", value: "combat-gateway-cast-001" }
    ], "player-gateway-cast-001");
    const out = await handleGatewayInteraction(interaction, runtime);

    assert.equal(out.ok, true);
    assert.equal(interaction._replyCalls.length, 1);
    assert.equal(interaction._replyCalls[0].content.includes("Defense: 11 -> 16"), true);
    assert.equal(interaction._replyCalls[0].content.includes("Conditions: mage_armor"), true);
  }, results);

  await runTest("gateway_uses_runtime_failure_response_shape_for_replies", async () => {
    const runtime = {
      processGatewayReadCommandEvent(event) {
        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "inventory",
                  ok: false,
                  data: {},
                  error: "inventory not found"
                }
              }
            ],
            events_processed: [event],
            final_state: {}
          },
          error: null
        };
      }
    };

    const interaction = createInteraction("inventory", [], "player-gateway-fail-001");
    const out = await handleGatewayInteraction(interaction, runtime);

    assert.equal(out.ok, false);
    assert.equal(interaction._replyCalls.length, 1);
    assert.equal(interaction._replyCalls[0].content, "inventory failed: inventory not found");
  }, results);

  await runTest("gateway_runtime_throw_sends_safe_fallback_reply", async () => {
    const runtime = {
      async processGatewayReadCommandEvent() {
        throw new Error("runtime exploded");
      }
    };

    const interaction = createInteraction("profile", [], "player-gateway-throw-001");
    const out = await handleGatewayInteraction(interaction, runtime);

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "gateway_interaction_failed");
    assert.equal(out.error, "runtime exploded");
    assert.equal(interaction._replyCalls.length, 1);
    assert.equal(
      interaction._replyCalls[0].content,
      "Something went wrong while processing that command. Please try again."
    );
  }, results);

  await runTest("gateway_replies_safely_on_runtime_routing_error_response", async () => {
    const runtime = {
      processGatewayReadCommandEvent(event) {
        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "routing_error",
                  ok: false,
                  data: {
                    reason: "unsupported_target_system"
                  },
                  error: "unsupported target_system for router"
                }
              }
            ],
            events_processed: [event],
            final_state: {}
          },
          error: null
        };
      }
    };

    const interaction = createInteraction("profile", [], "player-gateway-routing-fail-001");
    const out = await handleGatewayInteraction(interaction, runtime);

    assert.equal(out.ok, false);
    assert.equal(interaction._replyCalls.length, 1);
    assert.equal(interaction._replyCalls[0].content, "routing_error failed: unsupported target_system for router");
  }, results);

  await runTest("point_buy_helpers_start_at_standard_5e_base", async () => {
    const stats = __test.createBasePointBuyStats();
    const summary = __test.getPointBuySummary(stats);

    assert.deepEqual(stats, {
      strength: 8,
      dexterity: 8,
      constitution: 8,
      intelligence: 8,
      wisdom: 8,
      charisma: 8
    });
    assert.equal(summary.total_cost, 0);
    assert.equal(summary.remaining_points, 27);
  }, results);

  await runTest("gateway_start_command_opens_button_driven_wizard", async () => {
    const runtime = {
      processGatewayReadCommandEvent() {
        throw new Error("runtime should not be called for initial wizard render");
      }
    };

    const interaction = createInteraction("start", [{ name: "name", value: "Mira" }], "player-start-wizard-001");
    const out = await handleGatewayInteraction(interaction, runtime);

    assert.equal(out.ok, true);
    assert.equal(interaction._replyCalls.length, 1);
    assert.equal(interaction._replyCalls[0].embeds[0].data.title, "Start wizard");
    assert.equal(interaction._replyCalls[0].components.length > 0, true);
  }, results);

  await runTest("gateway_start_point_buy_flow_uses_buttons_and_blocks_overspend", async () => {
    const runtime = {
      processGatewayReadCommandEvent() {
        throw new Error("runtime should not be called during point-buy edits");
      }
    };
    const playerId = "player-start-point-buy-001";

    await handleGatewayInteraction(
      createInteraction("start", [{ name: "name", value: "Tarin" }], playerId),
      runtime
    );

    const openPointBuy = createButtonInteraction("start:point_buy", playerId);
    const openOut = await handleGatewayInteraction(openPointBuy, runtime);
    assert.equal(openOut.ok, true);
    assert.equal(openPointBuy._updateCalls[0].embeds[0].data.title, "Point-Buy");

    const chooseStrength = createSelectInteraction("start:point_buy_ability", "strength", playerId);
    await handleGatewayInteraction(chooseStrength, runtime);

    for (let i = 0; i < 7; i += 1) {
      const plus = createButtonInteraction("start:point_buy_increase", playerId);
      const out = await handleGatewayInteraction(plus, runtime);
      assert.equal(out.ok, true);
    }

    await handleGatewayInteraction(createSelectInteraction("start:point_buy_ability", "dexterity", playerId), runtime);
    for (let i = 0; i < 7; i += 1) {
      await handleGatewayInteraction(createButtonInteraction("start:point_buy_increase", playerId), runtime);
    }

    await handleGatewayInteraction(createSelectInteraction("start:point_buy_ability", "constitution", playerId), runtime);
    for (let i = 0; i < 7; i += 1) {
      await handleGatewayInteraction(createButtonInteraction("start:point_buy_increase", playerId), runtime);
    }

    await handleGatewayInteraction(createSelectInteraction("start:point_buy_ability", "intelligence", playerId), runtime);
    const overspend = createButtonInteraction("start:point_buy_increase", playerId);
    const overspendOut = await handleGatewayInteraction(overspend, runtime);
    assert.equal(overspendOut.ok, true);
    assert.equal(overspend._replyCalls.length, 1);
    assert.equal(
      overspend._replyCalls[0].content,
      "Point-buy cannot exceed 27. Current spend would be 28."
    );

    const backWithoutConfirm = createButtonInteraction("start:point_buy_back", playerId);
    await handleGatewayInteraction(backWithoutConfirm, runtime);
    const createTooEarly = createButtonInteraction("start:create", playerId);
    await handleGatewayInteraction(createTooEarly, runtime);
    assert.equal(
      createTooEarly._replyCalls[0].content,
      "Choose race, both classes, and confirm the full 27-point buy before creating."
    );
  }, results);

  await runTest("gateway_start_create_requires_full_point_buy_then_calls_runtime", async () => {
    let receivedEvent = null;
    const runtime = {
      processGatewayReadCommandEvent(event) {
        receivedEvent = event;
        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "start",
                  ok: true,
                  data: {
                    character: {
                      name: "Vera",
                      race: "human",
                      class: "cleric",
                      class_option_id: "life_domain",
                      secondary_class_id: "sorcerer",
                      secondary_class_option_id: "draconic_bloodline",
                      level: 1,
                      stats: {
                        strength: 15,
                        dexterity: 14,
                        constitution: 13,
                        intelligence: 12,
                        wisdom: 10,
                        charisma: 8
                      }
                    },
                    point_buy_summary: {
                      total_cost: 27
                    }
                  },
                  error: null
                }
              }
            ],
            final_state: {},
            events_processed: [event]
          },
          error: null
        };
      }
    };
    const playerId = "player-start-create-001";

    await handleGatewayInteraction(
      createInteraction("start", [{ name: "name", value: "Vera" }], playerId),
      runtime
    );

    await handleGatewayInteraction(createSelectInteraction("start:race", "human", playerId), runtime);
    await handleGatewayInteraction(createSelectInteraction("start:class_primary", "cleric", playerId), runtime);
    await handleGatewayInteraction(createSelectInteraction("start:class_option_primary", "life_domain", playerId), runtime);
    await handleGatewayInteraction(createSelectInteraction("start:class_secondary", "sorcerer", playerId), runtime);
    await handleGatewayInteraction(
      createSelectInteraction("start:class_option_secondary", "draconic_bloodline", playerId),
      runtime
    );
    await handleGatewayInteraction(createButtonInteraction("start:point_buy", playerId), runtime);

    const plan = [
      ["strength", 7],
      ["dexterity", 6],
      ["constitution", 5],
      ["intelligence", 4],
      ["wisdom", 2]
    ];

    for (let i = 0; i < plan.length; i += 1) {
      const [ability, clicks] = plan[i];
      await handleGatewayInteraction(createSelectInteraction("start:point_buy_ability", ability, playerId), runtime);
      for (let j = 0; j < clicks; j += 1) {
        await handleGatewayInteraction(createButtonInteraction("start:point_buy_increase", playerId), runtime);
      }
    }

    await handleGatewayInteraction(createButtonInteraction("start:point_buy_confirm", playerId), runtime);

    const create = createButtonInteraction("start:create", playerId);
    const out = await handleGatewayInteraction(create, runtime);

    assert.equal(out.ok, true);
    assert.equal(Boolean(receivedEvent), true);
    assert.equal(receivedEvent.event_type, "player_start_requested");
    assert.deepEqual(receivedEvent.payload.stats, {
      strength: 15,
      dexterity: 14,
      constitution: 13,
      intelligence: 12,
      wisdom: 10,
      charisma: 8
    });
    assert.equal(receivedEvent.payload.class_id, "cleric");
    assert.equal(receivedEvent.payload.class_option_id, "life_domain");
    assert.equal(receivedEvent.payload.secondary_class_id, "sorcerer");
    assert.equal(receivedEvent.payload.secondary_class_option_id, "draconic_bloodline");
    assert.equal(create._updateCalls.length, 1);
    assert.equal(create._updateCalls[0].embeds[0].data.title, "Character created");
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
  runGatewayRuntimeIntegrationTests()
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
  runGatewayRuntimeIntegrationTests
};
