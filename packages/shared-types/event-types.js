"use strict";

// Shared event type constants for Phase 1 scaffolding.
// Keep these names stable so routing stays simple and predictable.
const EVENT_TYPES = {
  // Required examples for the shared format scaffold.
  PLAYER_MOVE: "player_move",
  PLAYER_ATTACK: "player_attack",
  PLAYER_HELP_ACTION: "player_help_action",
  PLAYER_READY_ACTION: "player_ready_action",
  PLAYER_DODGE: "player_dodge",
  PLAYER_DASH: "player_dash",
  PLAYER_GRAPPLE: "player_grapple",
  PLAYER_ESCAPE_GRAPPLE: "player_escape_grapple",
  PLAYER_SHOVE: "player_shove",
  PLAYER_DISENGAGE: "player_disengage",
  COMBAT_STARTED: "combat_started",
  LOOT_GENERATED: "loot_generated",

  // Extra scaffold events used by current placeholder modules.
  PLAYER_CAST_SPELL: "player_cast_spell",
  PLAYER_USE_ITEM: "player_use_item",
  CHARACTER_CREATED: "character_created",
  CHARACTER_UPDATED: "character_updated",
  LEVEL_UP: "level_up",
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  ITEM_EQUIPPED: "item_equipped",
  ITEM_UNEQUIPPED: "item_unequipped",
  WORLD_ACTION_RESULT: "world_action_result",
  DATABASE_EVENT_SAVED: "database_event_saved",
  GATEWAY_SLASH_COMMAND_RECEIVED: "gateway_slash_command_received",
  GATEWAY_PING_REQUESTED: "gateway_ping_requested",
  GATEWAY_HELP_REQUESTED: "gateway_help_requested",
  PLAYER_START_REQUESTED: "player_start_requested",
  PLAYER_PROFILE_REQUESTED: "player_profile_requested",
  PLAYER_COMBAT_REQUESTED: "player_combat_requested",
  PLAYER_INVENTORY_REQUESTED: "player_inventory_requested",
  PLAYER_SHOP_REQUESTED: "player_shop_requested",
  PLAYER_CRAFT_REQUESTED: "player_craft_requested",
  PLAYER_TRADE_REQUESTED: "player_trade_requested",
  PLAYER_ADMIN_REQUESTED: "player_admin_requested",
  PLAYER_EQUIP_REQUESTED: "player_equip_requested",
  PLAYER_UNEQUIP_REQUESTED: "player_unequip_requested",
  PLAYER_IDENTIFY_ITEM_REQUESTED: "player_identify_item_requested",
  PLAYER_ATTUNE_ITEM_REQUESTED: "player_attune_item_requested",
  PLAYER_UNATTUNE_ITEM_REQUESTED: "player_unattune_item_requested",
  PLAYER_FEAT_REQUESTED: "player_feat_requested",
  PLAYER_ENTER_DUNGEON: "player_enter_dungeon",
  PLAYER_LEAVE_SESSION: "player_leave_session",
  PLAYER_INTERACT_OBJECT: "player_interact_object",
  RUNTIME_WORLD_COMMAND_REQUESTED: "runtime_world_command_requested",
  RUNTIME_SESSION_COMMAND_REQUESTED: "runtime_session_command_requested",
  RUNTIME_COMBAT_COMMAND_REQUESTED: "runtime_combat_command_requested",
  GATEWAY_RESPONSE_READY: "gateway_response_ready"
};

module.exports = {
  EVENT_TYPES
};
