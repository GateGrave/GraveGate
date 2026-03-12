"use strict";

const { loadBackgroundContent } = require("../../content/contentLoader");

const FALLBACK_BACKGROUND_RULES = {
  acolyte: {
    id: "acolyte",
    name: "Acolyte",
    stat_modifiers: {},
    features: ["religious_training"],
    metadata: {
      source: "scaffold",
      notes: ["Faith-based origin scaffold", "No full background mechanics yet"]
    }
  },
  soldier: {
    id: "soldier",
    name: "Soldier",
    stat_modifiers: {},
    features: ["military_rank"],
    metadata: {
      source: "scaffold",
      notes: ["Military origin scaffold", "No full background mechanics yet"]
    }
  },
  sage: {
    id: "sage",
    name: "Sage",
    stat_modifiers: {},
    features: ["researcher"],
    metadata: {
      source: "scaffold",
      notes: ["Academic origin scaffold", "No full background mechanics yet"]
    }
  }
};

let cachedBackgroundRules = null;

function buildBackgroundRuleMap(entries) {
  const map = {};
  const safeEntries = Array.isArray(entries) ? entries : [];
  for (const entry of safeEntries) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string") {
      continue;
    }
    map[String(entry.id).toLowerCase()] = entry;
  }
  return map;
}

function getBackgroundRulesMap() {
  if (cachedBackgroundRules) {
    return cachedBackgroundRules;
  }

  const loaded = loadBackgroundContent();
  if (loaded.ok) {
    const mapped = buildBackgroundRuleMap(loaded.payload.entries);
    if (Object.keys(mapped).length > 0) {
      cachedBackgroundRules = mapped;
      return cachedBackgroundRules;
    }
  }

  cachedBackgroundRules = FALLBACK_BACKGROUND_RULES;
  return cachedBackgroundRules;
}

const BACKGROUND_RULES = getBackgroundRulesMap();

function normalizeBackgroundId(background_id) {
  return String(background_id || "").trim().toLowerCase();
}

function getBackgroundData(background_id) {
  const id = normalizeBackgroundId(background_id);
  if (!id) {
    return {
      ok: false,
      event_type: "background_data_lookup_failed",
      payload: { background_data: null },
      error: "background_id is required"
    };
  }

  const background_data = getBackgroundRulesMap()[id] || null;
  if (!background_data) {
    return {
      ok: false,
      event_type: "background_data_lookup_failed",
      payload: { background_data: null },
      error: "background data not found"
    };
  }

  return {
    ok: true,
    event_type: "background_data_found",
    payload: { background_data },
    error: null
  };
}

function listAvailableBackgrounds() {
  return {
    ok: true,
    event_type: "background_rules_listed",
    payload: {
      backgrounds: Object.values(getBackgroundRulesMap())
    },
    error: null
  };
}

function getBackgroundRule(background_id) {
  const out = getBackgroundData(background_id);
  if (!out.ok) {
    return {
      ok: false,
      event_type: "background_rule_lookup_failed",
      payload: { background: null },
      error: out.error
    };
  }

  return {
    ok: true,
    event_type: "background_rule_found",
    payload: { background: out.payload.background_data },
    error: null
  };
}

function applyBackgroundHooks(character, background_id) {
  if (!character || typeof character !== "object") {
    return {
      ok: false,
      event_type: "background_hooks_apply_failed",
      payload: { character: null },
      error: "character object is required"
    };
  }

  const ruleResult = getBackgroundRule(background_id || character.background || "acolyte");
  if (!ruleResult.ok) {
    return {
      ok: false,
      event_type: "background_hooks_apply_failed",
      payload: { character: null },
      error: ruleResult.error
    };
  }

  return {
    ok: true,
    event_type: "background_hooks_applied",
    payload: {
      character: Object.assign({}, character, {
        background: ruleResult.payload.background.id
      }),
      applied_rule: ruleResult.payload.background
    },
    error: null
  };
}

module.exports = {
  BACKGROUND_RULES,
  getBackgroundData,
  listAvailableBackgrounds,
  getBackgroundRule,
  applyBackgroundHooks
};
