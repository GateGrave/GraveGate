"use strict";

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder
} = require("discord.js");
const { createEvent, EVENT_TYPES } = require("../../../packages/shared-types");
const { getDiscordConfig } = require("./config/discordConfig");
const { createDiscordClient } = require("./discord/createClient");
const { registerCommands } = require("./discord/registerCommands");
const { mapSlashCommandToGatewayEvent } = require("./discord/commandEventMapper");
const { createReadCommandRuntime } = require("../../runtime/src/readCommandRuntime");
const {
  buildCombatMapView,
  buildMapInteractionContext,
  buildTokenVisualOverrides,
  handleButtonAction: handleCombatMapButtonAction,
  adaptMapActionToCanonicalEvent
} = require("./combatMapView");
const {
  createDungeonMapMoveDirectionAction,
  adaptDungeonMapActionToCanonicalEvent
} = require("../../map-system/src");
const {
  buildDungeonMapView,
  parseDungeonMapCustomId,
  DUNGEON_MAP_ACTIONS,
  toggleDungeonDebugFlag
} = require("./dungeonMapView");
const { listAvailableRaces, getRaceOptions } = require("../../world-system/src/character/rules/raceRules");
const { listAvailableClasses, getClassOptions, getClassData } = require("../../world-system/src/character/rules/classRules");

// Load variables from root .env file.
dotenv.config({
  path: path.resolve(__dirname, "../../../.env")
});

const ABILITY_FIELDS = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const START_SESSION_TTL_MS = 30 * 60 * 1000;
const INVENTORY_VIEW_TTL_MS = 15 * 60 * 1000;
const PROFILE_VIEW_TTL_MS = 15 * 60 * 1000;
const SHOP_VIEW_TTL_MS = 15 * 60 * 1000;
const CRAFT_VIEW_TTL_MS = 15 * 60 * 1000;
const TRADE_VIEW_TTL_MS = 15 * 60 * 1000;
const TRADE_PROPOSAL_VIEW_TTL_MS = 15 * 60 * 1000;
const COMBAT_MAP_VIEW_TTL_MS = 15 * 60 * 1000;
const DUNGEON_MAP_VIEW_TTL_MS = 15 * 60 * 1000;
const DUNGEON_OBJECT_BUTTON_LIMIT = 5;
const POINT_BUY_COST_BY_SCORE = Object.freeze({ 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 });
const CUSTOM_IDS = {
  raceSelect: "start:race",
  classSelect: "start:class_primary",
  secondaryClassSelect: "start:class_secondary",
  raceOptionSelect: "start:race_option",
  classOptionSelect: "start:class_option_primary",
  secondaryClassOptionSelect: "start:class_option_secondary",
  pointBuyButton: "start:point_buy",
  pointBuyAbilitySelect: "start:point_buy_ability",
  pointBuyDecrease: "start:point_buy_decrease",
  pointBuyIncrease: "start:point_buy_increase",
  pointBuyResetAbility: "start:point_buy_reset_ability",
  pointBuyResetAll: "start:point_buy_reset_all",
  pointBuyConfirm: "start:point_buy_confirm",
  pointBuyBack: "start:point_buy_back",
  createButton: "start:create",
  profileOpenInventory: "profile:view:inventory",
  inventoryBackToProfile: "inventory:view:profile",
  inventorySummary: "inventory:view:summary",
  inventoryEquipment: "inventory:view:equipment",
  inventoryMagical: "inventory:view:magical",
  inventoryEquip: "inventory:view:equip",
  inventoryUnequip: "inventory:view:unequip",
  inventoryUse: "inventory:view:use",
  inventoryIdentify: "inventory:view:identify",
  inventoryAttune: "inventory:view:attune",
  inventoryUnattune: "inventory:view:unattune",
  shopRefresh: "shop:view:refresh",
  shopVendorBrowse: "shop:view:browse",
  craftRefresh: "craft:view:refresh",
  craftFilter: "craft:view:filter",
  tradeRefresh: "trade:view:refresh",
  tradeBack: "trade:view:back",
  tradeProposalItemSelect: "trade:proposal:item",
  tradeProposalQuantitySelect: "trade:proposal:quantity",
  tradeProposalGoldSelect: "trade:proposal:gold",
  tradeProposalSubmit: "trade:proposal:submit",
  tradeProposalCancel: "trade:proposal:cancel",
  combatRefresh: "combat:view:refresh",
  combatReady: "combat:view:ready",
  combatDodge: "combat:view:dodge",
  combatDash: "combat:view:dash",
  combatDisengage: "combat:view:disengage",
  economyNavShop: "economy:view:shop",
  economyNavCraft: "economy:view:craft",
  economyNavTrade: "economy:view:trade"
};

const startSessions = new Map();
const inventoryViews = new Map();
const profileViews = new Map();
const shopViews = new Map();
const craftViews = new Map();
const tradeViews = new Map();
const tradeProposalViews = new Map();
const combatMapViews = new Map();
const dungeonMapViews = new Map();
let raceCatalogCache = null;
let classCatalogCache = null;

function nowMs() {
  return Date.now();
}

function cleanText(value, fallback) {
  const safe = String(value || "").trim();
  return safe === "" ? fallback || "Unknown" : safe;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function humanizeIdentifier(value, fallback) {
  const safe = String(value || "").trim();
  if (!safe) {
    return fallback || "Unknown";
  }
  return safe
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeSelection(value) {
  return String(value || "").trim().toLowerCase();
}

function abbreviate(value, limit) {
  const safe = String(value || "").trim();
  if (safe.length <= limit) return safe;
  return safe.slice(0, Math.max(0, limit - 3)) + "...";
}

function pruneSessions() {
  const cutoff = nowMs() - START_SESSION_TTL_MS;
  for (const [userId, session] of startSessions.entries()) {
    if (!session || session.expiresAt < cutoff) {
      startSessions.delete(userId);
    }
  }
}

function pruneInventoryViews() {
  const cutoff = nowMs() - INVENTORY_VIEW_TTL_MS;
  for (const [userId, session] of inventoryViews.entries()) {
    if (!session || session.expiresAt < cutoff) {
      inventoryViews.delete(userId);
    }
  }
}

function pruneProfileViews() {
  const cutoff = nowMs() - PROFILE_VIEW_TTL_MS;
  for (const [userId, session] of profileViews.entries()) {
    if (!session || session.expiresAt < cutoff) {
      profileViews.delete(userId);
    }
  }
}

function pruneShopViews() {
  const cutoff = nowMs() - SHOP_VIEW_TTL_MS;
  for (const [userId, session] of shopViews.entries()) {
    if (!session || session.expiresAt < cutoff) {
      shopViews.delete(userId);
    }
  }
}

function pruneCraftViews() {
  const cutoff = nowMs() - CRAFT_VIEW_TTL_MS;
  for (const [userId, session] of craftViews.entries()) {
    if (!session || session.expiresAt < cutoff) {
      craftViews.delete(userId);
    }
  }
}

function pruneTradeViews() {
  const cutoff = nowMs() - TRADE_VIEW_TTL_MS;
  for (const [userId, session] of tradeViews.entries()) {
    if (!session || session.expiresAt < cutoff) {
      tradeViews.delete(userId);
    }
  }
}

function pruneTradeProposalViews() {
  const cutoff = nowMs() - TRADE_PROPOSAL_VIEW_TTL_MS;
  for (const [userId, session] of tradeProposalViews.entries()) {
    if (!session || session.expiresAt < cutoff) {
      tradeProposalViews.delete(userId);
    }
  }
}

function buildCombatMapViewKey(userId, combatId) {
  return `${String(userId || "").trim()}:${String(combatId || "").trim()}`;
}

function buildDungeonMapViewKey(userId, sessionId) {
  return `${String(userId || "").trim()}:${String(sessionId || "").trim()}`;
}

function pruneCombatMapViews() {
  const cutoff = nowMs() - COMBAT_MAP_VIEW_TTL_MS;
  for (const [key, view] of combatMapViews.entries()) {
    if (!view || view.expiresAt < cutoff) {
      combatMapViews.delete(key);
    }
  }
}

function getCombatMapView(userId, combatId) {
  pruneCombatMapViews();
  return combatMapViews.get(buildCombatMapViewKey(userId, combatId)) || null;
}

function setCombatMapView(userId, combatId, view) {
  const key = buildCombatMapViewKey(userId, combatId);
  if (!key || key === ":") {
    return;
  }
  combatMapViews.set(key, Object.assign({}, view, {
    expiresAt: nowMs() + COMBAT_MAP_VIEW_TTL_MS
  }));
}

function pruneDungeonMapViews() {
  const cutoff = nowMs() - DUNGEON_MAP_VIEW_TTL_MS;
  for (const [key, view] of dungeonMapViews.entries()) {
    if (!view || view.expiresAt < cutoff) {
      dungeonMapViews.delete(key);
    }
  }
}

function getDungeonMapView(userId, sessionId) {
  pruneDungeonMapViews();
  return dungeonMapViews.get(buildDungeonMapViewKey(userId, sessionId)) || null;
}

function setDungeonMapView(userId, sessionId, view) {
  const key = buildDungeonMapViewKey(userId, sessionId);
  if (!key || key === ":") {
    return;
  }
  dungeonMapViews.set(key, Object.assign({}, view, {
    expiresAt: nowMs() + DUNGEON_MAP_VIEW_TTL_MS
  }));
}

function getStartSession(userId) {
  pruneSessions();
  return startSessions.get(String(userId || "").trim()) || null;
}

function setStartSession(userId, session) {
  const safeUser = String(userId || "").trim();
  if (!safeUser) return;
  startSessions.set(safeUser, Object.assign({}, session, {
    user_id: safeUser,
    expiresAt: nowMs() + START_SESSION_TTL_MS
  }));
}

function deleteStartSession(userId) {
  startSessions.delete(String(userId || "").trim());
}

function getInventoryView(userId) {
  pruneInventoryViews();
  return inventoryViews.get(String(userId || "").trim()) || null;
}

function setInventoryView(userId, view) {
  const safeUser = String(userId || "").trim();
  if (!safeUser) return;
  inventoryViews.set(safeUser, Object.assign({}, view, {
    user_id: safeUser,
    expiresAt: nowMs() + INVENTORY_VIEW_TTL_MS
  }));
}

function getProfileView(userId) {
  pruneProfileViews();
  return profileViews.get(String(userId || "").trim()) || null;
}

function setProfileView(userId, view) {
  const safeUser = String(userId || "").trim();
  if (!safeUser) return;
  profileViews.set(safeUser, Object.assign({}, view, {
    user_id: safeUser,
    expiresAt: nowMs() + PROFILE_VIEW_TTL_MS
  }));
}

function getShopView(userId) {
  pruneShopViews();
  return shopViews.get(String(userId || "").trim()) || null;
}

function setShopView(userId, view) {
  const safeUser = String(userId || "").trim();
  if (!safeUser) return;
  shopViews.set(safeUser, Object.assign({}, view, {
    user_id: safeUser,
    expiresAt: nowMs() + SHOP_VIEW_TTL_MS
  }));
}

function getCraftView(userId) {
  pruneCraftViews();
  return craftViews.get(String(userId || "").trim()) || null;
}

function setCraftView(userId, view) {
  const safeUser = String(userId || "").trim();
  if (!safeUser) return;
  craftViews.set(safeUser, Object.assign({}, view, {
    user_id: safeUser,
    expiresAt: nowMs() + CRAFT_VIEW_TTL_MS
  }));
}

function getTradeView(userId) {
  pruneTradeViews();
  return tradeViews.get(String(userId || "").trim()) || null;
}

function setTradeView(userId, view) {
  const safeUser = String(userId || "").trim();
  if (!safeUser) return;
  tradeViews.set(safeUser, Object.assign({}, view, {
    user_id: safeUser,
    expiresAt: nowMs() + TRADE_VIEW_TTL_MS
  }));
}

function getTradeProposalView(userId) {
  pruneTradeProposalViews();
  return tradeProposalViews.get(String(userId || "").trim()) || null;
}

function setTradeProposalView(userId, view) {
  const safeUser = String(userId || "").trim();
  if (!safeUser) return;
  tradeProposalViews.set(safeUser, Object.assign({}, view, {
    user_id: safeUser,
    expiresAt: nowMs() + TRADE_PROPOSAL_VIEW_TTL_MS
  }));
}

function deleteTradeProposalView(userId) {
  tradeProposalViews.delete(String(userId || "").trim());
}

function loadRaces() {
  if (raceCatalogCache) {
    return raceCatalogCache;
  }

  const out = listAvailableRaces();
  const races = Array.isArray(out.payload && out.payload.races) ? out.payload.races : [];
  raceCatalogCache = races
    .map((entry) => (entry && typeof entry === "object" ? entry : {}))
    .filter((entry) => Boolean(normalizeSelection(entry.id)))
    .map((entry) => ({
      id: normalizeSelection(entry.id),
      name: cleanText(entry.name || entry.id, "Unknown Race"),
      source: cleanText((entry.metadata && entry.metadata.source) || "", "SRD 5.1"),
      stat_modifiers: entry.stat_modifiers || {},
      notes: Array.isArray(entry.metadata && entry.metadata.notes) ? entry.metadata.notes : [],
      features: Array.isArray(entry.features) ? entry.features : []
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return raceCatalogCache;
}

function loadClasses() {
  if (classCatalogCache) {
    return classCatalogCache;
  }

  const out = listAvailableClasses();
  const classes = Array.isArray(out.payload && out.payload.classes) ? out.payload.classes : [];
  classCatalogCache = classes
    .map((entry) => (entry && typeof entry === "object" ? entry : {}))
    .filter((entry) => Boolean(normalizeSelection(entry.id)))
    .map((entry) => ({
      id: normalizeSelection(entry.id),
      name: cleanText(entry.name || entry.id, "Unknown Class"),
      source: cleanText((entry.metadata && entry.metadata.source) || "", "SRD 5.1"),
      stat_modifiers: entry.stat_modifiers || {},
      notes: Array.isArray(entry.metadata && entry.metadata.notes) ? entry.metadata.notes : [],
      primary: Array.isArray(entry.metadata && entry.metadata.primary_abilities)
        ? entry.metadata.primary_abilities
        : []
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return classCatalogCache;
}

function getRaceById(raceId) {
  const target = normalizeSelection(raceId);
  const list = loadRaces();
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].id === target) {
      return list[i];
    }
  }
  return null;
}

function getClassById(classId) {
  const target = normalizeSelection(classId);
  const list = loadClasses();
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].id === target) {
      return list[i];
    }
  }
  return null;
}

function getClassSubclassUnlockLevel(classId) {
  const out = getClassData(classId);
  if (!out.ok) {
    return 3;
  }
  const metadata = out.payload && out.payload.class_data && out.payload.class_data.metadata
    ? out.payload.class_data.metadata
    : {};
  const level = Number(metadata.subclass_unlock_level);
  return Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 3;
}

function classNeedsOptionAtStart(classId) {
  return Boolean(classId) && getClassSubclassUnlockLevel(classId) <= 1;
}

function formatStatLine(stats) {
  const safe = stats && typeof stats === "object" ? stats : {};
  const parts = [];
  for (let i = 0; i < ABILITY_FIELDS.length; i += 1) {
    const ability = ABILITY_FIELDS[i];
    const raw = safe[ability];
    const value = Number.isFinite(Number(raw)) ? Math.floor(Number(raw)) : 10;
    parts.push(`${ability}: ${value}`);
  }
  return parts.join(" | ");
}

function formatPosition(position) {
  if (!position || typeof position !== "object") {
    return "(unknown)";
  }
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return "(unknown)";
  }
  return `(${Math.floor(x)}, ${Math.floor(y)})`;
}

function summarizeAiTurns(aiTurns, combatSummary) {
  const list = Array.isArray(aiTurns) ? aiTurns : [];
  if (list.length === 0) {
    return "";
  }
  return list.map((entry) => {
    const actor = resolveCombatParticipantReferenceLabel(
      combatSummary,
      cleanText(entry && entry.actor_id, ""),
      { include_marker: false }
    ) || cleanText(entry && entry.actor_id, "unknown");
    const actionType = cleanText(entry && entry.action_type, "wait");
    if (actionType === "attack") {
      const target = resolveCombatParticipantReferenceLabel(
        combatSummary,
        cleanText(entry && entry.target_id, ""),
        { include_marker: false }
      ) || cleanText(entry && entry.target_id, "unknown");
      return `${actor} attacked ${target}`;
    }
    if (actionType === "move") {
      const move = entry && entry.move ? entry.move : {};
      return `${actor} moved ${formatPosition(move.from_position)} -> ${formatPosition(move.to_position)}`;
    }
    if (actionType === "cast") {
      const target = resolveCombatParticipantReferenceLabel(
        combatSummary,
        cleanText(entry && entry.target_id, ""),
        { include_marker: false }
      ) || cleanText(entry && entry.target_id, "unknown");
      return `${actor} cast on ${target}`;
    }
    return `${actor} held position`;
  }).join(" | ");
}

function summarizeInventoryPreview(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) {
    return "(none)";
  }
  return list.map((entry) => {
    const safe = entry && typeof entry === "object" ? entry : {};
    const name = cleanText(safe.item_name, safe.item_id || "unknown");
    const quantity = Number.isFinite(Number(safe.quantity)) ? Number(safe.quantity) : null;
    const tags = [];
    if (safe.equipped === true) {
      tags.push(`equipped${safe.equipped_slot ? `:${cleanText(safe.equipped_slot, "slot")}` : ""}`);
    }
    if (safe.attuned === true) {
      tags.push("attuned");
    }
    if (safe.unidentified === true) {
      tags.push("sealed");
    }
    if (safe.magical === true || safe.requires_attunement === true) {
      tags.push("arcane");
    }
    const suffix = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
    const label = quantity && quantity > 1 ? `${name} x${quantity}` : name;
    const effects = Array.isArray(safe.effect_summary) ? safe.effect_summary.filter(Boolean) : [];
    const effectSuffix = effects.length > 0 ? ` - ${effects.slice(0, 2).join(", ")}` : "";
    return `${label}${suffix}${effectSuffix}`;
  }).join(" | ");
}

function summarizeTargetSelection(data, combatSummary) {
  const safe = data && typeof data === "object" ? data : {};
  const targetIds = Array.isArray(safe.target_ids) ? safe.target_ids.filter(Boolean) : [];
  if (targetIds.length > 1) {
    return targetIds
      .map((entry) => resolveCombatParticipantReferenceLabel(combatSummary, entry, { include_marker: false }) || cleanText(entry, "unknown"))
      .join(", ");
  }
  return resolveCombatParticipantReferenceLabel(combatSummary, safe.target_id, { include_marker: false }) || cleanText(safe.target_id, "(none)");
}

function summarizeRoomExits(exits) {
  const list = Array.isArray(exits) ? exits : [];
  if (list.length === 0) {
    return "(none)";
  }
  const summary = list.map((entry) => {
    const direction = cleanText(entry && entry.direction, "unknown");
    const target = cleanText(entry && entry.to_room_id, "unknown");
    const locked = entry && entry.locked === true ? " [locked]" : "";
    return `${direction} -> ${target}${locked}`;
  }).join(" | ");
  return `${summary} • routes available`;
}

function summarizeVisibleRoomObjects(objects) {
  const list = Array.isArray(objects) ? objects : [];
  if (list.length === 0) {
    return "(none)";
  }
  return list.map((entry) => {
    const safe = entry && typeof entry === "object" ? entry : {};
    const state = safe.state && typeof safe.state === "object" ? safe.state : {};
    const flags = [];
    if (state.is_locked) flags.push("locked");
    if (state.is_opened) flags.push("opened");
    if (state.is_disarmed) flags.push("disarmed");
    if (state.is_lit) flags.push("lit");
    if (state.is_activated) flags.push("activated");
    const label = cleanText(safe.name, safe.object_id || "object");
    const type = cleanText(safe.object_type, "object");
    let flavor = "";
    if (type === "door") {
      flavor = state.is_opened ? "way forward exposed" : state.is_locked ? "sealed way forward" : "a barrier on the path";
    } else if (type === "chest") {
      flavor = state.is_opened ? "contents already claimed" : state.is_locked ? "sealed cache" : "a cache waiting to be opened";
    } else if (type === "lore_object") {
      flavor = "something worth reading";
    } else if (type === "shrine") {
      flavor = "a place of old power";
    } else if (type === "trap") {
      flavor = state.is_disarmed ? "hazard neutralized" : "hazard still armed";
    }
    const base = flags.length > 0 ? `${label} [${type}; ${flags.join(", ")}]` : `${label} [${type}]`;
    return flavor ? `${base} - ${flavor}` : base;
  }).join(" | ");
}

function summarizeInteractionEffects(effects) {
  const list = Array.isArray(effects) ? effects : [];
  if (list.length === 0) {
    return [];
  }
  return list.slice(0, 4).map((entry) => {
    const safe = entry && typeof entry === "object" ? entry : {};
    const type = cleanText(safe.effect_type, "");
    if (type === "blessing_granted") {
      return `Blessing: ${cleanText(safe.blessing_key, "unknown blessing")}`;
    }
    if (type === "lore_discovered") {
      return `Discovery: ${cleanText(safe.discovery_key, "unknown lore")}`;
    }
    if (type === "room_revealed") {
      return `Revealed: ${cleanText(safe.room_id, "unknown room")}`;
    }
    if (type === "movement_lock_cleared") {
      return "Path unsealed";
    }
    if (type === "linked_object_opened") {
      return `Mechanism: opened ${cleanText(safe.object_id, "linked object")}`;
    }
    if (type === "skill_check_passed") {
      return `Check passed: ${cleanText(safe.skill_id || safe.ability_id || safe.tool_id, "unknown")}`;
    }
    return cleanText(type, "effect");
  });
}

function summarizeSpellEffect(spellEffect) {
  const safe = spellEffect && typeof spellEffect === "object" ? spellEffect : null;
  if (!safe) {
    return [];
  }
  const lines = [
    `Spell Effect: ${cleanText(safe.spell_name, humanizeIdentifier(safe.spell_id, "Unknown Spell"))}`
  ];
  if (safe.aura_summary) {
    lines.push(`Aura: ${cleanText(safe.aura_summary, "unknown aura")}`);
  }
  if (safe.identified_item_name || safe.identified_item_id) {
    lines.push(`Identified: ${cleanText(safe.identified_item_name, safe.identified_item_id || "unknown item")}`);
  }
  if (safe.object_state) {
    lines.push(`Effect State: ${humanizeIdentifier(safe.object_state, "Changed")}`);
  }
  return lines;
}

function summarizeSkillCheck(skillCheck) {
  const safe = skillCheck && typeof skillCheck === "object" ? skillCheck : null;
  if (!safe) {
    return [];
  }
  const label = cleanText(safe.skill_id || safe.tool_id || safe.ability_id, "unknown check");
  const result = safe.passed === true ? "passed" : "failed";
  const total = Number.isFinite(Number(safe.total)) ? Number(safe.total) : null;
  const dc = Number.isFinite(Number(safe.dc)) ? Number(safe.dc) : null;
  return [
    `Check: ${label} ${result}${total !== null ? ` (${total}` : ""}${dc !== null ? ` vs DC ${dc}` : ""}${total !== null ? ")" : ""}`
  ];
}

function getInventoryPreviewEntries(inventory) {
  const safe = inventory && typeof inventory === "object" ? inventory : {};
  const buckets = [
    safe.equipment_preview,
    safe.stackable_preview,
    safe.quest_preview,
    safe.magical_preview,
    safe.unidentified_preview,
    safe.tradeable_items
  ];
  return buckets.flatMap((entries) => Array.isArray(entries) ? entries : []);
}

function resolveInventoryItemName(inventory, itemId) {
  const target = cleanText(itemId, "");
  if (!target) {
    return "unknown item";
  }
  const entries = getInventoryPreviewEntries(inventory);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] && typeof entries[index] === "object" ? entries[index] : {};
    if (cleanText(entry.item_id, "") === target) {
      return cleanText(entry.item_name, humanizeIdentifier(target, target));
    }
  }
  return humanizeIdentifier(target, target);
}

function summarizeAttunedLinks(inventory) {
  const safe = inventory && typeof inventory === "object" ? inventory : {};
  const items = Array.isArray(safe.attuned_items) ? safe.attuned_items : [];
  if (items.length === 0) {
    return "(none)";
  }
  return items.map((itemId) => `\`${resolveInventoryItemName(safe, itemId)}\` • resonating`).join("\n");
}

function summarizeRoomForReply(room) {
  const safe = room && typeof room === "object" ? room : null;
  if (!safe) {
    return [];
  }
  return [
    `Room: ${cleanText(safe.name, safe.room_id || "unknown")}`,
    `Type: ${cleanText(safe.room_type, "unknown")}`,
    safe.description ? `Scene: ${cleanText(safe.description, "")}` : null,
    `Exits: ${summarizeRoomExits(safe.exits)}`,
    `Objects: ${summarizeVisibleRoomObjects(safe.visible_objects)}`
  ].filter(Boolean);
}

function getDefaultDungeonObjectAction(entry) {
  const safe = entry && typeof entry === "object" ? entry : {};
  const state = safe.state && typeof safe.state === "object" ? safe.state : {};
  const normalized = String(safe.object_type || "").trim().toLowerCase();
  if (normalized === "door" || normalized === "chest") {
    if (state.is_locked) {
      return "unlock";
    }
    if (!state.is_opened) {
      return "open";
    }
    return "use";
  }
  if (normalized === "trap") {
    return state.is_disarmed ? "use" : "disarm";
  }
  if (normalized === "lore_object") {
    return "read";
  }
  if (normalized === "lever") {
    return "activate";
  }
  return "use";
}

function getDungeonObjectActions(entry) {
  const safe = entry && typeof entry === "object" ? entry : {};
  const state = safe.state && typeof safe.state === "object" ? safe.state : {};
  const normalized = String(safe.object_type || "").trim().toLowerCase();

  if (normalized === "door" || normalized === "chest") {
    const actions = [];
    if (state.is_locked) {
      actions.push("unlock");
    }
    if (!state.is_opened) {
      actions.push("open");
    }
    if (actions.length === 0) {
      actions.push("use");
    }
    return actions;
  }

  if (normalized === "trap") {
    return state.is_disarmed ? ["use"] : ["disarm"];
  }

  if (normalized === "lore_object") {
    return ["read"];
  }

  if (normalized === "lever") {
    return ["activate"];
  }

  if (normalized === "shrine") {
    return ["activate", "use"];
  }

  return [getDefaultDungeonObjectAction(entry)];
}

function getDungeonObjectActionLabel(entry) {
  const action = cleanText(entry && entry.__action, "") || getDefaultDungeonObjectAction(entry);
  const safe = entry && typeof entry === "object" ? entry : {};
  const label = cleanText(safe.name, safe.object_id || "object");
  switch (action) {
    case "unlock":
      return `Unlock ${abbreviate(label, 18)}`;
    case "open":
      return `Open ${abbreviate(label, 20)}`;
    case "disarm":
      return `Disarm ${abbreviate(label, 18)}`;
    case "read":
      return `Read ${abbreviate(label, 20)}`;
    case "activate":
      return `Activate ${abbreviate(label, 16)}`;
    default:
      return abbreviate(label, 24);
  }
}

function buildDungeonRoomComponents(data) {
  const safe = data && typeof data === "object" ? data : {};
  const sessionId = cleanText(safe.session_id || (safe.session && safe.session.session_id), "");
  const room = safe.room && typeof safe.room === "object" ? safe.room : null;
  if (!sessionId || !room) {
    return [];
  }

  const rows = [];
  const exits = Array.isArray(room.exits) ? room.exits : [];
  if (exits.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        exits.slice(0, 5).map((entry) =>
          new ButtonBuilder()
            .setCustomId(`dungeon:view:move:${sessionId}:${cleanText(entry && entry.direction, "unknown")}`)
            .setLabel(cleanText(entry && entry.direction, "move"))
            .setStyle(ButtonStyle.Primary)
        )
      )
    );
  }

  const visibleObjects = Array.isArray(room.visible_objects) ? room.visible_objects : [];
  const objectButtons = [];
  visibleObjects
    .slice(0, DUNGEON_OBJECT_BUTTON_LIMIT)
    .forEach((entry) => {
      const actions = getDungeonObjectActions(entry).slice(0, 2);
      actions.forEach((action) => {
        objectButtons.push(
          new ButtonBuilder()
            .setCustomId(
              `dungeon:view:object:${sessionId}:${cleanText(entry && entry.object_id, "unknown")}:${action}`
            )
            .setLabel(getDungeonObjectActionLabel(Object.assign({}, entry, { __action: action })))
            .setStyle(action === "unlock" || action === "disarm" ? ButtonStyle.Danger : ButtonStyle.Secondary)
        );
      });
    });
  if (objectButtons.length > 0) {
    for (let index = 0; index < objectButtons.length; index += 5) {
      rows.push(new ActionRowBuilder().addComponents(objectButtons.slice(index, index + 5)));
    }
  }

  return rows;
}

function buildAbilityScoreBlock(stats) {
  const safe = stats && typeof stats === "object" ? stats : {};
  return ABILITY_FIELDS.map((ability) => {
    const short = ability.slice(0, 3).toUpperCase();
    const value = Number.isFinite(Number(safe[ability])) ? Number(safe[ability]) : 10;
    return `${short} ${value}`;
  }).join("  |  ");
}

function formatModifier(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "+0";
  }
  return number >= 0 ? `+${number}` : String(number);
}

function buildSaveSummary(savingThrows) {
  const safe = savingThrows && typeof savingThrows === "object" ? savingThrows : {};
  const labels = [
    ["strength", "STR"],
    ["dexterity", "DEX"],
    ["constitution", "CON"],
    ["intelligence", "INT"],
    ["wisdom", "WIS"],
    ["charisma", "CHA"]
  ];
  return labels.map(([key, label]) => `${label} ${formatModifier(safe[key])}`).join("  |  ");
}

function summarizeFeatPreview(feats) {
  const safeFeats = Array.isArray(feats) ? feats : [];
  if (safeFeats.length === 0) {
    return "(none)";
  }
  return safeFeats
    .slice(0, 4)
    .map((entry) => {
      if (entry && typeof entry === "object") {
        return cleanText(entry.name, entry.feat_id || "unknown");
      }
      return cleanText(entry, "unknown");
    })
    .join(", ");
}

function summarizeItemEffects(itemEffects) {
  const safe = itemEffects && typeof itemEffects === "object" ? itemEffects : {};
  const lines = [];
  const acBonus = Number(safe.armor_class_bonus);
  const saveBonus = Number(safe.saving_throw_bonus);
  const spellDcBonus = Number(safe.spell_save_dc_bonus);
  const spellAttackBonus = Number(safe.spell_attack_bonus);
  const speedBonus = Number(safe.speed_bonus);
  const resistances = Array.isArray(safe.resistances) ? safe.resistances : [];
  const activeNames = Array.isArray(safe.active_item_names) ? safe.active_item_names : [];

  if (Number.isFinite(acBonus) && acBonus !== 0) {
    lines.push(`AC Ward: +${acBonus}`);
  }
  if (Number.isFinite(saveBonus) && saveBonus !== 0) {
    lines.push(`Saves: +${saveBonus}`);
  }
  if (Number.isFinite(spellDcBonus) && spellDcBonus !== 0) {
    lines.push(`Spell DC: +${spellDcBonus}`);
  }
  if (Number.isFinite(spellAttackBonus) && spellAttackBonus !== 0) {
    lines.push(`Spell Attack: +${spellAttackBonus}`);
  }
  if (Number.isFinite(speedBonus) && speedBonus !== 0) {
    lines.push(`Speed: +${speedBonus} ft`);
  }
  if (resistances.length > 0) {
    lines.push(`Resists: ${resistances.map((entry) => humanizeIdentifier(entry, entry)).join(", ")}`);
  }
  if (activeNames.length > 0) {
    lines.push(`Sources: ${activeNames.slice(0, 3).join(", ")}`);
  }

  return lines.length > 0 ? lines.join("\n") : "No active magical item effects";
}

function toDisplayTag(value, fallback) {
  const safe = cleanText(value, fallback || "(none)");
  return safe === "(none)" ? safe : `\`${safe}\``;
}

function buildProfileEmbed(data) {
  const character = data.character || {};
  const attunement = character.attunement && typeof character.attunement === "object" ? character.attunement : {};
  const knownSpellIds = character.spellbook && Array.isArray(character.spellbook.known_spell_ids)
    ? character.spellbook.known_spell_ids
    : [];
  const feats = Array.isArray(character.feats) ? character.feats : [];
  const featSlots = character.feat_slots && typeof character.feat_slots === "object" ? character.feat_slots : {};
  const hp = character.hp_summary && typeof character.hp_summary === "object" ? character.hp_summary : {};
  const title = `${cleanText(character.name, "Unknown Adventurer")} | Hunter Record`;
  const subtitle = [
    cleanText(character.race, character.race_id || "Unknown"),
    `Lv.${Number.isFinite(Number(character.level)) ? Number(character.level) : 1}`,
    `XP ${Number.isFinite(Number(character.xp)) ? Number(character.xp) : 0}`
  ].join(" • ");
  return new EmbedBuilder()
    .setColor(0xc97f2d)
    .setTitle(title)
    .setDescription(subtitle)
    .addFields(
      {
        name: "Path",
        value: [
          `Track A: ${toDisplayTag(character.class, character.class_id || "unknown")}`,
          `Track A Subclass: ${toDisplayTag(character.class_option_id, "(none)")}`,
          `Track B: ${toDisplayTag(character.secondary_class_id, "(none)")}`,
          `Track B Subclass: ${toDisplayTag(character.secondary_class_option_id, "(none)")}`
        ].join("\n"),
        inline: true
      },
      {
        name: "Arcana",
        value: [
          `Known Spells: ${knownSpellIds.length}`,
          `Feats: ${feats.length}`,
          `Feat Slots: ${Number.isFinite(Number(featSlots.used_slots)) ? Number(featSlots.used_slots) : 0}/${Number.isFinite(Number(featSlots.total_slots)) ? Number(featSlots.total_slots) : 0}`,
          `Attunement: ${Number.isFinite(Number(attunement.slots_used)) ? Number(attunement.slots_used) : 0}/${Number.isFinite(Number(attunement.attunement_slots)) ? Number(attunement.attunement_slots) : 3}`,
          `Save DC: ${character.spellsave_dc === null || character.spellsave_dc === undefined ? "(none)" : character.spellsave_dc}`,
          `Inventory: ${toDisplayTag(character.inventory_id, "(none)")}`
        ].join("\n"),
        inline: true
      },
      {
        name: "Combat Core",
        value: [
          `HP: ${Number.isFinite(Number(hp.current)) ? Number(hp.current) : 10}/${Number.isFinite(Number(hp.max)) ? Number(hp.max) : 10}${Number.isFinite(Number(hp.temporary)) && Number(hp.temporary) > 0 ? ` (+${Number(hp.temporary)} temp)` : ""}`,
          `AC: ${Number.isFinite(Number(character.armor_class)) ? Number(character.armor_class) : 10}`,
          `Speed: ${Number.isFinite(Number(character.speed)) ? Number(character.speed) : 30} ft`,
          `Prof: ${formatModifier(character.proficiency_bonus)}`,
          `Init: ${formatModifier(character.initiative)}`
        ].join("\n"),
        inline: true
      },
      {
        name: "Saving Throws",
        value: buildSaveSummary(character.saving_throws),
        inline: false
      },
      {
        name: "Origin Stats",
        value: buildAbilityScoreBlock(character.base_stats || {}),
        inline: false
      },
      {
        name: "Current Stats",
        value: buildAbilityScoreBlock(character.stats || {}),
        inline: false
      }
    )
    .addFields(
      {
        name: "Origin",
        value: [
          `Background: ${toDisplayTag(character.background, "unknown")}`,
          `Spellcasting: ${toDisplayTag(character.spellcasting_ability, "(none)")}`,
          `Feats: ${summarizeFeatPreview(feats)}`
        ].join("\n"),
        inline: false
      },
      {
        name: "Relic Resonance",
        value: summarizeItemEffects(character.item_effects),
        inline: false
      }
    )
    .setFooter({ text: "System Registry • Isekai Adventurer Sheet" });
}

function buildInventoryEmbed(data) {
  const inventory = data.inventory || {};
  const currency = inventory.currency && typeof inventory.currency === "object" ? inventory.currency : {};
  return new EmbedBuilder()
    .setColor(0x2d8f6f)
    .setTitle("Dimensional Pack")
    .setDescription(`Inventory ${toDisplayTag(inventory.inventory_id, "unknown")} • field-ready storage and relic seal log`)
    .addFields(
      {
        name: "Ledger",
        value: [
          `Gold: ${Number.isFinite(Number(currency.gold)) ? Number(currency.gold) : 0}`,
          `Stackables: ${Number.isFinite(Number(inventory.stackable_count)) ? Number(inventory.stackable_count) : 0}`,
          `Equipment: ${Number.isFinite(Number(inventory.equipment_count)) ? Number(inventory.equipment_count) : 0}`,
          `Quest Items: ${Number.isFinite(Number(inventory.quest_count)) ? Number(inventory.quest_count) : 0}`
        ].join("\n"),
        inline: true
      },
      {
        name: "Arcane Flags",
        value: [
          `Magical: ${Number.isFinite(Number(inventory.magical_count)) ? Number(inventory.magical_count) : 0}`,
          `Unidentified: ${Number.isFinite(Number(inventory.unidentified_count)) ? Number(inventory.unidentified_count) : 0}`,
          `Attuned: ${Number.isFinite(Number(inventory.attuned_count)) ? Number(inventory.attuned_count) : 0}/${Number.isFinite(Number(inventory.attunement_slots)) ? Number(inventory.attunement_slots) : 3}`
        ].join("\n"),
        inline: true
      },
      {
        name: "Equipped Cache",
        value: summarizeInventoryPreview(inventory.equipment_preview),
        inline: false
      },
      {
        name: "Supply Cache",
        value: summarizeInventoryPreview(inventory.stackable_preview),
        inline: false
      }
    )
    .setFooter({ text: "Portable Storage Manifest" });
}

function buildInventoryDetailEmbed(data, tab) {
  const inventory = data && data.inventory && typeof data.inventory === "object" ? data.inventory : {};
  const selectedTab = String(tab || "summary");
  if (selectedTab === "equipment") {
    return new EmbedBuilder()
      .setColor(0x2d6d8f)
      .setTitle("Dimensional Pack | Equipment")
      .setDescription(`Inventory ${toDisplayTag(inventory.inventory_id, "unknown")} • arms, armor, and expedition gear`)
      .addFields(
        {
          name: "Equipped Cache",
          value: summarizeInventoryPreview(inventory.equipment_preview),
          inline: false
        },
        {
          name: "Quest Cache",
          value: summarizeInventoryPreview(inventory.quest_preview),
          inline: false
        },
        {
          name: "Field Readiness",
          value: "Use this tab to keep the active loadout clear before you step into a fight.",
          inline: false
        }
      )
      .setFooter({ text: "Armaments and relics" });
  }

  if (selectedTab === "magical") {
    return new EmbedBuilder()
      .setColor(0x7a4acb)
      .setTitle("Dimensional Pack | Arcane Ledger")
      .setDescription(`Inventory ${toDisplayTag(inventory.inventory_id, "unknown")} • relic resonance, seals, and attunement drift`)
      .addFields(
        {
          name: "Magical Cache",
          value: summarizeInventoryPreview(inventory.magical_preview),
          inline: false
        },
        {
          name: "Unidentified Cache",
          value: summarizeInventoryPreview(inventory.unidentified_preview),
          inline: false
        },
        {
          name: "Attuned Links",
          value: summarizeAttunedLinks(inventory),
          inline: false
        },
        {
          name: "Arcane Read",
          value: "Sealed items need identification. Resonant items may demand attunement before their full pattern answers back.",
          inline: false
        }
      )
      .setFooter({ text: "Mystic resonance and sealed relics" });
  }

  return buildInventoryEmbed(data);
}

function buildMagicalInventoryActionButtons(data) {
  const inventory = data && data.inventory && typeof data.inventory === "object" ? data.inventory : {};
  const magical = Array.isArray(inventory.magical_preview) ? inventory.magical_preview : [];
  const unidentified = Array.isArray(inventory.unidentified_preview) ? inventory.unidentified_preview : [];
  const buttons = [];

  magical.slice(0, 3).forEach((entry) => {
    const itemId = cleanText(entry && entry.item_id, "");
    if (!itemId || entry.unidentified === true || entry.usable !== true) {
      return;
    }
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.inventoryUse}:${itemId}`)
        .setLabel(`Use ${abbreviate(cleanText(entry && entry.item_name, itemId), 20)}`)
        .setStyle(ButtonStyle.Success)
    );
  });

  unidentified.slice(0, 2).forEach((entry) => {
    const itemId = cleanText(entry && entry.item_id, "");
    if (!itemId) {
      return;
    }
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.inventoryIdentify}:${itemId}`)
        .setLabel(`Identify ${abbreviate(cleanText(entry && entry.item_name, itemId), 18)}`)
        .setStyle(ButtonStyle.Primary)
    );
  });

  magical.slice(0, 3).forEach((entry) => {
    const itemId = cleanText(entry && entry.item_id, "");
    if (!itemId || entry.unidentified === true || entry.requires_attunement !== true) {
      return;
    }
    const actionId = entry.attuned === true ? CUSTOM_IDS.inventoryUnattune : CUSTOM_IDS.inventoryAttune;
    const actionLabel = entry.attuned === true ? "Unattune" : "Attune";
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${actionId}:${itemId}`)
        .setLabel(`${actionLabel} ${abbreviate(cleanText(entry && entry.item_name, itemId), 18)}`)
        .setStyle(entry.attuned === true ? ButtonStyle.Danger : ButtonStyle.Success)
    );
  });

  return buttons.slice(0, 5);
}

function buildEquipmentInventoryActionButtons(data) {
  const inventory = data && data.inventory && typeof data.inventory === "object" ? data.inventory : {};
  const equipment = Array.isArray(inventory.equipment_preview) ? inventory.equipment_preview : [];
  const buttons = [];

  equipment.slice(0, 5).forEach((entry) => {
    const itemId = cleanText(entry && entry.item_id, "");
    if (!itemId) {
      return;
    }
    if (entry && entry.equipped === true) {
      const slot = cleanText(entry && entry.equipped_slot, "");
      if (!slot) {
        return;
      }
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_IDS.inventoryUnequip}:${slot}:${itemId}`)
          .setLabel(`Unequip ${abbreviate(cleanText(entry && entry.item_name, itemId), 18)}`)
          .setStyle(ButtonStyle.Danger)
      );
      return;
    }

    const slot = cleanText(entry && entry.equip_slot, "");
    if (!slot) {
      return;
    }
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.inventoryEquip}:${slot}:${itemId}`)
        .setLabel(`Equip ${abbreviate(cleanText(entry && entry.item_name, itemId), 20)}`)
        .setStyle(ButtonStyle.Success)
    );
  });

  return buttons.slice(0, 5);
}

function buildCombatActionEmbed(title, color, lines, footer) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(lines.filter(Boolean).join("\n"))
    .setFooter({ text: footer || "Combat Feed" });
}

function buildCombatSectionsEmbed(title, color, sections, footer) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title);
  const safeSections = Array.isArray(sections)
    ? sections
      .map((section) => ({
        name: cleanText(section && section.name, ""),
        lines: Array.isArray(section && section.lines) ? section.lines.filter(Boolean) : []
      }))
      .filter((section) => section.name && section.lines.length > 0)
    : [];

  if (safeSections.length === 0) {
    embed.setDescription("No combat details available.");
  } else {
    embed.addFields(safeSections.map((section) => ({
      name: section.name,
      value: section.lines.join("\n"),
      inline: false
    })));
  }

  return embed.setFooter({ text: footer || "Combat Feed" });
}

function buildCombatSectionsContent(sections) {
  const safeSections = Array.isArray(sections) ? sections : [];
  const blocks = safeSections.map((section) => {
    const name = cleanText(section && section.name, "");
    const lines = Array.isArray(section && section.lines) ? section.lines.filter(Boolean) : [];
    if (!name || lines.length === 0) {
      return "";
    }
    return [`${name}:`, ...lines].join("\n");
  }).filter(Boolean);

  return blocks.length > 0 ? blocks.join("\n\n") : "Combat update.";
}

function summarizeCombatParticipantsForReply(summary) {
  const participants = getOrderedCombatParticipants(summary);
  if (participants.length === 0) {
    return "(unavailable)";
  }
  return participants.map((entry) => {
    const marker = String(entry && entry.participant_id || "") === String(summary.active_participant_id || "") ? "*" : "";
    const hp = Number.isFinite(Number(entry && entry.current_hp)) && Number.isFinite(Number(entry && entry.max_hp))
      ? `${Number(entry.current_hp)}/${Number(entry.max_hp)}`
      : "?/?";
    return `${marker}${formatCombatParticipantIdentity(entry, { include_marker: true })} ${hp}`;
  }).join(" | ");
}

function formatConditionLabel(value) {
  const safe = cleanText(value, "");
  if (!safe) {
    return "Condition";
  }
  const known = {
    mage_armor: "Mage Armor",
    guiding_bolt_marked: "Guiding Bolt Mark",
    speed_reduced: "Speed Reduced",
    opportunity_attack_immunity: "Opportunity Attack Guard"
  };
  if (known[safe]) {
    return known[safe];
  }
  return safe
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getOrderedCombatParticipants(summary) {
  const participants = Array.isArray(summary && summary.participants) ? summary.participants.slice() : [];
  const initiativeOrder = Array.isArray(summary && summary.initiative_order)
    ? summary.initiative_order.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const byId = new Map();
  participants.forEach((entry) => {
    const participantId = cleanText(entry && entry.participant_id, "");
    if (participantId) {
      byId.set(participantId, entry);
    }
  });

  const ordered = [];
  initiativeOrder.forEach((participantId) => {
    if (byId.has(participantId)) {
      ordered.push(byId.get(participantId));
      byId.delete(participantId);
    }
  });

  const activeId = String(summary && summary.active_participant_id || "");
  const remaining = Array.from(byId.values()).sort((left, right) => {
    const leftId = String(left && left.participant_id || "");
    const rightId = String(right && right.participant_id || "");
    if (leftId === activeId && rightId !== activeId) return -1;
    if (rightId === activeId && leftId !== activeId) return 1;
    const leftTeam = cleanText(left && left.team, "zzz");
    const rightTeam = cleanText(right && right.team, "zzz");
    if (leftTeam !== rightTeam) {
      return leftTeam.localeCompare(rightTeam);
    }
    return leftId.localeCompare(rightId);
  });
  return ordered.concat(remaining);
}

function findCombatParticipant(summary, participantId) {
  const participants = Array.isArray(summary && summary.participants) ? summary.participants : [];
  const target = String(participantId || "");
  for (let index = 0; index < participants.length; index += 1) {
    const entry = participants[index];
    if (String(entry && entry.participant_id || "") === target) {
      return entry;
    }
  }
  return null;
}

function formatCombatMapMarker(entry) {
  const marker = String(entry && entry.map_marker || "").trim();
  return marker ? `[${marker}] ` : "";
}

function getCombatParticipantDisplayName(entry) {
  const explicit = cleanText(
    entry && (
      entry.display_name ||
      entry.name ||
      entry.character_name ||
      entry.monster_name
    ),
    ""
  );
  if (explicit) {
    return explicit;
  }
  return cleanText(entry && entry.participant_id, "unknown");
}

function resolveCombatParticipantReferenceLabel(summary, participantId, options) {
  const participant = findCombatParticipant(summary, participantId);
  if (participant) {
    return formatCombatParticipantIdentity(participant, options);
  }
  const safeId = cleanText(participantId, "");
  return safeId ? humanizeIdentifier(safeId, safeId) : "";
}

function formatCombatParticipantIdentity(entry, options) {
  const safeOptions = options && typeof options === "object" ? options : {};
  const marker = safeOptions.include_marker === false ? "" : formatCombatMapMarker(entry);
  const label = abbreviate(
    getCombatParticipantDisplayName(entry),
    Number.isFinite(Number(safeOptions.limit)) ? Number(safeOptions.limit) : 32
  );
  return `${marker}${label}`.trim();
}

function formatCombatParticipantHp(entry) {
  if (Number.isFinite(Number(entry && entry.current_hp)) && Number.isFinite(Number(entry && entry.max_hp))) {
    return `${Number(entry.current_hp)}/${Number(entry.max_hp)}`;
  }
  return "?/?";
}

function formatCombatParticipantEconomy(entry) {
  const safe = entry && typeof entry === "object" ? entry : {};
  const parts = [];

  if (typeof safe.action_available === "boolean") {
    parts.push(safe.action_available ? "Action ready" : "Action spent");
  }
  if (typeof safe.bonus_action_available === "boolean") {
    parts.push(safe.bonus_action_available ? "Bonus ready" : "Bonus spent");
  }
  if (typeof safe.reaction_available === "boolean") {
    parts.push(safe.reaction_available ? "Reaction ready" : "Reaction spent");
  }
  if (Number.isFinite(Number(safe.movement_remaining))) {
    parts.push(`Move ${Number(safe.movement_remaining)} ft`);
  }

  return parts.length > 0 ? parts.join(" | ") : "unavailable";
}

function formatCombatParticipantSpellTempo(entry) {
  const spellState = entry && entry.spellcasting_turn_state && typeof entry.spellcasting_turn_state === "object"
    ? entry.spellcasting_turn_state
    : null;
  if (!spellState) {
    return "";
  }
  return [
    spellState.bonus_action_spell_cast === true ? "Bonus spell used" : "Bonus spell open",
    spellState.action_spell_cast === true
      ? (spellState.action_spell_was_cantrip === true ? "Action cantrip cast" : "Leveled action spell cast")
      : "Action spell open"
  ].join(" | ");
}

function getCombatParticipantStatusLabels(entry) {
  const safe = entry && typeof entry === "object" ? entry : {};
  const list = Array.isArray(safe.conditions) ? safe.conditions : [];
  const labels = list.map((condition) => formatConditionLabel(condition));
  const concentration = safe.concentration && typeof safe.concentration === "object"
    ? safe.concentration
    : null;
  if (concentration && concentration.is_concentrating === true) {
    const spellLabel = cleanText(concentration.source_spell_id, "");
    labels.push(
      spellLabel
        ? `Concentrating (${humanizeIdentifier(spellLabel, "Spell")})`
        : "Concentrating"
    );
  }
  return labels;
}

function formatCombatParticipantConditions(entry) {
  const labels = getCombatParticipantStatusLabels(entry);
  return labels.length > 0 ? labels.join(", ") : "none";
}

function summarizeCombatParticipantLine(entry) {
  const parts = [
    formatCombatParticipantIdentity(entry),
    `HP ${formatCombatParticipantHp(entry)}`,
    `Grid ${formatPosition(entry && entry.position)}`
  ];
  const conditions = formatCombatParticipantConditions(entry);
  if (conditions !== "none") {
    parts.push(`Conditions ${conditions}`);
  }
  return parts.join(" | ");
}

function chunkEmbedFieldLines(lines, maxLength) {
  const safeLines = (Array.isArray(lines) ? lines : []).filter(Boolean);
  const safeMax = Math.max(128, Number(maxLength || 1000));
  const chunks = [];
  let current = [];
  let currentLength = 0;

  safeLines.forEach((line) => {
    const safeLine = String(line || "");
    const nextLength = currentLength === 0
      ? safeLine.length
      : currentLength + 1 + safeLine.length;
    if (current.length > 0 && nextLength > safeMax) {
      chunks.push(current.join("\n"));
      current = [safeLine];
      currentLength = safeLine.length;
      return;
    }

    current.push(safeLine);
    currentLength = nextLength;
  });

  if (current.length > 0) {
    chunks.push(current.join("\n"));
  }

  return chunks;
}

function buildChunkedFieldEntries(name, lines, emptyValue) {
  const safeLines = Array.isArray(lines) && lines.length > 0
    ? lines
    : [emptyValue || "(unavailable)"];
  return chunkEmbedFieldLines(safeLines, 1000).map((value, index) => ({
    name: index === 0 ? name : `${name} (cont. ${index + 1})`,
    value,
    inline: false
  }));
}

function summarizeRecentCombatEvent(summary, entry) {
  const safe = entry && typeof entry === "object" ? entry : {};
  const type = cleanText(safe.event_type, "event");
  if (type === "attack_action" || type === "opportunity_attack" || type === "ready_attack") {
    const details = safe.details && typeof safe.details === "object" ? safe.details : {};
    const hit = safe.hit === true || details.hit === true;
    const damage = Number.isFinite(Number(safe.damage_dealt))
      ? Number(safe.damage_dealt)
      : (Number.isFinite(Number(details.damage_dealt)) ? Number(details.damage_dealt) : 0);
    return `${resolveCombatParticipantReferenceLabel(summary, safe.attacker_id, { include_marker: false }) || humanizeIdentifier(safe.attacker_id, "actor")} -> ${resolveCombatParticipantReferenceLabel(summary, safe.target_id, { include_marker: false }) || humanizeIdentifier(safe.target_id, "target")} ${hit ? `hit ${damage}` : "miss"}`;
  }
  if (type === "cast_spell_action") {
    const details = safe.details && typeof safe.details === "object" ? safe.details : {};
    const spellId = safe.spell_id || details.spell_id || null;
    return `${resolveCombatParticipantReferenceLabel(summary, safe.attacker_id || safe.participant_id || safe.caster_id, { include_marker: false }) || humanizeIdentifier(safe.attacker_id || safe.participant_id || safe.caster_id, "caster")} cast ${humanizeIdentifier(spellId, "spell")}`;
  }
  if (type === "move_action") {
    const from = safe.from_position ? `${safe.from_position.x},${safe.from_position.y}` : "?";
    const to = safe.to_position ? `${safe.to_position.x},${safe.to_position.y}` : "?";
    return `${resolveCombatParticipantReferenceLabel(summary, safe.participant_id, { include_marker: false }) || humanizeIdentifier(safe.participant_id, "actor")} moved ${from} -> ${to}`;
  }
  if (type === "grapple_action" || type === "escape_grapple_action" || type === "shove_action") {
    return `${resolveCombatParticipantReferenceLabel(summary, safe.attacker_id || safe.participant_id, { include_marker: false }) || humanizeIdentifier(safe.attacker_id || safe.participant_id, "actor")} ${type.replace(/_action$/, "").replace(/_/g, " ")}`;
  }
  if (type === "turn_advanced") {
    const details = safe.details && typeof safe.details === "object" ? safe.details : {};
    const active = safe.active_participant_id || details.active_participant_id || null;
    return `Turn advanced to ${resolveCombatParticipantReferenceLabel(summary, active, { include_marker: false }) || humanizeIdentifier(active, "next actor")}`;
  }
  return humanizeIdentifier(type, type);
}

function buildCombatStateEmbed(summary) {
  const safe = summary && typeof summary === "object" ? summary : {};
  const orderedParticipants = getOrderedCombatParticipants(safe);
  const activeParticipant = findCombatParticipant(safe, safe.active_participant_id);
  const activeIndex = activeParticipant
    ? orderedParticipants.findIndex((entry) => String(entry && entry.participant_id || "") === String(activeParticipant.participant_id || ""))
    : -1;
  const recentEvents = Array.isArray(safe.recent_events) ? safe.recent_events : [];
  const activeTurnValue = activeParticipant
    ? [
        `Actor: ${formatCombatParticipantIdentity(activeParticipant)}`,
        `HP: ${formatCombatParticipantHp(activeParticipant)}`,
        `Grid: ${formatPosition(activeParticipant.position)}`,
        `Conditions: ${formatCombatParticipantConditions(activeParticipant)}`,
        `Economy: ${formatCombatParticipantEconomy(activeParticipant)}`,
        formatCombatParticipantSpellTempo(activeParticipant)
          ? `Spell Tempo: ${formatCombatParticipantSpellTempo(activeParticipant)}`
          : "",
        activeIndex >= 0 ? `Initiative: ${activeIndex + 1} of ${orderedParticipants.length}` : ""
      ].filter(Boolean).join("\n")
    : "(no active combatant)";
  const initiativeLines = orderedParticipants.length > 0
    ? orderedParticipants.map((entry, index) => {
      const participantId = cleanText(entry && entry.participant_id, "");
      const suffix = participantId === cleanText(safe.active_participant_id, "") ? " <- active" : "";
      return `${index + 1}. ${formatCombatParticipantIdentity(entry)}${suffix}`;
    })
    : [];
  const battlefieldLines = orderedParticipants.length > 0
    ? orderedParticipants.map((entry) => summarizeCombatParticipantLine(entry))
    : [];
  const recentEventLines = recentEvents.map((entry) => `- ${summarizeRecentCombatEvent(safe, entry)}`);
  return new EmbedBuilder()
    .setColor(0x4f545c)
    .setTitle("Battle Window")
    .setDescription([
      `Combat: ${cleanText(safe.combat_id, "unknown")}`,
      `Round: ${Number.isFinite(Number(safe.round)) ? Number(safe.round) : 1}`,
      `Status: ${cleanText(safe.status, "unknown")}`
    ].join("\n"))
    .addFields(
      {
        name: "Active Turn",
        value: activeTurnValue,
        inline: false
      },
      ...buildChunkedFieldEntries("Initiative", initiativeLines, "(unavailable)"),
      ...buildChunkedFieldEntries("Battlefield", battlefieldLines, "(unavailable)"),
      ...buildChunkedFieldEntries("Recent Flow", recentEventLines, "(no recent actions)")
    )
    .setFooter({ text: "Grid positions use (x, y)." });
}

function formatCombatConditionEntry(entry) {
  if (typeof entry === "string") {
    return formatConditionLabel(entry);
  }
  const type = cleanText(entry && (entry.condition_type || entry.type || entry.condition_id), "");
  return type ? formatConditionLabel(type) : "";
}

function summarizeConditionEntries(entries) {
  const labels = (Array.isArray(entries) ? entries : [])
    .map((entry) => formatCombatConditionEntry(entry))
    .filter(Boolean);
  return labels.length > 0 ? labels.join(", ") : "";
}

function buildCombatParticipantSnapshot(entry, options) {
  const safeOptions = options && typeof options === "object" ? options : {};
  const parts = [formatCombatParticipantIdentity(entry)];

  if (safeOptions.include_hp !== false) {
    parts.push(`HP ${formatCombatParticipantHp(entry)}`);
  }
  if (safeOptions.include_grid !== false && entry && entry.position) {
    parts.push(`Grid ${formatPosition(entry.position)}`);
  }
  const conditions = formatCombatParticipantConditions(entry);
  if (
    safeOptions.include_conditions === true ||
    (safeOptions.include_conditions !== false && conditions !== "none")
  ) {
    parts.push(`Conditions ${conditions}`);
  }

  return parts.join(" | ");
}

function buildCombatParticipantStateLine(summary, participantId, label, options) {
  const participant = findCombatParticipant(summary, participantId);
  if (!participant) {
    const safeId = cleanText(participantId, "");
    return safeId ? `${label}: ${humanizeIdentifier(safeId, safeId)}` : "";
  }
  return `${label}: ${buildCombatParticipantSnapshot(participant, options)}`;
}

function buildDamageSummaryText(amount, damageType) {
  if (!Number.isFinite(Number(amount))) {
    return "";
  }
  const safeDamageType = cleanText(damageType, "");
  return `${Number(amount)}${safeDamageType ? ` ${safeDamageType}` : ""} damage`;
}

function buildHpDeltaText(before, after) {
  if (!Number.isFinite(Number(before)) || !Number.isFinite(Number(after))) {
    return "";
  }
  return `HP ${Number(before)} -> ${Number(after)}`;
}

function buildTempHpDeltaText(before, after) {
  if (!Number.isFinite(Number(before)) || !Number.isFinite(Number(after))) {
    return "";
  }
  if (Number(before) === Number(after)) {
    return "";
  }
  return `Temp HP ${Number(before)} -> ${Number(after)}`;
}

function buildArmorClassDeltaText(defenseResult) {
  const safe = defenseResult && typeof defenseResult === "object" ? defenseResult : {};
  if (!Number.isFinite(Number(safe.armor_class_before)) || !Number.isFinite(Number(safe.armor_class_after))) {
    return "";
  }
  return `AC ${Number(safe.armor_class_before)} -> ${Number(safe.armor_class_after)}`;
}

function buildDamageStateLine(damageResult, fallbackAmount, fallbackType) {
  const safe = damageResult && typeof damageResult === "object" ? damageResult : {};
  const damageText = buildDamageSummaryText(
    safe.final_damage,
    cleanText(safe.damage_type, cleanText(fallbackType, ""))
  ) || buildDamageSummaryText(fallbackAmount, fallbackType);
  const hpDeltaText = buildHpDeltaText(safe.hp_before, safe.hp_after);
  const tempHpText = buildTempHpDeltaText(safe.temporary_hp_before, safe.temporary_hp_after);
  const parts = [damageText, hpDeltaText, tempHpText].filter(Boolean);
  return parts.length > 0 ? `Damage: ${parts.join(" | ")}` : "";
}

function buildHealingStateLine(healingResult) {
  const safe = healingResult && typeof healingResult === "object" ? healingResult : {};
  const healedFor = Number.isFinite(Number(safe.healed_for)) ? Number(safe.healed_for) : null;
  const hpDeltaText = buildHpDeltaText(safe.hp_before, safe.hp_after);
  const parts = [];

  if (healedFor !== null) {
    parts.push(String(healedFor));
  }
  if (hpDeltaText) {
    parts.push(hpDeltaText);
  }

  return parts.length > 0 ? `Healing: ${parts.join(" | ")}` : "";
}

function buildVitalityStateLine(vitalityResult) {
  const safe = vitalityResult && typeof vitalityResult === "object" ? vitalityResult : {};
  const tempHpText = buildTempHpDeltaText(safe.temporary_hp_before, safe.temporary_hp_after);
  const granted = Number.isFinite(Number(safe.temporary_hitpoints_granted))
    ? Number(safe.temporary_hitpoints_granted)
    : null;
  const parts = [];

  if (tempHpText) {
    parts.push(tempHpText);
  }
  if (granted !== null && granted > 0) {
    parts.push(`Granted ${granted} temp HP`);
  }

  return parts.length > 0 ? `Temporary HP: ${parts.join(" | ")}` : "";
}

function buildDefenseStateLine(defenseResult) {
  const defenseText = buildArmorClassDeltaText(defenseResult);
  return defenseText ? `Defense: ${defenseText}` : "";
}

function buildTargetResultLine(targetResult, combatSummary) {
  const safe = targetResult && typeof targetResult === "object" ? targetResult : {};
  const targetId = cleanText(safe.target_id, "");
  const participant = combatSummary ? findCombatParticipant(combatSummary, targetId) : null;
  const label = participant ? formatCombatParticipantIdentity(participant) : cleanText(targetId, "Target");
  const parts = [];

  const damageText = buildDamageSummaryText(safe.final_damage, safe.damage_type);
  if (damageText) {
    parts.push(damageText);
  }

  const hpDeltaText = buildHpDeltaText(safe.hp_before, safe.hp_after);
  if (hpDeltaText) {
    parts.push(hpDeltaText);
  } else if (participant) {
    parts.push(`HP ${formatCombatParticipantHp(participant)}`);
  }

  const vitality = safe.vitality_result && typeof safe.vitality_result === "object" ? safe.vitality_result : null;
  const tempHpText = vitality
    ? buildTempHpDeltaText(vitality.temporary_hp_before, vitality.temporary_hp_after)
    : "";
  if (tempHpText) {
    parts.push(tempHpText);
  }
  if (vitality && Number.isFinite(Number(vitality.temporary_hitpoints_granted)) && Number(vitality.temporary_hitpoints_granted) > 0) {
    parts.push(`Granted ${Number(vitality.temporary_hitpoints_granted)} temp HP`);
  }

  const healing = safe.healing_result && typeof safe.healing_result === "object" ? safe.healing_result : null;
  if (healing && Number.isFinite(Number(healing.healed_for))) {
    parts.push(`Healing ${Number(healing.healed_for)}`);
  }

  const defenseText = buildArmorClassDeltaText(safe.defense_result);
  if (defenseText) {
    parts.push(defenseText);
  }

  const gained = summarizeConditionEntries(safe.applied_conditions);
  if (gained) {
    parts.push(`Gained ${gained}`);
  }
  const lost = summarizeConditionEntries(safe.removed_conditions);
  if (lost) {
    parts.push(`Lost ${lost}`);
  }

  if (participant && participant.position) {
    parts.push(`Grid ${formatPosition(participant.position)}`);
  }

  return parts.length > 0 ? `${label}: ${parts.join(" | ")}` : "";
}

function buildTargetResultLines(targetResults, combatSummary) {
  return (Array.isArray(targetResults) ? targetResults : [])
    .map((entry) => buildTargetResultLine(entry, combatSummary))
    .filter(Boolean);
}

function summarizeConcentrationUpdate(data) {
  const lines = [];
  const concentrationResult = data && data.concentration_result && typeof data.concentration_result === "object"
    ? data.concentration_result
    : null;
  const concentrationStarted = data && data.concentration_started && typeof data.concentration_started === "object"
    ? data.concentration_started
    : null;
  const concentrationReplaced = data && data.concentration_replaced && typeof data.concentration_replaced === "object"
    ? data.concentration_replaced
    : null;

  if (concentrationStarted && concentrationStarted.is_concentrating === true) {
    lines.push(`Concentration started: ${humanizeIdentifier(concentrationStarted.source_spell_id, "active spell")}`);
  }
  if (concentrationReplaced && concentrationReplaced.source_spell_id) {
    lines.push(`Concentration replaced: ${humanizeIdentifier(concentrationReplaced.source_spell_id, concentrationReplaced.source_spell_id)}`);
  }
  if (concentrationResult) {
    const dc = Number.isFinite(Number(concentrationResult.concentration_dc))
      ? Number(concentrationResult.concentration_dc)
      : 10;
    lines.push(
      concentrationResult.concentration_broken === true
        ? `Concentration broken (DC ${dc})`
        : `Concentration maintained (DC ${dc})`
    );
  }
  return lines;
}

function buildCombatTurnLines(data, combatSummary) {
  const lines = [];
  if (combatSummary) {
    lines.push(`Round: ${Number.isFinite(Number(combatSummary.round)) ? Number(combatSummary.round) : 1}`);
  }

  const nextParticipantId = cleanText(
    data && data.active_participant_id,
    cleanText(combatSummary && combatSummary.active_participant_id, "")
  );
  const nextTurnLine = buildCombatParticipantStateLine(
    combatSummary,
    nextParticipantId,
    "Next Turn",
    { include_conditions: false }
  );
  if (nextTurnLine) {
    lines.push(nextTurnLine);
  }

  const followUp = summarizeAiTurns(data && data.ai_turns, combatSummary);
  if (followUp) {
    lines.push(`Follow-Up: ${followUp}`);
  }

  if (data && data.combat_completed === true) {
    lines.push(
      data.winner_team
        ? `Combat Ended: ${humanizeIdentifier(data.winner_team, data.winner_team)} wins`
        : "Combat Ended"
    );
  }

  return lines;
}

function buildCombatFeedReply(options) {
  const data = options && options.data && typeof options.data === "object" ? options.data : {};
  const combatSummary = data.combat_summary && typeof data.combat_summary === "object" ? data.combat_summary : null;
  const sections = Array.isArray(options && options.sections) ? options.sections : [];

  return {
    ok: true,
    embeds: [
      buildCombatSectionsEmbed(
        cleanText(options && options.title, "Combat Update"),
        Number.isFinite(Number(options && options.color)) ? Number(options.color) : 0x4f545c,
        sections,
        cleanText(options && options.footer, "Combat Feed")
      ),
      ...(combatSummary ? [buildCombatStateEmbed(combatSummary)] : [])
    ],
    components: buildCombatStatusComponents({
      combat_id: data.combat_id || (combatSummary && combatSummary.combat_id) || null
    }),
    content: buildCombatSectionsContent(sections),
    data
  };
}

function buildCombatStatusComponents(data) {
  const combatId = cleanText(data && data.combat_id, "");
  if (!combatId) {
    return [];
  }
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.combatRefresh}:${combatId}`)
        .setLabel("Refresh Combat")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.combatReady}:${combatId}`)
        .setLabel("Ready")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.combatDodge}:${combatId}`)
        .setLabel("Dodge")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.combatDash}:${combatId}`)
        .setLabel("Dash")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.combatDisengage}:${combatId}`)
        .setLabel("Disengage")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function buildInventoryComponents(selectedTab, data) {
  const tab = String(selectedTab || "summary");
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.inventoryBackToProfile)
        .setLabel("Back to Profile")
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.inventorySummary)
        .setLabel("Summary")
        .setStyle(tab === "summary" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.inventoryEquipment)
        .setLabel("Equipment")
        .setStyle(tab === "equipment" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.inventoryMagical)
        .setLabel("Magical")
        .setStyle(tab === "magical" ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  ];
  if (tab === "magical") {
    const magicalButtons = buildMagicalInventoryActionButtons(data);
    if (magicalButtons.length > 0) {
      rows.push(new ActionRowBuilder().addComponents(...magicalButtons));
    }
  } else if (tab === "equipment") {
    const equipmentButtons = buildEquipmentInventoryActionButtons(data);
    if (equipmentButtons.length > 0) {
      rows.push(new ActionRowBuilder().addComponents(...equipmentButtons));
    }
  }
  return rows;
}

function buildProfileComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.profileOpenInventory)
        .setLabel("Open Inventory")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function buildShopEmbed(data) {
  const stock = Array.isArray(data && data.stock) ? data.stock : [];
  const sellable = Array.isArray(data && data.sellable_items) ? data.sellable_items : [];
  const vendors = Array.isArray(data && data.vendors) ? data.vendors : [];
  return new EmbedBuilder()
    .setColor(0xb56f1b)
    .setTitle(cleanText(data && data.vendor_name, "Quartermaster"))
    .setDescription(cleanText(data && data.vendor_description, "Starter supply counter"))
    .addFields(
      {
        name: "Purse",
        value: `Gold: ${Number.isFinite(Number(data && data.gold)) ? Number(data.gold) : 0}`,
        inline: true
      },
      {
        name: "Inventory Link",
        value: toDisplayTag(data && data.inventory_id, "(none)"),
        inline: true
      },
      {
        name: "Stock",
        value: stock.length > 0
          ? stock.slice(0, 5).map((entry) => {
            const qty = entry && entry.infinite_stock ? "∞ stock" : `${String(entry && entry.quantity_available !== null ? entry.quantity_available : 0)} left`;
            return `\`${cleanText(entry && entry.item_name, entry && entry.item_id || "item")}\` • ${Number(entry && entry.price_gold || 0)}g • ${qty} • expedition stock`;
          }).join("\n")
          : "(no stock)",
        inline: false
      },
      {
        name: "Sellable Pack",
        value: sellable.length > 0
          ? sellable.slice(0, 5).map((entry) => `\`${cleanText(entry.item_name, entry.item_id)}\` • ${Number(entry.quantity || 1)} • ${Number(entry.sell_price_gold || 0)}g • ready for barter`).join("\n")
          : "(no sellable items)",
        inline: false
      },
      {
        name: "Open Counters",
        value: vendors.length > 0
          ? vendors.slice(0, 5).map((entry) => `\`${cleanText(entry.vendor_name, entry.vendor_id)}\``).join(" | ")
          : "(none)",
        inline: false
      }
    )
    .setFooter({ text: "Counter service • Buy and sell buttons use the canonical shop flow" });
}

function buildShopComponents(data) {
  const stock = Array.isArray(data && data.stock) ? data.stock : [];
  const sellable = Array.isArray(data && data.sellable_items) ? data.sellable_items : [];
  const vendors = Array.isArray(data && data.vendors) ? data.vendors : [];
  const vendorButtons = vendors
    .slice(0, 3)
    .map((entry) =>
      new ButtonBuilder()
        .setCustomId(`shop:view:browse:${cleanText(entry.vendor_id, "vendor_starter_quartermaster")}`)
        .setLabel(abbreviate(cleanText(entry.vendor_name, entry.vendor_id), 18))
        .setStyle(cleanText(data && data.vendor_id, "") === cleanText(entry.vendor_id, "") ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
  const buyButtons = stock
    .filter((entry) => entry && entry.item_available)
    .slice(0, 5)
    .map((entry) =>
      new ButtonBuilder()
        .setCustomId(`shop:view:buy:${cleanText(data && data.vendor_id, "vendor_starter_quartermaster")}:${cleanText(entry.item_id, "unknown")}`)
        .setLabel(`Buy ${abbreviate(cleanText(entry.item_name, entry.item_id), 18)}`)
        .setStyle(ButtonStyle.Primary)
    );
  const sellButtons = sellable
    .slice(0, 5)
    .map((entry) =>
      new ButtonBuilder()
        .setCustomId(`shop:view:sell:${cleanText(data && data.vendor_id, "vendor_starter_quartermaster")}:${cleanText(entry.item_id, "unknown")}`)
        .setLabel(`Sell ${abbreviate(cleanText(entry.item_name, entry.item_id), 17)}`)
        .setStyle(ButtonStyle.Danger)
    );

  const rows = [];
  if (vendorButtons.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(...vendorButtons));
  }
  if (buyButtons.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(...buyButtons));
  }
  if (sellButtons.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(...sellButtons));
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.shopRefresh)
        .setLabel("Refresh Shop")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.economyNavCraft)
        .setLabel("Open Craft")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.economyNavTrade)
        .setLabel("Open Trade")
        .setStyle(ButtonStyle.Secondary)
    )
  );
  return rows;
}

function buildCraftEmbed(data) {
  const recipes = Array.isArray(data && data.recipes) ? data.recipes : [];
  const filter = String(data && data.selected_filter || "all");
  const visibleRecipes = getVisibleCraftRecipes(recipes, filter);
  return new EmbedBuilder()
    .setColor(0x8c5b2d)
    .setTitle("Fieldcraft Ledger")
    .setDescription(`Supported starter recipes • Filter: ${filter} • camp-ready craft notes`)
    .addFields(
      {
        name: "Ready Now",
        value: visibleRecipes.length > 0
          ? visibleRecipes.slice(0, 4).map((entry) => {
            const materialText = Array.isArray(entry.required_materials) && entry.required_materials.length > 0
              ? entry.required_materials.map((material) => `${cleanText(material.item_id, "item")} x${Number(material.quantity || 1)}`).join(", ")
              : "(none)";
            const type = cleanText(entry.recipe_type, "crafting");
            const difficulty = cleanText(entry.difficulty, "easy");
            const outputItem = cleanText(entry.output_item_id, "");
            const outputQuantity = Number.isFinite(Number(entry.output_quantity)) ? Number(entry.output_quantity) : 1;
            const detailLine = [type, difficulty, outputItem ? `out ${outputItem} x${outputQuantity}` : null].filter(Boolean).join(" • ");
            return [
              `\`${cleanText(entry.recipe_name, entry.recipe_id)}\` • ${entry.craftable ? "Ready" : "Missing mats"}`,
              detailLine,
              `Materials: ${materialText}`,
              entry.craftable ? "Field note: workable with the current pack." : "Field note: gather more before the next camp."
            ].join("\n");
          }).join("\n\n")
          : "(no recipes for this filter)",
        inline: false
      }
    )
    .setFooter({ text: "Instant craft slice • recipes gated to current supported data" });
}

function buildCraftComponents(data) {
  const recipes = Array.isArray(data && data.recipes) ? data.recipes : [];
  const filter = String(data && data.selected_filter || "all");
  const visibleRecipes = getVisibleCraftRecipes(recipes, filter);
  const craftButtons = visibleRecipes
    .filter((entry) => entry && entry.craftable === true)
    .slice(0, 5)
    .map((entry) =>
      new ButtonBuilder()
        .setCustomId(`craft:view:make:${cleanText(entry.recipe_id, "unknown")}`)
        .setLabel(`Craft ${abbreviate(cleanText(entry.recipe_name, entry.recipe_id), 16)}`)
        .setStyle(ButtonStyle.Primary)
    );
  const rows = [];
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("craft:view:filter:all")
        .setLabel("All")
        .setStyle(filter === "all" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("craft:view:filter:ready")
        .setLabel("Ready")
        .setStyle(filter === "ready" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("craft:view:filter:survival")
        .setLabel("Survival")
        .setStyle(filter === "survival" ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  );
  if (craftButtons.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(...craftButtons));
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.craftRefresh)
        .setLabel("Refresh Recipes")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.economyNavShop)
        .setLabel("Open Shop")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.economyNavTrade)
        .setLabel("Open Trade")
        .setStyle(ButtonStyle.Secondary)
    )
  );
  return rows;
}

function getVisibleCraftRecipes(recipes, filter) {
  const list = Array.isArray(recipes) ? recipes : [];
  const selected = String(filter || "all");
  if (selected === "ready") {
    return list.filter((entry) => entry && entry.craftable === true);
  }
  if (selected === "survival") {
    return list.filter((entry) => String(entry && entry.recipe_type || "").toLowerCase() === "survival");
  }
  return list;
}

function formatTradeOffer(offer) {
  const safe = offer && typeof offer === "object" ? offer : {};
  const parts = [];
  if (safe.item_id) {
    parts.push(`${cleanText(safe.item_name, safe.item_id || "item")} x${Number.isFinite(Number(safe.quantity)) ? Number(safe.quantity) : 1}`);
  }
  if (Number.isFinite(Number(safe.currency)) && Number(safe.currency) > 0) {
    parts.push(`${Number(safe.currency)}g`);
  }
  return parts.length > 0 ? parts.join(" + ") : "(none)";
}

function summarizeAttackResult(data) {
  if (data && data.hit === true) {
    return "Hit";
  }
  return "Miss";
}

function summarizeSpellResolution(data) {
  const resolutionType = cleanText(data && data.resolution_type, "unknown");
  if (resolutionType === "save") {
    return data && data.saved === true ? "Save succeeded" : "Save failed";
  }
  if (resolutionType === "auto_hit") {
    return "Automatic effect";
  }
  if (resolutionType === "spell_attack") {
    return data && data.hit === true ? "Spell attack hit" : "Spell attack missed";
  }
  if (resolutionType === "none") {
    return "Effect applied";
  }
  return resolutionType;
}

function getTradeById(data, tradeId) {
  const trades = Array.isArray(data && data.trades) ? data.trades : [];
  const target = cleanText(tradeId, "");
  for (let i = 0; i < trades.length; i += 1) {
    const trade = trades[i];
    if (cleanText(trade && trade.trade_id, "") === target) {
      return trade;
    }
  }
  return null;
}

function normalizeTradeableItems(data) {
  const inventory = data && data.inventory && typeof data.inventory === "object" ? data.inventory : {};
  const items = Array.isArray(inventory.tradeable_items) ? inventory.tradeable_items : [];
  return items
    .map((entry) => (entry && typeof entry === "object" ? entry : {}))
    .filter((entry) => Boolean(normalizeSelection(entry.item_id)));
}

function getTradeableItemById(data, itemId) {
  const target = normalizeSelection(itemId);
  const items = normalizeTradeableItems(data);
  for (let i = 0; i < items.length; i += 1) {
    if (normalizeSelection(items[i].item_id) === target) {
      return items[i];
    }
  }
  return null;
}

function getTradeProposalGoldOptions() {
  return [0, 5, 10, 25, 50, 100];
}

function buildTradeProposalEmbed(view) {
  const safe = view && typeof view === "object" ? view : {};
  const inventoryData = safe.inventoryData || {};
  const selectedItem = getTradeableItemById(inventoryData, safe.offered_item_id);
  const selectedQuantity = Number.isFinite(Number(safe.offered_quantity)) ? Number(safe.offered_quantity) : 1;
  const requestedGold = Number.isFinite(Number(safe.requested_currency)) ? Number(safe.requested_currency) : 0;
  const tradeableItems = normalizeTradeableItems(inventoryData);

  return new EmbedBuilder()
    .setColor(0x3f7bd8)
    .setTitle("Broker Desk | New Offer")
    .setDescription(`Counterparty: ${toDisplayTag(safe.counterparty_player_id, "unknown")}`)
    .addFields(
      {
        name: "Offer",
        value: selectedItem
          ? `${cleanText(selectedItem.item_name, selectedItem.item_id)} x${selectedQuantity}`
          : "(select an item)",
        inline: true
      },
      {
        name: "Request",
        value: requestedGold > 0 ? `${requestedGold}g` : "(no gold requested)",
        inline: true
      },
      {
        name: "Tradeable Cache",
        value: tradeableItems.length > 0
          ? tradeableItems.slice(0, 10).map((entry) => {
            const quantity = Number.isFinite(Number(entry.quantity)) ? Number(entry.quantity) : 1;
            return `${cleanText(entry.item_name, entry.item_id || "item")} x${quantity}`;
          }).join("\n")
          : "(no tradable items)",
        inline: false
      }
    )
    .setFooter({ text: "Select an item, quantity, and requested gold" });
}

function buildTradeProposalComponents(view) {
  const safe = view && typeof view === "object" ? view : {};
  const inventoryData = safe.inventoryData || {};
  const tradeableItems = normalizeTradeableItems(inventoryData);
  const selectedItem = getTradeableItemById(inventoryData, safe.offered_item_id);
  const maxQuantity = selectedItem && Number.isFinite(Number(selectedItem.quantity))
    ? Math.max(1, Math.min(25, Math.floor(Number(selectedItem.quantity))))
    : 1;
  const selectedQuantity = Number.isFinite(Number(safe.offered_quantity)) ? Number(safe.offered_quantity) : 1;
  const selectedGold = Number.isFinite(Number(safe.requested_currency)) ? Number(safe.requested_currency) : 0;

  const rows = [];
  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(CUSTOM_IDS.tradeProposalItemSelect)
        .setPlaceholder(tradeableItems.length > 0 ? "Choose offered item" : "No tradable items available")
        .setDisabled(tradeableItems.length === 0)
        .addOptions(
          (tradeableItems.length > 0 ? tradeableItems : [{ item_id: "none", item_name: "No items", quantity: 0 }]).slice(0, 25).map((entry) => ({
            label: abbreviate(cleanText(entry.item_name, entry.item_id || "item"), 80),
            description: `Qty ${Number.isFinite(Number(entry.quantity)) ? Number(entry.quantity) : 1}`,
            value: normalizeSelection(entry.item_id)
          }))
        )
    )
  );
  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(CUSTOM_IDS.tradeProposalQuantitySelect)
        .setPlaceholder("Choose quantity")
        .setDisabled(!selectedItem)
        .addOptions(
          Array.from({ length: maxQuantity }, (_, index) => index + 1).slice(0, 25).map((quantity) => ({
            label: `Quantity ${quantity}`,
            description: quantity === selectedQuantity ? "Selected" : "Set offered quantity",
            value: String(quantity)
          }))
        )
    )
  );
  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(CUSTOM_IDS.tradeProposalGoldSelect)
        .setPlaceholder("Choose requested gold")
        .addOptions(
          getTradeProposalGoldOptions().map((gold) => ({
            label: gold > 0 ? `${gold} gold` : "No gold requested",
            description: gold === selectedGold ? "Selected" : "Set requested gold",
            value: String(gold)
          }))
        )
    )
  );
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.tradeProposalSubmit)
        .setLabel("Submit Offer")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!selectedItem),
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.tradeProposalCancel)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    )
  );
  return rows;
}

function buildTradeEmbed(data, userId) {
  const trades = Array.isArray(data && data.trades) ? data.trades : [];
  const actionable = Array.isArray(data && data.actionable_trades) ? data.actionable_trades : [];
  return new EmbedBuilder()
    .setColor(0x3f7bd8)
    .setTitle("Broker Ledger")
    .setDescription("Direct player trades • private exchange records for active delvers")
    .addFields(
      {
        name: "Pending Ledger",
        value: trades.length > 0
          ? trades.slice(0, 6).map((trade) => {
            const counterparty = trade.role === "initiator"
              ? trade.counterparty_player_id
              : trade.initiator_player_id;
            return `\`${cleanText(trade.trade_id, "trade")}\` • ${cleanText(trade.trade_state, "pending")} • with ${cleanText(counterparty, "unknown")}\nOffer: ${formatTradeOffer(trade.offered)}\nRequest: ${formatTradeOffer(trade.requested)}\nBroker note: awaiting both hands on the bargain.`;
          }).join("\n\n")
          : "(no trades)",
        inline: false
      },
      {
        name: "Actionable",
        value: actionable.length > 0
          ? actionable.map((trade) => `\`${cleanText(trade.trade_id, "trade")}\` • ${trade.role === "counterparty" ? "accept / decline" : "cancel"}`).join("\n")
          : "(no pending actions)",
        inline: false
      }
    )
    .setFooter({ text: `Trade desk • ${cleanText(userId, "unknown player")}` });
}

function buildTradeDetailEmbed(data, trade, userId) {
  const safe = trade && typeof trade === "object" ? trade : {};
  const role = cleanText(safe.role, "observer");
  const counterparty = role === "initiator"
    ? cleanText(safe.counterparty_player_id, "unknown")
    : cleanText(safe.initiator_player_id, "unknown");
  return new EmbedBuilder()
    .setColor(0x3f7bd8)
    .setTitle(`Broker Ledger | ${cleanText(safe.trade_id, "trade")}`)
    .setDescription(`State: ${cleanText(safe.trade_state, "unknown")} • Role: ${role} • With: ${counterparty} • broker seal pending`)
    .addFields(
      {
        name: "Offer",
        value: formatTradeOffer(safe.offered),
        inline: false
      },
      {
        name: "Request",
        value: formatTradeOffer(safe.requested),
        inline: false
      },
      {
        name: "Timestamps",
        value: [
          `Created: ${cleanText(safe.created_at, "(unknown)")}`,
          `Updated: ${cleanText(safe.updated_at, "(unknown)")}`,
          `Completed: ${cleanText(safe.completed_at, "(none)")}`
        ].join("\n"),
        inline: false
      }
    )
    .setFooter({ text: `Trade desk • ${cleanText(userId, "unknown player")}` });
}

function buildTradeComponents(data, selectedTradeId) {
  const actionable = Array.isArray(data && data.actionable_trades) ? data.actionable_trades : [];
  const trades = Array.isArray(data && data.trades) ? data.trades : [];
  const selectedTrade = selectedTradeId ? getTradeById(data, selectedTradeId) : null;
  const rows = [];
  if (selectedTrade) {
    const role = cleanText(selectedTrade.role, "observer");
    if (selectedTrade.actionable && role === "counterparty") {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`trade:view:accept:${cleanText(selectedTrade.trade_id, "unknown")}`)
          .setLabel("Accept Trade")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`trade:view:decline:${cleanText(selectedTrade.trade_id, "unknown")}`)
          .setLabel("Decline Trade")
          .setStyle(ButtonStyle.Danger)
      ));
    } else if (selectedTrade.actionable && role === "initiator") {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`trade:view:cancel:${cleanText(selectedTrade.trade_id, "unknown")}`)
          .setLabel("Cancel Trade")
          .setStyle(ButtonStyle.Secondary)
      ));
    }
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.tradeBack)
          .setLabel("Back to Ledger")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.tradeRefresh)
          .setLabel("Refresh Trades")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.economyNavShop)
          .setLabel("Open Shop")
          .setStyle(ButtonStyle.Secondary)
      )
    );
    return rows;
  }

  for (let i = 0; i < actionable.length && i < 2; i += 1) {
    const trade = actionable[i];
    if (trade.role === "counterparty") {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`trade:view:accept:${cleanText(trade.trade_id, "unknown")}`)
          .setLabel(`Accept ${abbreviate(cleanText(trade.trade_id, "trade"), 18)}`)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`trade:view:decline:${cleanText(trade.trade_id, "unknown")}`)
          .setLabel(`Decline ${abbreviate(cleanText(trade.trade_id, "trade"), 17)}`)
          .setStyle(ButtonStyle.Danger)
      ));
    } else {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`trade:view:cancel:${cleanText(trade.trade_id, "unknown")}`)
          .setLabel(`Cancel ${abbreviate(cleanText(trade.trade_id, "trade"), 18)}`)
          .setStyle(ButtonStyle.Secondary)
      ));
    }
  }
  if (trades.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        trades.slice(0, 3).map((trade) =>
          new ButtonBuilder()
            .setCustomId(`trade:view:detail:${cleanText(trade.trade_id, "unknown")}`)
            .setLabel(abbreviate(cleanText(trade.trade_id, "trade"), 20))
            .setStyle(ButtonStyle.Primary)
        )
      )
    );
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.tradeRefresh)
        .setLabel("Refresh Trades")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.economyNavShop)
        .setLabel("Open Shop")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.economyNavCraft)
        .setLabel("Open Craft")
        .setStyle(ButtonStyle.Secondary)
    )
  );
  return rows;
}

function toAbilityLabel(ability) {
  const safe = String(ability || "").trim();
  if (!safe) return "Unknown";
  return safe.charAt(0).toUpperCase() + safe.slice(1);
}

function createBasePointBuyStats() {
  const stats = {};
  for (let i = 0; i < ABILITY_FIELDS.length; i += 1) {
    stats[ABILITY_FIELDS[i]] = 8;
  }
  return stats;
}

function getAbilityDescription(ability) {
  switch (ability) {
    case "strength":
      return "Power, athletics, and heavy weapon pressure.";
    case "dexterity":
      return "Initiative, finesse, stealth, and defense.";
    case "constitution":
      return "Durability, health, and concentration resilience.";
    case "intelligence":
      return "Reasoning, recall, investigation, and arcane study.";
    case "wisdom":
      return "Perception, intuition, survival, and divine insight.";
    case "charisma":
      return "Presence, force of will, leadership, and social play.";
    default:
      return "Core adventuring ability.";
  }
}

function getPointBuySummary(stats) {
  const safe = stats && typeof stats === "object" ? stats : createBasePointBuyStats();
  let totalCost = 0;
  for (let i = 0; i < ABILITY_FIELDS.length; i += 1) {
    const ability = ABILITY_FIELDS[i];
    const score = Number(safe[ability]);
    const normalized = Number.isFinite(score) ? Math.floor(score) : 8;
    totalCost += POINT_BUY_COST_BY_SCORE[normalized] || 0;
  }

  return {
    mode: "point_buy_5e",
    total_cost: totalCost,
    remaining_points: 27 - totalCost,
    abilities: safe
  };
}

function isPointBuyComplete(session) {
  const summary = session && session.point_buy_summary ? session.point_buy_summary : null;
  return Boolean(summary && summary.total_cost === 27);
}

function raceNeedsOption(raceId) {
  if (!raceId) {
    return false;
  }
  const out = getRaceOptions(raceId);
  if (!out.ok) {
    return false;
  }
  const payload = out.payload || {};
  return (Array.isArray(payload.subraces) && payload.subraces.length > 0) ||
    (Array.isArray(payload.ancestry_options) && payload.ancestry_options.length > 0);
}

function getRaceOptionMenu(raceId) {
  const out = getRaceOptions(raceId);
  if (!out.ok) {
    return [];
  }

  const payload = out.payload || {};
  const values = [];
  const subraces = Array.isArray(payload.subraces) ? payload.subraces : [];
  for (let i = 0; i < subraces.length; i += 1) {
    const option = subraces[i] || {};
    const id = normalizeSelection(option.id);
    if (!id) continue;
    values.push({
      value: id,
      label: abbreviate(cleanText(option.name, id), 100),
      description: abbreviate(cleanText(option.notes && option.notes[0], "Subrace"), 100)
    });
  }

  const ancestry = Array.isArray(payload.ancestry_options) ? payload.ancestry_options : [];
  for (let i = 0; i < ancestry.length; i += 1) {
    const option = ancestry[i] || {};
    const id = normalizeSelection(option.id);
    if (!id) continue;
    values.push({
      value: id,
      label: abbreviate(cleanText(option.name, id), 100),
      description: abbreviate(cleanText(option.damage_type, "Ancestry"), 100)
    });
  }

  return values;
}

function getClassOptionMenu(classId) {
  const out = getClassOptions(classId);
  if (!out.ok) {
    return [];
  }

  const payload = out.payload || {};
  const subclasses = Array.isArray(payload.subclasses) ? payload.subclasses : [];
  const values = [];
  for (let i = 0; i < subclasses.length; i += 1) {
    const option = subclasses[i] || {};
    const id = normalizeSelection(option.id);
    if (!id) continue;
    const features = Array.isArray(option.features) ? option.features : [];
    values.push({
      value: id,
      label: abbreviate(cleanText(option.name, id), 100),
      description: abbreviate(
        cleanText(
          (Array.isArray(option.notes) && option.notes[0]) || features.slice(0, 2).join(", "),
          "Subclass choice"
        ),
        100
      )
    });
  }

  return values;
}

function canSubmit(session) {
  const safe = session || {};
  if (!safe.race_id || !safe.class_id || !safe.secondary_class_id) return false;
  if (safe.class_id === safe.secondary_class_id) return false;
  if (raceNeedsOption(safe.race_id) && !safe.race_option_id) return false;
  if (classNeedsOptionAtStart(safe.class_id) && !safe.class_option_id) return false;
  if (classNeedsOptionAtStart(safe.secondary_class_id) && !safe.secondary_class_option_id) return false;
  return isPointBuyComplete(safe) && safe.point_buy_confirmed === true;
}

function validatePointBuy(stats) {
  const safe = stats && typeof stats === "object" ? stats : {};
  let spent = 0;
  const abilities = {};

  for (let i = 0; i < ABILITY_FIELDS.length; i += 1) {
    const ability = ABILITY_FIELDS[i];
    const raw = safe[ability];
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return { ok: false, error: `invalid ${ability}` };
    }
    const integer = Math.floor(value);
    if (integer < 8 || integer > 15 || POINT_BUY_COST_BY_SCORE[integer] === undefined) {
      return { ok: false, error: `${ability} must be between 8 and 15` };
    }

    abilities[ability] = integer;
    spent += POINT_BUY_COST_BY_SCORE[integer];
  }

  if (spent !== 27) {
    return {
      ok: false,
      error: `point-buy must spend exactly 27 points. Current spend: ${spent}`
    };
  }

  return { ok: true, spent, abilities };
}

function buildStartEmbed(session, extra) {
  const safe = session || {};
  const race = getRaceById(safe.race_id);
  const primaryClass = getClassById(safe.class_id);
  const secondaryClass = getClassById(safe.secondary_class_id);
  const raceText = race ? `${race.name} (${safe.race_id})` : "Not selected";
  const primaryClassText = primaryClass ? `${primaryClass.name} (${safe.class_id})` : "Not selected";
  const secondaryClassText = secondaryClass
    ? `${secondaryClass.name} (${safe.secondary_class_id})`
    : "Not selected";
  const primarySubclassText = safe.class_option_id ? safe.class_option_id : "(deferred)";
  const secondarySubclassText = safe.secondary_class_option_id ? safe.secondary_class_option_id : "(deferred)";
  const stats = safe.stats || createBasePointBuyStats();
  const pointBuySummary = safe.point_buy_summary || getPointBuySummary(stats);
  const statText = formatStatLine(stats);
  const pointBuyText = `Spent ${pointBuySummary.total_cost}/27 | Remaining ${pointBuySummary.remaining_points}`;
  const status = canSubmit(safe)
    ? "Ready to create"
    : "Set race, both gestalt classes, then confirm the 27-point buy.";

  if (safe.view === "point_buy") {
    const selectedAbility = safe.selected_ability || ABILITY_FIELDS[0];
    const selectedScore = Number(stats[selectedAbility]) || 8;
    return new EmbedBuilder()
      .setTitle("Point-Buy")
      .setColor(pointBuySummary.remaining_points === 0 ? 0x57f287 : 0xfaa61a)
      .setDescription(`${cleanText(extra, "")}\nAdjust one ability at a time with buttons. Name stays from \`/start name:\`.`)
      .addFields(
        { name: "Name", value: cleanText(safe.requested_character_name, "(none)"), inline: true },
        { name: "Selected ability", value: `${toAbilityLabel(selectedAbility)}: ${selectedScore}`, inline: true },
        { name: "Budget", value: `${pointBuyText} | ${safe.point_buy_confirmed ? "Confirmed" : "Not confirmed"}`, inline: true },
        { name: "Ability scores", value: statText, inline: false },
        { name: "About", value: getAbilityDescription(selectedAbility), inline: false },
        {
          name: "5e Cost Table",
          value: "8=0, 9=1, 10=2, 11=3, 12=4, 13=5, 14=7, 15=9"
        }
      );
  }

  return new EmbedBuilder()
    .setTitle("Start wizard")
    .setColor(canSubmit(safe) ? 0x5865f2 : 0xfaa61a)
    .setDescription(`${cleanText(extra, "")}\n${status}`)
    .addFields(
      { name: "Name", value: cleanText(safe.requested_character_name, "(none)"), inline: true },
      { name: "Race", value: raceText, inline: true },
      { name: "Track A", value: primaryClassText, inline: true },
      { name: "Track B", value: secondaryClassText, inline: true },
      { name: "Race option", value: safe.race_option_id ? safe.race_option_id : "(none)", inline: true },
      { name: "Track A subclass", value: primarySubclassText, inline: true },
      { name: "Track B subclass", value: secondarySubclassText, inline: true },
      { name: "Stats", value: statText, inline: false },
      { name: "Point-buy", value: `${pointBuyText} | ${safe.point_buy_confirmed ? "Confirmed" : "Needs confirm"}`, inline: false },
      {
        name: "Flow",
        value: "Name is typed in `/start`. Race, both gestalt tracks, and stats are all selected in menus/buttons."
      },
      {
        name: "Subclass Timing",
        value: "Only classes that unlock subclass at level 1 are shown here during `/start`."
      }
    );
}

function buildStartComponents(session) {
  if ((session && session.view) === "point_buy") {
    const stats = session.stats || createBasePointBuyStats();
    const selectedAbility = session.selected_ability || ABILITY_FIELDS[0];
    const abilityOptions = ABILITY_FIELDS.map((ability) => ({
      value: ability,
      label: abbreviate(`${toAbilityLabel(ability)} (${stats[ability] || 8})`, 100),
      description: abbreviate(getAbilityDescription(ability), 100),
      default: ability === selectedAbility
    }));

    return [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CUSTOM_IDS.pointBuyAbilitySelect)
          .setPlaceholder("Choose an ability to adjust")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(abilityOptions)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.pointBuyDecrease)
          .setLabel("-1")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.pointBuyIncrease)
          .setLabel("+1")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.pointBuyResetAbility)
          .setLabel("Reset Stat")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.pointBuyResetAll)
          .setLabel("Reset All")
          .setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.pointBuyConfirm)
          .setLabel("Confirm")
          .setStyle(ButtonStyle.Success)
          .setDisabled(!isPointBuyComplete(session)),
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.pointBuyBack)
          .setLabel("Back")
          .setStyle(ButtonStyle.Secondary)
      )
    ];
  }

  const rows = [];
  const raceOptions = loadRaces().map((entry) => ({
    value: entry.id,
    label: abbreviate(entry.name, 100),
    description: abbreviate(`${entry.source} • ${entry.notes[0] || ""} • ${cleanText("", "")}`.trim(), 100)
  }));

  const classOptions = loadClasses().map((entry) => ({
    value: entry.id,
    label: abbreviate(entry.name, 100),
    description: abbreviate(`${entry.source} • ${entry.notes[0] || ""}`.trim(), 100)
  }));

  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.raceSelect)
      .setPlaceholder("Choose a race")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(raceOptions.length ? raceOptions : [{ value: "none", label: "No race options" }])
      .setDisabled(raceOptions.length === 0)
  ));

  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.classSelect)
      .setPlaceholder("Choose Track A class")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(classOptions.length ? classOptions : [{ value: "none", label: "No class options" }])
      .setDisabled(classOptions.length === 0)
  ));

  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.secondaryClassSelect)
      .setPlaceholder("Choose Track B class")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(classOptions.length ? classOptions : [{ value: "none", label: "No class options" }])
      .setDisabled(classOptions.length === 0)
  ));

  const raceMenu = getRaceOptionMenu(session.race_id);
  if (raceMenu.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(CUSTOM_IDS.raceOptionSelect)
        .setPlaceholder("Choose race option")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(raceMenu)
    ));
  }

  const primaryClassMenu = classNeedsOptionAtStart(session.class_id) ? getClassOptionMenu(session.class_id) : [];
  if (primaryClassMenu.length > 0) {
    const primaryClass = getClassById(session.class_id);
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(CUSTOM_IDS.classOptionSelect)
        .setPlaceholder(
          `Choose Track A subclass${primaryClass ? ` (${abbreviate(primaryClass.name, 40)})` : ""}`
        )
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(primaryClassMenu)
    ));
  }

  const secondaryClassMenu = classNeedsOptionAtStart(session.secondary_class_id)
    ? getClassOptionMenu(session.secondary_class_id)
    : [];
  if (secondaryClassMenu.length > 0) {
    const secondaryClass = getClassById(session.secondary_class_id);
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(CUSTOM_IDS.secondaryClassOptionSelect)
        .setPlaceholder(
          `Choose Track B subclass${secondaryClass ? ` (${abbreviate(secondaryClass.name, 40)})` : ""}`
        )
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(secondaryClassMenu)
    ));
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.pointBuyButton)
      .setLabel("Point-Buy")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.createButton)
      .setLabel("Create Character")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canSubmit(session))
  ));

  return rows;
}

function buildStartMessage(session, note) {
  return {
    embeds: [buildStartEmbed(session, note)],
    components: buildStartComponents(session),
    ephemeral: true
  };
}

function buildStartUpdateMessage(session, note) {
  return {
    embeds: [buildStartEmbed(session, note)],
    components: buildStartComponents(session)
  };
}

function extractInteractionUser(interaction) {
  return interaction && interaction.user && interaction.user.id ? String(interaction.user.id) : "";
}

function formatGatewayReplyFromRuntime(runtimeResult) {
  const safeResult = runtimeResult && typeof runtimeResult === "object" ? runtimeResult : null;
  const responses = safeResult && safeResult.payload && Array.isArray(safeResult.payload.responses)
    ? safeResult.payload.responses
    : [];
  const firstResponse = responses.length > 0 ? responses[0] : null;

  if (!firstResponse) {
    return {
      ok: false,
      content: "No runtime response was produced for this command.",
      data: {}
    };
  }

  const payload = firstResponse.payload || {};
  const responseType = payload.response_type || "command";
  const ok = payload.ok !== false;
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};

  if (!ok) {
    return {
      ok: false,
      content: responseType + " failed: " + (payload.error || "unknown runtime error"),
      data
    };
  }

  if (responseType === "start") {
    const character = data.character || {};
    const baseStats = character.base_stats || (data.point_buy_summary && data.point_buy_summary.abilities) || null;
    return {
      ok: true,
      content: [
        "Character created successfully",
        `Name: ${cleanText(character.name, "unknown")}`,
        `Race: ${cleanText(character.race, character.race_id || "unknown")}`,
        `Track A: ${cleanText(character.class, character.class_id || "unknown")}`,
        `Track B: ${cleanText(character.secondary_class_id, "unknown")}`,
        `Level: ${character.level || 1}`,
        `Base Stats: ${baseStats ? formatStatLine(baseStats) : "unknown"}`,
        `Stats: ${formatStatLine(character.stats || {})}`
      ].join("\n"),
      data
    };
  }

  if (responseType === "ping") {
    return {
      ok: true,
      content: typeof data.message === "string" && data.message.trim() !== "" ? data.message : "Pong!",
      data
    };
  }

  if (responseType === "profile") {
    if (data.profile_found !== true || !data.character) {
      return {
        ok: true,
        content: "No character profile found for this player.",
        data
      };
    }

    const character = data.character || {};
    const attunement = character.attunement && typeof character.attunement === "object" ? character.attunement : {};
    const knownSpellIds = character.spellbook && Array.isArray(character.spellbook.known_spell_ids)
      ? character.spellbook.known_spell_ids
      : [];
    const feats = Array.isArray(character.feats) ? character.feats : [];
    const featSlots = character.feat_slots && typeof character.feat_slots === "object" ? character.feat_slots : {};
    return {
      ok: true,
      embeds: [buildProfileEmbed(data)],
      components: buildProfileComponents(),
      content: [
        `Name: ${cleanText(character.name, "unknown")}`,
        `Race: ${cleanText(character.race, character.race_id || "unknown")}`,
        `Track A: ${cleanText(character.class, character.class_id || "unknown")}`,
        `Track B: ${cleanText(character.secondary_class_id, "(none)")}`,
        `Track A Subclass: ${cleanText(character.class_option_id, "(none)")}`,
        `Track B Subclass: ${cleanText(character.secondary_class_option_id, "(none)")}`,
        `Level: ${Number.isFinite(Number(character.level)) ? Number(character.level) : 1}`,
        `XP: ${Number.isFinite(Number(character.xp)) ? Number(character.xp) : 0}`,
        `Known Spells: ${knownSpellIds.length}`,
        `Feats: ${feats.length} (${summarizeFeatPreview(feats)})`,
        `Feat Slots: ${Number.isFinite(Number(featSlots.used_slots)) ? Number(featSlots.used_slots) : 0}/${Number.isFinite(Number(featSlots.total_slots)) ? Number(featSlots.total_slots) : 0}${data.character && data.character.feat_available === true ? " • available" : ""}`,
        `Attunement: ${Number.isFinite(Number(attunement.slots_used)) ? Number(attunement.slots_used) : 0}/${Number.isFinite(Number(attunement.attunement_slots)) ? Number(attunement.attunement_slots) : 3}`,
        `Base Stats: ${character.base_stats ? formatStatLine(character.base_stats) : "unknown"}`,
        `Stats: ${character.stats ? formatStatLine(character.stats) : "unknown"}`
      ].join("\n"),
      data
    };
  }

  if (responseType === "feat") {
    const action = cleanText(data.action, "list");
    const slots = data.feat_slots && typeof data.feat_slots === "object" ? data.feat_slots : {};
    if (action === "take" && data.feat) {
      const feat = data.feat || {};
      return {
        ok: true,
        content: [
          `Feat claimed: ${cleanText(feat.name, feat.feat_id || "unknown")}`,
          cleanText(feat.description, "No feat description available."),
          `Slots: ${Number.isFinite(Number(slots.used_slots)) ? Number(slots.used_slots) : 0}/${Number.isFinite(Number(slots.total_slots)) ? Number(slots.total_slots) : 0}`,
          `Effects: ${Array.isArray(data.applied_effects) && data.applied_effects.length > 0 ? data.applied_effects.map((entry) => cleanText(entry.type, "effect")).join(", ") : "(none)"}`
        ].join("\n"),
        data
      };
    }

    const feats = Array.isArray(data.feats) ? data.feats : [];
    return {
      ok: true,
      content: [
        `Available feats: ${feats.length}`,
        `Slots: ${Number.isFinite(Number(slots.used_slots)) ? Number(slots.used_slots) : 0}/${Number.isFinite(Number(slots.total_slots)) ? Number(slots.total_slots) : 0}`,
        feats.length > 0
          ? feats.slice(0, 8).map((entry) => `- ${cleanText(entry.name, entry.feat_id || "unknown")}: ${cleanText(entry.description, "")}`).join("\n")
          : "No feats available."
      ].join("\n"),
      data
    };
  }

  if (responseType === "inventory") {
    if (data.inventory_found !== true || !data.inventory) {
      return {
        ok: true,
        content: "No inventory found for this player.",
        data
      };
    }

    const inventory = data.inventory || {};
    const currency = inventory.currency && typeof inventory.currency === "object" ? inventory.currency : {};
    return {
      ok: true,
      embeds: [buildInventoryDetailEmbed(data, "summary")],
      components: buildInventoryComponents("summary", data),
      content: [
        `Inventory ID: ${cleanText(inventory.inventory_id, "unknown")}`,
        `Gold: ${Number.isFinite(Number(currency.gold)) ? Number(currency.gold) : 0}`,
        `Stackables: ${Number.isFinite(Number(inventory.stackable_count)) ? Number(inventory.stackable_count) : 0}`,
        `Equipment: ${Number.isFinite(Number(inventory.equipment_count)) ? Number(inventory.equipment_count) : 0}`,
        `Quest Items: ${Number.isFinite(Number(inventory.quest_count)) ? Number(inventory.quest_count) : 0}`,
        `Magical: ${Number.isFinite(Number(inventory.magical_count)) ? Number(inventory.magical_count) : 0}`,
        `Unidentified: ${Number.isFinite(Number(inventory.unidentified_count)) ? Number(inventory.unidentified_count) : 0}`,
        `Attuned: ${Number.isFinite(Number(inventory.attuned_count)) ? Number(inventory.attuned_count) : 0}/${Number.isFinite(Number(inventory.attunement_slots)) ? Number(inventory.attunement_slots) : 3}`,
        `Equipment Preview: ${summarizeInventoryPreview(inventory.equipment_preview)}`,
        `Stackable Preview: ${summarizeInventoryPreview(inventory.stackable_preview)}`
      ].join("\n"),
      data
    };
  }

  if (responseType === "shop") {
    const stock = Array.isArray(data.stock) ? data.stock : [];
    const result = data.result && typeof data.result === "object" ? data.result : {};
    return {
      ok: true,
      embeds: stock.length > 0 ? [buildShopEmbed(data)] : [],
      components: stock.length > 0 ? buildShopComponents(data) : [],
      content: [
        `Vendor: ${cleanText(data.vendor_name, data.vendor_id || "unknown")}`,
        `Gold: ${Number.isFinite(Number(data.gold)) ? Number(data.gold) : 0}`,
        data.item_id ? `Item: ${cleanText(data.item_id, "unknown")}` : null,
        data.quantity ? `Quantity: ${Number(data.quantity)}` : null,
        result.gold_spent !== undefined ? `Gold Spent: ${Number(result.gold_spent)}` : null,
        result.gold_earned !== undefined ? `Gold Earned: ${Number(result.gold_earned)}` : null,
        Array.isArray(data.sellable_items) && data.sellable_items.length > 0
          ? `Sellable: ${data.sellable_items.slice(0, 5).map((entry) => cleanText(entry.item_name, entry.item_id)).join(" | ")}`
          : null,
        stock.length > 0 ? `Stock: ${stock.slice(0, 5).map((entry) => cleanText(entry.item_name, entry.item_id)).join(" | ")}` : null
      ].filter(Boolean).join("\n"),
      data
    };
  }

  if (responseType === "craft") {
    const nextData = Object.assign({ selected_filter: "all" }, data);
    const recipes = Array.isArray(nextData.recipes) ? nextData.recipes : [];
    const result = data.result && typeof data.result === "object" ? data.result : {};
    return {
      ok: true,
      embeds: recipes.length > 0 ? [buildCraftEmbed(nextData)] : [],
      components: recipes.length > 0 ? buildCraftComponents(nextData) : [],
      content: [
        nextData.recipe && nextData.recipe.recipe_name ? `Recipe: ${cleanText(nextData.recipe.recipe_name, nextData.recipe.recipe_id || "unknown")}` : null,
        nextData.recipe && nextData.recipe.output_item_id ? `Output: ${cleanText(nextData.recipe.output_item_id, "unknown")} x${Number(nextData.recipe.output_quantity || 1)}` : null,
        result.consumed_materials ? `Consumed: ${Array.isArray(result.consumed_materials) && result.consumed_materials.length > 0 ? result.consumed_materials.map((entry) => `${cleanText(entry.item_id, "item")} x${Number(entry.quantity || 1)}`).join(" | ") : "(none)"}` : null,
        recipes.length > 0 ? `Craftable: ${recipes.filter((entry) => entry && entry.craftable === true).length}/${recipes.length}` : null
      ].filter(Boolean).join("\n") || "Crafting ledger loaded.",
      data: nextData
    };
  }

  if (responseType === "trade") {
    const trades = Array.isArray(data.trades) ? data.trades : [];
    const trade = data.trade && typeof data.trade === "object" ? data.trade : null;
    return {
      ok: true,
      embeds: [buildTradeEmbed(data, null)],
      components: buildTradeComponents(data, null),
      content: [
        trade && trade.trade_id ? `Trade: ${cleanText(trade.trade_id, "unknown")}` : null,
        trade && trade.trade_state ? `State: ${cleanText(trade.trade_state, "unknown")}` : null,
        trade ? `Offer: ${formatTradeOffer(trade.offered)}` : null,
        trade ? `Request: ${formatTradeOffer(trade.requested)}` : null,
        `Open Trades: ${trades.length}`
      ].filter(Boolean).join("\n") || "Trade ledger loaded.",
      data
    };
  }

  if (responseType === "identify" || responseType === "attune" || responseType === "unattune") {
    const item = data.item && typeof data.item === "object" ? data.item : {};
    const character = data.character && typeof data.character === "object" ? data.character : {};
    const attunement = character.attunement && typeof character.attunement === "object" ? character.attunement : {};
    return {
      ok: true,
      content: [
        `Item: ${cleanText(item.item_name, item.item_id || "unknown")}`,
        `Type: ${cleanText(item.item_type, "unknown")}`,
        `Magical: ${String(Boolean(item.magical || item.is_attuned || item.requires_attunement))}`,
        `Requires Attunement: ${String(Boolean(item.requires_attunement))}`,
        `Attuned: ${String(Boolean(item.is_attuned))}`,
        `Slots Used: ${Number.isFinite(Number(attunement.slots_used)) ? Number(attunement.slots_used) : 0}/${Number.isFinite(Number(attunement.attunement_slots)) ? Number(attunement.attunement_slots) : 3}`
      ].join("\n"),
      data
    };
  }

  if (responseType === "admin") {
    const result = data.result && typeof data.result === "object" ? data.result : {};
    return {
      ok: true,
      content: [
        `Admin action succeeded`,
        `Type: ${cleanText(data.admin_event_type, "unknown_admin_result")}`,
        `Summary: ${cleanText(result.summary || result.message || result.status, "structured result available")}`
      ].join("\n"),
      data
    };
  }

  if (responseType === "cast") {
    const combatSummary = data.combat_summary && typeof data.combat_summary === "object" ? data.combat_summary : null;
    const actionLines = [
      buildCombatParticipantStateLine(combatSummary, data.caster_id, "Caster", {
        include_hp: false,
        include_grid: false,
        include_conditions: false
      }) || `Caster: ${cleanText(data.caster_id, "unknown")}`,
      `Spell: ${cleanText(data.spell_name, data.spell_id || "unknown")}`,
      `Target: ${summarizeTargetSelection(data, combatSummary)}`,
      `Result: ${summarizeSpellResolution(data)}`
    ];
    const targetLines = buildTargetResultLines(data.target_results, combatSummary);
    const stateLines = targetLines.length > 0 ? targetLines.slice() : [
      buildDamageStateLine(data.damage_result, null, data.damage_type),
      buildHealingStateLine(data.healing_result),
      buildVitalityStateLine(data.vitality_result),
      buildDefenseStateLine(data.defense_result)
    ].filter(Boolean);
    const gainedConditions = summarizeConditionEntries(data.applied_conditions);
    const lostConditions = summarizeConditionEntries(data.removed_conditions);

    if (targetLines.length === 0 && gainedConditions) {
      stateLines.push(`Conditions Gained: ${gainedConditions}`);
    }
    if (targetLines.length === 0 && lostConditions) {
      stateLines.push(`Conditions Lost: ${lostConditions}`);
    }
    stateLines.push(...summarizeConcentrationUpdate(data));

    return buildCombatFeedReply({
      title: "Spell Cast",
      color: 0x8b5cf6,
      footer: "Combat Spell Feed",
      data,
      sections: [
        { name: "Action", lines: actionLines },
        { name: "State Changes", lines: stateLines },
        { name: "Turn", lines: buildCombatTurnLines(data, combatSummary) }
      ]
    });
  }

  if (responseType === "attack") {
    const combatSummary = data.combat_summary && typeof data.combat_summary === "object" ? data.combat_summary : null;
    const actionLines = [
      buildCombatParticipantStateLine(combatSummary, data.attacker_id, "Attacker", {
        include_hp: false,
        include_grid: false,
        include_conditions: false
      }) || `Attacker: ${cleanText(data.attacker_id, "unknown")}`,
      buildCombatParticipantStateLine(combatSummary, data.target_id, "Target", {
        include_hp: false,
        include_grid: false,
        include_conditions: false
      }) || `Target: ${cleanText(data.target_id, "unknown")}`,
      `Result: ${summarizeAttackResult(data)}`
    ];
    const stateLines = [
      buildDamageStateLine(data.damage_result, data.damage_dealt, data.damage_type),
      buildCombatParticipantStateLine(combatSummary, data.target_id, "Target State"),
      ...summarizeConcentrationUpdate(data)
    ].filter(Boolean);

    return buildCombatFeedReply({
      title: "Attack Resolved",
      color: data.hit ? 0xb3d944 : 0xed4245,
      footer: "Combat Attack Feed",
      data,
      sections: [
        { name: "Action", lines: actionLines },
        { name: "State Changes", lines: stateLines },
        { name: "Turn", lines: buildCombatTurnLines(data, combatSummary) }
      ]
    });
  }

  if (responseType === "assist") {
    const combatSummary = data.combat_summary && typeof data.combat_summary === "object" ? data.combat_summary : null;
    const conditionType = data.applied_condition && data.applied_condition.condition_type
      ? String(data.applied_condition.condition_type)
      : "helped_attack";
    const actionLines = [
      buildCombatParticipantStateLine(combatSummary, data.helper_id, "Helper", {
        include_hp: false,
        include_grid: false,
        include_conditions: false
      }) || `Helper: ${cleanText(data.helper_id, "unknown")}`,
      buildCombatParticipantStateLine(combatSummary, data.target_id, "Target", {
        include_hp: false,
        include_grid: false,
        include_conditions: false
      }) || `Target: ${cleanText(data.target_id, "unknown")}`,
      `Effect: ${formatConditionLabel(conditionType)} applied`
    ];
    const stateLines = [
      buildCombatParticipantStateLine(combatSummary, data.target_id, "Target State")
    ];
    if (!stateLines[0]) {
      stateLines.push(`Conditions Gained: ${formatConditionLabel(conditionType)}`);
    }
    return buildCombatFeedReply({
      title: "Assist Used",
      color: 0x3498db,
      footer: "Combat Assist Feed",
      data,
      sections: [
        { name: "Action", lines: actionLines },
        { name: "State Changes", lines: stateLines.filter(Boolean) },
        { name: "Turn", lines: buildCombatTurnLines(data, combatSummary) }
      ]
    });
  }

  if (responseType === "grapple") {
    const combatSummary = data.combat_summary && typeof data.combat_summary === "object" ? data.combat_summary : null;
    const actionLines = [
      buildCombatParticipantStateLine(combatSummary, data.attacker_id, "Attacker", {
        include_hp: false,
        include_grid: false,
        include_conditions: false
      }) || `Attacker: ${cleanText(data.attacker_id, "unknown")}`,
      buildCombatParticipantStateLine(combatSummary, data.target_id, "Target", {
        include_hp: false,
        include_grid: false,
        include_conditions: false
      }) || `Target: ${cleanText(data.target_id, "unknown")}`,
      `Result: ${data.applied_condition ? "Grappled" : "No effect"}`
    ];
    const stateLines = [
      buildCombatParticipantStateLine(combatSummary, data.target_id, "Target State")
    ];
    if (!stateLines[0] && data.applied_condition) {
      stateLines.push(`Conditions Gained: ${formatCombatConditionEntry(data.applied_condition)}`);
    }
    return buildCombatFeedReply({
      title: "Grapple Attempt",
      color: 0xf39c12,
      footer: "Combat Grapple Feed",
      data,
      sections: [
        { name: "Action", lines: actionLines },
        { name: "State Changes", lines: stateLines.filter(Boolean) },
        { name: "Turn", lines: buildCombatTurnLines(data, combatSummary) }
      ]
    });
  }

  if (responseType === "escape") {
    const combatSummary = data.combat_summary && typeof data.combat_summary === "object" ? data.combat_summary : null;
    const removedCondition = formatCombatConditionEntry(data.removed_condition);
    return buildCombatFeedReply({
      title: "Escape Grapple",
      color: 0x2ecc71,
      footer: "Combat Escape Feed",
      data,
      sections: [
        {
          name: "Action",
          lines: [
            buildCombatParticipantStateLine(combatSummary, data.participant_id, "Actor", {
              include_hp: false,
              include_grid: false,
              include_conditions: false
            }) || `Actor: ${cleanText(data.participant_id, "unknown")}`,
            buildCombatParticipantStateLine(combatSummary, data.source_actor_id, "From Grappler", {
              include_hp: false,
              include_grid: false,
              include_conditions: false
            }) || `From Grappler: ${cleanText(data.source_actor_id, "unknown")}`,
            `Result: ${data.escaped === true ? "Escaped" : "Failed to escape"}`
          ]
        },
        {
          name: "State Changes",
          lines: [
            buildCombatParticipantStateLine(combatSummary, data.participant_id, "Actor State"),
            removedCondition ? `Conditions Lost: ${removedCondition}` : ""
          ].filter(Boolean)
        },
        {
          name: "Turn",
          lines: buildCombatTurnLines(data, combatSummary)
        }
      ]
    });
  }

  if (responseType === "shove") {
    const combatSummary = data.combat_summary && typeof data.combat_summary === "object" ? data.combat_summary : null;
    const appliedCondition = formatCombatConditionEntry(data.applied_condition);
    return buildCombatFeedReply({
      title: "Shove Attempt",
      color: 0xe67e22,
      footer: "Combat Shove Feed",
      data,
      sections: [
        {
          name: "Action",
          lines: [
            buildCombatParticipantStateLine(combatSummary, data.attacker_id, "Attacker", {
              include_hp: false,
              include_grid: false,
              include_conditions: false
            }) || `Attacker: ${cleanText(data.attacker_id, "unknown")}`,
            buildCombatParticipantStateLine(combatSummary, data.target_id, "Target", {
              include_hp: false,
              include_grid: false,
              include_conditions: false
            }) || `Target: ${cleanText(data.target_id, "unknown")}`,
            `Mode: ${cleanText(data.mode, "push")}`,
            `Result: ${data.success === true ? "Success" : "Failed"}`
          ]
        },
        {
          name: "State Changes",
          lines: [
            data.moved_to ? `Moved To: ${formatPosition(data.moved_to)}` : "",
            appliedCondition ? `Conditions Gained: ${appliedCondition}` : "",
            buildCombatParticipantStateLine(combatSummary, data.target_id, "Target State")
          ].filter(Boolean)
        },
        {
          name: "Turn",
          lines: buildCombatTurnLines(data, combatSummary)
        }
      ]
    });
  }

  if (responseType === "ready") {
    const combatSummary = data.combat_summary && typeof data.combat_summary === "object" ? data.combat_summary : null;
    const triggerType = cleanText(data.ready_action && data.ready_action.trigger_type, "enemy_enters_reach");
    const actionType = cleanText(data.ready_action && data.ready_action.action_type, "attack");
    return buildCombatFeedReply({
      title: "Ready Set",
      color: 0x95a5a6,
      footer: "Combat Ready Feed",
      data,
      sections: [
        {
          name: "Action",
          lines: [
            buildCombatParticipantStateLine(combatSummary, data.participant_id, "Actor", {
              include_hp: false,
              include_grid: false,
              include_conditions: false
            }) || `Actor: ${cleanText(data.participant_id, "unknown")}`,
            `Trigger: ${triggerType}`,
            `Readied Action: ${actionType}`
          ]
        },
        {
          name: "State Changes",
          lines: [
            buildCombatParticipantStateLine(combatSummary, data.participant_id, "Actor State")
          ].filter(Boolean)
        },
        {
          name: "Turn",
          lines: buildCombatTurnLines(data, combatSummary)
        }
      ]
    });
  }

  if (responseType === "dodge") {
    const combatSummary = data.combat_summary && typeof data.combat_summary === "object" ? data.combat_summary : null;
    return buildCombatFeedReply({
      title: "Dodge Taken",
      color: 0xf1c40f,
      footer: "Combat Dodge Feed",
      data,
      sections: [
        {
          name: "Action",
          lines: [
            buildCombatParticipantStateLine(combatSummary, data.participant_id, "Actor", {
              include_hp: false,
              include_grid: false,
              include_conditions: false
            }) || `Actor: ${cleanText(data.participant_id, "unknown")}`,
            "Action: Dodge",
            `Result: ${data.is_dodging === true ? "Dodge active" : "Dodge inactive"}`
          ]
        },
        {
          name: "State Changes",
          lines: [
            buildCombatParticipantStateLine(combatSummary, data.participant_id, "Actor State")
          ].filter(Boolean)
        },
        {
          name: "Turn",
          lines: buildCombatTurnLines(data, combatSummary)
        }
      ]
    });
  }

  if (responseType === "dash") {
    const combatSummary = data.combat_summary && typeof data.combat_summary === "object" ? data.combat_summary : null;
    return buildCombatFeedReply({
      title: "Dash Taken",
      color: 0x3498db,
      footer: "Combat Dash Feed",
      data,
      sections: [
        {
          name: "Action",
          lines: [
            buildCombatParticipantStateLine(combatSummary, data.participant_id, "Actor", {
              include_hp: false,
              include_grid: false,
              include_conditions: false
            }) || `Actor: ${cleanText(data.participant_id, "unknown")}`,
            `Movement: ${Number.isFinite(Number(data.movement_before)) ? Number(data.movement_before) : 0} -> ${Number.isFinite(Number(data.movement_after)) ? Number(data.movement_after) : 0}`,
            `Added: +${Number.isFinite(Number(data.movement_added)) ? Number(data.movement_added) : 0} feet`
          ]
        },
        {
          name: "State Changes",
          lines: [
            buildCombatParticipantStateLine(combatSummary, data.participant_id, "Actor State")
          ].filter(Boolean)
        },
        {
          name: "Turn",
          lines: buildCombatTurnLines(data, combatSummary)
        }
      ]
    });
  }

  if (responseType === "disengage") {
    const combatSummary = data.combat_summary && typeof data.combat_summary === "object" ? data.combat_summary : null;
    return buildCombatFeedReply({
      title: "Disengage Taken",
      color: 0x57f287,
      footer: "Combat Disengage Feed",
      data,
      sections: [
        {
          name: "Action",
          lines: [
            buildCombatParticipantStateLine(combatSummary, data.participant_id, "Actor", {
              include_hp: false,
              include_grid: false,
              include_conditions: false
            }) || `Actor: ${cleanText(data.participant_id, "unknown")}`,
            "Action: Disengage",
            "Result: Disengage active"
          ]
        },
        {
          name: "State Changes",
          lines: [
            buildCombatParticipantStateLine(combatSummary, data.participant_id, "Actor State")
          ].filter(Boolean)
        },
        {
          name: "Turn",
          lines: buildCombatTurnLines(data, combatSummary)
        }
      ]
    });
  }

  if (responseType === "move") {
    if (data.to_room_id || data.from_room_id) {
      return {
        ok: true,
        content: [
          `From: ${cleanText(data.from_room_id, "unknown")}`,
          `To: ${cleanText(data.to_room_id, "unknown")}`,
          data.trap_trigger && data.trap_trigger.object_id
            ? `Trap: triggered (${cleanText(data.trap_trigger.object_id, "unknown")})`
            : "Trap: none",
          ...summarizeRoomForReply(data.room)
        ].join("\n"),
        components: buildDungeonRoomComponents(data),
        data
      };
    }
    return {
      ok: true,
      ...buildCombatFeedReply({
        title: "Combat Movement",
        color: 0x5865f2,
        footer: "Combat Movement Feed",
        data,
        sections: [
          {
            name: "Action",
            lines: [
              buildCombatParticipantStateLine(data.combat_summary, data.participant_id, "Actor", {
                include_hp: false,
                include_grid: false,
                include_conditions: false
              }) || `Actor: ${cleanText(data.participant_id, "unknown")}`,
              `From: ${formatPosition(data.from_position)}`,
              `To: ${formatPosition(data.to_position)}`,
              "Result: Movement resolved"
            ]
          },
          {
            name: "State Changes",
            lines: [
              buildCombatParticipantStateLine(data.combat_summary, data.participant_id, "Actor State"),
              Number.isFinite(Number(data.opportunity_attack_count))
                ? `Opportunity Attacks: ${Number(data.opportunity_attack_count)}`
                : "",
              Number.isFinite(Number(data.ready_attack_count))
                ? `Readied Attacks: ${Number(data.ready_attack_count)}`
                : ""
            ].filter(Boolean)
          },
          {
            name: "Turn",
            lines: buildCombatTurnLines(data, data.combat_summary)
          }
        ]
      })
    };
  }

  if (responseType === "interact") {
    const stateLabel =
      data.object_state && data.object_state.is_locked ? "Locked"
        : data.object_state && data.object_state.is_disarmed ? "Disarmed"
          : data.object_state && data.object_state.is_lit ? "Lit"
          : data.object_state && data.object_state.is_opened ? "Opened"
            : "Updated";
    return {
      ok: true,
      content: [
        `Object: ${cleanText(data.object_name, data.object_id || "unknown")}`,
        `Type: ${cleanText(data.object_type, "unknown")}`,
        `Action: ${cleanText(data.interaction_action, "unknown")}`,
        `State: ${stateLabel}`,
        ...summarizeSpellEffect(data.spell_effect),
        ...summarizeSkillCheck(data.skill_check),
        ...summarizeSkillCheck(data.tool_check),
        ...summarizeSkillCheck(data.ability_check),
        ...summarizeInteractionEffects(data.interaction_effects),
        `Reward: ${cleanText(data.reward_status, "none")}`,
        ...summarizeRoomForReply(data.room)
      ].join("\n"),
      components: buildDungeonRoomComponents(data),
      data
    };
  }

  if (responseType === "dungeon_enter") {
    return {
      ok: true,
      content: [
        `Session: ${cleanText(data.session && data.session.session_id, "unknown")}`,
        `Dungeon: ${cleanText(data.session && data.session.dungeon_id, "unknown")}`,
        `Status: ${cleanText(data.session && data.session.status, "unknown")}`,
        ...summarizeRoomForReply(data.room)
      ].join("\n"),
      components: buildDungeonRoomComponents(data),
      data
    };
  }

  if (responseType === "use") {
    if (data.use_status === "resolved" && data.combat_id) {
      const combatSummary = data.combat_summary && typeof data.combat_summary === "object" ? data.combat_summary : null;
      const gainedConditions = summarizeConditionEntries(data.applied_conditions);
      const lostConditions = summarizeConditionEntries(data.removed_conditions);
      return buildCombatFeedReply({
        title: "Combat Item Use",
        color: 0x2d8f6f,
        footer: "Combat Item Feed",
        data,
        sections: [
          {
            name: "Action",
            lines: [
              buildCombatParticipantStateLine(combatSummary, data.participant_id, "Actor", {
                include_hp: false,
                include_grid: false,
                include_conditions: false
              }) || `Actor: ${cleanText(data.participant_id, "unknown")}`,
              `Item: ${cleanText(data.item_id, "unknown")}`,
              "Result: Item resolved"
            ]
          },
          {
            name: "State Changes",
            lines: [
              buildHpDeltaText(data.hp_before, data.hp_after) ? `HP: ${buildHpDeltaText(data.hp_before, data.hp_after)}` : "",
              Number.isFinite(Number(data.healed_for)) ? `Healing: ${Number(data.healed_for)}` : "",
              buildTempHpDeltaText(data.temporary_hp_before, data.temporary_hp_after)
                ? `Temporary HP: ${buildTempHpDeltaText(data.temporary_hp_before, data.temporary_hp_after)}`
                : "",
              Number.isFinite(Number(data.temporary_hitpoints_granted)) && Number(data.temporary_hitpoints_granted) > 0
                ? `Granted Temp HP: ${Number(data.temporary_hitpoints_granted)}`
                : "",
              gainedConditions ? `Conditions Gained: ${gainedConditions}` : "",
              lostConditions ? `Conditions Lost: ${lostConditions}` : "",
              buildCombatParticipantStateLine(combatSummary, data.participant_id, "Actor State")
            ].filter(Boolean)
          },
          {
            name: "Turn",
            lines: buildCombatTurnLines(data, combatSummary)
          }
        ]
      });
    }

    return {
      ok: true,
      content: [
        `Use status: ${cleanText(data.use_status, "resolved")}`,
        `Item: ${cleanText(data.item_id, "unknown")}`,
        `Inventory: ${cleanText(data.inventory_id, "(none)")}`,
        `HP: ${data.hp_before === undefined ? "(unknown)" : String(data.hp_before)} -> ${data.hp_after === undefined ? "(unknown)" : String(data.hp_after)}`,
        `Temp HP: ${data.temporary_hp_before === undefined ? 0 : String(data.temporary_hp_before)} -> ${data.temporary_hp_after === undefined ? 0 : String(data.temporary_hp_after)}`
      ].join("\n"),
      data
    };
  }

  if (responseType === "combat") {
    const combatSummary = data.combat_summary && typeof data.combat_summary === "object" ? data.combat_summary : null;
    if (!combatSummary) {
      return {
        ok: true,
        content: "No active combat found.",
        data
      };
    }

    return {
      ok: true,
      embeds: [buildCombatStateEmbed(combatSummary)],
      components: buildCombatStatusComponents({ combat_id: combatSummary.combat_id || data.combat_id || null }),
      content: [
        `Combat: ${cleanText(combatSummary.combat_id, "unknown")}`,
        `Round: ${Number.isFinite(Number(combatSummary.round)) ? Number(combatSummary.round) : 1}`,
        `Status: ${cleanText(combatSummary.status, "unknown")}`,
        `Active: ${cleanText(combatSummary.active_participant_id, "(none)")}`,
        `Participants: ${summarizeCombatParticipantsForReply(combatSummary)}`
      ].join("\n"),
      data
    };
  }

  return {
    ok: true,
    content: responseType + " completed.",
    data
  };
}

function hasCombatSummary(data) {
  return Boolean(data && data.combat_summary && typeof data.combat_summary === "object");
}

function hasDungeonRoomSnapshot(data) {
  return Boolean(data && data.room && typeof data.room === "object");
}

function isCombatActionReplyData(data) {
  const safe = data && typeof data === "object" ? data : {};
  return safe.attack_status === "resolved" ||
    safe.cast_status === "resolved" ||
    safe.move_status === "resolved" ||
    safe.dodge_status === "resolved" ||
    (safe.use_status === "resolved" && Boolean(safe.combat_id));
}

function buildCombatBoardReply(reply) {
  if (!reply || !reply.ok || !hasCombatSummary(reply.data)) {
    return reply;
  }

  const combatSummary = reply.data && reply.data.combat_summary;
  const combatId = cleanText(
    reply.data && reply.data.combat_id,
    cleanText(combatSummary && combatSummary.combat_id, "")
  );

  return {
    ok: true,
    content: "",
    embeds: [buildCombatStateEmbed(combatSummary)],
    components: buildCombatStatusComponents({ combat_id: combatId || null }),
    files: [],
    data: reply.data
  };
}

function buildCombatTextOnlyTurnSummary(reply) {
  if (!reply || !reply.ok || !hasCombatSummary(reply.data) || !isCombatActionReplyData(reply.data)) {
    return "";
  }
  return cleanText(reply.content, "");
}

function buildCombatReadEvent(userId, combatId) {
  return createEvent(EVENT_TYPES.PLAYER_COMBAT_REQUESTED, {
    command_name: "combat",
    combat_id: combatId
  }, {
    source: "gateway.discord",
    target_system: "combat_system",
    player_id: userId,
    combat_id: combatId
  });
}

async function attachCombatMapToReply(reply, userId, storedView, options) {
  if (!reply || !reply.ok || !hasCombatSummary(reply.data)) {
    return reply;
  }

  const mapView = await buildCombatMapView({
    data: reply.data,
    user_id: userId,
    token_overrides: storedView && Array.isArray(storedView.token_overrides) ? storedView.token_overrides : [],
    interaction_state: storedView && storedView.interaction_state ? storedView.interaction_state : null,
    content: options && options.map_content ? options.map_content : "",
    component_rows: options && Array.isArray(options.component_rows) ? options.component_rows : null,
    map_override: options && options.map_override ? options.map_override : null,
    suffix: options && options.suffix ? options.suffix : null
  });
  if (!mapView.ok) {
    return reply;
  }

  const combatId = cleanText(reply.data.combat_id, cleanText(reply.data.combat_summary && reply.data.combat_summary.combat_id, ""));
  if (combatId) {
    setCombatMapView(userId, combatId, {
      combat_id: combatId,
      map_config: mapView.payload.map_config,
      interaction_state: mapView.payload.interaction_state,
      token_overrides: mapView.payload.token_overrides,
      token_catalog: mapView.payload.token_catalog
    });
  }

  return Object.assign({}, reply, {
    content: [reply.content, mapView.payload.content].filter(Boolean).join("\n\n"),
    files: [].concat(Array.isArray(reply.files) ? reply.files : [], mapView.payload.files || []),
    components: [].concat(Array.isArray(reply.components) ? reply.components : [], mapView.payload.components || [])
  });
}

async function attachDungeonMapToReply(reply, userId, storedView, options) {
  if (!reply || !reply.ok || !hasDungeonRoomSnapshot(reply.data)) {
    return reply;
  }

  const mapView = await buildDungeonMapView({
    data: reply.data,
    user_id: userId,
    view_state: storedView && storedView.view_state ? storedView.view_state : null,
    content: options && options.map_content ? options.map_content : "",
    suffix: options && options.suffix ? options.suffix : null
  });
  if (!mapView.ok) {
    return reply;
  }

  const sessionId = cleanText(reply.data.session_id, cleanText(reply.data.session && reply.data.session.session_id, ""));
  if (sessionId) {
    setDungeonMapView(userId, sessionId, {
      session_id: sessionId,
      view_state: mapView.payload.view_state || { mode: "idle" },
      map_config: mapView.payload.map_config,
      dungeon_map: mapView.payload.dungeon_map || {},
      data: clone(reply.data)
    });
  }

  return Object.assign({}, reply, {
    content: [reply.content, mapView.payload.content].filter(Boolean).join("\n\n"),
    files: [].concat(Array.isArray(reply.files) ? reply.files : [], mapView.payload.files || []),
    components: [].concat(Array.isArray(reply.components) ? reply.components : [], mapView.payload.components || [])
  });
}

function buildStartCompleteEmbed(runtimeResult) {
  const reply = formatGatewayReplyFromRuntime(runtimeResult);
  const data = reply.data || {};
  const character = data.character || {};
  const points = data.point_buy_summary || null;
  const baseStats = character.base_stats || (points && points.abilities) || null;
  return new EmbedBuilder()
    .setTitle(reply.ok ? "Character created" : "Character creation failed")
    .setColor(reply.ok ? 0x57f287 : 0xed4245)
    .setDescription(reply.content)
    .addFields(
      {
        name: "Character",
        value: [
          `Name: ${character.name || "unknown"}`,
          `Race: ${character.race || "unknown"}`,
          `Track A: ${character.class || "unknown"}`,
          `Track B: ${character.secondary_class_id || "unknown"}`,
          `Level: ${character.level || 1}`,
          `Base Stats: ${baseStats ? formatStatLine(baseStats) : "unknown"}`,
          `Stats: ${character.stats ? formatStatLine(character.stats) : "unknown"}`
        ].join("\n")
      },
      {
        name: "Point-buy",
        value: points ? `Spent: ${points.total_cost || 0}/27 | Remaining: ${points.remaining_points || 0}` : "not set"
      }
    );
}

async function respondInteraction(interaction, payload) {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(Object.assign({}, payload, { ephemeral: true }));
    return;
  }

  await interaction.reply(Object.assign({}, payload, { ephemeral: true }));
}

async function refreshInteractionMessage(interaction, payload) {
  const safePayload = Object.assign({}, payload);
  delete safePayload.ephemeral;

  if (
    typeof interaction.update === "function" &&
    !interaction.deferred &&
    !interaction.replied
  ) {
    await interaction.update(safePayload);
    return;
  }

  if (typeof interaction.deferUpdate === "function" && typeof interaction.editReply === "function") {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }
    await interaction.editReply(safePayload);
    return;
  }

  await respondInteraction(interaction, safePayload);
}

function syncSessionPointBuy(session) {
  const safe = session || {};
  const stats =
    safe.stats ||
    (safe.point_buy_summary && safe.point_buy_summary.abilities) ||
    createBasePointBuyStats();
  safe.stats = stats;
  safe.point_buy_summary = getPointBuySummary(stats);
  safe.point_buy_confirmed = safe.point_buy_confirmed === true && safe.point_buy_summary.total_cost === 27;
  if (!safe.selected_ability || !ABILITY_FIELDS.includes(safe.selected_ability)) {
    safe.selected_ability = ABILITY_FIELDS[0];
  }
  return safe;
}

function adjustSelectedAbility(session, delta) {
  const safe = syncSessionPointBuy(Object.assign({}, session));
  const selectedAbility = safe.selected_ability;
  const currentValue = Number(safe.stats[selectedAbility]) || 8;
  const nextValue = currentValue + delta;

  if (nextValue < 8 || nextValue > 15) {
    return {
      ok: false,
      error: `${toAbilityLabel(selectedAbility)} must stay between 8 and 15.`
    };
  }

  const nextStats = Object.assign({}, safe.stats, {
    [selectedAbility]: nextValue
  });
  const nextSummary = getPointBuySummary(nextStats);
  if (nextSummary.total_cost > 27) {
    return {
      ok: false,
      error: `Point-buy cannot exceed 27. Current spend would be ${nextSummary.total_cost}.`
    };
  }

  safe.stats = nextStats;
  safe.point_buy_summary = nextSummary;
  safe.point_buy_confirmed = false;
  return { ok: true, session: safe };
}

function resetSelectedAbility(session) {
  const safe = syncSessionPointBuy(Object.assign({}, session));
  const selectedAbility = safe.selected_ability;
  safe.stats = Object.assign({}, safe.stats, {
    [selectedAbility]: 8
  });
  safe.point_buy_summary = getPointBuySummary(safe.stats);
  safe.point_buy_confirmed = false;
  return safe;
}

async function handleStartComponent(interaction, runtime) {
  const userId = extractInteractionUser(interaction);
  const customId = interaction.customId || "";

  if (!userId) {
    await respondInteraction(interaction, { content: "Could not identify user." });
    return;
  }

  if (customId === CUSTOM_IDS.pointBuyButton) {
    const session = syncSessionPointBuy(getStartSession(userId) || {});
    session.view = "point_buy";
    setStartSession(userId, session);
    await refreshInteractionMessage(interaction, buildStartUpdateMessage(session, "Point-buy editor opened."));
    return;
  }

  if (customId === CUSTOM_IDS.pointBuyDecrease || customId === CUSTOM_IDS.pointBuyIncrease) {
    const session = getStartSession(userId);
    if (!session) {
      await respondInteraction(interaction, { content: "No active start session found. Run /start again." });
      return;
    }

    const delta = customId === CUSTOM_IDS.pointBuyIncrease ? 1 : -1;
    const out = adjustSelectedAbility(session, delta);
    if (!out.ok) {
      await respondInteraction(interaction, { content: out.error || "Point-buy adjustment failed." });
      return;
    }

    out.session.view = "point_buy";
    setStartSession(userId, out.session);
    await refreshInteractionMessage(interaction, buildStartUpdateMessage(out.session, "Point-buy updated."));
    return;
  }

  if (customId === CUSTOM_IDS.pointBuyResetAbility || customId === CUSTOM_IDS.pointBuyResetAll) {
    const session = getStartSession(userId);
    if (!session) {
      await respondInteraction(interaction, { content: "No active start session found. Run /start again." });
      return;
    }

    const nextSession = customId === CUSTOM_IDS.pointBuyResetAll
      ? syncSessionPointBuy(Object.assign({}, session, { stats: createBasePointBuyStats() }))
      : resetSelectedAbility(session);
    nextSession.view = "point_buy";
    setStartSession(userId, nextSession);
    await refreshInteractionMessage(interaction, buildStartUpdateMessage(nextSession, "Point-buy reset."));
    return;
  }

  if (customId === CUSTOM_IDS.pointBuyConfirm) {
    const session = syncSessionPointBuy(getStartSession(userId) || {});
    if (!isPointBuyComplete(session)) {
      await respondInteraction(interaction, { content: "Spend all 27 points before confirming point-buy." });
      return;
    }

    session.point_buy_confirmed = true;
    session.view = "wizard";
    setStartSession(userId, session);
    await refreshInteractionMessage(interaction, buildStartUpdateMessage(session, "Point-buy confirmed."));
    return;
  }

  if (customId === CUSTOM_IDS.pointBuyBack) {
    const session = syncSessionPointBuy(getStartSession(userId) || {});
    session.view = "wizard";
    setStartSession(userId, session);
    await refreshInteractionMessage(interaction, buildStartUpdateMessage(session, "Returned to start wizard."));
    return;
  }

  if (customId === CUSTOM_IDS.createButton) {
    const session = syncSessionPointBuy(getStartSession(userId));
    if (!session) {
      await respondInteraction(interaction, { content: "No active start session found. Run /start again." });
      return;
    }

    if (!canSubmit(session)) {
      await respondInteraction(interaction, { content: "Choose race, both classes, and confirm the full 27-point buy before creating." });
      return;
    }

    const requestedStats =
      (session.point_buy_summary && session.point_buy_summary.abilities) ||
      session.stats ||
      null;

    const event = createEvent(EVENT_TYPES.PLAYER_START_REQUESTED, {
      command_name: "start",
      requested_character_name: session.requested_character_name || null,
      race_id: session.race_id,
      race_option_id: session.race_option_id || null,
      class_id: session.class_id,
      class_option_id: session.class_option_id || null,
      secondary_class_id: session.secondary_class_id,
      secondary_class_option_id: session.secondary_class_option_id || null,
      stats: requestedStats
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: userId
    });

    const runtimeResult = await runtime.processGatewayReadCommandEvent(event);
    const embed = buildStartCompleteEmbed(runtimeResult);
    deleteStartSession(userId);

    await refreshInteractionMessage(interaction, {
      content: null,
      embeds: [embed],
      components: []
    });
    return;
  }

  if (customId === CUSTOM_IDS.raceSelect || customId === CUSTOM_IDS.classSelect ||
      customId === CUSTOM_IDS.secondaryClassSelect || customId === CUSTOM_IDS.raceOptionSelect ||
      customId === CUSTOM_IDS.classOptionSelect || customId === CUSTOM_IDS.secondaryClassOptionSelect ||
      customId === CUSTOM_IDS.pointBuyAbilitySelect) {
    const session = syncSessionPointBuy(getStartSession(userId) || {});
    const selected = normalizeSelection(interaction.values && interaction.values[0]);

    if (!selected) {
      await respondInteraction(interaction, { content: "Please select a valid value." });
      return;
    }

    if (selected === "none") {
      await respondInteraction(interaction, { content: "This option is currently unavailable." });
      return;
    }

    if (customId === CUSTOM_IDS.raceSelect) {
      session.race_id = selected;
      session.race_option_id = null;
    } else if (customId === CUSTOM_IDS.classSelect) {
      session.class_id = selected;
      session.class_option_id = null;
    } else if (customId === CUSTOM_IDS.secondaryClassSelect) {
      session.secondary_class_id = selected;
      session.secondary_class_option_id = null;
    } else if (customId === CUSTOM_IDS.raceOptionSelect) {
      session.race_option_id = selected;
    } else if (customId === CUSTOM_IDS.classOptionSelect) {
      session.class_option_id = selected;
    } else if (customId === CUSTOM_IDS.secondaryClassOptionSelect) {
      session.secondary_class_option_id = selected;
    } else if (customId === CUSTOM_IDS.pointBuyAbilitySelect) {
      session.selected_ability = selected;
      session.view = "point_buy";
    }

    setStartSession(userId, session);
    await refreshInteractionMessage(interaction, buildStartUpdateMessage(session, "Selections updated."));
    return;
  }

  await respondInteraction(interaction, { content: "Unknown start interaction." });
}

async function handleStartWizard(interaction, mappedEvent) {
  const payload = mappedEvent.payload || {};
  const session = {
    requested_character_name: payload.requested_character_name || "",
    race_id: normalizeSelection(payload.race_id),
    race_option_id: normalizeSelection(payload.race_option_id),
    class_id: normalizeSelection(payload.class_id),
    class_option_id: normalizeSelection(payload.class_option_id),
    secondary_class_id: normalizeSelection(payload.secondary_class_id),
    secondary_class_option_id: normalizeSelection(payload.secondary_class_option_id),
    stats: createBasePointBuyStats(),
    point_buy_summary: getPointBuySummary(createBasePointBuyStats()),
    point_buy_confirmed: false,
    selected_ability: ABILITY_FIELDS[0],
    view: "wizard"
  };

  setStartSession(extractInteractionUser(interaction), session);
  await interaction.reply(buildStartMessage(session, "Use the controls to pick race, both gestalt classes, and stats."));
}

function isStartComponentInteraction(interaction) {
  if (!interaction || !interaction.customId) {
    return false;
  }

  return interaction.customId.startsWith("start:");
}

function isInventoryComponentInteraction(interaction) {
  if (!interaction || !interaction.customId) {
    return false;
  }

  return interaction.customId.startsWith("inventory:view:");
}

function isProfileComponentInteraction(interaction) {
  if (!interaction || !interaction.customId) {
    return false;
  }

  return interaction.customId === CUSTOM_IDS.profileOpenInventory;
}

function isShopComponentInteraction(interaction) {
  if (!interaction || !interaction.customId) {
    return false;
  }
  return interaction.customId === CUSTOM_IDS.shopRefresh
    || interaction.customId === CUSTOM_IDS.economyNavCraft
    || interaction.customId === CUSTOM_IDS.economyNavTrade
    || interaction.customId.startsWith("shop:view:buy:")
    || interaction.customId.startsWith("shop:view:sell:")
    || interaction.customId.startsWith("shop:view:browse:");
}

function isCraftComponentInteraction(interaction) {
  if (!interaction || !interaction.customId) {
    return false;
  }
  return interaction.customId === CUSTOM_IDS.craftRefresh
    || interaction.customId === CUSTOM_IDS.economyNavShop
    || interaction.customId === CUSTOM_IDS.economyNavTrade
    || interaction.customId.startsWith("craft:view:make:")
    || interaction.customId.startsWith("craft:view:filter:");
}

function isTradeComponentInteraction(interaction) {
  if (!interaction || !interaction.customId) {
    return false;
  }
  return interaction.customId === CUSTOM_IDS.tradeRefresh
    || interaction.customId === CUSTOM_IDS.economyNavShop
    || interaction.customId === CUSTOM_IDS.economyNavCraft
    || interaction.customId.startsWith("trade:view:")
    || interaction.customId.startsWith("trade:proposal:");
}

function isDungeonViewComponentInteraction(interaction) {
  if (!interaction || !interaction.customId) {
    return false;
  }
  return interaction.customId.startsWith("dungeon:view:");
}

function isDungeonMapComponentInteraction(interaction) {
  if (!interaction || !interaction.customId) {
    return false;
  }
  return interaction.customId.startsWith("dungeon-map:view:");
}

function isCombatViewComponentInteraction(interaction) {
  if (!interaction || !interaction.customId) {
    return false;
  }
  return interaction.customId.startsWith("combat:view:");
}

function isCombatMapComponentInteraction(interaction) {
  if (!interaction || !interaction.customId) {
    return false;
  }
  return interaction.customId.startsWith("map-ui:");
}

async function handleInventoryComponent(interaction, runtime) {
  const userId = extractInteractionUser(interaction);
  const customId = interaction.customId || "";
  const inventoryView = getInventoryView(userId);

  if (!inventoryView || !inventoryView.data) {
    await respondInteraction(interaction, { content: "No active inventory view found. Run /inventory again." });
    return;
  }

  if (customId === CUSTOM_IDS.inventoryBackToProfile) {
    const profileView = getProfileView(userId);
    if (!profileView || !profileView.data) {
      await respondInteraction(interaction, { content: "No active profile view found. Run /profile again." });
      return;
    }
    await refreshInteractionMessage(interaction, {
      content: profileView.content || "Profile loaded.",
      embeds: Array.isArray(profileView.embeds) ? profileView.embeds : [],
      components: Array.isArray(profileView.components) ? profileView.components : []
    });
    return;
  }

  const useActionPrefix = `${CUSTOM_IDS.inventoryUse}:`;
  const magicalActionPrefix = `${CUSTOM_IDS.inventoryIdentify}:`;
  const attuneActionPrefix = `${CUSTOM_IDS.inventoryAttune}:`;
  const unattuneActionPrefix = `${CUSTOM_IDS.inventoryUnattune}:`;
  const equipActionPrefix = `${CUSTOM_IDS.inventoryEquip}:`;
  const unequipActionPrefix = `${CUSTOM_IDS.inventoryUnequip}:`;
  if (
    customId.startsWith(useActionPrefix) ||
    customId.startsWith(equipActionPrefix) ||
    customId.startsWith(unequipActionPrefix) ||
    customId.startsWith(magicalActionPrefix) ||
    customId.startsWith(attuneActionPrefix) ||
    customId.startsWith(unattuneActionPrefix)
  ) {
    const segments = customId.split(":");
    const isUseAction = customId.startsWith(useActionPrefix);
    const isEquipAction = customId.startsWith(equipActionPrefix);
    const isUnequipAction = customId.startsWith(unequipActionPrefix);
    const action = isUseAction
      ? "use"
      : isEquipAction
      ? "equip"
      : isUnequipAction
        ? "unequip"
        : customId.startsWith(magicalActionPrefix)
          ? "identify"
          : customId.startsWith(attuneActionPrefix)
            ? "attune"
            : "unattune";
    const slot = isEquipAction || isUnequipAction ? segments[3] || null : null;
    const itemId = segments[segments.length - 1] || null;
    if (!itemId || ((isEquipAction || isUnequipAction) && !slot)) {
      await respondInteraction(interaction, { content: "Inventory action is missing required item data." });
      return;
    }

    const eventType =
      action === "use"
        ? EVENT_TYPES.PLAYER_USE_ITEM
        : action === "equip"
        ? EVENT_TYPES.PLAYER_EQUIP_REQUESTED
        : action === "unequip"
          ? EVENT_TYPES.PLAYER_UNEQUIP_REQUESTED
          : action === "identify"
        ? EVENT_TYPES.PLAYER_IDENTIFY_ITEM_REQUESTED
        : action === "attune"
          ? EVENT_TYPES.PLAYER_ATTUNE_ITEM_REQUESTED
          : EVENT_TYPES.PLAYER_UNATTUNE_ITEM_REQUESTED;

    const actionEvent = createEvent(eventType, {
      command_name: action,
      item_id: itemId,
      ...(slot ? { slot } : {})
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: userId
    });

    const actionResult = await runtime.processGatewayReadCommandEvent(actionEvent);
    const actionReply = formatGatewayReplyFromRuntime(actionResult);
    if (!actionReply.ok) {
      await refreshInteractionMessage(interaction, {
        content: actionReply.content,
        embeds: [buildInventoryDetailEmbed(inventoryView.data, inventoryView.tab || "magical")],
        components: buildInventoryComponents(inventoryView.tab || "magical", inventoryView.data)
      });
      return;
    }

    const refreshedReply = await loadInventoryReplyForUser(runtime, userId);
    if (refreshedReply.ok && refreshedReply.data && refreshedReply.data.inventory_found === true) {
      inventoryView.data = refreshedReply.data;
      inventoryView.tab = isEquipAction || isUnequipAction ? "equipment" : "magical";
      inventoryView.content = actionReply.content;
      setInventoryView(userId, inventoryView);
      await refreshInteractionMessage(interaction, {
        content: actionReply.content,
        embeds: [buildInventoryDetailEmbed(refreshedReply.data, inventoryView.tab)],
        components: buildInventoryComponents(inventoryView.tab, refreshedReply.data)
      });
      return;
    }

    await refreshInteractionMessage(interaction, {
      content: actionReply.content,
      embeds: [buildInventoryDetailEmbed(inventoryView.data, inventoryView.tab || (isEquipAction || isUnequipAction ? "equipment" : "magical"))],
      components: buildInventoryComponents(inventoryView.tab || (isEquipAction || isUnequipAction ? "equipment" : "magical"), inventoryView.data)
    });
    return;
  }

  let tab = "summary";
  if (customId === CUSTOM_IDS.inventoryEquipment) {
    tab = "equipment";
  } else if (customId === CUSTOM_IDS.inventoryMagical) {
    tab = "magical";
  }

  inventoryView.tab = tab;
  setInventoryView(userId, inventoryView);
  await refreshInteractionMessage(interaction, {
    content: inventoryView.content || "Inventory loaded.",
    embeds: [buildInventoryDetailEmbed(inventoryView.data, tab)],
    components: buildInventoryComponents(tab, inventoryView.data)
  });
}

async function handleProfileComponent(interaction, runtime) {
  const userId = extractInteractionUser(interaction);
  if (!userId) {
    await respondInteraction(interaction, { content: "Could not identify user." });
    return;
  }

  const event = createEvent(EVENT_TYPES.PLAYER_INVENTORY_REQUESTED, {
    command_name: "inventory"
  }, {
    source: "gateway.discord",
    target_system: "world_system",
    player_id: userId
  });

  const runtimeResult = await runtime.processGatewayReadCommandEvent(event);
  const reply = formatGatewayReplyFromRuntime(runtimeResult);
  if (!reply.ok || !reply.data || reply.data.inventory_found !== true) {
    await respondInteraction(interaction, { content: reply.content || "Inventory could not be loaded." });
    return;
  }

  setInventoryView(userId, {
    data: reply.data,
    tab: "summary",
    content: reply.content
  });

  await refreshInteractionMessage(interaction, {
    content: reply.content,
    embeds: Array.isArray(reply.embeds) ? reply.embeds : [],
    components: Array.isArray(reply.components) ? reply.components : []
  });
}

async function handleShopComponent(interaction, runtime) {
  const userId = extractInteractionUser(interaction);
  const view = getShopView(userId);
  if (!userId || !view || !view.data) {
    await respondInteraction(interaction, { content: "No active shop view found. Run /shop action:browse again." });
    return;
  }

  const customId = String(interaction.customId || "");
  if (customId === CUSTOM_IDS.economyNavCraft) {
    const reply = await loadCraftReplyForUser(runtime, userId);
    if (reply.ok && reply.data && Array.isArray(reply.data.recipes)) {
      const nextData = Object.assign({}, reply.data, { selected_filter: "all" });
      setCraftView(userId, { data: nextData, content: reply.content });
      await refreshInteractionMessage(interaction, {
        content: reply.content,
        embeds: [buildCraftEmbed(nextData)],
        components: buildCraftComponents(nextData)
      });
      return;
    }
    await respondInteraction(interaction, { content: reply.content || "Craft view could not be loaded." });
    return;
  }
  if (customId === CUSTOM_IDS.economyNavTrade) {
    const reply = await loadTradeReplyForUser(runtime, userId);
    if (reply.ok && reply.data && Array.isArray(reply.data.trades)) {
      setTradeView(userId, { data: reply.data, content: reply.content, selected_trade_id: null });
      await refreshInteractionMessage(interaction, {
        content: reply.content,
        embeds: [buildTradeEmbed(reply.data, userId)],
        components: buildTradeComponents(reply.data, null)
      });
      return;
    }
    await respondInteraction(interaction, { content: reply.content || "Trade view could not be loaded." });
    return;
  }
  let event;
  if (customId === CUSTOM_IDS.shopRefresh) {
    event = createEvent(EVENT_TYPES.PLAYER_SHOP_REQUESTED, {
      command_name: "shop",
      action: "browse",
      vendor_id: view.data.vendor_id || "vendor_starter_quartermaster"
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: userId
    });
  } else {
    const parts = customId.split(":");
    const action = parts[2] || "browse";
    const vendorId = parts[3] || view.data.vendor_id || "vendor_starter_quartermaster";
    const itemId = parts[4] || null;
    event = createEvent(EVENT_TYPES.PLAYER_SHOP_REQUESTED, {
      command_name: "shop",
      action: action === "browse" ? "browse" : action,
      vendor_id: vendorId,
      item_id: itemId,
      quantity: action === "buy" || action === "sell" ? 1 : null
    }, {
      source: "gateway.discord",
      target_system: "world_system",
      player_id: userId
    });
  }

  const runtimeResult = await runtime.processGatewayReadCommandEvent(event);
  const reply = formatGatewayReplyFromRuntime(runtimeResult);
  if (reply.ok && reply.data && (reply.data.stock || reply.data.vendor_id)) {
    setShopView(userId, { data: reply.data, content: reply.content });
  }
  await refreshInteractionMessage(interaction, {
    content: reply.content,
    embeds: Array.isArray(reply.embeds) ? reply.embeds : [],
    components: Array.isArray(reply.components) ? reply.components : []
  });
}

async function handleCraftComponent(interaction, runtime) {
  const userId = extractInteractionUser(interaction);
  const view = getCraftView(userId);
  if (!userId || !view || !view.data) {
    await respondInteraction(interaction, { content: "No active craft view found. Run /craft action:browse again." });
    return;
  }

  const customId = String(interaction.customId || "");
  let reply;
  if (customId === CUSTOM_IDS.economyNavShop) {
    reply = await loadShopReplyForUser(runtime, userId, "vendor_starter_quartermaster");
    if (reply.ok && reply.data && (reply.data.stock || reply.data.vendor_id)) {
      setShopView(userId, { data: reply.data, content: reply.content });
    }
  } else if (customId === CUSTOM_IDS.economyNavTrade) {
    reply = await loadTradeReplyForUser(runtime, userId);
    if (reply.ok && reply.data && Array.isArray(reply.data.trades)) {
      setTradeView(userId, { data: reply.data, content: reply.content, selected_trade_id: null });
      reply.embeds = [buildTradeEmbed(reply.data, userId)];
      reply.components = buildTradeComponents(reply.data, null);
    }
  } else if (customId.startsWith("craft:view:filter:")) {
    const filter = customId.split(":")[3] || "all";
    const nextData = Object.assign({}, view.data, { selected_filter: filter });
    setCraftView(userId, { data: nextData, content: view.content });
    reply = {
      ok: true,
      content: view.content,
      embeds: [buildCraftEmbed(nextData)],
      components: buildCraftComponents(nextData),
      data: nextData
    };
  } else {
    const event = customId === CUSTOM_IDS.craftRefresh
      ? createEvent(EVENT_TYPES.PLAYER_CRAFT_REQUESTED, {
          command_name: "craft",
          action: "browse"
        }, {
          source: "gateway.discord",
          target_system: "world_system",
          player_id: userId
        })
      : createEvent(EVENT_TYPES.PLAYER_CRAFT_REQUESTED, {
          command_name: "craft",
          action: "make",
          recipe_id: customId.split(":")[3] || null
        }, {
          source: "gateway.discord",
          target_system: "world_system",
          player_id: userId
        });

    const runtimeResult = await runtime.processGatewayReadCommandEvent(event);
    reply = formatGatewayReplyFromRuntime(runtimeResult);
    if (reply.ok && reply.data && Array.isArray(reply.data.recipes)) {
      const nextData = Object.assign({}, reply.data, { selected_filter: view.data.selected_filter || "all" });
      setCraftView(userId, { data: nextData, content: reply.content });
      reply.data = nextData;
      reply.embeds = [buildCraftEmbed(nextData)];
      reply.components = buildCraftComponents(nextData);
    }
  }
  await refreshInteractionMessage(interaction, {
    content: reply.content,
    embeds: Array.isArray(reply.embeds) ? reply.embeds : [],
    components: Array.isArray(reply.components) ? reply.components : []
  });
}

async function loadInventoryReplyForUser(runtime, userId) {
  const event = createEvent(EVENT_TYPES.PLAYER_INVENTORY_REQUESTED, {
    command_name: "inventory"
  }, {
    source: "gateway.discord",
    target_system: "world_system",
    player_id: userId
  });

  const runtimeResult = await runtime.processGatewayReadCommandEvent(event);
  return formatGatewayReplyFromRuntime(runtimeResult);
}

async function loadShopReplyForUser(runtime, userId, vendorId) {
  const event = createEvent(EVENT_TYPES.PLAYER_SHOP_REQUESTED, {
    command_name: "shop",
    action: "browse",
    vendor_id: vendorId || "vendor_starter_quartermaster"
  }, {
    source: "gateway.discord",
    target_system: "world_system",
    player_id: userId
  });
  const runtimeResult = await runtime.processGatewayReadCommandEvent(event);
  return formatGatewayReplyFromRuntime(runtimeResult);
}

async function loadCraftReplyForUser(runtime, userId) {
  const event = createEvent(EVENT_TYPES.PLAYER_CRAFT_REQUESTED, {
    command_name: "craft",
    action: "browse"
  }, {
    source: "gateway.discord",
    target_system: "world_system",
    player_id: userId
  });
  const runtimeResult = await runtime.processGatewayReadCommandEvent(event);
  return formatGatewayReplyFromRuntime(runtimeResult);
}

async function loadTradeReplyForUser(runtime, userId) {
  const event = createEvent(EVENT_TYPES.PLAYER_TRADE_REQUESTED, {
    command_name: "trade",
    action: "list"
  }, {
    source: "gateway.discord",
    target_system: "world_system",
    player_id: userId
  });
  const runtimeResult = await runtime.processGatewayReadCommandEvent(event);
  return formatGatewayReplyFromRuntime(runtimeResult);
}

async function openTradeProposalWizard(interaction, runtime, counterpartyPlayerId) {
  const userId = extractInteractionUser(interaction);
  const inventoryReply = await loadInventoryReplyForUser(runtime, userId);
  if (!inventoryReply.ok || !inventoryReply.data || inventoryReply.data.inventory_found !== true) {
    await sendEphemeralReply(interaction, inventoryReply.content || "Inventory could not be loaded for trade.");
    return {
      ok: false
    };
  }

  const tradeableItems = normalizeTradeableItems(inventoryReply.data);
  if (tradeableItems.length === 0) {
    await sendEphemeralReply(interaction, "You do not have any tradable stackable items.");
    return {
      ok: false
    };
  }

  const firstItem = tradeableItems[0];
  const view = {
    counterparty_player_id: cleanText(counterpartyPlayerId, "unknown"),
    inventoryData: inventoryReply.data,
    offered_item_id: normalizeSelection(firstItem.item_id),
    offered_quantity: 1,
    requested_currency: 0
  };
  setTradeProposalView(userId, view);
  await sendEphemeralReply(interaction, {
    content: "Trade proposal wizard loaded.",
    embeds: [buildTradeProposalEmbed(view)],
    components: buildTradeProposalComponents(view)
  });
  return {
    ok: true
  };
}

async function handleTradeComponent(interaction, runtime) {
  const userId = extractInteractionUser(interaction);
  const customId = String(interaction.customId || "");
  if (customId.startsWith("trade:proposal:")) {
    const proposalView = getTradeProposalView(userId);
    if (!userId || !proposalView || !proposalView.inventoryData) {
      await respondInteraction(interaction, { content: "No active trade proposal found. Run /trade action:propose again." });
      return;
    }

    if (customId === CUSTOM_IDS.tradeProposalCancel) {
      deleteTradeProposalView(userId);
      await refreshInteractionMessage(interaction, {
        content: "Trade proposal canceled.",
        embeds: [],
        components: []
      });
      return;
    }

    if (customId === CUSTOM_IDS.tradeProposalSubmit) {
      const event = createEvent(EVENT_TYPES.PLAYER_TRADE_REQUESTED, {
        command_name: "trade",
        action: "propose",
        counterparty_player_id: proposalView.counterparty_player_id,
        offered_item_id: proposalView.offered_item_id,
        offered_quantity: proposalView.offered_quantity,
        requested_currency: proposalView.requested_currency
      }, {
        source: "gateway.discord",
        target_system: "world_system",
        player_id: userId
      });
      const runtimeResult = await runtime.processGatewayReadCommandEvent(event);
      const reply = formatGatewayReplyFromRuntime(runtimeResult);
      if (reply.ok && reply.data && Array.isArray(reply.data.trades)) {
        setTradeView(userId, { data: reply.data, content: reply.content });
      }
      deleteTradeProposalView(userId);
      await refreshInteractionMessage(interaction, {
        content: reply.content,
        embeds: Array.isArray(reply.embeds) ? reply.embeds : [],
        components: Array.isArray(reply.components) ? reply.components : []
      });
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (customId === CUSTOM_IDS.tradeProposalItemSelect) {
        const nextItemId = normalizeSelection(interaction.values && interaction.values[0]);
        const nextItem = getTradeableItemById(proposalView.inventoryData, nextItemId);
        if (nextItem) {
          proposalView.offered_item_id = nextItemId;
          proposalView.offered_quantity = 1;
        }
      } else if (customId === CUSTOM_IDS.tradeProposalQuantitySelect) {
        const nextQuantity = Number(interaction.values && interaction.values[0]);
        if (Number.isFinite(nextQuantity) && nextQuantity > 0) {
          proposalView.offered_quantity = Math.floor(nextQuantity);
        }
      } else if (customId === CUSTOM_IDS.tradeProposalGoldSelect) {
        const nextGold = Number(interaction.values && interaction.values[0]);
        if (Number.isFinite(nextGold) && nextGold >= 0) {
          proposalView.requested_currency = Math.floor(nextGold);
        }
      }
      setTradeProposalView(userId, proposalView);
      await refreshInteractionMessage(interaction, {
        content: "Trade proposal wizard loaded.",
        embeds: [buildTradeProposalEmbed(proposalView)],
        components: buildTradeProposalComponents(proposalView)
      });
      return;
    }
  }

  const view = getTradeView(userId);
  if (!userId || !view || !view.data) {
    await respondInteraction(interaction, { content: "No active trade view found. Run /trade action:list again." });
    return;
  }

  if (customId === CUSTOM_IDS.economyNavShop) {
    const reply = await loadShopReplyForUser(runtime, userId, "vendor_starter_quartermaster");
    if (reply.ok && reply.data && (reply.data.stock || reply.data.vendor_id)) {
      setShopView(userId, { data: reply.data, content: reply.content });
      await refreshInteractionMessage(interaction, {
        content: reply.content,
        embeds: Array.isArray(reply.embeds) ? reply.embeds : [],
        components: Array.isArray(reply.components) ? reply.components : []
      });
      return;
    }
    await respondInteraction(interaction, { content: reply.content || "Shop view could not be loaded." });
    return;
  }

  if (customId === CUSTOM_IDS.economyNavCraft) {
    const reply = await loadCraftReplyForUser(runtime, userId);
    if (reply.ok && reply.data && Array.isArray(reply.data.recipes)) {
      const nextData = Object.assign({}, reply.data, { selected_filter: "all" });
      setCraftView(userId, { data: nextData, content: reply.content });
      await refreshInteractionMessage(interaction, {
        content: reply.content,
        embeds: [buildCraftEmbed(nextData)],
        components: buildCraftComponents(nextData)
      });
      return;
    }
    await respondInteraction(interaction, { content: reply.content || "Craft view could not be loaded." });
    return;
  }

  if (customId === CUSTOM_IDS.tradeBack) {
    view.selected_trade_id = null;
    setTradeView(userId, view);
    await refreshInteractionMessage(interaction, {
      content: view.content || "Trade ledger loaded.",
      embeds: [buildTradeEmbed(view.data, userId)],
      components: buildTradeComponents(view.data, null)
    });
    return;
  }

  if (customId.startsWith("trade:view:detail:")) {
    const selectedTradeId = customId.split(":")[3] || null;
    const selectedTrade = selectedTradeId ? getTradeById(view.data, selectedTradeId) : null;
    if (!selectedTrade) {
      await respondInteraction(interaction, { content: "That trade is no longer available. Refresh the ledger." });
      return;
    }
    view.selected_trade_id = selectedTradeId;
    setTradeView(userId, view);
    await refreshInteractionMessage(interaction, {
      content: `Trade: ${cleanText(selectedTrade.trade_id, "unknown")}\nState: ${cleanText(selectedTrade.trade_state, "unknown")}`,
      embeds: [buildTradeDetailEmbed(view.data, selectedTrade, userId)],
      components: buildTradeComponents(view.data, selectedTradeId)
    });
    return;
  }

  const parts = customId.split(":");
  const action = customId === CUSTOM_IDS.tradeRefresh ? "list" : (parts[2] || "list");
  const tradeId = parts[3] || null;
  const event = createEvent(EVENT_TYPES.PLAYER_TRADE_REQUESTED, {
    command_name: "trade",
    action,
    trade_id: tradeId
  }, {
    source: "gateway.discord",
    target_system: "world_system",
    player_id: userId
  });

  const runtimeResult = await runtime.processGatewayReadCommandEvent(event);
  const reply = formatGatewayReplyFromRuntime(runtimeResult);
  if (reply.ok && reply.data && Array.isArray(reply.data.trades)) {
    const selectedTradeId = action === "accept" || action === "decline" || action === "cancel"
      ? null
      : view.selected_trade_id || null;
    setTradeView(userId, { data: reply.data, content: reply.content, selected_trade_id: selectedTradeId });
    if (selectedTradeId) {
      const selectedTrade = getTradeById(reply.data, selectedTradeId);
      if (selectedTrade) {
        await refreshInteractionMessage(interaction, {
          content: `Trade: ${cleanText(selectedTrade.trade_id, "unknown")}\nState: ${cleanText(selectedTrade.trade_state, "unknown")}`,
          embeds: [buildTradeDetailEmbed(reply.data, selectedTrade, userId)],
          components: buildTradeComponents(reply.data, selectedTradeId)
        });
        return;
      }
    }
  }
  await refreshInteractionMessage(interaction, {
    content: reply.content,
    embeds: Array.isArray(reply.embeds) ? reply.embeds : [],
    components: Array.isArray(reply.components) ? reply.components : []
  });
}

async function handleDungeonViewComponent(interaction, runtime) {
  const userId = extractInteractionUser(interaction);
  const customId = String(interaction.customId || "");
  const parts = customId.split(":");
  const mode = parts[2] || "";
  const sessionId = parts[3] || null;

  if (!userId || !sessionId) {
    await respondInteraction(interaction, { content: "Dungeon view action is missing session context." });
    return;
  }

  let event;
  if (mode === "move") {
    const direction = parts[4] || null;
    event = createEvent(EVENT_TYPES.PLAYER_MOVE, {
      command_name: "move",
      direction,
      session_id: sessionId
    }, {
      source: "gateway.discord",
      target_system: "session_system",
      player_id: userId,
      session_id: sessionId
    });
  } else if (mode === "object") {
    const objectId = parts[4] || null;
    const action = parts[5] || "use";
    event = createEvent(EVENT_TYPES.PLAYER_INTERACT_OBJECT, {
      command_name: "interact",
      session_id: sessionId,
      object_id: objectId,
      action
    }, {
      source: "gateway.discord",
      target_system: "session_system",
      player_id: userId,
      session_id: sessionId
    });
  } else {
    await respondInteraction(interaction, { content: "Unknown dungeon view action." });
    return;
  }

  const runtimeResult = await runtime.processGatewayReadCommandEvent(event);
  const reply = formatGatewayReplyFromRuntime(runtimeResult);
  const nextReply = await attachDungeonMapToReply(reply, userId, getDungeonMapView(userId, sessionId), {
    suffix: `dungeon-${mode}`
  });
  await refreshInteractionMessage(interaction, {
    content: nextReply.content,
    embeds: Array.isArray(nextReply.embeds) ? nextReply.embeds : [],
    components: Array.isArray(nextReply.components) ? nextReply.components : [],
    files: Array.isArray(nextReply.files) ? nextReply.files : []
  });
}

async function handleDungeonMapComponent(interaction, runtime) {
  const userId = extractInteractionUser(interaction);
  const parsed = parseDungeonMapCustomId(String(interaction.customId || ""));
  if (!parsed.ok) {
    await respondInteraction(interaction, { content: "Unknown dungeon map action." });
    return;
  }

  const sessionId = parsed.session_id || null;
  if (!userId || !sessionId) {
    await respondInteraction(interaction, { content: "Dungeon map action is missing session context." });
    return;
  }

  const storedView = getDungeonMapView(userId, sessionId);
  if (!storedView || !storedView.data) {
    await respondInteraction(interaction, { content: "No active dungeon map view found. Move or enter the dungeon again first." });
    return;
  }

  if (parsed.action === DUNGEON_MAP_ACTIONS.PREVIEW_MOVE) {
    const previewReply = await attachDungeonMapToReply({
      ok: true,
      content: storedView.data.room && storedView.data.room.name ? `Room: ${cleanText(storedView.data.room.name, storedView.data.room.room_id)}` : "Dungeon room loaded.",
      embeds: [],
      components: Array.isArray(buildDungeonRoomComponents(storedView.data)) ? buildDungeonRoomComponents(storedView.data) : [],
      files: [],
      data: storedView.data
    }, userId, {
      ...storedView,
      view_state: {
        ...(storedView.view_state || {}),
        mode: "move_preview"
      }
    }, {
      map_content: "Choose a highlighted exit to move the party leader through the dungeon.",
      suffix: "dungeon-move-preview"
    });

    await refreshInteractionMessage(interaction, {
      content: previewReply.content,
      embeds: Array.isArray(previewReply.embeds) ? previewReply.embeds : [],
      components: Array.isArray(previewReply.components) ? previewReply.components : [],
      files: Array.isArray(previewReply.files) ? previewReply.files : []
    });
    return;
  }

  if (parsed.action === DUNGEON_MAP_ACTIONS.BACK) {
    const backReply = await attachDungeonMapToReply({
      ok: true,
      content: storedView.data.room && storedView.data.room.name ? `Room: ${cleanText(storedView.data.room.name, storedView.data.room.room_id)}` : "Dungeon room loaded.",
      embeds: [],
      components: Array.isArray(buildDungeonRoomComponents(storedView.data)) ? buildDungeonRoomComponents(storedView.data) : [],
      files: [],
      data: storedView.data
    }, userId, {
      ...storedView,
      view_state: {
        ...(storedView.view_state || {}),
        mode: "idle"
      }
    }, {
      map_content: "Dungeon map ready.",
      suffix: "dungeon-idle"
    });

    await refreshInteractionMessage(interaction, {
      content: backReply.content,
      embeds: Array.isArray(backReply.embeds) ? backReply.embeds : [],
      components: Array.isArray(backReply.components) ? backReply.components : [],
      files: Array.isArray(backReply.files) ? backReply.files : []
    });
    return;
  }

  if (parsed.action === DUNGEON_MAP_ACTIONS.DEBUG_TOGGLE) {
    const debugKey = parsed.value || "";
    const nextReply = await attachDungeonMapToReply({
      ok: true,
      content: storedView.data.room && storedView.data.room.name ? `Room: ${cleanText(storedView.data.room.name, storedView.data.room.room_id)}` : "Dungeon room loaded.",
      embeds: [],
      components: Array.isArray(buildDungeonRoomComponents(storedView.data)) ? buildDungeonRoomComponents(storedView.data) : [],
      files: [],
      data: storedView.data
    }, userId, {
      ...storedView,
      view_state: {
        ...(storedView.view_state || {}),
        debug_flags: toggleDungeonDebugFlag(storedView.view_state && storedView.view_state.debug_flags, debugKey)
      }
    }, {
      map_content: "Dungeon debug overlays updated.",
      suffix: `dungeon-debug-${cleanText(debugKey, "view")}`
    });

    await refreshInteractionMessage(interaction, {
      content: nextReply.content,
      embeds: Array.isArray(nextReply.embeds) ? nextReply.embeds : [],
      components: Array.isArray(nextReply.components) ? nextReply.components : [],
      files: Array.isArray(nextReply.files) ? nextReply.files : []
    });
    return;
  }

  if (parsed.action === DUNGEON_MAP_ACTIONS.MOVE) {
    const direction = parsed.value || null;
    const action = createDungeonMapMoveDirectionAction({
      actor_id: cleanText(storedView.data && storedView.data.session && storedView.data.session.leader_id, userId),
      instance_id: sessionId,
      instance_type: "dungeon",
      map_id: cleanText(storedView.data && storedView.data.dungeon_map && storedView.data.dungeon_map.map_id, ""),
      source: "gateway.discord.map"
    }, direction);
    const adapted = adaptDungeonMapActionToCanonicalEvent(action, {
      source: "gateway.discord.map",
      player_id: userId,
      session_id: sessionId
    });
    if (!adapted.ok || !adapted.payload || !adapted.payload.dispatch_required || !adapted.payload.event) {
      await respondInteraction(interaction, { content: "Dungeon map move could not be prepared." });
      return;
    }

    const runtimeResult = await runtime.processGatewayReadCommandEvent(adapted.payload.event);
    const reply = formatGatewayReplyFromRuntime(runtimeResult);
    const nextReply = await attachDungeonMapToReply(reply, userId, {
      ...storedView,
      view_state: {
        ...(storedView.view_state || {}),
        mode: "idle"
      }
    }, {
      suffix: "dungeon-map-move"
    });

    await refreshInteractionMessage(interaction, {
      content: nextReply.content,
      embeds: Array.isArray(nextReply.embeds) ? nextReply.embeds : [],
      components: Array.isArray(nextReply.components) ? nextReply.components : [],
      files: Array.isArray(nextReply.files) ? nextReply.files : []
    });
    return;
  }

  await respondInteraction(interaction, { content: "Unknown dungeon map action." });
}

async function handleCombatViewComponent(interaction, runtime) {
  const userId = extractInteractionUser(interaction);
  const parts = String(interaction.customId || "").split(":");
  const action = parts[2] || "";
  const combatId = parts[3] || null;

  if (!userId || !combatId) {
    await respondInteraction(interaction, { content: "Combat view action is missing combat context." });
    return;
  }

  const event = action === "dodge"
    ? createEvent(EVENT_TYPES.PLAYER_DODGE, {
      command_name: "dodge",
      combat_id: combatId
    }, {
      source: "gateway.discord",
      target_system: "combat_system",
      player_id: userId,
      combat_id: combatId
    })
    : action === "ready"
      ? createEvent(EVENT_TYPES.PLAYER_READY_ACTION, {
        command_name: "ready",
        combat_id: combatId
      }, {
        source: "gateway.discord",
        target_system: "combat_system",
        player_id: userId,
        combat_id: combatId
      })
      : action === "dash"
        ? createEvent(EVENT_TYPES.PLAYER_DASH, {
          command_name: "dash",
          combat_id: combatId
        }, {
          source: "gateway.discord",
          target_system: "combat_system",
          player_id: userId,
          combat_id: combatId
        })
    : action === "disengage"
      ? createEvent(EVENT_TYPES.PLAYER_DISENGAGE, {
        command_name: "disengage",
        combat_id: combatId
      }, {
        source: "gateway.discord",
        target_system: "combat_system",
        player_id: userId,
        combat_id: combatId
      })
      : createEvent(EVENT_TYPES.PLAYER_COMBAT_REQUESTED, {
        command_name: "combat",
        combat_id: combatId
      }, {
        source: "gateway.discord",
        target_system: "combat_system",
        player_id: userId,
        combat_id: combatId
      });

  const runtimeResult = await runtime.processGatewayReadCommandEvent(event);
  const reply = buildCombatBoardReply(formatGatewayReplyFromRuntime(runtimeResult));
  const nextReply = await attachCombatMapToReply(reply, userId, getCombatMapView(userId, combatId), {
    suffix: action ? `combat-${action}` : "combat-refresh"
  });
  await refreshInteractionMessage(interaction, {
    content: nextReply.content,
    embeds: Array.isArray(nextReply.embeds) ? nextReply.embeds : [],
    components: Array.isArray(nextReply.components) ? nextReply.components : [],
    files: Array.isArray(nextReply.files) ? nextReply.files : []
  });
}

async function handleCombatMapComponent(interaction, runtime) {
  const userId = extractInteractionUser(interaction);
  const storedCombatId = String(interaction.customId || "").split(":")[3] || null;
  const storedView = storedCombatId ? getCombatMapView(userId, storedCombatId) : null;
  const combatId = storedCombatId || (storedView && storedView.combat_id) || null;

  if (!userId || !combatId) {
    await respondInteraction(interaction, { content: "Combat map action is missing combat context." });
    return;
  }

  const readEvent = buildCombatReadEvent(userId, combatId);
  const runtimeResult = await runtime.processGatewayReadCommandEvent(readEvent);
  const reply = buildCombatBoardReply(formatGatewayReplyFromRuntime(runtimeResult));
  if (!reply.ok || !hasCombatSummary(reply.data)) {
    await refreshInteractionMessage(interaction, {
      content: reply.content,
      embeds: Array.isArray(reply.embeds) ? reply.embeds : [],
      components: Array.isArray(reply.components) ? reply.components : []
    });
    return;
  }

  const contextOut = buildMapInteractionContext({
    view: storedView || {},
    data: reply.data,
    user_id: userId,
    message_id: interaction.message && interaction.message.id ? String(interaction.message.id) : ""
  });
  if (!contextOut.ok) {
    await respondInteraction(interaction, { content: contextOut.error || "Combat map context could not be built." });
    return;
  }

  const controllerOut = handleCombatMapButtonAction(contextOut.payload, interaction.customId);
  if (!controllerOut.ok) {
    await respondInteraction(interaction, { content: controllerOut.error || "Combat map action failed." });
    return;
  }

  const nextTokenOverrides = buildTokenVisualOverrides(
    (controllerOut.map && controllerOut.map.tokens)
      || (controllerOut.preview_map && controllerOut.preview_map.tokens)
      || contextOut.payload.map.tokens
  );

  if (controllerOut.action_contract) {
    const adapted = adaptMapActionToCanonicalEvent(controllerOut.action_contract, {
      player_id: userId,
      source: "gateway.discord.map"
    });
    if (!adapted.ok) {
      await respondInteraction(interaction, { content: adapted.error || "Combat map action could not be adapted." });
      return;
    }

    if (adapted.payload.dispatch_required === true && adapted.payload.event) {
      const actionRuntimeResult = await runtime.processGatewayReadCommandEvent(adapted.payload.event);
      const actionReply = formatGatewayReplyFromRuntime(actionRuntimeResult);
      const turnSummaryContent = buildCombatTextOnlyTurnSummary(actionReply);
      const hydratedActionReply = await attachCombatMapToReply(buildCombatBoardReply(actionReply), userId, {
        combat_id: combatId,
        token_overrides: nextTokenOverrides,
        interaction_state: null,
        token_catalog: storedView && storedView.token_catalog ? storedView.token_catalog : []
      }, {
        suffix: "combat-action"
      });
      await refreshInteractionMessage(interaction, {
        content: hydratedActionReply.content,
        embeds: Array.isArray(hydratedActionReply.embeds) ? hydratedActionReply.embeds : [],
        components: Array.isArray(hydratedActionReply.components) ? hydratedActionReply.components : [],
        files: Array.isArray(hydratedActionReply.files) ? hydratedActionReply.files : []
      });
      if (turnSummaryContent) {
        await sendEphemeralReply(interaction, {
          content: turnSummaryContent,
          allowedMentions: { parse: [] }
        });
      }
      return;
    }
  }

  const previewReply = await attachCombatMapToReply(buildCombatBoardReply(reply), userId, {
    combat_id: combatId,
    token_overrides: nextTokenOverrides,
    interaction_state: controllerOut.state || null,
    token_catalog: storedView && storedView.token_catalog ? storedView.token_catalog : []
  }, {
    map_content: controllerOut.payload && controllerOut.payload.content ? controllerOut.payload.content : "",
    component_rows: controllerOut.payload && Array.isArray(controllerOut.payload.components)
      ? controllerOut.payload.components
      : null,
    map_override: controllerOut.preview_map || controllerOut.map || contextOut.payload.map,
    suffix: controllerOut.state && controllerOut.state.mode ? controllerOut.state.mode : "preview"
  });

  await refreshInteractionMessage(interaction, {
    content: previewReply.content,
    embeds: Array.isArray(previewReply.embeds) ? previewReply.embeds : [],
    components: Array.isArray(previewReply.components) ? previewReply.components : [],
    files: Array.isArray(previewReply.files) ? previewReply.files : []
  });
}

async function sendEphemeralReply(interaction, payload) {
  const safePayload = typeof payload === "string"
    ? { content: String(payload || "") }
    : Object.assign({}, payload);
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(Object.assign({}, safePayload, { ephemeral: true }));
    return;
  }

  await interaction.reply(Object.assign({}, safePayload, { ephemeral: true }));
}

async function handleGatewayInteraction(interaction, runtime) {
  try {
    const isButton = typeof interaction.isButton === "function" && interaction.isButton();
    const isSelect = typeof interaction.isStringSelectMenu === "function" && interaction.isStringSelectMenu();

    if ((isButton || isSelect) && isStartComponentInteraction(interaction)) {
      await handleStartComponent(interaction, runtime);
      return {
        ok: true,
        event_type: "gateway_interaction_processed",
        payload: { custom_id: interaction.customId },
        error: null
      };
    }

    if (isButton && isInventoryComponentInteraction(interaction)) {
      await handleInventoryComponent(interaction, runtime);
      return {
        ok: true,
        event_type: "gateway_interaction_processed",
        payload: { custom_id: interaction.customId },
        error: null
      };
    }

    if (isButton && isProfileComponentInteraction(interaction)) {
      await handleProfileComponent(interaction, runtime);
      return {
        ok: true,
        event_type: "gateway_interaction_processed",
        payload: { custom_id: interaction.customId },
        error: null
      };
    }

    if (isButton && isShopComponentInteraction(interaction)) {
      await handleShopComponent(interaction, runtime);
      return {
        ok: true,
        event_type: "gateway_interaction_processed",
        payload: { custom_id: interaction.customId },
        error: null
      };
    }

      if (isButton && isCraftComponentInteraction(interaction)) {
        await handleCraftComponent(interaction, runtime);
        return {
          ok: true,
          event_type: "gateway_interaction_processed",
          payload: { custom_id: interaction.customId },
          error: null
        };
      }

      if ((isButton || isSelect) && isTradeComponentInteraction(interaction)) {
        await handleTradeComponent(interaction, runtime);
        return {
          ok: true,
          event_type: "gateway_interaction_processed",
          payload: { custom_id: interaction.customId },
          error: null
        };
      }

      if (isButton && isDungeonViewComponentInteraction(interaction)) {
        await handleDungeonViewComponent(interaction, runtime);
        return {
          ok: true,
          event_type: "gateway_interaction_processed",
          payload: { custom_id: interaction.customId },
          error: null
        };
      }

      if (isButton && isDungeonMapComponentInteraction(interaction)) {
        await handleDungeonMapComponent(interaction, runtime);
        return {
          ok: true,
          event_type: "gateway_interaction_processed",
          payload: { custom_id: interaction.customId },
          error: null
        };
      }

      if (isButton && isCombatViewComponentInteraction(interaction)) {
        await handleCombatViewComponent(interaction, runtime);
        return {
          ok: true,
          event_type: "gateway_interaction_processed",
          payload: { custom_id: interaction.customId },
          error: null
        };
      }

      if (isButton && isCombatMapComponentInteraction(interaction)) {
        await handleCombatMapComponent(interaction, runtime);
        return {
          ok: true,
          event_type: "gateway_interaction_processed",
          payload: { custom_id: interaction.customId },
          error: null
        };
      }

    if (!interaction.isChatInputCommand()) {
      return {
        ok: true,
        event_type: "gateway_interaction_ignored",
        payload: { reason: "not_chat_input" },
        error: null
      };
    }

    const mapped = mapSlashCommandToGatewayEvent(interaction);
    if (!mapped.ok) {
      console.error(
        JSON.stringify({
          type: "gateway_event_error",
          error: mapped.error,
          payload: mapped.payload
        }, null, 2)
      );

      await sendEphemeralReply(interaction, "Command could not be processed by the gateway translator.");
      return {
        ok: false,
        event_type: "gateway_interaction_failed",
        payload: mapped.payload || {},
        error: mapped.error
      };
    }

    const internalEvent = mapped.payload.event;

    if (internalEvent.payload && internalEvent.payload.command_name === "start") {
      await handleStartWizard(interaction, internalEvent);
      return {
        ok: true,
        event_type: "gateway_interaction_processed",
        payload: { command_name: "start", mode: "wizard" },
        error: null
      };
    }

    if (
      internalEvent.event_type === EVENT_TYPES.PLAYER_TRADE_REQUESTED &&
      internalEvent.payload &&
      internalEvent.payload.action === "propose" &&
      internalEvent.payload.counterparty_player_id &&
      !internalEvent.payload.offered_item_id &&
      Number(internalEvent.payload.offered_currency || 0) <= 0 &&
      !internalEvent.payload.requested_item_id
    ) {
      const wizardOut = await openTradeProposalWizard(
        interaction,
        runtime,
        internalEvent.payload.counterparty_player_id
      );
      return {
        ok: wizardOut.ok,
        event_type: "gateway_interaction_processed",
        payload: { command_name: "trade", mode: "proposal_wizard" },
        error: wizardOut.ok ? null : "trade proposal wizard failed"
      };
    }

    const runtimeResult = await runtime.processGatewayReadCommandEvent(internalEvent);
    const rawReply = formatGatewayReplyFromRuntime(runtimeResult);
    const reply =
      internalEvent.event_type === EVENT_TYPES.PLAYER_COMBAT_REQUESTED
        ? buildCombatBoardReply(rawReply)
        : rawReply;
    const combatHydratedReply = await attachCombatMapToReply(reply, extractInteractionUser(interaction), null, {
      suffix: internalEvent.payload && internalEvent.payload.command_name
        ? String(internalEvent.payload.command_name)
        : "combat"
    });
    const requestSessionId = internalEvent.session_id || (internalEvent.payload && internalEvent.payload.session_id) || null;
    const nextReply = await attachDungeonMapToReply(
      combatHydratedReply,
      extractInteractionUser(interaction),
      requestSessionId ? getDungeonMapView(extractInteractionUser(interaction), requestSessionId) : null,
      {
      suffix: internalEvent.payload && internalEvent.payload.command_name
        ? String(internalEvent.payload.command_name)
        : "dungeon"
      }
    );
    if (internalEvent.event_type === EVENT_TYPES.PLAYER_PROFILE_REQUESTED && reply.ok && reply.data && reply.data.profile_found === true) {
      setProfileView(extractInteractionUser(interaction), {
        data: reply.data,
        content: reply.content,
        embeds: Array.isArray(reply.embeds) ? reply.embeds : [],
        components: Array.isArray(reply.components) ? reply.components : []
      });
    }
    if (internalEvent.event_type === EVENT_TYPES.PLAYER_INVENTORY_REQUESTED && reply.ok && reply.data && reply.data.inventory_found === true) {
      setInventoryView(extractInteractionUser(interaction), {
        data: reply.data,
        tab: "summary",
        content: reply.content
      });
    }
    if (internalEvent.event_type === EVENT_TYPES.PLAYER_SHOP_REQUESTED && reply.ok && reply.data && reply.data.vendor_id) {
      setShopView(extractInteractionUser(interaction), {
        data: reply.data,
        content: reply.content
      });
    }
    if (internalEvent.event_type === EVENT_TYPES.PLAYER_CRAFT_REQUESTED && reply.ok && reply.data && Array.isArray(reply.data.recipes)) {
      setCraftView(extractInteractionUser(interaction), {
        data: reply.data,
        content: reply.content
      });
    }
    if (internalEvent.event_type === EVENT_TYPES.PLAYER_TRADE_REQUESTED && reply.ok && reply.data && Array.isArray(reply.data.trades)) {
      setTradeView(extractInteractionUser(interaction), {
        data: reply.data,
        content: reply.content,
        selected_trade_id: null
      });
    }
    await sendEphemeralReply(interaction, {
      content: nextReply.content,
      embeds: Array.isArray(nextReply.embeds) ? nextReply.embeds : []
      ,
      components: Array.isArray(nextReply.components) ? nextReply.components : [],
      files: Array.isArray(nextReply.files) ? nextReply.files : []
    });

    return {
      ok: nextReply.ok,
      event_type: "gateway_interaction_processed",
      payload: {
        command_name: internalEvent.payload ? internalEvent.payload.command_name : null,
        request_event: internalEvent,
        runtime_result: runtimeResult
      },
      error: nextReply.ok ? null : nextReply.content
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        type: "gateway_interaction_internal_error",
        command_name: interaction && interaction.commandName ? interaction.commandName : null,
        custom_id: interaction && interaction.customId ? interaction.customId : null,
        error: error && error.message ? error.message : "unknown runtime error"
      }, null, 2)
    );

    await sendEphemeralReply(
      interaction,
      "Something went wrong while processing that command. Please try again."
    );

    return {
      ok: false,
      event_type: "gateway_interaction_failed",
      payload: {},
      error: error && error.message ? error.message : "unknown runtime error"
    };
  }
}

// Stage 0 shell: connect bot + register commands + translate inputs into events.
async function startGatewayShell() {
  const config = getDiscordConfig();
  const client = createDiscordClient();
  const runtime = createReadCommandRuntime();
  const autoRegisterOnStart = String(process.env.AUTO_REGISTER_COMMANDS_ON_START || "").trim().toLowerCase() === "true";

  client.once("clientReady", async () => {
    console.log("Gateway ready as " + client.user.tag);
    if (autoRegisterOnStart) {
      await registerCommands();
    } else {
      console.log("Skipping auto command registration on startup. Run `npm run discord:register` when needed.");
    }
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      await handleGatewayInteraction(interaction, runtime);
    } catch (error) {
      console.error(
        JSON.stringify({
          type: "gateway_interaction_runtime_error",
          command_name: interaction && interaction.commandName ? interaction.commandName : null,
          error: error && error.message ? error.message : "unknown runtime error"
        }, null, 2)
      );

      try {
        await sendEphemeralReply(
          interaction,
          "Something went wrong while processing that command. Please try again."
        );
      } catch (replyError) {
        console.error(
          JSON.stringify({
            type: "gateway_interaction_error_reply_failed",
            command_name: interaction && interaction.commandName ? interaction.commandName : null,
            error: replyError && replyError.message ? replyError.message : "failed to send fallback reply"
          }, null, 2)
        );
      }
    }
  });

  await client.login(config.botToken);
}

if (require.main === module) {
  startGatewayShell().catch((error) => {
    console.error("Gateway startup failed:", error.message);
    process.exit(1);
  });
}

module.exports = {
  startGatewayShell,
  translateSlashCommandToInternalEvent: function translateSlashCommandToInternalEvent(interaction) {
    const mapped = mapSlashCommandToGatewayEvent(interaction);
    if (!mapped.ok) return null;
    return mapped.payload.event;
  },
  handleGatewayInteraction,
  formatGatewayReplyFromRuntime,
  __test: {
    validatePointBuy,
    createBasePointBuyStats,
    getPointBuySummary,
    adjustSelectedAbility,
    buildStartMessage
  }
};
