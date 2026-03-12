"use strict";

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
const { listAvailableRaces, getRaceOptions } = require("../../world-system/src/character/rules/raceRules");
const { listAvailableClasses, getClassOptions, getClassData } = require("../../world-system/src/character/rules/classRules");

// Load variables from root .env file.
dotenv.config({
  path: path.resolve(__dirname, "../../../.env")
});

const ABILITY_FIELDS = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const START_SESSION_TTL_MS = 30 * 60 * 1000;
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
  createButton: "start:create"
};

const startSessions = new Map();
let raceCatalogCache = null;
let classCatalogCache = null;

function nowMs() {
  return Date.now();
}

function cleanText(value, fallback) {
  const safe = String(value || "").trim();
  return safe === "" ? fallback || "Unknown" : safe;
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

function summarizeAiTurns(aiTurns) {
  const list = Array.isArray(aiTurns) ? aiTurns : [];
  if (list.length === 0) {
    return "None";
  }
  return list.map((entry) => {
    const actor = cleanText(entry && entry.actor_id, "unknown");
    const actionType = cleanText(entry && entry.action_type, "wait");
    if (actionType === "attack") {
      return `${actor} attacked ${cleanText(entry.target_id, "unknown")}`;
    }
    if (actionType === "move") {
      const move = entry && entry.move ? entry.move : {};
      return `${actor} moved ${formatPosition(move.from_position)} -> ${formatPosition(move.to_position)}`;
    }
    return `${actor} waited`;
  }).join(" | ");
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
    return {
      ok: true,
      content: [
        `Name: ${cleanText(character.name, "unknown")}`,
        `Race: ${cleanText(character.race, character.race_id || "unknown")}`,
        `Track A: ${cleanText(character.class, character.class_id || "unknown")}`,
        `Track B: ${cleanText(character.secondary_class_id, "(none)")}`,
        `Level: ${Number.isFinite(Number(character.level)) ? Number(character.level) : 1}`,
        `XP: ${Number.isFinite(Number(character.xp)) ? Number(character.xp) : 0}`,
        `Base Stats: ${character.base_stats ? formatStatLine(character.base_stats) : "unknown"}`,
        `Stats: ${character.stats ? formatStatLine(character.stats) : "unknown"}`
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
      content: [
        `Inventory ID: ${cleanText(inventory.inventory_id, "unknown")}`,
        `Gold: ${Number.isFinite(Number(currency.gold)) ? Number(currency.gold) : 0}`,
        `Stackables: ${Number.isFinite(Number(inventory.stackable_count)) ? Number(inventory.stackable_count) : 0}`,
        `Equipment: ${Number.isFinite(Number(inventory.equipment_count)) ? Number(inventory.equipment_count) : 0}`,
        `Quest Items: ${Number.isFinite(Number(inventory.quest_count)) ? Number(inventory.quest_count) : 0}`
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
    const appliedConditions = Array.isArray(data.applied_conditions) ? data.applied_conditions : [];
    const conditionSummary = appliedConditions.length > 0
      ? appliedConditions.map((entry) => cleanText(entry.condition_type, "condition")).join(", ")
      : "(none)";
    const damageSummary = data.damage_result && Number.isFinite(Number(data.damage_result.final_damage))
      ? String(Number(data.damage_result.final_damage))
      : "(none)";
    const healingSummary = data.healing_result && Number.isFinite(Number(data.healing_result.healed_for))
      ? String(Number(data.healing_result.healed_for))
      : "(none)";
    const defenseSummary = data.defense_result && data.defense_result.armor_class_after !== undefined
      ? `${String(data.defense_result.armor_class_before)} -> ${String(data.defense_result.armor_class_after)}`
      : "(none)";
    return {
      ok: true,
      content: [
        `Spell: ${cleanText(data.spell_name, data.spell_id || "unknown")}`,
        `Caster: ${cleanText(data.caster_id, "unknown")}`,
        `Target: ${cleanText(data.target_id, "(none)")}`,
        `Resolution: ${cleanText(data.resolution_type, "unknown")}`,
        `Damage Type: ${cleanText(data.damage_type, "(none)")}`,
        `Hit: ${data.hit === null || data.hit === undefined ? "(n/a)" : String(Boolean(data.hit))}`,
        `Saved: ${data.saved === null || data.saved === undefined ? "(n/a)" : String(Boolean(data.saved))}`,
        `Damage: ${damageSummary}`,
        `Healing: ${healingSummary}`,
        `Defense: ${defenseSummary}`,
        `Conditions: ${conditionSummary}`,
        `Next Turn: ${cleanText(data.active_participant_id, "(none)")}`,
        `AI Actions: ${summarizeAiTurns(data.ai_turns)}`,
        `Combat Ended: ${String(Boolean(data.combat_completed))}${data.winner_team ? " | Winner: " + data.winner_team : ""}`
      ].join("\n"),
      data
    };
  }

  if (responseType === "attack") {
    return {
      ok: true,
      content: [
        `Attacker: ${cleanText(data.attacker_id, "unknown")}`,
        `Target: ${cleanText(data.target_id, "unknown")}`,
        `Hit: ${String(Boolean(data.hit))}`,
        `Damage: ${Number.isFinite(Number(data.damage_dealt)) ? Number(data.damage_dealt) : 0}`,
        `Target HP After: ${data.target_hp_after === undefined ? "(unknown)" : String(data.target_hp_after)}`,
        `Next Turn: ${cleanText(data.active_participant_id, "(none)")}`,
        `AI Actions: ${summarizeAiTurns(data.ai_turns)}`,
        `Combat Ended: ${String(Boolean(data.combat_completed))}${data.winner_team ? " | Winner: " + data.winner_team : ""}`
      ].join("\n"),
      data
    };
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
            : "Trap: none"
        ].join("\n"),
        data
      };
    }
    return {
      ok: true,
      content: [
        `Actor: ${cleanText(data.participant_id, "unknown")}`,
        `From: ${formatPosition(data.from_position)}`,
        `To: ${formatPosition(data.to_position)}`,
        `Opportunity Attacks: ${Number.isFinite(Number(data.opportunity_attack_count)) ? Number(data.opportunity_attack_count) : 0}`,
        `Next Turn: ${cleanText(data.active_participant_id, "(none)")}`,
        `AI Actions: ${summarizeAiTurns(data.ai_turns)}`,
        `Combat Ended: ${String(Boolean(data.combat_completed))}${data.winner_team ? " | Winner: " + data.winner_team : ""}`
      ].join("\n"),
      data
    };
  }

  if (responseType === "interact") {
    const stateLabel =
      data.object_state && data.object_state.is_locked ? "Locked"
        : data.object_state && data.object_state.is_disarmed ? "Disarmed"
          : data.object_state && data.object_state.is_lit ? "Lit"
          : data.object_state && data.object_state.is_opened ? "Opened"
            : "Updated";
    const spellEffect = data.spell_effect && typeof data.spell_effect === "object"
      ? `${cleanText(data.spell_effect.spell_name || data.spell_effect.spell_id, "unknown")} (${cleanText(data.spell_effect.object_state, "updated")})`
      : "none";
    return {
      ok: true,
      content: [
        `Object: ${cleanText(data.object_id, "unknown")}`,
        `Type: ${cleanText(data.object_type, "unknown")}`,
        `Action: ${cleanText(data.interaction_action, "unknown")}`,
        `State: ${stateLabel}`,
        `Spell: ${spellEffect}`,
        `Reward: ${cleanText(data.reward_status, "none")}`
      ].join("\n"),
      data
    };
  }

  if (responseType === "use") {
    if (data.use_status === "resolved" && data.combat_id) {
      return {
        ok: true,
        content: [
          `Actor: ${cleanText(data.participant_id, "unknown")}`,
          `Item: ${cleanText(data.item_id, "unknown")}`,
          `HP: ${data.hp_before === undefined ? "(unknown)" : String(data.hp_before)} -> ${data.hp_after === undefined ? "(unknown)" : String(data.hp_after)}`,
          `Healed For: ${data.healed_for === undefined ? 0 : String(data.healed_for)}`,
          `Next Turn: ${cleanText(data.active_participant_id, "(none)")}`,
          `AI Actions: ${summarizeAiTurns(data.ai_turns)}`,
          `Combat Ended: ${String(Boolean(data.combat_completed))}${data.winner_team ? " | Winner: " + data.winner_team : ""}`
        ].join("\n"),
        data
      };
    }

    return {
      ok: true,
      content: [
        `Use status: ${cleanText(data.use_status, "resolved")}`,
        `Item: ${cleanText(data.item_id, "unknown")}`,
        `Inventory: ${cleanText(data.inventory_id, "(none)")}`
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

async function sendEphemeralReply(interaction, content) {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      content: String(content || ""),
      ephemeral: true
    });
    return;
  }

  await interaction.reply({
    content: String(content || ""),
    ephemeral: true
  });
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

    const runtimeResult = await runtime.processGatewayReadCommandEvent(internalEvent);
    const reply = formatGatewayReplyFromRuntime(runtimeResult);
    await sendEphemeralReply(interaction, reply.content);

    return {
      ok: reply.ok,
      event_type: "gateway_interaction_processed",
      payload: {
        command_name: internalEvent.payload ? internalEvent.payload.command_name : null,
        request_event: internalEvent,
        runtime_result: runtimeResult
      },
      error: reply.ok ? null : reply.content
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
