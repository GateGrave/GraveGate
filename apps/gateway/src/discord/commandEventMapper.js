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

function normalizeIdentifierList(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return String(value)
    .split(",")
    .map((entry) => normalizeIdentifier(entry))
    .filter(Boolean);
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

function normalizeSingleItemPayload(commandOptions, commandName) {
  const itemId = normalizeIdentifier(getOptionValue(commandOptions, "item_id"));

  if (!itemId) {
    return {
      ok: false,
      payload: {},
      error: commandName + " command requires item_id"
    };
  }

  return {
    ok: true,
    payload: {
      item_id: itemId
    },
    error: null
  };
}

function normalizeFeatPayload(commandOptions) {
  const action = normalizeIdentifier(getOptionValue(commandOptions, "action"));
  const featId = normalizeIdentifier(getOptionValue(commandOptions, "feat_id"));
  const abilityId = normalizeIdentifier(getOptionValue(commandOptions, "ability_id"));
  const allowedActions = new Set(["list", "take"]);

  if (!action || !allowedActions.has(action)) {
    return {
      ok: false,
      payload: {},
      error: "feat command requires a valid action"
    };
  }

  if (action === "take" && !featId) {
    return {
      ok: false,
      payload: {},
      error: "take requires feat_id"
    };
  }

  return {
    ok: true,
    payload: {
      action,
      feat_id: featId || null,
      ability_id: abilityId || null
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

function normalizeDodgePayload(commandOptions) {
  const actorId = normalizeIdentifier(getOptionValue(commandOptions, "actor_id"));
  return {
    ok: true,
    payload: {
      actor_id: actorId || null
    },
    error: null
  };
}

function normalizeDashPayload(commandOptions) {
  const actorId = normalizeIdentifier(getOptionValue(commandOptions, "actor_id"));
  return {
    ok: true,
    payload: {
      actor_id: actorId || null
    },
    error: null
  };
}

function normalizeGrapplePayload(commandOptions) {
  const targetId = normalizeIdentifier(getOptionValue(commandOptions, "target_id"));
  const actorId = normalizeIdentifier(getOptionValue(commandOptions, "actor_id"));
  if (!targetId) {
    return {
      ok: false,
      payload: {},
      error: "grapple command requires target_id"
    };
  }
  return {
    ok: true,
    payload: {
      target_id: targetId,
      actor_id: actorId || null
    },
    error: null
  };
}

function normalizeEscapePayload(commandOptions) {
  const actorId = normalizeIdentifier(getOptionValue(commandOptions, "actor_id"));
  return {
    ok: true,
    payload: {
      actor_id: actorId || null
    },
    error: null
  };
}

function normalizeShovePayload(commandOptions) {
  const targetId = normalizeIdentifier(getOptionValue(commandOptions, "target_id"));
  const actorId = normalizeIdentifier(getOptionValue(commandOptions, "actor_id"));
  const shoveMode = normalizeIdentifier(getOptionValue(commandOptions, "shove_mode"));
  if (!targetId) {
    return {
      ok: false,
      payload: {},
      error: "shove command requires target_id"
    };
  }
  if (shoveMode && shoveMode !== "push" && shoveMode !== "prone") {
    return {
      ok: false,
      payload: {},
      error: "shove command shove_mode must be push or prone"
    };
  }
  return {
    ok: true,
    payload: {
      target_id: targetId,
      actor_id: actorId || null,
      shove_mode: shoveMode || "push"
    },
    error: null
  };
}

function normalizeAssistPayload(commandOptions) {
  const targetId = normalizeIdentifier(getOptionValue(commandOptions, "target_id"));
  const actorId = normalizeIdentifier(getOptionValue(commandOptions, "actor_id"));
  if (!targetId) {
    return {
      ok: false,
      payload: {},
      error: "assist command requires target_id"
    };
  }
  return {
    ok: true,
    payload: {
      target_id: targetId,
      actor_id: actorId || null
    },
    error: null
  };
}

function normalizeReadyPayload(commandOptions) {
  const actorId = normalizeIdentifier(getOptionValue(commandOptions, "actor_id"));
  const triggerType = normalizeIdentifier(getOptionValue(commandOptions, "trigger_type"));
  const readiedActionType = normalizeIdentifier(getOptionValue(commandOptions, "readied_action_type"));
  const targetId = normalizeIdentifier(getOptionValue(commandOptions, "target_id"));
  const supportedTriggerTypes = new Set(["enemy_enters_reach"]);
  const supportedReadiedActionTypes = new Set(["attack"]);
  if (triggerType && !supportedTriggerTypes.has(triggerType)) {
    return {
      ok: false,
      payload: {},
      error: "ready command trigger_type is not supported"
    };
  }
  if (readiedActionType && !supportedReadiedActionTypes.has(readiedActionType)) {
    return {
      ok: false,
      payload: {},
      error: "ready command readied_action_type is not supported"
    };
  }
  return {
    ok: true,
    payload: {
      actor_id: actorId || null,
      trigger_type: triggerType || null,
      readied_action_type: readiedActionType || null,
      target_id: targetId || null
    },
    error: null
  };
}

function normalizeDisengagePayload(commandOptions) {
  const actorId = normalizeIdentifier(getOptionValue(commandOptions, "actor_id"));
  return {
    ok: true,
    payload: {
      actor_id: actorId || null
    },
    error: null
  };
}

function normalizeCastPayload(commandOptions) {
  const spellId = normalizeIdentifier(getOptionValue(commandOptions, "spell_id"));
  const targetId = normalizeIdentifier(getOptionValue(commandOptions, "target_id"));
  const additionalTargetIds = normalizeIdentifierList(getOptionValue(commandOptions, "additional_target_ids"));

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
      target_id: targetId || null,
      target_ids: Array.from(new Set([targetId].concat(additionalTargetIds).filter(Boolean)))
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

function normalizeCombatReadPayload(commandOptions) {
  const combatId = normalizeIdentifier(getOptionValue(commandOptions, "combat_id"));
  return {
    ok: true,
    payload: {
      combat_id: combatId || null
    },
    error: null
  };
}

function normalizeShopPayload(commandOptions) {
  const action = normalizeIdentifier(getOptionValue(commandOptions, "action"));
  const vendorId = normalizeIdentifier(getOptionValue(commandOptions, "vendor_id"));
  const itemId = normalizeIdentifier(getOptionValue(commandOptions, "item_id"));
  const quantity = getOptionValue(commandOptions, "quantity");
  const allowedActions = new Set(["browse", "buy", "sell"]);

  if (!action || !allowedActions.has(action)) {
    return {
      ok: false,
      payload: {},
      error: "shop command requires a valid action"
    };
  }

  if ((action === "buy" || action === "sell") && !itemId) {
    return {
      ok: false,
      payload: {},
      error: action + " requires item_id"
    };
  }

  if ((action === "buy" || action === "sell") && (!Number.isFinite(quantity) || Number(quantity) <= 0)) {
    return {
      ok: false,
      payload: {},
      error: action + " requires quantity"
    };
  }

  return {
    ok: true,
    payload: {
      action,
      vendor_id: vendorId || "vendor_starter_quartermaster",
      item_id: itemId || null,
      quantity: Number.isFinite(quantity) ? Number(quantity) : null
    },
    error: null
  };
}

function normalizeCraftPayload(commandOptions) {
  const action = normalizeIdentifier(getOptionValue(commandOptions, "action"));
  const recipeId = normalizeIdentifier(getOptionValue(commandOptions, "recipe_id"));
  const allowedActions = new Set(["browse", "make"]);

  if (!action || !allowedActions.has(action)) {
    return {
      ok: false,
      payload: {},
      error: "craft command requires a valid action"
    };
  }

  if (action === "make" && !recipeId) {
    return {
      ok: false,
      payload: {},
      error: "make requires recipe_id"
    };
  }

  return {
    ok: true,
    payload: {
      action,
      recipe_id: recipeId || null
    },
    error: null
  };
}

function normalizeTradePayload(commandOptions) {
  const action = normalizeIdentifier(getOptionValue(commandOptions, "action"));
  const tradeId = normalizeIdentifier(getOptionValue(commandOptions, "trade_id"));
  const counterpartyPlayerId = normalizeIdentifier(getOptionValue(commandOptions, "counterparty_player_id"));
  const offeredItemId = normalizeIdentifier(getOptionValue(commandOptions, "offered_item_id"));
  const offeredQuantity = getOptionValue(commandOptions, "offered_quantity");
  const offeredCurrency = getOptionValue(commandOptions, "offered_currency");
  const requestedItemId = normalizeIdentifier(getOptionValue(commandOptions, "requested_item_id"));
  const requestedQuantity = getOptionValue(commandOptions, "requested_quantity");
  const requestedCurrency = getOptionValue(commandOptions, "requested_currency");
  const allowedActions = new Set(["list", "propose", "accept", "decline", "cancel"]);

  if (!action || !allowedActions.has(action)) {
    return {
      ok: false,
      payload: {},
      error: "trade command requires a valid action"
    };
  }

  if (action === "propose" && !counterpartyPlayerId) {
    return {
      ok: false,
      payload: {},
      error: "propose requires counterparty_player_id"
    };
  }

  if (action === "propose" && offeredItemId && (!Number.isFinite(offeredQuantity) || Number(offeredQuantity) <= 0)) {
    return {
      ok: false,
      payload: {},
      error: "propose requires offered_quantity when offering an item"
    };
  }

  if ((action === "accept" || action === "decline" || action === "cancel") && !tradeId) {
    return {
      ok: false,
      payload: {},
      error: action + " requires trade_id"
    };
  }

  return {
    ok: true,
    payload: {
      action,
      trade_id: tradeId || null,
      counterparty_player_id: counterpartyPlayerId || null,
      offered_item_id: offeredItemId || null,
      offered_quantity: Number.isFinite(offeredQuantity) ? Number(offeredQuantity) : null,
      offered_currency: Number.isFinite(offeredCurrency) ? Number(offeredCurrency) : 0,
      requested_item_id: requestedItemId || null,
      requested_quantity: Number.isFinite(requestedQuantity) ? Number(requestedQuantity) : null,
      requested_currency: Number.isFinite(requestedCurrency) ? Number(requestedCurrency) : 0
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

  if (name === "combat") {
    return {
      eventType: EVENT_TYPES.PLAYER_COMBAT_REQUESTED,
      targetSystem: "combat_system"
    };
  }

  if (name === "inventory") {
    return {
      eventType: EVENT_TYPES.PLAYER_INVENTORY_REQUESTED,
      targetSystem: "world_system"
    };
  }

  if (name === "shop") {
    return {
      eventType: EVENT_TYPES.PLAYER_SHOP_REQUESTED,
      targetSystem: "world_system"
    };
  }

  if (name === "craft") {
    return {
      eventType: EVENT_TYPES.PLAYER_CRAFT_REQUESTED,
      targetSystem: "world_system"
    };
  }

  if (name === "trade") {
    return {
      eventType: EVENT_TYPES.PLAYER_TRADE_REQUESTED,
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

  if (name === "identify") {
    return {
      eventType: EVENT_TYPES.PLAYER_IDENTIFY_ITEM_REQUESTED,
      targetSystem: "world_system"
    };
  }

  if (name === "attune") {
    return {
      eventType: EVENT_TYPES.PLAYER_ATTUNE_ITEM_REQUESTED,
      targetSystem: "world_system"
    };
  }

  if (name === "unattune") {
    return {
      eventType: EVENT_TYPES.PLAYER_UNATTUNE_ITEM_REQUESTED,
      targetSystem: "world_system"
    };
  }

  if (name === "feat") {
    return {
      eventType: EVENT_TYPES.PLAYER_FEAT_REQUESTED,
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

  if (name === "assist") {
    return {
      eventType: EVENT_TYPES.PLAYER_HELP_ACTION,
      targetSystem: "combat_system"
    };
  }

  if (name === "ready") {
    return {
      eventType: EVENT_TYPES.PLAYER_READY_ACTION,
      targetSystem: "combat_system"
    };
  }

  if (name === "dodge") {
    return {
      eventType: EVENT_TYPES.PLAYER_DODGE,
      targetSystem: "combat_system"
    };
  }

  if (name === "dash") {
    return {
      eventType: EVENT_TYPES.PLAYER_DASH,
      targetSystem: "combat_system"
    };
  }

  if (name === "grapple") {
    return {
      eventType: EVENT_TYPES.PLAYER_GRAPPLE,
      targetSystem: "combat_system"
    };
  }

  if (name === "escape") {
    return {
      eventType: EVENT_TYPES.PLAYER_ESCAPE_GRAPPLE,
      targetSystem: "combat_system"
    };
  }

  if (name === "shove") {
    return {
      eventType: EVENT_TYPES.PLAYER_SHOVE,
      targetSystem: "combat_system"
    };
  }

  if (name === "disengage") {
    return {
      eventType: EVENT_TYPES.PLAYER_DISENGAGE,
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
  const identifyPayload = commandName === "identify" ? normalizeSingleItemPayload(normalizedOptions, "identify") : null;
  const attunePayload = commandName === "attune" ? normalizeSingleItemPayload(normalizedOptions, "attune") : null;
  const unattunePayload = commandName === "unattune" ? normalizeSingleItemPayload(normalizedOptions, "unattune") : null;
  const featPayload = commandName === "feat" ? normalizeFeatPayload(normalizedOptions) : null;
  const dungeonPayload = commandName === "dungeon" ? normalizeDungeonEnterPayload(rawOptions) : null;
  const leavePayload = commandName === "leave" ? normalizeLeavePayload(normalizedOptions) : null;
  const interactPayload = commandName === "interact" ? normalizeInteractPayload(normalizedOptions) : null;
  const adminPayload = commandName === "admin" ? normalizeAdminPayload(normalizedOptions) : null;
  const movePayload = commandName === "move" ? normalizeMovePayload(normalizedOptions) : null;
  const attackPayload = commandName === "attack" ? normalizeAttackPayload(normalizedOptions) : null;
  const assistPayload = commandName === "assist" ? normalizeAssistPayload(normalizedOptions) : null;
  const readyPayload = commandName === "ready" ? normalizeReadyPayload(normalizedOptions) : null;
  const dodgePayload = commandName === "dodge" ? normalizeDodgePayload(normalizedOptions) : null;
  const dashPayload = commandName === "dash" ? normalizeDashPayload(normalizedOptions) : null;
  const grapplePayload = commandName === "grapple" ? normalizeGrapplePayload(normalizedOptions) : null;
  const escapePayload = commandName === "escape" ? normalizeEscapePayload(normalizedOptions) : null;
  const shovePayload = commandName === "shove" ? normalizeShovePayload(normalizedOptions) : null;
  const disengagePayload = commandName === "disengage" ? normalizeDisengagePayload(normalizedOptions) : null;
  const castPayload = commandName === "cast" ? normalizeCastPayload(normalizedOptions) : null;
  const usePayload = commandName === "use" ? normalizeUsePayload(normalizedOptions) : null;
  const combatReadPayload = commandName === "combat" ? normalizeCombatReadPayload(normalizedOptions) : null;
  const shopPayload = commandName === "shop" ? normalizeShopPayload(normalizedOptions) : null;
  const craftPayload = commandName === "craft" ? normalizeCraftPayload(normalizedOptions) : null;
  const tradePayload = commandName === "trade" ? normalizeTradePayload(normalizedOptions) : null;

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

  if (identifyPayload && !identifyPayload.ok) {
    return failure("gateway_command_map_failed", identifyPayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (attunePayload && !attunePayload.ok) {
    return failure("gateway_command_map_failed", attunePayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (unattunePayload && !unattunePayload.ok) {
    return failure("gateway_command_map_failed", unattunePayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (featPayload && !featPayload.ok) {
    return failure("gateway_command_map_failed", featPayload.error, {
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

  if (dodgePayload && !dodgePayload.ok) {
    return failure("gateway_command_map_failed", dodgePayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (dashPayload && !dashPayload.ok) {
    return failure("gateway_command_map_failed", dashPayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (grapplePayload && !grapplePayload.ok) {
    return failure("gateway_command_map_failed", grapplePayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (escapePayload && !escapePayload.ok) {
    return failure("gateway_command_map_failed", escapePayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (shovePayload && !shovePayload.ok) {
    return failure("gateway_command_map_failed", shovePayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (assistPayload && !assistPayload.ok) {
    return failure("gateway_command_map_failed", assistPayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (readyPayload && !readyPayload.ok) {
    return failure("gateway_command_map_failed", readyPayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (disengagePayload && !disengagePayload.ok) {
    return failure("gateway_command_map_failed", disengagePayload.error, {
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

  if (combatReadPayload && !combatReadPayload.ok) {
    return failure("gateway_command_map_failed", combatReadPayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (shopPayload && !shopPayload.ok) {
    return failure("gateway_command_map_failed", shopPayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (craftPayload && !craftPayload.ok) {
    return failure("gateway_command_map_failed", craftPayload.error, {
      command_name: commandName,
      command_options: normalizedOptions
    });
  }

  if (tradePayload && !tradePayload.ok) {
    return failure("gateway_command_map_failed", tradePayload.error, {
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
    ...(identifyPayload ? identifyPayload.payload : {}),
    ...(attunePayload ? attunePayload.payload : {}),
    ...(unattunePayload ? unattunePayload.payload : {}),
    ...(featPayload ? featPayload.payload : {}),
    ...(dungeonPayload ? dungeonPayload.payload : {}),
    ...(leavePayload ? leavePayload.payload : {}),
    ...(interactPayload ? interactPayload.payload : {}),
    ...(adminPayload ? adminPayload.payload : {}),
    ...(movePayload ? movePayload.payload : {}),
    ...(attackPayload ? attackPayload.payload : {}),
    ...(assistPayload ? assistPayload.payload : {}),
    ...(readyPayload ? readyPayload.payload : {}),
    ...(dodgePayload ? dodgePayload.payload : {}),
    ...(dashPayload ? dashPayload.payload : {}),
    ...(grapplePayload ? grapplePayload.payload : {}),
    ...(escapePayload ? escapePayload.payload : {}),
    ...(shovePayload ? shovePayload.payload : {}),
    ...(disengagePayload ? disengagePayload.payload : {}),
    ...(castPayload ? castPayload.payload : {}),
    ...(usePayload ? usePayload.payload : {}),
    ...(combatReadPayload ? combatReadPayload.payload : {}),
    ...(shopPayload ? shopPayload.payload : {}),
    ...(craftPayload ? craftPayload.payload : {}),
    ...(tradePayload ? tradePayload.payload : {}),
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
  normalizeSingleItemPayload,
  normalizeFeatPayload,
  normalizeDungeonEnterPayload,
  normalizeLeavePayload,
  normalizeAdminPayload,
  normalizeMovePayload,
  normalizeAttackPayload,
  normalizeAssistPayload,
  normalizeReadyPayload,
  normalizeDodgePayload,
  normalizeDashPayload,
  normalizeGrapplePayload,
  normalizeEscapePayload,
  normalizeShovePayload,
  normalizeDisengagePayload,
  normalizeCastPayload,
  normalizeUsePayload,
  normalizeShopPayload,
  normalizeCraftPayload,
  normalizeTradePayload
};
