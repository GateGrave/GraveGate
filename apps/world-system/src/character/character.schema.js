"use strict";

const CHARACTER_SCHEMA = {
  character_id: "string",
  account_id: "string|null",
  player_id: "string|null",
  name: "string",
  race: "string",
  class: "string",
  background: "string",
  level: "number",
  xp: "number",
  proficiency_bonus: "number",
  stats: "object",
  hp_summary: "object",
  current_hitpoints: "number",
  hitpoint_max: "number",
  temporary_hitpoints: "number",
  armor_class: "number",
  bab: "number",
  initiative: "number",
  speed: "number",
  spellcasting_ability: "string|null",
  spellsave_dc: "number|null",
  saving_throws: "object",
  skills: "object",
  feats: "array",
  inventory_id: "string|null",
  inventory_ref: "string|null",
  inventory: "object|null",
  equipment: "object",
  attunement: "object",
  item_effects: "object",
  multiclass: "object",
  gestalt_progression: "object",
  status_flags: "array",
  metadata: "object",
  created_at: "string",
  updated_at: "string"
};

function createId(prefix) {
  return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function normalizeStat(value) {
  if (!Number.isFinite(value)) {
    return 10;
  }
  return Math.floor(Number(value));
}

function buildDefaultStats(inputStats) {
  const stats = inputStats && typeof inputStats === "object" ? inputStats : {};
  return {
    strength: normalizeStat(stats.strength),
    dexterity: normalizeStat(stats.dexterity),
    constitution: normalizeStat(stats.constitution),
    intelligence: normalizeStat(stats.intelligence),
    wisdom: normalizeStat(stats.wisdom),
    charisma: normalizeStat(stats.charisma)
  };
}

function getProficiencyBonus(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level || 1)));
  return 2 + Math.floor((safeLevel - 1) / 4);
}

function buildHpSummary(data) {
  const current = Number.isFinite(data.current_hitpoints) ? Math.floor(Number(data.current_hitpoints)) : 10;
  const max = Number.isFinite(data.hitpoint_max) ? Math.floor(Number(data.hitpoint_max)) : 10;
  const temporary = Number.isFinite(data.temporary_hitpoints)
    ? Math.floor(Number(data.temporary_hitpoints))
    : 0;

  if (data.hp_summary && typeof data.hp_summary === "object") {
    return {
      current: Number.isFinite(data.hp_summary.current) ? Math.floor(Number(data.hp_summary.current)) : current,
      max: Number.isFinite(data.hp_summary.max) ? Math.floor(Number(data.hp_summary.max)) : max,
      temporary: Number.isFinite(data.hp_summary.temporary)
        ? Math.floor(Number(data.hp_summary.temporary))
        : temporary
    };
  }

  return {
    current,
    max,
    temporary
  };
}

function createCharacterRecord(input) {
  const data = input || {};

  if (!data.name || String(data.name).trim() === "") {
    throw new Error("createCharacter requires name");
  }

  const level = Number.isFinite(data.level) ? Math.max(1, Math.floor(Number(data.level))) : 1;
  const stats = buildDefaultStats(data.stats);
  const hp_summary = buildHpSummary(data);
  const now = new Date().toISOString();

  return {
    character_id: data.character_id ? String(data.character_id) : createId("character"),
    account_id: data.account_id ? String(data.account_id) : null,
    player_id: data.player_id ? String(data.player_id) : null,
    name: String(data.name),
    race: data.race ? String(data.race) : "unknown",
    class: data.class ? String(data.class) : "unknown",
    background: data.background ? String(data.background) : "unknown",
    level,
    xp: Number.isFinite(data.xp) ? Math.max(0, Math.floor(Number(data.xp))) : 0,
    proficiency_bonus: Number.isFinite(data.proficiency_bonus)
      ? Math.floor(Number(data.proficiency_bonus))
      : getProficiencyBonus(level),
    stats,
    hp_summary,
    current_hitpoints: hp_summary.current,
    hitpoint_max: hp_summary.max,
    temporary_hitpoints: hp_summary.temporary,
    armor_class: Number.isFinite(data.armor_class) ? Math.floor(Number(data.armor_class)) : 10,
    bab: Number.isFinite(data.bab) ? Math.floor(Number(data.bab)) : 0,
    initiative: Number.isFinite(data.initiative) ? Math.floor(Number(data.initiative)) : 0,
    speed: Number.isFinite(data.speed) ? Math.floor(Number(data.speed)) : 30,
    spellcasting_ability: data.spellcasting_ability ? String(data.spellcasting_ability) : null,
    spellsave_dc: Number.isFinite(data.spellsave_dc) ? Math.floor(Number(data.spellsave_dc)) : null,
    saving_throws: data.saving_throws && typeof data.saving_throws === "object" ? data.saving_throws : {},
    skills: data.skills && typeof data.skills === "object" ? data.skills : {},
    feats: Array.isArray(data.feats) ? data.feats : [],
    inventory_id: data.inventory_id ? String(data.inventory_id) : null,
    inventory_ref: data.inventory_ref ? String(data.inventory_ref) : null,
    inventory: data.inventory && typeof data.inventory === "object" ? data.inventory : null,
    equipment: data.equipment && typeof data.equipment === "object" ? data.equipment : {},
    attunement: data.attunement && typeof data.attunement === "object" ? data.attunement : {},
    item_effects: data.item_effects && typeof data.item_effects === "object" ? data.item_effects : {},
    multiclass: data.multiclass && typeof data.multiclass === "object" ? data.multiclass : {},
    gestalt_progression:
      data.gestalt_progression && typeof data.gestalt_progression === "object"
        ? data.gestalt_progression
        : {},
    status_flags: Array.isArray(data.status_flags) ? data.status_flags : [],
    metadata: data.metadata && typeof data.metadata === "object" ? data.metadata : {},
    created_at: data.created_at ? String(data.created_at) : now,
    updated_at: data.updated_at ? String(data.updated_at) : now
  };
}

module.exports = {
  CHARACTER_SCHEMA,
  createCharacterRecord
};
