"use strict";

const ACCOUNT_SCHEMA = {
  account_id: "string",
  discord_user_id: "string",
  active_character_id: "string|null",
  max_character_slots: "number",
  created_at: "string",
  updated_at: "string"
};

function createId(prefix) {
  return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function createAccountRecord(input) {
  const data = input || {};
  const discordUserId = data.discord_user_id ? String(data.discord_user_id).trim() : "";
  if (!discordUserId) {
    throw new Error("createAccount requires discord_user_id");
  }

  const now = new Date().toISOString();
  const maxCharacterSlots = Number.isFinite(data.max_character_slots)
    ? Math.max(1, Math.floor(Number(data.max_character_slots)))
    : 3;

  return {
    account_id: data.account_id ? String(data.account_id) : createId("account"),
    discord_user_id: discordUserId,
    active_character_id: data.active_character_id ? String(data.active_character_id) : null,
    max_character_slots: maxCharacterSlots,
    created_at: data.created_at ? String(data.created_at) : now,
    updated_at: data.updated_at ? String(data.updated_at) : now
  };
}

module.exports = {
  ACCOUNT_SCHEMA,
  createAccountRecord
};
