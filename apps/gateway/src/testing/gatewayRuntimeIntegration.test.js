"use strict";

const assert = require("assert");
const path = require("path");
const { handleGatewayInteraction, __test } = require("../index");
const { buildDungeonMapState } = require("../dungeonMapView");

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
    message: { id: "message-gateway-runtime-001" },
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
                      background: "soldier",
                      secondary_class_id: "wizard",
                      class_option_id: "champion",
                      secondary_class_option_id: "evocation",
                      level: 5,
                      xp: 650,
                      armor_class: 17,
                      speed: 35,
                      initiative: 2,
                      proficiency_bonus: 3,
                      spellcasting_ability: "wisdom",
                      spellsave_dc: 13,
                      saving_throws: {
                        strength: 5,
                        dexterity: 1,
                        constitution: 4,
                        intelligence: 0,
                        wisdom: 2,
                        charisma: 1
                      },
                      hp_summary: {
                        current: 38,
                        max: 42,
                        temporary: 5
                      },
                      spellbook: {
                        known_spell_ids: ["fire_bolt", "light"]
                      },
                      feats: [
                        { feat_id: "alert", name: "Alert", description: "Init edge." }
                      ],
                      attunement: {
                        attunement_slots: 3,
                        slots_used: 1,
                        attuned_items: ["item_ring_of_protection"]
                      },
                      item_effects: {
                        armor_class_bonus: 1,
                        saving_throw_bonus: 1,
                        active_item_names: ["Ring of Protection"]
                      },
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
    assert.equal(Array.isArray(interaction._replyCalls[0].embeds), true);
    assert.equal(interaction._replyCalls[0].embeds.length, 1);
    assert.equal(interaction._replyCalls[0].embeds[0].data.title, "Profile Hero | Hunter Record");
    assert.equal(interaction._replyCalls[0].embeds[0].data.description.includes("Lv.5"), true);
    assert.equal(Array.isArray(interaction._replyCalls[0].components), true);
    assert.equal(interaction._replyCalls[0].components.length, 1);
    assert.equal(interaction._replyCalls[0].embeds[0].data.fields.some((field) => field.name === "Path"), true);
    assert.equal(interaction._replyCalls[0].embeds[0].data.fields.some((field) => String(field.value).includes("Attunement: 1/3")), true);
    assert.equal(interaction._replyCalls[0].embeds[0].data.fields.some((field) => field.name === "Combat Core" && String(field.value).includes("HP: 38/42 (+5 temp)")), true);
    assert.equal(interaction._replyCalls[0].embeds[0].data.fields.some((field) => field.name === "Saving Throws" && String(field.value).includes("STR +5")), true);
    assert.equal(interaction._replyCalls[0].embeds[0].data.fields.some((field) => field.name === "Origin" && String(field.value).includes("soldier")), true);
    assert.equal(interaction._replyCalls[0].embeds[0].data.fields.some((field) => field.name === "Relic Resonance" && String(field.value).includes("Ring of Protection")), true);
  }, results);

  await runTest("gateway_routes_feat_command_to_runtime_path", async () => {
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
                  response_type: "feat",
                  ok: true,
                  data: {
                    action: "take",
                    feat: {
                      feat_id: "alert",
                      name: "Alert",
                      description: "Init edge."
                    },
                    feat_slots: {
                      total_slots: 1,
                      used_slots: 1
                    },
                    applied_effects: [
                      { type: "initiative_bonus" }
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

    const interaction = createInteraction("feat", [{ name: "action", value: "take" }, { name: "feat_id", value: "alert" }], "player-gateway-feat-001");
    const out = await handleGatewayInteraction(interaction, runtime);

    assert.equal(out.ok, true);
    assert.equal(Boolean(receivedEvent), true);
    assert.equal(receivedEvent.event_type, "player_feat_requested");
    assert.equal(interaction._replyCalls.length, 1);
    assert.equal(String(interaction._replyCalls[0].content).includes("Feat claimed: Alert"), true);
  }, results);

  await runTest("gateway_profile_button_opens_inventory_viewer", async () => {
    let inventoryRequests = 0;
    const runtime = {
      processGatewayReadCommandEvent(event) {
        if (event.event_type === "player_profile_requested") {
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
                        level: 5,
                        xp: 650,
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

        inventoryRequests += 1;
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
                      inventory_id: "inv-profile-open-001",
                      currency: { gold: 25 },
                      stackable_count: 1,
                      equipment_count: 1,
                      quest_count: 0,
                      magical_count: 1,
                      unidentified_count: 0,
                      attuned_count: 1,
                      attunement_slots: 3,
                      equipment_preview: [
                        { item_id: "item_ring_of_protection", item_name: "Ring of Protection" }
                      ],
                      stackable_preview: [
                        { item_id: "potion", item_name: "Potion", quantity: 2 }
                      ],
                      magical_preview: [
                        {
                          item_id: "item_ring_of_protection",
                          item_name: "Ring of Protection",
                          effect_summary: ["AC +1"]
                        }
                      ],
                      unidentified_preview: [],
                      attuned_items: ["item_ring_of_protection"]
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

    const interaction = createInteraction("profile", [], "player-gateway-profile-open-001");
    const out = await handleGatewayInteraction(interaction, runtime);
    assert.equal(out.ok, true);

    const button = createButtonInteraction("profile:view:inventory", "player-gateway-profile-open-001");
    const buttonOut = await handleGatewayInteraction(button, runtime);
    assert.equal(buttonOut.ok, true);
    assert.equal(inventoryRequests, 1);
    assert.equal(button._updateCalls.length, 1);
    assert.equal(button._updateCalls[0].embeds[0].data.title, "Dimensional Pack");
    assert.equal(button._updateCalls[0].components.length, 2);
  }, results);

  await runTest("gateway_inventory_back_button_returns_to_profile_view", async () => {
    const runtime = {
      processGatewayReadCommandEvent(event) {
        if (event.event_type === "player_profile_requested") {
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
                        level: 5,
                        xp: 650,
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
                      inventory_id: "inv-profile-back-001",
                      currency: { gold: 25 },
                      stackable_count: 1,
                      equipment_count: 1,
                      quest_count: 0,
                      magical_count: 1,
                      unidentified_count: 0,
                      attuned_count: 1,
                      attunement_slots: 3,
                      equipment_preview: [
                        { item_id: "item_ring_of_protection", item_name: "Ring of Protection" }
                      ],
                      stackable_preview: [
                        { item_id: "potion", item_name: "Potion", quantity: 2 }
                      ],
                      magical_preview: [
                        {
                          item_id: "item_ring_of_protection",
                          item_name: "Ring of Protection",
                          effect_summary: ["AC +1"]
                        }
                      ],
                      unidentified_preview: [],
                      attuned_items: ["item_ring_of_protection"]
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

    const profileInteraction = createInteraction("profile", [], "player-gateway-profile-back-001");
    await handleGatewayInteraction(profileInteraction, runtime);

    const openInventory = createButtonInteraction("profile:view:inventory", "player-gateway-profile-back-001");
    await handleGatewayInteraction(openInventory, runtime);

    const backButton = createButtonInteraction("inventory:view:profile", "player-gateway-profile-back-001");
    const backOut = await handleGatewayInteraction(backButton, runtime);
    assert.equal(backOut.ok, true);
    assert.equal(backButton._updateCalls.length, 1);
    assert.equal(backButton._updateCalls[0].embeds[0].data.title, "Profile Hero | Hunter Record");
    assert.equal(backButton._updateCalls[0].components.length, 1);
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
                      quest_count: 1,
                      magical_count: 1,
                      unidentified_count: 0,
                      attuned_count: 1,
                      attunement_slots: 3,
                      equipment_preview: [
                        { item_id: "item_ring_of_protection", item_name: "Ring of Protection" }
                      ],
                      stackable_preview: [
                        { item_id: "potion", item_name: "Potion", quantity: 2 }
                      ]
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
    assert.equal(Array.isArray(interaction._replyCalls[0].embeds), true);
    assert.equal(interaction._replyCalls[0].embeds.length, 1);
    assert.equal(Array.isArray(interaction._replyCalls[0].components), true);
    assert.equal(interaction._replyCalls[0].components.length, 2);
    assert.equal(interaction._replyCalls[0].embeds[0].data.title, "Dimensional Pack");
    assert.equal(interaction._replyCalls[0].embeds[0].data.fields.some((field) => String(field.value).includes("Gold: 42")), true);
    assert.equal(interaction._replyCalls[0].embeds[0].data.fields.some((field) => String(field.value).includes("Attuned: 1/3")), true);
    assert.equal(interaction._replyCalls[0].embeds[0].data.fields.some((field) => String(field.value).includes("Ring of Protection")), true);
  }, results);

  await runTest("gateway_inventory_buttons_switch_between_summary_and_magical_tabs", async () => {
    let runtimeCalls = 0;
    const runtime = {
      processGatewayReadCommandEvent(event) {
        runtimeCalls += 1;
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
                      inventory_id: "inv-gateway-tabs-001",
                      currency: { gold: 12 },
                      stackable_count: 1,
                      equipment_count: 2,
                      quest_count: 0,
                      magical_count: 1,
                      unidentified_count: 1,
                      attuned_count: 1,
                      attunement_slots: 3,
                      equipment_preview: [
                        { item_id: "item_sword", item_name: "Iron Sword" }
                      ],
                      stackable_preview: [
                        { item_id: "potion", item_name: "Potion", quantity: 2 }
                      ],
                      magical_preview: [
                        { item_id: "item_ring_of_protection", item_name: "Ring of Protection" }
                      ],
                      unidentified_preview: [
                        { item_id: "item_mysterious_ring", item_name: "Mysterious Ring" }
                      ],
                      attuned_items: ["item_ring_of_protection"]
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

    const interaction = createInteraction("inventory", [], "player-gateway-inventory-tabs-001");
    const out = await handleGatewayInteraction(interaction, runtime);
    assert.equal(out.ok, true);
    assert.equal(runtimeCalls, 1);

    const magicalButton = createButtonInteraction("inventory:view:magical", "player-gateway-inventory-tabs-001");
    const magicalOut = await handleGatewayInteraction(magicalButton, runtime);
    assert.equal(magicalOut.ok, true);
    assert.equal(runtimeCalls, 1);
    assert.equal(magicalButton._updateCalls.length, 1);
    assert.equal(magicalButton._updateCalls[0].embeds[0].data.title, "Dimensional Pack | Arcane Ledger");
    assert.equal(magicalButton._updateCalls[0].components.length >= 2, true);
    assert.equal(magicalButton._updateCalls[0].embeds[0].data.fields.some((field) => String(field.value).includes("Ring of Protection")), true);
    assert.equal(magicalButton._updateCalls[0].embeds[0].data.fields.some((field) => String(field.value).includes("Mysterious Ring")), true);
  }, results);

  await runTest("gateway_inventory_magical_actions_use_button_driven_identify_attune_and_use_flow", async () => {
    const receivedEvents = [];
    const runtime = {
      processGatewayReadCommandEvent(event) {
        receivedEvents.push(event);
        if (event.event_type === "player_use_item") {
          return {
            ok: true,
            event_type: "read_command_runtime_completed",
            payload: {
              responses: [
                {
                  event_type: "gateway_response_ready",
                  payload: {
                    response_type: "use",
                    ok: true,
                    data: {
                      use_status: "consumed",
                      item_id: "item_potion_of_heroism",
                      inventory_id: "inv-gateway-magical-actions-001",
                      hp_before: 7,
                      hp_after: 7,
                      temporary_hp_before: 0,
                      temporary_hp_after: 10,
                      temporary_hitpoints_granted: 10
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
        if (event.event_type === "player_identify_item_requested") {
          return {
            ok: true,
            event_type: "read_command_runtime_completed",
            payload: {
              responses: [
                {
                  event_type: "gateway_response_ready",
                  payload: {
                    response_type: "identify",
                    ok: true,
                    data: {
                      item: {
                        item_id: "item_ring_of_protection",
                        item_name: "Ring of Protection",
                        item_type: "equipment",
                        magical: true,
                        requires_attunement: true
                      },
                      character: {
                        attunement: { slots_used: 0, attunement_slots: 3 }
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
        if (event.event_type === "player_attune_item_requested") {
          return {
            ok: true,
            event_type: "read_command_runtime_completed",
            payload: {
              responses: [
                {
                  event_type: "gateway_response_ready",
                  payload: {
                    response_type: "attune",
                    ok: true,
                    data: {
                      item: {
                        item_id: "item_ring_of_protection",
                        item_name: "Ring of Protection",
                        item_type: "equipment",
                        magical: true,
                        requires_attunement: true,
                        is_attuned: true
                      },
                      character: {
                        attunement: { slots_used: 1, attunement_slots: 3 }
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
                      inventory_id: "inv-gateway-magical-actions-001",
                      currency: { gold: 12 },
                      stackable_count: 0,
                      equipment_count: 1,
                      quest_count: 0,
                      magical_count: 1,
                      unidentified_count: event.event_type === "player_inventory_requested" && receivedEvents.filter((x) => x.event_type === "player_identify_item_requested").length === 0 ? 1 : 0,
                      attuned_count: receivedEvents.filter((x) => x.event_type === "player_attune_item_requested").length > 0 ? 1 : 0,
                      attunement_slots: 3,
                      equipment_preview: [
                        { item_id: "item_ring_of_protection", item_name: "Ring of Protection" }
                      ],
                      stackable_preview: [],
                      magical_preview: [
                        {
                          item_id: "item_potion_of_heroism",
                          item_name: "Potion of Heroism",
                          item_type: "consumable",
                          usable: true,
                          unidentified: false
                        },
                        {
                          item_id: "item_ring_of_protection",
                          item_name: "Ring of Protection",
                          requires_attunement: true,
                          attuned: receivedEvents.filter((x) => x.event_type === "player_attune_item_requested").length > 0
                        }
                      ],
                      unidentified_preview: receivedEvents.filter((x) => x.event_type === "player_identify_item_requested").length === 0
                        ? [{ item_id: "item_mysterious_ring", item_name: "Mysterious Ring", unidentified: true }]
                        : [],
                      attuned_items: receivedEvents.filter((x) => x.event_type === "player_attune_item_requested").length > 0
                        ? ["item_ring_of_protection"]
                        : []
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

    const interaction = createInteraction("inventory", [], "player-gateway-magical-actions-001");
    await handleGatewayInteraction(interaction, runtime);

    const magicalButton = createButtonInteraction("inventory:view:magical", "player-gateway-magical-actions-001");
    await handleGatewayInteraction(magicalButton, runtime);
    assert.equal(
      magicalButton._updateCalls[0].components.some((row) =>
        Array.isArray(row.components) && row.components.some((button) => String(button.data.custom_id).startsWith("inventory:view:use:"))
      ),
      true
    );
    assert.equal(
      magicalButton._updateCalls[0].components.some((row) =>
        Array.isArray(row.components) && row.components.some((button) => String(button.data.custom_id).startsWith("inventory:view:identify:"))
      ),
      true
    );

    const identifyButton = createButtonInteraction("inventory:view:identify:item_mysterious_ring", "player-gateway-magical-actions-001");
    const identifyOut = await handleGatewayInteraction(identifyButton, runtime);
    assert.equal(identifyOut.ok, true);
    assert.equal(String(identifyButton._updateCalls[0].content).includes("Ring of Protection"), true);
    assert.equal(
      identifyButton._updateCalls[0].components.some((row) =>
        Array.isArray(row.components) && row.components.some((button) => String(button.data.custom_id).startsWith("inventory:view:attune:"))
      ),
      true
    );

    const attuneButton = createButtonInteraction("inventory:view:attune:item_ring_of_protection", "player-gateway-magical-actions-001");
    const attuneOut = await handleGatewayInteraction(attuneButton, runtime);
    assert.equal(attuneOut.ok, true);
    assert.equal(String(attuneButton._updateCalls[0].content).includes("Attuned: true"), true);
    assert.equal(
      attuneButton._updateCalls[0].components.some((row) =>
        Array.isArray(row.components) && row.components.some((button) => String(button.data.custom_id).startsWith("inventory:view:unattune:"))
      ),
      true
    );

    const useButton = createButtonInteraction("inventory:view:use:item_potion_of_heroism", "player-gateway-magical-actions-001");
    const useOut = await handleGatewayInteraction(useButton, runtime);
    assert.equal(useOut.ok, true);
    assert.equal(String(useButton._updateCalls[0].content).includes("Temp HP: 0 -> 10"), true);
  }, results);

  await runTest("gateway_inventory_equipment_actions_use_button_driven_equip_and_unequip_flow", async () => {
    const receivedEvents = [];
    const runtime = {
      processGatewayReadCommandEvent(event) {
        receivedEvents.push(event);
        const hasEquipped = receivedEvents.some((entry) => entry.event_type === "player_equip_requested");
        const hasUnequipped = receivedEvents.some((entry) => entry.event_type === "player_unequip_requested");

        if (event.event_type === "player_equip_requested") {
          return {
            ok: true,
            event_type: "read_command_runtime_completed",
            payload: {
              responses: [
                {
                  event_type: "gateway_response_ready",
                  payload: {
                    response_type: "equip",
                    ok: true,
                    data: {
                      equipped: {
                        item_id: "item_spear_001",
                        slot: "main_hand"
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

        if (event.event_type === "player_unequip_requested") {
          return {
            ok: true,
            event_type: "read_command_runtime_completed",
            payload: {
              responses: [
                {
                  event_type: "gateway_response_ready",
                  payload: {
                    response_type: "unequip",
                    ok: true,
                    data: {
                      unequipped: {
                        item_id: "item_spear_001",
                        slot: "main_hand"
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
                      inventory_id: "inv-gateway-equipment-actions-001",
                      currency: { gold: 8 },
                      stackable_count: 0,
                      equipment_count: 1,
                      quest_count: 0,
                      magical_count: 0,
                      unidentified_count: 0,
                      attuned_count: 0,
                      attunement_slots: 3,
                      stackable_preview: [],
                      equipment_preview: [
                        {
                          item_id: "item_spear_001",
                          item_name: "Iron Spear",
                          item_type: "equipment",
                          equip_slot: "main_hand",
                          equipped: hasEquipped && !hasUnequipped,
                          equipped_slot: hasEquipped && !hasUnequipped ? "main_hand" : null
                        }
                      ],
                      quest_preview: [],
                      magical_preview: [],
                      unidentified_preview: [],
                      attuned_items: []
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

    const interaction = createInteraction("inventory", [], "player-gateway-equipment-actions-001");
    await handleGatewayInteraction(interaction, runtime);

    const equipmentButton = createButtonInteraction("inventory:view:equipment", "player-gateway-equipment-actions-001");
    const equipmentOut = await handleGatewayInteraction(equipmentButton, runtime);
    assert.equal(equipmentOut.ok, true);
    assert.equal(
      equipmentButton._updateCalls[0].components.some((row) =>
        Array.isArray(row.components) && row.components.some((button) => String(button.data.custom_id).startsWith("inventory:view:equip:main_hand:item_spear_001"))
      ),
      true
    );

    const equipButton = createButtonInteraction("inventory:view:equip:main_hand:item_spear_001", "player-gateway-equipment-actions-001");
    const equipOut = await handleGatewayInteraction(equipButton, runtime);
    assert.equal(equipOut.ok, true);
    assert.equal(String(equipButton._updateCalls[0].content).includes("equip completed"), true);
    assert.equal(
      equipButton._updateCalls[0].components.some((row) =>
        Array.isArray(row.components) && row.components.some((button) => String(button.data.custom_id).startsWith("inventory:view:unequip:main_hand:item_spear_001"))
      ),
      true
    );

    const unequipButton = createButtonInteraction("inventory:view:unequip:main_hand:item_spear_001", "player-gateway-equipment-actions-001");
    const unequipOut = await handleGatewayInteraction(unequipButton, runtime);
    assert.equal(unequipOut.ok, true);
    assert.equal(String(unequipButton._updateCalls[0].content).includes("unequip completed"), true);
    assert.equal(
      unequipButton._updateCalls[0].components.some((row) =>
        Array.isArray(row.components) && row.components.some((button) => String(button.data.custom_id).startsWith("inventory:view:equip:main_hand:item_spear_001"))
      ),
      true
    );
  }, results);

  await runTest("gateway_routes_shop_command_and_buy_button_through_runtime_path", async () => {
    let runtimeCalls = 0;
    const runtime = {
      processGatewayReadCommandEvent(event) {
        runtimeCalls += 1;
        if (event.payload && event.payload.action === "buy") {
          return {
            ok: true,
            event_type: "read_command_runtime_completed",
            payload: {
              responses: [
                {
                  event_type: "gateway_response_ready",
                    payload: {
                      response_type: "shop",
                      ok: true,
                      data: {
                        vendor_id: "vendor_starter_quartermaster",
                        vendor_name: "Quartermaster Rhel",
                        vendor_description: "A practical supplier for delvers heading below.",
                        gold: 50,
                        item_id: "item_healing_potion",
                        quantity: 1,
                        result: { gold_spent: 50 },
                        stock: [
                          { item_id: "item_healing_potion", item_name: "Potion of Healing", price_gold: 50, item_available: true, infinite_stock: true, quantity_available: null }
                        ],
                        vendors: [
                          { vendor_id: "vendor_starter_quartermaster", vendor_name: "Quartermaster Rhel" },
                          { vendor_id: "vendor_starter_armorer", vendor_name: "Armorer Vexa" }
                        ],
                        sellable_items: [
                          { item_id: "item_bandage_roll", item_name: "Bandage Roll", quantity: 2, sell_price_gold: 4 }
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

        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                  payload: {
                    response_type: "shop",
                    ok: true,
                    data: {
                      vendor_id: "vendor_starter_quartermaster",
                      vendor_name: "Quartermaster Rhel",
                      vendor_description: "A practical supplier for delvers heading below.",
                      gold: 100,
                      stock: [
                        { item_id: "item_healing_potion", item_name: "Potion of Healing", price_gold: 50, item_available: true, infinite_stock: true, quantity_available: null }
                      ],
                      vendors: [
                        { vendor_id: "vendor_starter_quartermaster", vendor_name: "Quartermaster Rhel" },
                        { vendor_id: "vendor_starter_armorer", vendor_name: "Armorer Vexa" }
                      ],
                      sellable_items: [
                        { item_id: "item_bandage_roll", item_name: "Bandage Roll", quantity: 2, sell_price_gold: 4 }
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

    const interaction = createInteraction("shop", [{ name: "action", value: "browse" }], "player-gateway-shop-001");
    const out = await handleGatewayInteraction(interaction, runtime);
    assert.equal(out.ok, true);
    assert.equal(interaction._replyCalls[0].embeds[0].data.title, "Quartermaster Rhel");

    const buyButton = createButtonInteraction("shop:view:buy:vendor_starter_quartermaster:item_healing_potion", "player-gateway-shop-001");
    const buyOut = await handleGatewayInteraction(buyButton, runtime);
    assert.equal(buyOut.ok, true);
    assert.equal(runtimeCalls, 2);
    assert.equal(buyButton._updateCalls.length, 1);
    assert.equal(String(buyButton._updateCalls[0].content).includes("Gold: 50"), true);
  }, results);

  await runTest("gateway_shop_buttons_support_vendor_switch_and_sell", async () => {
    let runtimeCalls = 0;
    const runtime = {
      processGatewayReadCommandEvent(event) {
        runtimeCalls += 1;
        if (event.payload && event.payload.action === "sell") {
          return {
            ok: true,
            event_type: "read_command_runtime_completed",
            payload: {
              responses: [
                {
                  event_type: "gateway_response_ready",
                  payload: {
                    response_type: "shop",
                    ok: true,
                    data: {
                      vendor_id: "vendor_starter_quartermaster",
                      vendor_name: "Quartermaster Rhel",
                      vendor_description: "A practical supplier for delvers heading below.",
                      gold: 14,
                      result: { gold_earned: 4 },
                      stock: [],
                      vendors: [
                        { vendor_id: "vendor_starter_quartermaster", vendor_name: "Quartermaster Rhel" },
                        { vendor_id: "vendor_starter_armorer", vendor_name: "Armorer Vexa" }
                      ],
                      sellable_items: [
                        { item_id: "item_bandage_roll", item_name: "Bandage Roll", quantity: 1, sell_price_gold: 4 }
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
        if (event.payload && event.payload.action === "browse" && event.payload.vendor_id === "vendor_starter_armorer") {
          return {
            ok: true,
            event_type: "read_command_runtime_completed",
            payload: {
              responses: [
                {
                  event_type: "gateway_response_ready",
                  payload: {
                    response_type: "shop",
                    ok: true,
                    data: {
                      vendor_id: "vendor_starter_armorer",
                      vendor_name: "Armorer Vexa",
                      vendor_description: "A hard-eyed outfitter handling field arms and cheap armor.",
                      gold: 10,
                      stock: [
                        { item_id: "item_shield", item_name: "Shield", price_gold: 10, item_available: true, infinite_stock: true, quantity_available: null }
                      ],
                      vendors: [
                        { vendor_id: "vendor_starter_quartermaster", vendor_name: "Quartermaster Rhel" },
                        { vendor_id: "vendor_starter_armorer", vendor_name: "Armorer Vexa" }
                      ],
                      sellable_items: []
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

        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "shop",
                  ok: true,
                  data: {
                    vendor_id: "vendor_starter_quartermaster",
                    vendor_name: "Quartermaster Rhel",
                    vendor_description: "A practical supplier for delvers heading below.",
                    gold: 10,
                    stock: [],
                    vendors: [
                      { vendor_id: "vendor_starter_quartermaster", vendor_name: "Quartermaster Rhel" },
                      { vendor_id: "vendor_starter_armorer", vendor_name: "Armorer Vexa" }
                    ],
                    sellable_items: [
                      { item_id: "item_bandage_roll", item_name: "Bandage Roll", quantity: 2, sell_price_gold: 4 }
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

    const interaction = createInteraction("shop", [{ name: "action", value: "browse" }], "player-gateway-shop-sell-001");
    await handleGatewayInteraction(interaction, runtime);

    const switchVendor = createButtonInteraction("shop:view:browse:vendor_starter_armorer", "player-gateway-shop-sell-001");
    const switchOut = await handleGatewayInteraction(switchVendor, runtime);
    assert.equal(switchOut.ok, true);
    assert.equal(switchVendor._updateCalls[0].embeds[0].data.title, "Armorer Vexa");

    const resetInteraction = createInteraction("shop", [{ name: "action", value: "browse" }], "player-gateway-shop-sell-002");
    await handleGatewayInteraction(resetInteraction, runtime);
    const sellButton = createButtonInteraction("shop:view:sell:vendor_starter_quartermaster:item_bandage_roll", "player-gateway-shop-sell-002");
    const sellOut = await handleGatewayInteraction(sellButton, runtime);
    assert.equal(sellOut.ok, true);
    assert.equal(String(sellButton._updateCalls[0].content).includes("Gold Earned: 4"), true);
    assert.equal(runtimeCalls >= 3, true);
  }, results);

  await runTest("gateway_routes_craft_command_and_craft_button_through_runtime_path", async () => {
    let runtimeCalls = 0;
    const runtime = {
      processGatewayReadCommandEvent(event) {
        runtimeCalls += 1;
        if (event.payload && event.payload.action === "make") {
          return {
            ok: true,
            event_type: "read_command_runtime_completed",
            payload: {
              responses: [
                {
                  event_type: "gateway_response_ready",
                    payload: {
                      response_type: "craft",
                      ok: true,
                      data: {
                      recipe: {
                        recipe_id: "recipe_torch_pack",
                        recipe_name: "Torch Pack",
                        output_item_id: "item_torch_bundle",
                        output_quantity: 1
                      },
                      result: {
                        consumed_materials: [{ item_id: "item_rat_tail", quantity: 1 }]
                      },
                        recipes: [
                          {
                            recipe_id: "recipe_torch_pack",
                            recipe_name: "Torch Pack",
                            recipe_type: "survival",
                            craftable: true,
                            required_materials: [{ item_id: "item_rat_tail", quantity: 1 }]
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

        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                  payload: {
                    response_type: "craft",
                    ok: true,
                    data: {
                      recipes: [
                        {
                          recipe_id: "recipe_torch_pack",
                          recipe_name: "Torch Pack",
                          recipe_type: "survival",
                          craftable: true,
                          required_materials: [{ item_id: "item_rat_tail", quantity: 1 }]
                        },
                        {
                          recipe_id: "recipe_hardened_club",
                          recipe_name: "Hardened Club",
                          recipe_type: "survival",
                          craftable: false,
                          required_materials: [{ item_id: "item_rat_tail", quantity: 2 }]
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

    const interaction = createInteraction("craft", [{ name: "action", value: "browse" }], "player-gateway-craft-001");
    const out = await handleGatewayInteraction(interaction, runtime);
    assert.equal(out.ok, true);
    assert.equal(interaction._replyCalls[0].embeds[0].data.title, "Fieldcraft Ledger");

    const craftButton = createButtonInteraction("craft:view:make:recipe_torch_pack", "player-gateway-craft-001");
    const craftOut = await handleGatewayInteraction(craftButton, runtime);
    assert.equal(craftOut.ok, true);
    assert.equal(runtimeCalls, 2);
    assert.equal(craftButton._updateCalls.length, 1);
    assert.equal(String(craftButton._updateCalls[0].content).includes("Recipe: Torch Pack"), true);
  }, results);

  await runTest("gateway_craft_buttons_support_filter_switching", async () => {
    const runtime = {
      processGatewayReadCommandEvent() {
        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "craft",
                  ok: true,
                  data: {
                    recipes: [
                      {
                        recipe_id: "recipe_torch_pack",
                        recipe_name: "Torch Pack",
                        recipe_type: "survival",
                        craftable: true,
                        required_materials: [{ item_id: "item_rat_tail", quantity: 1 }]
                      },
                      {
                        recipe_id: "recipe_hardened_club",
                        recipe_name: "Hardened Club",
                        recipe_type: "survival",
                        craftable: false,
                        required_materials: [{ item_id: "item_rat_tail", quantity: 2 }]
                      }
                    ]
                  },
                  error: null
                }
              }
            ],
            events_processed: [],
            final_state: {}
          },
          error: null
        };
      }
    };

    const interaction = createInteraction("craft", [{ name: "action", value: "browse" }], "player-gateway-craft-filter-001");
    await handleGatewayInteraction(interaction, runtime);

    const filterButton = createButtonInteraction("craft:view:filter:ready", "player-gateway-craft-filter-001");
    const filterOut = await handleGatewayInteraction(filterButton, runtime);
    assert.equal(filterOut.ok, true);
    assert.equal(filterButton._updateCalls.length, 1);
    assert.equal(filterButton._updateCalls[0].embeds[0].data.description.includes("Filter: ready"), true);
  }, results);

  await runTest("gateway_economy_views_support_cross_navigation_buttons", async () => {
    const runtime = {
      processGatewayReadCommandEvent(event) {
        if (event.event_type === "player_craft_requested") {
          return {
            ok: true,
            event_type: "read_command_runtime_completed",
            payload: {
              responses: [
                {
                  event_type: "gateway_response_ready",
                  payload: {
                    response_type: "craft",
                    ok: true,
                    data: {
                      recipes: [
                        {
                          recipe_id: "recipe_torch_pack",
                          recipe_name: "Torch Pack",
                          recipe_type: "survival",
                          craftable: true,
                          required_materials: [{ item_id: "item_rat_tail", quantity: 1 }]
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

        if (event.event_type === "player_trade_requested") {
          return {
            ok: true,
            event_type: "read_command_runtime_completed",
            payload: {
              responses: [
                {
                  event_type: "gateway_response_ready",
                  payload: {
                    response_type: "trade",
                    ok: true,
                    data: {
                      trades: [],
                      actionable_trades: []
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

        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "shop",
                  ok: true,
                  data: {
                    vendor_id: "vendor_starter_quartermaster",
                    vendor_name: "Quartermaster Rhel",
                    vendor_description: "A practical supplier for delvers heading below.",
                    gold: 10,
                    stock: [
                      { item_id: "item_healing_potion", item_name: "Potion of Healing", price_gold: 50, item_available: true, infinite_stock: true, quantity_available: null }
                    ],
                    vendors: [
                      { vendor_id: "vendor_starter_quartermaster", vendor_name: "Quartermaster Rhel" }
                    ],
                    sellable_items: []
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

    const interaction = createInteraction("shop", [{ name: "action", value: "browse" }], "player-gateway-economy-nav-001");
    await handleGatewayInteraction(interaction, runtime);

    const craftNav = createButtonInteraction("economy:view:craft", "player-gateway-economy-nav-001");
    const craftOut = await handleGatewayInteraction(craftNav, runtime);
    assert.equal(craftOut.ok, true);
    assert.equal(craftNav._updateCalls[0].embeds[0].data.title, "Fieldcraft Ledger");

    const tradeNav = createButtonInteraction("economy:view:trade", "player-gateway-economy-nav-001");
    const tradeOut = await handleGatewayInteraction(tradeNav, runtime);
    assert.equal(tradeOut.ok, true);
    assert.equal(tradeNav._updateCalls[0].embeds[0].data.title, "Broker Ledger");

    const shopNav = createButtonInteraction("economy:view:shop", "player-gateway-economy-nav-001");
    const shopOut = await handleGatewayInteraction(shopNav, runtime);
    assert.equal(shopOut.ok, true);
    assert.equal(shopNav._updateCalls[0].embeds[0].data.title, "Quartermaster Rhel");
  }, results);

  await runTest("gateway_routes_trade_command_and_accept_button_through_runtime_path", async () => {
    let runtimeCalls = 0;
    const runtime = {
      processGatewayReadCommandEvent(event) {
        runtimeCalls += 1;
        if (event.payload && event.payload.action === "accept") {
          return {
            ok: true,
            event_type: "read_command_runtime_completed",
            payload: {
              responses: [
                {
                  event_type: "gateway_response_ready",
                  payload: {
                    response_type: "trade",
                    ok: true,
                    data: {
                      trade: {
                        trade_id: "trade-001",
                        trade_state: "completed",
                        offered: { item_id: "item_bandage_roll", item_name: "Bandage Roll", quantity: 1, currency: 0 },
                        requested: { item_id: null, quantity: null, currency: 5 }
                      },
                      trades: [],
                      actionable_trades: []
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

        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "trade",
                  ok: true,
                  data: {
                    trades: [
                      {
                        trade_id: "trade-001",
                        trade_state: "pending",
                        initiator_player_id: "player-gateway-trade-seller-001",
                        counterparty_player_id: "player-gateway-trade-001",
                        role: "counterparty",
                        offered: { item_id: "item_bandage_roll", item_name: "Bandage Roll", quantity: 1, currency: 0 },
                        requested: { item_id: null, quantity: null, currency: 5 }
                      }
                    ],
                    actionable_trades: [
                      {
                        trade_id: "trade-001",
                        trade_state: "pending",
                        initiator_player_id: "player-gateway-trade-seller-001",
                        counterparty_player_id: "player-gateway-trade-001",
                        role: "counterparty",
                        offered: { item_id: "item_bandage_roll", item_name: "Bandage Roll", quantity: 1, currency: 0 },
                        requested: { item_id: null, quantity: null, currency: 5 }
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

    const interaction = createInteraction("trade", [{ name: "action", value: "list" }], "player-gateway-trade-001");
    const out = await handleGatewayInteraction(interaction, runtime);
    assert.equal(out.ok, true);
    assert.equal(interaction._replyCalls[0].embeds[0].data.title, "Broker Ledger");

    const acceptButton = createButtonInteraction("trade:view:accept:trade-001", "player-gateway-trade-001");
    const acceptOut = await handleGatewayInteraction(acceptButton, runtime);
    assert.equal(acceptOut.ok, true);
    assert.equal(runtimeCalls, 2);
    assert.equal(acceptButton._updateCalls.length, 1);
    assert.equal(String(acceptButton._updateCalls[0].content).includes("State: completed"), true);
  }, results);

  await runTest("gateway_formats_session_move_with_room_snapshot", async () => {
    const receivedEvents = [];
    const runtime = {
      processGatewayReadCommandEvent(event) {
        receivedEvents.push(event);
        if (event.event_type === "player_interact_object") {
          return {
            ok: true,
            event_type: "read_command_runtime_completed",
            payload: {
              responses: [
                {
                  event_type: "gateway_response_ready",
                  payload: {
                    response_type: "interact",
                    ok: true,
                    data: {
                      session_id: "session-room-001",
                      object_id: "obj-door-001",
                      object_name: "Bronze Door",
                      object_type: "door",
                      interaction_action: "open",
                      object_state: { is_opened: true },
                      spell_effect: {
                        spell_id: "knock",
                        object_state: "unlocked"
                      },
                      skill_check: {
                        skill_id: "investigation",
                        passed: true,
                        total: 15,
                        dc: 12
                      },
                      interaction_effects: [
                        {
                          effect_type: "linked_object_opened",
                          object_id: "obj-door-002"
                        }
                      ],
                      reward_status: "none",
                      room: {
                        room_id: "room-hall",
                        name: "Hall of Echoes",
                        room_type: "empty",
                        dungeon_map: {
                          map_path: "apps/map-system/data/maps/dungeon/map-12x12.base-map.json",
                          profile_path: "apps/map-system/data/profiles/dungeon/map-12x12.dungeon-profile.json",
                          party_position: { x: 1, y: 1 },
                          party_path: [
                            { x: 0, y: 1 },
                            { x: 1, y: 1 }
                          ],
                          exits: [
                            { direction: "west", to_room_id: "room-entry", position: { x: 0, y: 1 } },
                            { direction: "east", to_room_id: "room-door", position: { x: 2, y: 1 } }
                          ],
                          objects: [
                            { object_id: "obj-door-001", object_type: "door", position: { x: 2, y: 1 } }
                          ]
                        },
                        exits: [
                          { direction: "west", to_room_id: "room-entry", locked: false, position: { x: 0, y: 1 } },
                          { direction: "east", to_room_id: "room-door", locked: false, position: { x: 2, y: 1 } }
                        ],
                        visible_objects: [
                          {
                            object_id: "obj-door-001",
                            object_type: "door",
                            name: "Bronze Door",
                            position: { x: 2, y: 1 },
                            state: { is_opened: true }
                          }
                        ]
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
        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "move",
                  ok: true,
                  data: {
                    session_id: "session-room-001",
                    from_room_id: "room-entry",
                    to_room_id: "room-hall",
                    trap_trigger: null,
                      room: {
                        room_id: "room-hall",
                        name: "Hall of Echoes",
                        room_type: "empty",
                        description: "A stone hall lined with carved faces.",
                        encounter: {
                          encounter_id: "enc-goblin-hall-001",
                          name: "Goblin Scout",
                          visible_enemy_tokens: [
                            {
                              token_id: "dungeon-goblin-001",
                              actor_id: "dungeon-goblin-001",
                              label: "Goblin Scout",
                              badge_text: "G1",
                              position: { x: 6, y: 6 }
                            }
                          ]
                        },
                        dungeon_map: {
                          map_path: "apps/map-system/data/maps/dungeon/map-12x12.base-map.json",
                          profile_path: "apps/map-system/data/profiles/dungeon/map-12x12.dungeon-profile.json",
                          party_position: { x: 1, y: 1 },
                          party_path: [
                            { x: 0, y: 1 },
                            { x: 1, y: 1 }
                          ],
                          encounter_triggers: [
                            { position: { x: 6, y: 6 }, label: "enc" }
                          ],
                          visible_enemy_tokens: [
                            {
                              token_id: "dungeon-goblin-001",
                              actor_id: "dungeon-goblin-001",
                              label: "Goblin Scout",
                              badge_text: "G1",
                              position: { x: 6, y: 6 }
                            }
                          ],
                          exits: [
                            { direction: "west", to_room_id: "room-entry", position: { x: 0, y: 1 } },
                            { direction: "east", to_room_id: "room-door", position: { x: 2, y: 1 } }
                        ],
                        objects: [
                          { object_id: "obj-door-001", object_type: "door", position: { x: 2, y: 1 } },
                          { object_id: "obj-lore-001", object_type: "lore_object", position: { x: 4, y: 2 } }
                        ]
                      },
                      exits: [
                        { direction: "west", to_room_id: "room-entry", locked: false, position: { x: 0, y: 1 } },
                        { direction: "east", to_room_id: "room-door", locked: false, position: { x: 2, y: 1 } }
                      ],
                      visible_objects: [
                        {
                          object_id: "obj-door-001",
                          object_type: "door",
                          name: "Bronze Door",
                          position: { x: 2, y: 1 },
                          state: { is_locked: true }
                        },
                        {
                          object_id: "obj-lore-001",
                          object_type: "lore_object",
                          name: "Weathered Tablet",
                          position: { x: 4, y: 2 },
                          state: {}
                        }
                      ]
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

    const interaction = createInteraction("move", [{ name: "direction", value: "east" }], "player-gateway-room-001");
    const out = await handleGatewayInteraction(interaction, runtime);

    assert.equal(out.ok, true);
    assert.equal(interaction._replyCalls.length, 1);
    const content = interaction._replyCalls[0].content;
    assert.equal(content.includes("Room: Hall of Echoes"), true);
    assert.equal(content.includes("Visible enemies: 1"), true);
    assert.equal(content.includes("Exits: west -> room-entry | east -> room-door"), true);
    assert.equal(content.includes("Bronze Door [door; locked]"), true);
    assert.equal(content.includes("Weathered Tablet [lore_object]"), true);
    assert.equal(Array.isArray(interaction._replyCalls[0].files), true);
    assert.equal(interaction._replyCalls[0].files.length >= 1, true);
    assert.equal(Array.isArray(interaction._replyCalls[0].components), true);
    assert.equal(interaction._replyCalls[0].components.length >= 3, true);
    assert.equal(interaction._replyCalls[0].components[1].components[0].data.label, "Unlock Bronze Door");
    assert.equal(
      interaction._replyCalls[0].components.some((row) =>
        Array.isArray(row.components) && row.components.some((button) => button.data.label === "Preview Move")
      ),
      true
    );
    assert.equal(
      interaction._replyCalls[0].components.some((row) =>
        Array.isArray(row.components) && row.components.some((button) => button.data.label === "Open Bronze Door")
      ),
      true
    );

    const mapPreviewButton = createButtonInteraction("dungeon-map:view:preview_move:session-room-001", "player-gateway-room-001");
    const previewOut = await handleGatewayInteraction(mapPreviewButton, runtime);
    assert.equal(previewOut.ok, true);
    assert.equal(mapPreviewButton._updateCalls.length, 1);
    assert.equal(String(mapPreviewButton._updateCalls[0].content).includes("Choose a highlighted exit"), true);
    assert.equal(String(mapPreviewButton._updateCalls[0].content).includes("Mode: Move Preview"), true);
    assert.equal(String(mapPreviewButton._updateCalls[0].content).includes("Visible enemies: 1"), true);
    assert.equal(Array.isArray(mapPreviewButton._updateCalls[0].files), true);
    assert.equal(mapPreviewButton._updateCalls[0].files.length >= 1, true);
    assert.equal(
      mapPreviewButton._updateCalls[0].components.some((row) =>
        Array.isArray(row.components) && row.components.some((button) => button.data.label.includes("west") || button.data.label.includes("east"))
      ),
      true
    );

    const backButton = createButtonInteraction("dungeon-map:view:back:session-room-001", "player-gateway-room-001");
    const backOut = await handleGatewayInteraction(backButton, runtime);
    assert.equal(backOut.ok, true);
    assert.equal(backButton._updateCalls.length, 1);
    assert.equal(String(backButton._updateCalls[0].content).includes("Dungeon map ready."), true);
    assert.equal(String(backButton._updateCalls[0].content).includes("Mode: Exploration"), true);

    const mapMoveButton = createButtonInteraction("dungeon-map:view:move:session-room-001:east", "player-gateway-room-001");
    const mapMoveOut = await handleGatewayInteraction(mapMoveButton, runtime);
    assert.equal(mapMoveOut.ok, true);
    assert.equal(receivedEvents.some((event) => event.event_type === "player_move" && event.payload && event.payload.direction === "east"), true);
    const dispatchedMoveEvent = receivedEvents.find((event) =>
      event.event_type === "player_move"
      && event.payload
      && event.payload.direction === "east"
      && event.source === "gateway.discord.map"
    );
    assert.equal(Boolean(dispatchedMoveEvent), true);
    assert.equal(dispatchedMoveEvent.target_system, "session_system");
    assert.equal(dispatchedMoveEvent.source, "gateway.discord.map");
    assert.equal(dispatchedMoveEvent.session_id, "session-room-001");
    assert.equal(Boolean(dispatchedMoveEvent.payload.map_action_id), true);
    assert.equal(mapMoveButton._updateCalls.length, 1);
    assert.equal(String(mapMoveButton._updateCalls[0].content).includes("Room: Hall of Echoes"), true);
    assert.equal(Array.isArray(mapMoveButton._updateCalls[0].files), true);
    assert.equal(mapMoveButton._updateCalls[0].files.length >= 1, true);

    const objectButton = createButtonInteraction("dungeon:view:object:session-room-001:obj-door-001:open", "player-gateway-room-001");
    const buttonOut = await handleGatewayInteraction(objectButton, runtime);
    assert.equal(buttonOut.ok, true);
    assert.equal(receivedEvents.some((event) => event.event_type === "player_interact_object"), true);
    assert.equal(objectButton._updateCalls.length, 1);
    assert.equal(String(objectButton._updateCalls[0].content).includes("Object: Bronze Door"), true);
    assert.equal(String(objectButton._updateCalls[0].content).includes("Action: open"), true);
    assert.equal(String(objectButton._updateCalls[0].content).includes("Spell Effect: Knock"), true);
    assert.equal(String(objectButton._updateCalls[0].content).includes("Check: investigation passed (15 vs DC 12)"), true);
    assert.equal(String(objectButton._updateCalls[0].content).includes("Mechanism: opened obj-door-002"), true);
    assert.equal(Array.isArray(objectButton._updateCalls[0].files), true);
    assert.equal(objectButton._updateCalls[0].files.length >= 1, true);
  }, results);

  await runTest("dungeon_map_state_builds_typed_object_markers_and_visible_enemy_tokens", async () => {
    const out = await buildDungeonMapState({
      data: {
        session_id: "session-dungeon-map-state-001",
        session: {
          session_id: "session-dungeon-map-state-001",
          leader_id: "player-dungeon-leader-001"
        },
        room: {
          room_id: "room-state-001",
          name: "Signal Chamber",
          room_type: "encounter",
          encounter: {
            encounter_id: "enc-state-001",
            name: "Skeleton Watch",
            visible_enemy_tokens: [
              {
                token_id: "skeleton-watch-001",
                actor_id: "skeleton-watch-001",
                label: "Skeleton Watch",
                badge_text: "S1",
                position: { x: 8, y: 3 }
              }
            ]
          },
          exits: [
            { direction: "east", to_room_id: "room-state-002", position: { x: 11, y: 5 } }
          ],
          visible_objects: [
            {
              object_id: "door-state-001",
              object_type: "door",
              name: "Iron Door",
              position: { x: 4, y: 5 },
              state: { is_locked: true }
            },
            {
              object_id: "trap-state-001",
              object_type: "trap",
              name: "Floor Spikes",
              position: { x: 6, y: 4 },
              state: {}
            },
            {
              object_id: "chest-state-001",
              object_type: "chest",
              name: "Signal Chest",
              position: { x: 2, y: 2 },
              state: { is_locked: false }
            }
          ],
          dungeon_map: {
            map_path: "apps/map-system/data/maps/dungeon/map-12x10.base-map.json",
            profile_path: "apps/map-system/data/profiles/dungeon/map-12x10.dungeon-profile.json",
            party_position: { x: 1, y: 5 },
            party_path: [
              { x: 0, y: 5 },
              { x: 1, y: 5 }
            ],
            encounter_triggers: [
              { encounter_id: "enc-state-001", position: { x: 8, y: 3 }, label: "enc" }
            ]
          }
        }
      },
      map_config: {
        map_path: path.resolve(process.cwd(), "apps/map-system/data/maps/dungeon/map-12x10.base-map.json"),
        profile_path: path.resolve(process.cwd(), "apps/map-system/data/profiles/dungeon/map-12x10.dungeon-profile.json"),
        output_dir: path.resolve(process.cwd(), "apps/map-system/output/live"),
        dungeon_map: {
          map_path: "apps/map-system/data/maps/dungeon/map-12x10.base-map.json",
          party_position: { x: 1, y: 5 },
          party_path: [
            { x: 0, y: 5 },
            { x: 1, y: 5 }
          ],
          encounter_triggers: [
            { encounter_id: "enc-state-001", position: { x: 8, y: 3 }, label: "enc" }
          ]
        }
      },
      view_state: { mode: "idle" }
    });

    assert.equal(out.ok, true);
    assert.equal(Array.isArray(out.payload.map.tokens), true);
    assert.equal(out.payload.map.tokens.length, 2);
    assert.equal(out.payload.map.tokens.some((token) => token.token_type === "player"), true);
    assert.equal(out.payload.map.tokens.some((token) => token.token_type === "enemy"), true);
    assert.equal(
      out.payload.map.overlays.some((overlay) => overlay && overlay.overlay_id === "dungeon-party-path-overlay"),
      true
    );
    assert.equal(
      out.payload.map.overlays.some((overlay) => overlay && String(overlay.overlay_id).includes("door-state-001")),
      true
    );
    assert.equal(
      out.payload.map.overlays.some((overlay) => overlay && String(overlay.overlay_id).includes("trap-state-001")),
      true
    );
    assert.equal(
      out.payload.map.overlays.some((overlay) => overlay && String(overlay.overlay_id).includes("dungeon-visible-enemy")),
      true
    );
  }, results);

  await runTest("gateway_trade_proposal_wizard_collects_offer_and_submits_runtime_trade", async () => {
    const receivedEvents = [];
    const runtime = {
      processGatewayReadCommandEvent(event) {
        receivedEvents.push(event);
        if (event.event_type === "player_inventory_requested") {
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
                        inventory_id: "inv-trade-proposal-001",
                        currency: { gold: 12 },
                        stackable_count: 2,
                        equipment_count: 0,
                        quest_count: 0,
                        magical_count: 0,
                        unidentified_count: 0,
                        attuned_count: 0,
                        attunement_slots: 3,
                        stackable_preview: [
                          { item_id: "item_bandage_roll", item_name: "Bandage Roll", quantity: 3 }
                        ],
                        equipment_preview: [],
                        quest_preview: [],
                        magical_preview: [],
                        unidentified_preview: [],
                        tradeable_items: [
                          { item_id: "item_bandage_roll", item_name: "Bandage Roll", quantity: 3 }
                        ],
                        attuned_items: []
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

        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "trade",
                  ok: true,
                  data: {
                    trade: {
                      trade_id: "trade-proposal-001",
                      trade_state: "pending",
                      offered: { item_id: "item_bandage_roll", quantity: 2, currency: 0 },
                      requested: { item_id: null, quantity: null, currency: 10 }
                    },
                    trades: [
                      {
                        trade_id: "trade-proposal-001",
                        trade_state: "pending",
                        initiator_player_id: "player-gateway-trade-proposal-001",
                        counterparty_player_id: "player-counterparty-001",
                        role: "initiator",
                        offered: { item_id: "item_bandage_roll", quantity: 2, currency: 0 },
                        requested: { item_id: null, quantity: null, currency: 10 }
                      }
                    ],
                    actionable_trades: [
                      {
                        trade_id: "trade-proposal-001",
                        trade_state: "pending",
                        initiator_player_id: "player-gateway-trade-proposal-001",
                        counterparty_player_id: "player-counterparty-001",
                        role: "initiator",
                        offered: { item_id: "item_bandage_roll", quantity: 2, currency: 0 },
                        requested: { item_id: null, quantity: null, currency: 10 }
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

    const interaction = createInteraction("trade", [
      { name: "action", value: "propose" },
      { name: "counterparty_player_id", value: "player-counterparty-001" }
    ], "player-gateway-trade-proposal-001");
    const out = await handleGatewayInteraction(interaction, runtime);
    assert.equal(out.ok, true);
    assert.equal(interaction._replyCalls.length, 1);
    assert.equal(interaction._replyCalls[0].embeds[0].data.title, "Broker Desk | New Offer");

    const quantitySelect = createSelectInteraction("trade:proposal:quantity", "2", "player-gateway-trade-proposal-001");
    const quantityOut = await handleGatewayInteraction(quantitySelect, runtime);
    assert.equal(quantityOut.ok, true);
    assert.equal(quantitySelect._updateCalls.length, 1);
    assert.equal(String(quantitySelect._updateCalls[0].embeds[0].data.fields[0].value).includes("x2"), true);

    const goldSelect = createSelectInteraction("trade:proposal:gold", "10", "player-gateway-trade-proposal-001");
    const goldOut = await handleGatewayInteraction(goldSelect, runtime);
    assert.equal(goldOut.ok, true);
    assert.equal(goldSelect._updateCalls.length, 1);
    assert.equal(String(goldSelect._updateCalls[0].embeds[0].data.fields[1].value).includes("10g"), true);

    const submitButton = createButtonInteraction("trade:proposal:submit", "player-gateway-trade-proposal-001");
    const submitOut = await handleGatewayInteraction(submitButton, runtime);
    assert.equal(submitOut.ok, true);
    const proposeEvent = receivedEvents.find((event) => event.event_type === "player_trade_requested");
    assert.equal(Boolean(proposeEvent), true);
    assert.equal(proposeEvent.payload.counterparty_player_id, "player-counterparty-001");
    assert.equal(proposeEvent.payload.offered_item_id, "item_bandage_roll");
    assert.equal(proposeEvent.payload.offered_quantity, 2);
    assert.equal(proposeEvent.payload.requested_currency, 10);
    assert.equal(submitButton._updateCalls.length, 1);
    assert.equal(String(submitButton._updateCalls[0].content).includes("trade-proposal-001"), true);
  }, results);

  await runTest("gateway_trade_ledger_supports_detail_and_back_navigation", async () => {
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
                  response_type: "trade",
                  ok: true,
                  data: {
                    trades: [
                      {
                        trade_id: "trade-detail-001",
                        trade_state: "pending",
                        initiator_player_id: "player-gateway-trade-detail-001",
                        counterparty_player_id: "player-counterparty-001",
                        role: "initiator",
                        actionable: true,
                        offered: { item_id: "item_bandage_roll", item_name: "Bandage Roll", quantity: 1, currency: 0 },
                        requested: { item_id: null, quantity: null, currency: 5 },
                        created_at: "2026-03-12T10:00:00.000Z",
                        updated_at: "2026-03-12T10:01:00.000Z",
                        completed_at: null
                      }
                    ],
                    actionable_trades: [
                      {
                        trade_id: "trade-detail-001",
                        trade_state: "pending",
                        initiator_player_id: "player-gateway-trade-detail-001",
                        counterparty_player_id: "player-counterparty-001",
                        role: "initiator",
                        actionable: true,
                        offered: { item_id: "item_bandage_roll", quantity: 1, currency: 0 },
                        requested: { item_id: null, quantity: null, currency: 5 },
                        created_at: "2026-03-12T10:00:00.000Z",
                        updated_at: "2026-03-12T10:01:00.000Z",
                        completed_at: null
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

    const interaction = createInteraction("trade", [{ name: "action", value: "list" }], "player-gateway-trade-detail-001");
    const out = await handleGatewayInteraction(interaction, runtime);
    assert.equal(out.ok, true);
    assert.equal(interaction._replyCalls[0].embeds[0].data.title, "Broker Ledger");
    assert.equal(String(interaction._replyCalls[0].embeds[0].data.fields[0].value).includes("Bandage Roll x1"), true);

    const detailButton = createButtonInteraction("trade:view:detail:trade-detail-001", "player-gateway-trade-detail-001");
    const detailOut = await handleGatewayInteraction(detailButton, runtime);
    assert.equal(detailOut.ok, true);
    assert.equal(detailButton._updateCalls.length, 1);
    assert.equal(detailButton._updateCalls[0].embeds[0].data.title, "Broker Ledger | trade-detail-001");
    assert.equal(detailButton._updateCalls[0].components.length >= 1, true);
    assert.equal(String(detailButton._updateCalls[0].embeds[0].data.fields[0].value).includes("Bandage Roll x1"), true);

    const backButton = createButtonInteraction("trade:view:back", "player-gateway-trade-detail-001");
    const backOut = await handleGatewayInteraction(backButton, runtime);
    assert.equal(backOut.ok, true);
    assert.equal(backButton._updateCalls.length, 1);
    assert.equal(backButton._updateCalls[0].embeds[0].data.title, "Broker Ledger");
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
                    combat_summary: {
                      combat_id: "combat-gateway-attack-001",
                      round: 2,
                      active_participant_id: "hero-001",
                      participants: [
                        { participant_id: "hero-001", current_hp: 9, max_hp: 12 },
                        { participant_id: "monster-001", current_hp: 3, max_hp: 7 }
                      ]
                    },
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
    assert.equal(interaction._replyCalls[0].embeds[0].data.title, "Attack Resolved");
    assert.equal(interaction._replyCalls[0].embeds[1].data.title, "Combat State");
    assert.equal(String(interaction._replyCalls[0].embeds[0].data.description).includes("Result: Hit for 4"), true);
    assert.equal(String(interaction._replyCalls[0].embeds[0].data.description).includes("Round: 2"), true);
    assert.equal(String(interaction._replyCalls[0].embeds[0].data.description).includes("*hero-001 9/12 | monster-001 3/7"), true);
    assert.equal(interaction._replyCalls[0].content.includes("Result: Hit for 4"), true);
    assert.equal(interaction._replyCalls[0].content.includes("Next Turn: hero-001"), true);
    assert.equal(interaction._replyCalls[0].content.includes("monster-001 struck at hero-001"), true);
  }, results);

  await runTest("gateway_formats_dodge_response_with_combat_state", async () => {
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
                  response_type: "dodge",
                  ok: true,
                  data: {
                    participant_id: "hero-001",
                    is_dodging: true,
                    active_participant_id: "monster-001",
                    combat_completed: false,
                    ai_turns: [],
                    combat_summary: {
                      combat_id: "combat-gateway-dodge-001",
                      round: 2,
                      active_participant_id: "monster-001",
                      participants: [
                        { participant_id: "hero-001", current_hp: 9, max_hp: 12 },
                        { participant_id: "monster-001", current_hp: 7, max_hp: 7 }
                      ]
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

    const interaction = createInteraction("dodge", [
      { name: "combat_id", value: "combat-gateway-dodge-001" }
    ], "player-gateway-dodge-001");
    const out = await handleGatewayInteraction(interaction, runtime);

    assert.equal(out.ok, true);
    assert.equal(interaction._replyCalls.length, 1);
    assert.equal(interaction._replyCalls[0].embeds[0].data.title, "Dodge Taken");
    assert.equal(interaction._replyCalls[0].embeds[1].data.title, "Combat State");
    assert.equal(String(interaction._replyCalls[0].content).includes("Status: Dodging"), true);
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
                    combat_summary: {
                      combat_id: "combat-gateway-cast-001",
                      round: 3,
                      active_participant_id: "enemy-001",
                      participants: [
                        { participant_id: "ally-001", current_hp: 12, max_hp: 12 },
                        { participant_id: "enemy-001", current_hp: 8, max_hp: 8 }
                      ]
                    },
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
    assert.equal(interaction._replyCalls[0].embeds[0].data.title, "Spell Cast");
    assert.equal(interaction._replyCalls[0].embeds[1].data.title, "Combat State");
    assert.equal(String(interaction._replyCalls[0].embeds[0].data.description).includes("Result: Effect applied"), true);
    assert.equal(String(interaction._replyCalls[0].embeds[0].data.description).includes("Round: 3"), true);
    assert.equal(interaction._replyCalls[0].content.includes("Defense: 11 -> 16"), true);
    assert.equal(interaction._replyCalls[0].content.includes("Conditions: mage_armor"), true);
  }, results);

  await runTest("gateway_formats_combat_status_command_and_refresh_button", async () => {
    let calls = 0;
    const runtime = {
      processGatewayReadCommandEvent(event) {
        calls += 1;
        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "combat",
                  ok: true,
                  data: {
                    combat_id: "combat-gateway-status-001",
                    combat_summary: {
                      combat_id: "combat-gateway-status-001",
                      status: "active",
                      round: 4,
                      active_participant_id: "hero-001",
                      condition_count: 1,
                      participants: [
                        {
                          participant_id: "hero-001",
                          player_id: "player-gateway-combat-001",
                          team: "heroes",
                          current_hp: 9,
                          max_hp: 12,
                          position: { x: 1, y: 1 },
                          action_available: false,
                          bonus_action_available: true,
                          reaction_available: true,
                          movement_remaining: 15,
                          conditions: []
                        },
                        {
                          participant_id: "monster-001",
                          team: "monsters",
                          current_hp: 3,
                          max_hp: 7,
                          position: { x: 3, y: 1 },
                          action_available: true,
                          bonus_action_available: false,
                          reaction_available: false,
                          movement_remaining: 0,
                          conditions: ["poisoned"]
                        }
                      ]
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

    const interaction = createInteraction("combat", [], "player-gateway-combat-001");
    const out = await handleGatewayInteraction(interaction, runtime);
    assert.equal(out.ok, true);
    assert.equal(interaction._replyCalls.length, 1);
    assert.equal(interaction._replyCalls[0].embeds[0].data.title, "Combat State");
    assert.equal(interaction._replyCalls[0].components.length >= 2, true);
    assert.equal(Array.isArray(interaction._replyCalls[0].files), true);
    assert.equal(interaction._replyCalls[0].files.length >= 1, true);
    assert.equal(String(interaction._replyCalls[0].embeds[0].data.fields[0].value).includes("Resources: Action spent | Bonus up | Reaction up | Move 15"), true);
    assert.equal(String(interaction._replyCalls[0].embeds[0].data.fields[1].value).includes("monster-001 3/7 HP | Cond Poisoned"), true);

    const button = createButtonInteraction("combat:view:refresh:combat-gateway-status-001", "player-gateway-combat-001");
    const buttonOut = await handleGatewayInteraction(button, runtime);
    assert.equal(buttonOut.ok, true);
    assert.equal(calls, 2);
    assert.equal(button._updateCalls.length, 1);
    assert.equal(button._updateCalls[0].embeds[0].data.title, "Combat State");
    assert.equal(Array.isArray(button._updateCalls[0].files), true);
    assert.equal(button._updateCalls[0].files.length >= 1, true);
  }, results);

  await runTest("gateway_handles_map_ui_move_preview_without_putting_gameplay_logic_in_gateway", async () => {
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
                  response_type: "combat",
                  ok: true,
                    data: {
                      combat_id: "combat-gateway-map-ui-001",
                      actor_spells: [
                        {
                          spell_id: "fire_bolt",
                          name: "Fire Bolt",
                          level: 0,
                          casting_time: "1 action",
                          range: "120 feet",
                          targeting: { type: "single_target" }
                        },
                        {
                          spell_id: "light",
                          name: "Light",
                          level: 0,
                          casting_time: "1 action",
                          range: "touch",
                          targeting: { type: "object" }
                        }
                      ],
                      combat_summary: {
                        combat_id: "combat-gateway-map-ui-001",
                      status: "active",
                      round: 1,
                      active_participant_id: "hero-001",
                      condition_count: 0,
                      participants: [
                        {
                          participant_id: "hero-001",
                          player_id: "player-gateway-map-ui-001",
                          team: "heroes",
                          current_hp: 10,
                          max_hp: 10,
                          position: { x: 1, y: 1 },
                          action_available: true,
                          bonus_action_available: true,
                          reaction_available: true,
                          movement_remaining: 30,
                          conditions: []
                        },
                        {
                          participant_id: "monster-001",
                          team: "monsters",
                          current_hp: 8,
                          max_hp: 8,
                          position: { x: 4, y: 1 },
                          action_available: true,
                          bonus_action_available: true,
                          reaction_available: true,
                          movement_remaining: 30,
                          conditions: []
                        }
                      ]
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

    const interaction = createButtonInteraction("map-ui:move:combat:combat-gateway-map-ui-001:hero-001", "player-gateway-map-ui-001");
    const out = await handleGatewayInteraction(interaction, runtime);

    assert.equal(out.ok, true);
    assert.equal(interaction._updateCalls.length, 1);
      assert.equal(String(interaction._updateCalls[0].content).includes("Move Preview"), true);
      assert.equal(Array.isArray(interaction._updateCalls[0].files), true);
      assert.equal(interaction._updateCalls[0].files.length >= 1, true);
    }, results);

  await runTest("gateway_handles_map_ui_spell_selection_with_supported_spell_slice", async () => {
    const runtime = {
      processGatewayReadCommandEvent() {
        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "combat",
                  ok: true,
                  data: {
                    combat_id: "combat-gateway-map-ui-spell-001",
                    actor_spells: [
                      {
                        spell_id: "fire_bolt",
                        name: "Fire Bolt",
                        level: 0,
                        casting_time: "1 action",
                        range: "120 feet",
                        targeting: { type: "single_target" }
                      },
                      {
                        spell_id: "bless",
                        name: "Bless",
                        level: 1,
                        casting_time: "1 action",
                        range: "30 feet",
                        targeting: { type: "up_to_three_allies" }
                      }
                    ],
                    combat_summary: {
                      combat_id: "combat-gateway-map-ui-spell-001",
                      status: "active",
                      round: 1,
                      active_participant_id: "hero-001",
                      condition_count: 0,
                      participants: [
                        {
                          participant_id: "hero-001",
                          player_id: "player-gateway-map-ui-spell-001",
                          known_spell_ids: ["fire_bolt", "bless"],
                          team: "heroes",
                          current_hp: 10,
                          max_hp: 10,
                          position: { x: 1, y: 1 },
                          action_available: true,
                          bonus_action_available: true,
                          reaction_available: true,
                          movement_remaining: 30,
                          conditions: []
                        },
                        {
                          participant_id: "monster-001",
                          team: "monsters",
                          current_hp: 8,
                          max_hp: 8,
                          position: { x: 4, y: 1 },
                          action_available: true,
                          bonus_action_available: true,
                          reaction_available: true,
                          movement_remaining: 30,
                          conditions: []
                        }
                      ]
                    }
                  },
                  error: null
                }
              }
            ],
            events_processed: [],
            final_state: {}
          },
          error: null
        };
      }
    };

    const listInteraction = createButtonInteraction("map-ui:spell:combat:combat-gateway-map-ui-spell-001:hero-001", "player-gateway-map-ui-spell-001");
    const listOut = await handleGatewayInteraction(listInteraction, runtime);
    assert.equal(listOut.ok, true);
    assert.equal(String(listInteraction._updateCalls[0].content).includes("Choose a spell"), true);
    assert.equal(String(listInteraction._updateCalls[0].content).includes("Bless"), true);
    assert.equal(
      listInteraction._updateCalls[0].components.some((row) =>
        Array.isArray(row.components) && row.components.some((button) => String(button.data.label) === "Fire Bolt")
      ),
      true
    );
    assert.equal(
      listInteraction._updateCalls[0].components.some((row) =>
        Array.isArray(row.components) && row.components.some((button) => String(button.data.label) === "Bless")
      ),
      false
    );

    const previewInteraction = createButtonInteraction("map-ui:spell,fire_bolt:combat:combat-gateway-map-ui-spell-001:hero-001", "player-gateway-map-ui-spell-001");
    const previewOut = await handleGatewayInteraction(previewInteraction, runtime);
    assert.equal(previewOut.ok, true);
    assert.equal(String(previewInteraction._updateCalls[0].content).includes("Spell Preview"), true);
    assert.equal(String(previewInteraction._updateCalls[0].content).includes("Fire Bolt"), true);
    assert.equal(Array.isArray(previewInteraction._updateCalls[0].files), true);
    assert.equal(previewInteraction._updateCalls[0].files.length >= 1, true);
  }, results);

  await runTest("gateway_combat_map_dry_run_flow_supports_open_move_attack_and_spell_preview_without_discord", async () => {
    const receivedEvents = [];

    function buildCombatPayload() {
      return {
        combat_id: "combat-gateway-live-flow-001",
        actor_spells: [
          {
            spell_id: "fire_bolt",
            name: "Fire Bolt",
            level: 0,
            casting_time: "1 action",
            range: "120 feet",
            targeting: { type: "single_target" }
          },
          {
            spell_id: "thunderwave",
            name: "Thunderwave",
            level: 1,
            casting_time: "1 action",
            range: "self",
            targeting: { type: "cube_15" }
          },
          {
            spell_id: "bless",
            name: "Bless",
            level: 1,
            casting_time: "1 action",
            range: "30 feet",
            targeting: { type: "up_to_three_allies" }
          }
        ],
        combat_summary: {
          combat_id: "combat-gateway-live-flow-001",
          status: "active",
          round: 2,
          active_participant_id: "hero-001",
          condition_count: 0,
          participants: [
            {
              participant_id: "hero-001",
              player_id: "player-gateway-live-flow-001",
              known_spell_ids: ["fire_bolt", "thunderwave", "bless"],
              team: "heroes",
              current_hp: 14,
              max_hp: 14,
              position: { x: 1, y: 1 },
              action_available: true,
              bonus_action_available: true,
              reaction_available: true,
              movement_remaining: 30,
              conditions: [],
              weapon_profile: {
                weapon_name: "Longsword",
                mode: "melee",
                range_feet: 5
              }
            },
            {
              participant_id: "monster-001",
              team: "monsters",
              current_hp: 12,
              max_hp: 12,
              position: { x: 2, y: 1 },
              action_available: true,
              bonus_action_available: true,
              reaction_available: true,
              movement_remaining: 30,
              conditions: []
            }
          ]
        }
      };
    }

    const runtime = {
      processGatewayReadCommandEvent(event) {
        receivedEvents.push(event);

        return {
          ok: true,
          event_type: "read_command_runtime_completed",
          payload: {
            responses: [
              {
                event_type: "gateway_response_ready",
                payload: {
                  response_type: "combat",
                  ok: true,
                  data: buildCombatPayload(),
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

    const combatInteraction = createInteraction("combat", [], "player-gateway-live-flow-001");
    const combatOut = await handleGatewayInteraction(combatInteraction, runtime);
    assert.equal(combatOut.ok, true);
    assert.equal(combatInteraction._replyCalls.length, 1);
    assert.equal(combatInteraction._replyCalls[0].embeds[0].data.title, "Combat State");
    assert.equal(Array.isArray(combatInteraction._replyCalls[0].files), true);
    assert.equal(combatInteraction._replyCalls[0].files.length >= 1, true);
    assert.equal(
      combatInteraction._replyCalls[0].components.some((row) =>
        Array.isArray(row.components) && row.components.some((button) => String(button.data.label) === "Move")
      ),
      true
    );

    const moveInteraction = createButtonInteraction("map-ui:move:combat:combat-gateway-live-flow-001:hero-001", "player-gateway-live-flow-001");
    const moveOut = await handleGatewayInteraction(moveInteraction, runtime);
    assert.equal(moveOut.ok, true);
    assert.equal(moveInteraction._updateCalls.length, 1);
    assert.equal(String(moveInteraction._updateCalls[0].content).includes("Move Preview"), true);
    assert.equal(Array.isArray(moveInteraction._updateCalls[0].files), true);
    assert.equal(moveInteraction._updateCalls[0].files.length >= 1, true);

    const attackInteraction = createButtonInteraction("map-ui:attack:combat:combat-gateway-live-flow-001:hero-001", "player-gateway-live-flow-001");
    const attackOut = await handleGatewayInteraction(attackInteraction, runtime);
    assert.equal(attackOut.ok, true);
    assert.equal(String(attackInteraction._updateCalls[0].content).includes("Attack Preview"), true);
    assert.equal(
      attackInteraction._updateCalls[0].components.some((row) =>
        Array.isArray(row.components) && row.components.some((button) => String(button.data.label) === "monster-001")
      ),
      true
    );

    const attackTargetInteraction = createButtonInteraction("map-ui:attack_target,monster-001:combat:combat-gateway-live-flow-001:hero-001", "player-gateway-live-flow-001");
    const attackTargetOut = await handleGatewayInteraction(attackTargetInteraction, runtime);
    assert.equal(attackTargetOut.ok, true);
    assert.equal(String(attackTargetInteraction._updateCalls[0].content).includes("Attack Preview"), true);
    assert.equal(String(attackTargetInteraction._updateCalls[0].content).includes("monster-001"), true);

    const attackConfirmInteraction = createButtonInteraction("map-ui:attack_confirm:combat:combat-gateway-live-flow-001:hero-001", "player-gateway-live-flow-001");
    const attackConfirmOut = await handleGatewayInteraction(attackConfirmInteraction, runtime);
    assert.equal(attackConfirmOut.ok, true);
    assert.equal(attackConfirmInteraction._updateCalls.length, 1);
    assert.equal(attackConfirmInteraction._updateCalls[0].embeds[0].data.title, "Combat State");
    assert.equal(Array.isArray(attackConfirmInteraction._updateCalls[0].files), true);
    assert.equal(attackConfirmInteraction._updateCalls[0].files.length >= 1, true);
    assert.equal(receivedEvents.some((event) => event && event.event_type === "player_attack"), true);

    const spellListInteraction = createButtonInteraction("map-ui:spell:combat:combat-gateway-live-flow-001:hero-001", "player-gateway-live-flow-001");
    const spellListOut = await handleGatewayInteraction(spellListInteraction, runtime);
    assert.equal(spellListOut.ok, true);
    assert.equal(String(spellListInteraction._updateCalls[0].content).includes("Choose a spell"), true);
    assert.equal(
      spellListInteraction._updateCalls[0].components.some((row) =>
        Array.isArray(row.components) && row.components.some((button) => String(button.data.label) === "Fire Bolt")
      ),
      true
    );
    assert.equal(
      spellListInteraction._updateCalls[0].components.some((row) =>
        Array.isArray(row.components) && row.components.some((button) => String(button.data.label) === "Bless")
      ),
      false
    );
    assert.equal(
      spellListInteraction._updateCalls[0].components.some((row) =>
        Array.isArray(row.components) && row.components.some((button) => String(button.data.label) === "Thunderwave")
      ),
      false
    );

    const spellPreviewInteraction = createButtonInteraction("map-ui:spell,fire_bolt:combat:combat-gateway-live-flow-001:hero-001", "player-gateway-live-flow-001");
    const spellPreviewOut = await handleGatewayInteraction(spellPreviewInteraction, runtime);
    assert.equal(spellPreviewOut.ok, true);
    assert.equal(String(spellPreviewInteraction._updateCalls[0].content).includes("Spell Preview"), true);
    assert.equal(String(spellPreviewInteraction._updateCalls[0].content).includes("Fire Bolt"), true);
    assert.equal(Array.isArray(spellPreviewInteraction._updateCalls[0].files), true);
    assert.equal(spellPreviewInteraction._updateCalls[0].files.length >= 1, true);
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
