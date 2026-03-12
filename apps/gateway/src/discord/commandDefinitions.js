"use strict";

const { SlashCommandBuilder } = require("discord.js");

// Stage 0 shell command list. Keep this small and simple.
const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Basic shell test command.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show command help and usage overview.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View your player profile summary.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("combat")
    .setDescription("View the current combat state.")
    .addStringOption((option) =>
      option
        .setName("combat_id")
        .setDescription("Optional combat identifier if known")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("View your inventory summary.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Browse or trade with a starter vendor.")
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("Shop action")
        .setRequired(true)
        .addChoices(
          { name: "browse", value: "browse" },
          { name: "buy", value: "buy" },
          { name: "sell", value: "sell" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("vendor_id")
        .setDescription("Vendor identifier")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("item_id")
        .setDescription("Item identifier for buy/sell")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("quantity")
        .setDescription("Quantity to buy/sell")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("craft")
    .setDescription("Browse or craft from supported starter recipes.")
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("Crafting action")
        .setRequired(true)
        .addChoices(
          { name: "browse", value: "browse" },
          { name: "make", value: "make" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("recipe_id")
        .setDescription("Recipe identifier to craft")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("trade")
    .setDescription("Propose and manage direct player trades.")
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("Trade action")
        .setRequired(true)
        .addChoices(
          { name: "list", value: "list" },
          { name: "propose", value: "propose" },
          { name: "accept", value: "accept" },
          { name: "decline", value: "decline" },
          { name: "cancel", value: "cancel" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("trade_id")
        .setDescription("Trade identifier for accept/decline/cancel")
        .setRequired(false)
    )
    .addUserOption((option) =>
      option
        .setName("counterparty_player_id")
        .setDescription("Player to trade with")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("offered_item_id")
        .setDescription("Item you are offering")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("offered_quantity")
        .setDescription("Quantity you are offering")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("offered_currency")
        .setDescription("Gold you are offering")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("requested_item_id")
        .setDescription("Item you want in return")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("requested_quantity")
        .setDescription("Requested item quantity")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("requested_currency")
        .setDescription("Gold you want in return")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Admin/GM toolkit actions for alpha operations.")
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("Admin action to run")
        .setRequired(true)
        .addChoices(
          { name: "inspect_account_character", value: "inspect_account_character" },
          { name: "inspect_session", value: "inspect_session" },
          { name: "inspect_combat", value: "inspect_combat" },
          { name: "inspect_inventory", value: "inspect_inventory" },
          { name: "grant_item", value: "grant_item" },
          { name: "grant_xp", value: "grant_xp" },
          { name: "spawn_monster", value: "spawn_monster" },
          { name: "reset_session", value: "reset_session" },
          { name: "set_active_character", value: "set_active_character" },
          { name: "inspect_party", value: "inspect_party" },
          { name: "inspect_guild", value: "inspect_guild" },
          { name: "inspect_rankings", value: "inspect_rankings" },
          { name: "inspect_world_event", value: "inspect_world_event" },
          { name: "inspect_tuning", value: "inspect_tuning" },
          { name: "inspect_world_summary", value: "inspect_world_summary" },
          { name: "set_reward_multiplier", value: "set_reward_multiplier" },
          { name: "activate_world_event", value: "activate_world_event" },
          { name: "deactivate_world_event", value: "deactivate_world_event" },
          { name: "refresh_content", value: "refresh_content" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("character_id")
        .setDescription("Optional character id for admin action")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("item_id")
        .setDescription("Optional item id for grant_item")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("quantity")
        .setDescription("Optional quantity for grant_item")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("xp_delta")
        .setDescription("Optional XP delta for grant_xp")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("session_id")
        .setDescription("Optional session id")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("combat_id")
        .setDescription("Optional combat id")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("monster_id")
        .setDescription("Optional monster id for spawn_monster")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("inventory_id")
        .setDescription("Optional inventory id for inspect_inventory")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("party_id")
        .setDescription("Optional party id for inspect_party")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("guild_id")
        .setDescription("Optional guild id for inspect_guild")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("world_event_id")
        .setDescription("Optional world event id for world-event controls")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("ranking_type")
        .setDescription("Optional ranking category id")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("Optional ranking limit")
        .setRequired(false)
    )
    .addNumberOption((option) =>
      option
        .setName("reward_multiplier")
        .setDescription("Optional reward multiplier for tuning")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("start")
    .setDescription("Request initial character bootstrap flow.")
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("Character name")
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("equip")
    .setDescription("Request equipping an item to a slot.")
    .addStringOption((option) =>
      option
        .setName("item_id")
        .setDescription("Item identifier to equip")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("slot")
        .setDescription("Optional equipment slot identifier")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("unequip")
    .setDescription("Request unequipping from a slot.")
    .addStringOption((option) =>
      option
        .setName("slot")
        .setDescription("Equipment slot identifier")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("item_id")
        .setDescription("Optional item identifier for validation")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("identify")
    .setDescription("Identify an unidentified item in your inventory.")
    .addStringOption((option) =>
      option
        .setName("item_id")
        .setDescription("Unidentified item identifier")
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("attune")
    .setDescription("Attune to a magical item in your inventory.")
    .addStringOption((option) =>
      option
        .setName("item_id")
        .setDescription("Magical item identifier")
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("unattune")
    .setDescription("End attunement with a magical item.")
    .addStringOption((option) =>
      option
        .setName("item_id")
        .setDescription("Attuned item identifier")
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("dungeon")
    .setDescription("Dungeon session lifecycle commands.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("enter")
        .setDescription("Request entering a dungeon.")
        .addStringOption((option) =>
          option
            .setName("dungeon_id")
            .setDescription("Dungeon identifier")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("party_id")
            .setDescription("Optional party identifier")
            .setRequired(false)
        )
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Request leaving the current session.")
    .addStringOption((option) =>
      option
        .setName("session_id")
        .setDescription("Optional session identifier if known")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("interact")
    .setDescription("Interact with an object in the current dungeon room.")
    .addStringOption((option) =>
      option
        .setName("object_id")
        .setDescription("Object identifier in the current room")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("Interaction action")
        .setRequired(false)
        .addChoices(
          { name: "open", value: "open" },
          { name: "unlock", value: "unlock" },
          { name: "disarm", value: "disarm" },
          { name: "activate", value: "activate" },
          { name: "use", value: "use" },
          { name: "read", value: "read" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("spell_id")
        .setDescription("Optional utility spell to use on the object")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("session_id")
        .setDescription("Optional session identifier")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("move")
    .setDescription("Request a movement action.")
    .addStringOption((option) =>
      option
        .setName("direction")
        .setDescription("Direction to move (north/south/east/west)")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("destination_id")
        .setDescription("Optional destination room or tile id")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("target_x")
        .setDescription("Optional target X coordinate")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("target_y")
        .setDescription("Optional target Y coordinate")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("session_id")
        .setDescription("Optional session identifier")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("combat_id")
        .setDescription("Optional combat identifier")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("attack")
    .setDescription("Request an attack action.")
    .addStringOption((option) =>
      option
        .setName("target_id")
        .setDescription("Target participant identifier")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("ability_id")
        .setDescription("Optional attack ability identifier")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("session_id")
        .setDescription("Optional session identifier")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("combat_id")
        .setDescription("Optional combat identifier")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("cast")
    .setDescription("Request casting a spell in combat.")
    .addStringOption((option) =>
      option
        .setName("spell_id")
        .setDescription("Spell identifier to cast")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("target_id")
        .setDescription("Optional target participant identifier")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("session_id")
        .setDescription("Optional session identifier")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("combat_id")
        .setDescription("Combat identifier")
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("use")
    .setDescription("Request item or ability usage.")
    .addStringOption((option) =>
      option
        .setName("item_id")
        .setDescription("Optional item identifier")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("ability_id")
        .setDescription("Optional ability identifier")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("target_id")
        .setDescription("Optional target identifier")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("session_id")
        .setDescription("Optional session identifier")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("combat_id")
        .setDescription("Optional combat identifier")
        .setRequired(false)
    )
    .toJSON()
];

module.exports = {
  commandDefinitions
};
