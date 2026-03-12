"use strict";

const { createEvent, isValidEvent } = require("../../../../packages/shared-types/event-schema");
const { EVENT_TYPES } = require("../../../../packages/shared-types/event-types");

function success(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {},
    error: null
  };
}

function failure(eventType, message, payload) {
  return {
    ok: false,
    event_type: eventType,
    payload: payload || {},
    error: message
  };
}

function normalizeSlashCommandOptions(interaction) {
  const rawOptions = interaction && interaction.options && Array.isArray(interaction.options.data)
    ? interaction.options.data
    : [];

  return rawOptions.map(function mapOption(option) {
    return {
      name: option && option.name ? String(option.name) : null,
      value: option && option.value !== undefined ? option.value : null
    };
  });
}

function getSubcommandFromOptions(rawOptions) {
  const options = Array.isArray(rawOptions) ? rawOptions : [];
  const subcommandOption = options.find(function findSubcommand(option) {
    // Discord subcommand option type is 1.
    return option && Number(option.type) === 1;
  });

  if (!subcommandOption || !subcommandOption.name) {
    return null;
  }

  return {
    name: String(subcommandOption.name).toLowerCase(),
    options: Array.isArray(subcommandOption.options) ? subcommandOption.options : []
  };
}

function normalizeStartPayload(commandOptions) {
  const options = Array.isArray(commandOptions) ? commandOptions : [];
  const startPayload = {};

  const nameOption = options.find(function findName(option) {
    return option && option.name === "name";
  });

  if (nameOption && typeof nameOption.value === "string" && nameOption.value.trim() !== "") {
    startPayload.requested_character_name = nameOption.value.trim();
  }

  return startPayload;
}

function getOptionValue(commandOptions, optionName) {
  const options = Array.isArray(commandOptions) ? commandOptions : [];
  const found = options.find(function findOption(option) {
    return option && option.name === optionName;
  });
  return found ? found.value : undefined;
}

function getNestedOptionValue(nestedOptions, optionName) {
  const options = Array.isArray(nestedOptions) ? nestedOptions : [];
  const found = options.find(function findOption(option) {
    return option && option.name === optionName;
  });
  return found ? found.value : undefined;
}

function normalizeIdentifier(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const asString = String(value).trim();
  if (asString === "") {
    return null;
  }
  return asString;
}

function normalizeEquipPayload(commandOptions) {
  const itemId = normalizeIdentifier(getOptionValue(commandOptions, "item_id"));
  const slot = normalizeIdentifier(getOptionValue(commandOptions, "slot"));

  if (!itemId) {
    return {
      ok: false,
      payload: {},
      error: "equip command requires item_id"
    };
  }

  return {
    ok: true,
    payload: {
      item_id: itemId,
      slot: slot || null
    },
    error: null
  };
}

function normalizeUnequipPayload(commandOptions) {
  const slot = normalizeIdentifier(getOptionValue(commandOptions, "slot"));
  const itemId = normalizeIdentifier(getOptionValue(commandOptions, "item_id"));

  if (!slot) {
    return {
      ok: false,
      payload: {},
      error: "unequip command requires slot"
    };
  }

  return {
    ok: true,
    payload: {
      slot,
      item_id: itemId || null
    },
    error: null
  };
}

function normalizeMovePayload(commandOptions) {
  const directionRaw = normalizeIdentifier(getOptionValue(commandOptions, "direction"));
  const destinationId = normalizeIdentifier(getOptionValue(commandOptions, "destination_id"));
  const targetXValue = getOptionValue(commandOptions, "target_x");
  const targetYValue = getOptionValue(commandOptions, "target_y");

  const direction = directionRaw ? directionRaw.toLowerCase() : null;
  const validDirections = ["north", "south", "east", "west", "up", "down", "left", "right"];
  if (direction && !validDirections.includes(direction)) {
    return {
      ok: false,
      payload: {},
      error: "move command has invalid direction"
    };
  }

  const hasTargetX = Number.isInteger(targetXValue);
  const hasTargetY = Number.isInteger(targetYValue);
  const hasCoordinates = hasTargetX && hasTargetY;

  if (!direction && !destinationId && !hasCoordinates) {
    return {
      ok: false,
      payload: {},
      error: "move command requires direction, destination_id, or target coordinates"
    };
  }

  if ((hasTargetX && !hasTargetY) || (!hasTargetX && hasTargetY)) {
    return {
      ok: false,
      payload: {},
      error: "move command requires both target_x and target_y when using coordinates"
    };
  }

  return {
    ok: true,
    payload: {
      direction: direction || null,
      destination_id: destinationId || null,
      target_x: hasCoordinates ? targetXValue : null,
      target_y: hasCoordinates ? targetYValue : null
    },
    error: null
  };
}

function normalizeAttackPayload(commandOptions) {
  const targetId = normalizeIdentifier(getOptionValue(commandOptions, "target_id"));
  const abilityId = normalizeIdentifier(getOptionValue(commandOptions, "ability_id"));

  if (!targetId) {
    return {
      ok: false,
      payload: {},
      error: "attack command requires target_id"
    };
  }

  return {
    ok: true,
    payload: {
      target_id: targetId,
      ability_id: abilityId || null
    },
    error: null
  };
}

function normalizeCastPayload(commandOptions) {
  const spellId = normalizeIdentifier(getOptionValue(commandOptions, "spell_id"));
  const targetId = normalizeIdentifier(getOptionValue(commandOptions, "target_id"));

  if (!spellId) {
    return {
      ok: false,
      payload: {},
      error: "cast command requires spell_id"
    };
  }

  return {
    ok: true,
    payload: {
      spell_id: spellId,
      target_id: targetId || null
    },
    error: null
  };
}

function normalizeUsePayload(commandOptions) {
  const itemId = normalizeIdentifier(getOptionValue(commandOptions, "item_id"));
  const abilityId = normalizeIdentifier(getOptionValue(commandOptions, "ability_id"));
  const targetId = normalizeIdentifier(getOptionValue(commandOptions, "target_id"));

  if (!itemId && !abilityId) {
    return {
      ok: false,
      payload: {},
      error: "use command requires item_id or ability_id"
    };
  }

  return {
    ok: true,
    payload: {
      item_id: itemId || null,
      ability_id: abilityId || null,
      target_id: targetId || null
    },
    error: null
  };
}

function normalizeDungeonEnterPayload(rawOptions) {
  const subcommand = getSubcommandFromOptions(rawOptions);
  if (!subcommand || subcommand.name !== "enter") {
    return {
      ok: false,
      payload: {},
      error: "dungeon command requires enter subcommand"
    };
  }

  const dungeonId = normalizeIdentifier(getNestedOptionValue(subcommand.options, "dungeon_id"));
  const partyId = normalizeIdentifier(getNestedOptionValue(subcommand.options, "party_id"));

  if (!dungeonId) {
    return {
      ok: false,
      payload: {},
      error: "dungeon enter requires dungeon_id"
    };
  }

  return {
    ok: true,
    payload: {
      subcommand: "enter",
      dungeon_id: dungeonId,
      party_id: partyId || null
    },
    error: null
  };
}

function normalizeLeavePayload(commandOptions) {
  const sessionId = normalizeIdentifier(getOptionValue(commandOptions, "session_id"));
  return {
    ok: true,
    payload: {
      session_id: sessionId || null
    },
    error: null
  };
}

function normalizeInteractPayload(commandOptions) {
  const objectId = normalizeIdentifier(getOptionValue(commandOptions, "object_id"));
  const action = normalizeIdentifier(getOptionValue(commandOptions, "action"));
  const spellId = normalizeIdentifier(getOptionValue(commandOptions, "spell_id"));
  const sessionId = normalizeIdentifier(getOptionValue(commandOptions, "session_id"));
  const allowedActions = new Set(["open", "unlock", "disarm", "activate", "use", "read"]);

  if (!objectId) {
    return {
      ok: false,
      payload: {},
      error: "interact command requires object_id"
    };
  }

  if (action && !allowedActions.has(String(action).toLowerCase())) {
    return {
      ok: false,
      payload: {},
      error: "interact command has invalid action"
    };
  }

  return {
    ok: true,
    payload: {
      object_id: objectId,
      action: action ? String(action).toLowerCase() : null,
      spell_id: spellId || null,
      session_id: sessionId || null
    },
    error: null
  };
}

function normalizeAdminPayload(commandOptions) {
  const action = normalizeIdentifier(getOptionValue(commandOptions, "action"));
  const characterId = normalizeIdentifier(getOptionValue(commandOptions, "character_id"));
  const itemId = normalizeIdentifier(getOptionValue(commandOptions, "item_id"));
  const quantity = getOptionValue(commandOptions, "quantity");
  const xpDelta = getOptionValue(commandOptions, "xp_delta");
  const sessionId = normalizeIdentifier(getOptionValue(commandOptions, "session_id"));
  const combatId = normalizeIdentifier(getOptionValue(commandOptions, "combat_id"));
  const inventoryId = normalizeIdentifier(getOptionValue(commandOptions, "inventory_id"));
  const monsterId = normalizeIdentifier(getOptionValue(commandOptions, "monster_id"));
  const partyId = normalizeIdentifier(getOptionValue(commandOptions, "party_id"));
  const guildId = normalizeIdentifier(getOptionValue(commandOptions, "guild_id"));
  const worldEventId = normalizeIdentifier(getOptionValue(commandOptions, "world_event_id"));
  const rankingType = normalizeIdentifier(getOptionValue(commandOptions, "ranking_type"));
  const limit = getOptionValue(commandOptions, "limit");
  const rewardMultiplier = getOptionValue(commandOptions, "reward_multiplier");

  const allowedActions = new Set([
    "inspect_account_character",
    "inspect_session",
    "inspect_combat",
    "inspect_inventory",
    "inspect_party",
    "inspect_guild",
    "inspect_rankings",
    "inspect_world_event",
    "inspect_tuning",
    "inspect_world_summary",
    "grant_item",
    "grant_xp",
    "spawn_monster",
    "reset_session",
    "set_active_character",
    "set_reward_multiplier",
    "activate_world_event",
    "deactivate_world_event",
    "refresh_content"
  ]);

  if (!action || !allowedActions.has(action)) {
    return {
      ok: false,
      payload: {},
      error: "admin command requires a valid action"
    };
  }

  if (action === "grant_item" && !itemId) {
    return {
      ok: false,
      payload: {},
      error: "grant_item requires item_id"
    };
  }

  if (action === "grant_xp" && !Number.isFinite(xpDelta)) {
    return {
      ok: false,
      payload: {},
      error: "grant_xp requires xp_delta"
    };
  }

  if (action === "set_active_character" && !characterId) {
    return {
      ok: false,
      payload: {},
      error: "set_active_character requires character_id"
    };
  }

  if (action === "spawn_monster" && (!combatId || !monsterId)) {
    return {
      ok: false,
      payload: {},
      error: "spawn_monster requires combat_id and monster_id"
    };
  }

  if ((action === "inspect_session" || action === "reset_session") && !sessionId) {
    return {
      ok: false,
      payload: {},
      error: action + " requires session_id"
    };
  }

  if (action === "inspect_combat" && !combatId) {
    return {
      ok: false,
      payload: {},
      error: "inspect_combat requires combat_id"
    };
  }
  if (action === "inspect_inventory" && !inventoryId) {
    return {
      ok: false,
      payload: {},
      error: "inspect_inventory requires inventory_id"
    };
  }
  if (action === "inspect_party" && !partyId) {
    return {
      ok: false,
      payload: {},
      error: "inspect_party requires party_id"
    };
  }
  if (action === "inspect_guild" && !guildId) {
    return {
      ok: false,
      payload: {},
      error: "inspect_guild requires guild_id"
    };
  }
  if (action === "inspect_rankings" && !rankingType) {
    return {
      ok: false,
      payload: {},
      error: "inspect_rankings requires ranking_type"
    };
  }
  if (action === "inspect_world_event" && !worldEventId) {
    return {
      ok: false,
      payload: {},
      error: "inspect_world_event requires world_event_id"
    };
  }
  if ((action === "activate_world_event" || action === "deactivate_world_event") && !worldEventId) {
    return {
      ok: false,
      payload: {},
      error: action + " requires world_event_id"
    };
  }
  if (action === "set_reward_multiplier" && !Number.isFinite(rewardMultiplier)) {
    return {
      ok: false,
      payload: {},
      error: "set_reward_multiplier requires reward_multiplier"
    };
  }

  return {
    ok: true,
    payload: {
      action,
      character_id: characterId || null,
      item_id: itemId || null,
      quantity: Number.isFinite(quantity) ? Number(quantity) : null,
      xp_delta: Number.isFinite(xpDelta) ? Number(xpDelta) : null,
      session_id: sessionId || null,
      combat_id: combatId || null,
      inventory_id: inventoryId || null,
      monster_id: monsterId || null,
      party_id: partyId || null,
      guild_id: guildId || null,
      world_event_id: worldEventId || null,
      ranking_type: rankingType || null,
      limit: Number.isFinite(limit) ? Number(limit) : null,
      reward_multiplier: Number.isFinite(rewardMultiplier) ? Number(rewardMultiplier) : null
    },
    error: null
  };
}

function resolveCommandMapping(commandName) {
  const name = String(commandName || "").toLowerCase();

  if (name === "help") {
    return {
      eventType: EVENT_TYPES.GATEWAY_HELP_REQUESTED,
      targetSystem: "controller"
    };
  }

  if (name === "profile") {
    return {
      eventType: EVENT_TYPES.PLAYER_PROFILE_REQUESTED,
      targetSystem: "world_system"
    };
  }

  if (name === "inventory") {
    return {
      eventType: EVENT_TYPES.PLAYER_INVENTORY_REQUESTED,
      targetSystem: "world_system"
    };
  }

  if (name === "start") {
    return {
      eventType: EVENT_TYPES.PLAYER_START_REQUESTED,
      targetSystem: "world_system"
    };
  }

  if (name === "admin") {
    return {
      eventType: EVENT_TYPES.PLAYER_ADMIN_REQUESTED,
      targetSystem: "world_system"
    };
  }

  if (name === "equip") {
    return {
      eventType: EVENT_TYPES.PLAYER_EQUIP_REQUESTED,
      targetSystem: "world_system"
    };
  }

  if (name === "unequip") {
    return {
      eventType: EVENT_TYPES.PLAYER_UNEQUIP_REQUESTED,
      targetSystem: "world_system"
    };
  }

  if (name === "dungeon") {
    return {
      eventType: EVENT_TYPES.PLAYER_ENTER_DUNGEON,
      targetSystem: "session_system"
    };
  }

  if (name === "leave") {
    return {
      eventType: EVENT_TYPES.PLAYER_LEAVE_SESSION,
      targetSystem: "session_system"
    };
  }

  if (name === "move") {
    return {
      eventType: EVENT_TYPES.PLAYER_MOVE,
      targetSystem: "session_system"
    };
  }

  if (name === "attack") {
    return {
      eventType: EVENT_TYPES.PLAYER_ATTACK,
      targetSystem: "combat_system"
    };
  }

  if (name === "cast") {
    return {
      eventType: EVENT_TYPES.PLAYER_CAST_SPELL,
      targetSystem: "combat_system"
    };
  }

  if (name === "use") {
    return {
      eventType: EVENT_TYPES.PLAYER_USE_ITEM,
      targetSystem: "world_system"
    };
  }

  if (name === "interact") {
    return {
      eventType: EVENT_TYPES.PLAYER_INTERACT_OBJECT,
      targetSystem: "session_system"
    };
  }

  if (name === "ping") {
    return {
      eventType: EVENT_TYPES.GATEWAY_PING_REQUESTED,
      targetSystem: "controller"
    };
  }

  return {
    eventType: EVENT_TYPES.GATEWAY_SLASH_COMMAND_RECEIVED,
    targetSystem: "controller"
  };
}

function mapSlashCommandToGatewayEvent(interaction) {
  if (!interaction || typeof interaction !== "object") {
    return failure("gateway_command_map_failed", "interaction object is required");
  }

  if (!interaction.commandName || String(interaction.commandName).trim() === "") {
    return failure("gateway_command_map_failed", "interaction.commandName is required");
  }

  const commandName = String(interaction.commandName).toLowerCase();
  const mapping = resolveCommandMapping(commandName);
  const rawOptions = interaction && interaction.options && Array.isArray(interaction.options.data)
    ? interaction.options.data
    : [];
  const normalizedOptions = normalizeSlashCommandOptions(interaction);
  const startPayload = commandName === "start" ? normalizeStartPayload(normalizedOptions) : {};
  const equipPayload = commandName === "equip" ? normalizeEquipPayload(normalizedOptions) : null;
  const unequipPayload = commandName === "unequip" ? normalizeUnequipPayload(normalizedOptions) : null;
  const dungeonPayload = commandName === "dungeon" ? normalizeDungeonEnterPayload(rawOptions) : null;
  const leavePayload = commandName === "leave" ? normalizeLeavePayload(normalizedOptions) : null;
  const interactPayload = commandName === "interact" ? normalizeInteractPayload(normalizedOptions) : null;
  const adminPayload = commandName === "admin" ? normalizeAdminPayload(normalizedOptions) : null;
  const movePayload = commandName === "move" ? normalizeMovePayload(normalizedOptions) : null;
  const attackPayload = commandName === "attack" ? normalizeAttackPayload(normalizedOptions) : null;
  const castPayload = commandName === "cast" ? normalizeCastPayload(normalizedOptions) : null;
  const usePayload = commandName === "use" ? normalizeUsePayload(normalizedOptions) : null;

  if (equipPayload && !equipPayload.ok) {
    return failure("gateway_command_map_failed", equipPayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (unequipPayload && !unequipPayload.ok) {
    return failure("gateway_command_map_failed", unequipPayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (dungeonPayload && !dungeonPayload.ok) {
    return failure("gateway_command_map_failed", dungeonPayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (leavePayload && !leavePayload.ok) {
    return failure("gateway_command_map_failed", leavePayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (adminPayload && !adminPayload.ok) {
    return failure("gateway_command_map_failed", adminPayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }
  if (interactPayload && !interactPayload.ok) {
    return failure("gateway_command_map_failed", interactPayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (movePayload && !movePayload.ok) {
    return failure("gateway_command_map_failed", movePayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (attackPayload && !attackPayload.ok) {
    return failure("gateway_command_map_failed", attackPayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (castPayload && !castPayload.ok) {
    return failure("gateway_command_map_failed", castPayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (usePayload && !usePayload.ok) {
    return failure("gateway_command_map_failed", usePayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  const optionSessionId = normalizeIdentifier(getOptionValue(normalizedOptions, "session_id"));
  const optionCombatId = normalizeIdentifier(getOptionValue(normalizedOptions, "combat_id"));

  const resolvedSessionId = (leavePayload && leavePayload.payload ? leavePayload.payload.session_id : null) || optionSessionId || null;
  const resolvedCombatId = optionCombatId || null;

  const resolvedTargetSystem =
    commandName === "move" && resolvedCombatId
      ? "combat_system"
      : commandName === "use" && resolvedCombatId
        ? "combat_system"
        : mapping.targetSystem;

  const event = createEvent(mapping.eventType, {
    command_name: commandName,
    command_options: normalizedOptions,
    guild_id: interaction.guildId || null,
    channel_id: interaction.channelId || null,
    ...startPayload,
    ...(equipPayload ? equipPayload.payload : {}),
    ...(unequipPayload ? unequipPayload.payload : {}),
    ...(dungeonPayload ? dungeonPayload.payload : {}),
    ...(leavePayload ? leavePayload.payload : {}),
    ...(interactPayload ? interactPayload.payload : {}),
    ...(adminPayload ? adminPayload.payload : {}),
    ...(movePayload ? movePayload.payload : {}),
    ...(attackPayload ? attackPayload.payload : {}),
    ...(castPayload ? castPayload.payload : {}),
    ...(usePayload ? usePayload.payload : {}),
    session_id: optionSessionId || null,
    combat_id: optionCombatId || null
  }, {
    source: "gateway.discord",
    target_system: resolvedTargetSystem,
    player_id: interaction.user && interaction.user.id ? String(interaction.user.id) : null,
    session_id: resolvedSessionId || null,
    combat_id: resolvedCombatId
  });

  if (!isValidEvent(event)) {
    return failure("gateway_command_map_failed", "mapped event does not match shared schema", {
      event
    });
  }

  return success("gateway_command_mapped", {
    event
  });
}

module.exports = {
  mapSlashCommandToGatewayEvent,
  resolveCommandMapping,
  normalizeSlashCommandOptions,
  normalizeStartPayload,
  normalizeEquipPayload,
  normalizeUnequipPayload,
  normalizeDungeonEnterPayload,
  normalizeLeavePayload,
  normalizeAdminPayload,
  normalizeMovePayload,
  normalizeAttackPayload,
  normalizeCastPayload,
  normalizeUsePayload
};
