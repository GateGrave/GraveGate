"use strict";

const { loadClassContent } = require("../../content/contentLoader");

const FALLBACK_CLASS_RULES = {
  fighter: {
    id: "fighter",
    name: "Fighter",
    stat_modifiers: {},
    features: ["fighting_style"],
    metadata: {
      source: "scaffold",
      notes: ["Martial class scaffold", "No full class mechanics yet"]
    }
  },
  wizard: {
    id: "wizard",
    name: "Wizard",
    stat_modifiers: {},
    features: ["spellcasting"],
    metadata: {
      source: "scaffold",
      notes: ["Arcane class scaffold", "No full class mechanics yet"]
    }
  },
  rogue: {
    id: "rogue",
    name: "Rogue",
    stat_modifiers: {},
    features: ["sneak_attack"],
    metadata: {
      source: "scaffold",
      notes: ["Skill class scaffold", "No full class mechanics yet"]
    }
  }
};

let cachedClassRules = null;

function buildClassRuleMap(entries) {
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

function getClassRulesMap() {
  if (cachedClassRules) {
    return cachedClassRules;
  }

  const loaded = loadClassContent();
  if (loaded.ok) {
    const mapped = buildClassRuleMap(loaded.payload.entries);
    if (Object.keys(mapped).length > 0) {
      cachedClassRules = mapped;
      return cachedClassRules;
    }
  }

  cachedClassRules = FALLBACK_CLASS_RULES;
  return cachedClassRules;
}

const CLASS_RULES = getClassRulesMap();

function normalizeClassId(class_id) {
  return String(class_id || "").trim().toLowerCase();
}

function getClassData(class_id) {
  const id = normalizeClassId(class_id);
  if (!id) {
    return {
      ok: false,
      event_type: "class_data_lookup_failed",
      payload: { class_data: null },
      error: "class_id is required"
    };
  }

  const class_data = getClassRulesMap()[id] || null;
  if (!class_data) {
    return {
      ok: false,
      event_type: "class_data_lookup_failed",
      payload: { class_data: null },
      error: "class data not found"
    };
  }

  return {
    ok: true,
    event_type: "class_data_found",
    payload: { class_data },
    error: null
  };
}

function listAvailableClasses() {
  return {
    ok: true,
    event_type: "class_rules_listed",
    payload: {
      classes: Object.values(getClassRulesMap())
    },
    error: null
  };
}

function getClassOptions(class_id) {
  const classOut = getClassData(class_id);
  if (!classOut.ok) {
    return {
      ok: false,
      event_type: "class_options_lookup_failed",
      payload: {
        class_id: normalizeClassId(class_id),
        subclasses: []
      },
      error: classOut.error
    };
  }

  const classRule = classOut.payload.class_data;
  const metadata = classRule.metadata && typeof classRule.metadata === "object" ? classRule.metadata : {};

  return {
    ok: true,
    event_type: "class_options_found",
    payload: {
      class_id: classRule.id,
      subclasses: Array.isArray(metadata.subclasses) ? metadata.subclasses : []
    },
    error: null
  };
}

function getClassOptionData(class_id, option_id) {
  const optionsOut = getClassOptions(class_id);
  if (!optionsOut.ok) {
    return {
      ok: false,
      event_type: "class_option_lookup_failed",
      payload: { option_data: null },
      error: optionsOut.error
    };
  }

  const normalizedOptionId = String(option_id || "").trim().toLowerCase();
  if (!normalizedOptionId) {
    return {
      ok: false,
      event_type: "class_option_lookup_failed",
      payload: { option_data: null },
      error: "option_id is required"
    };
  }

  const subclass = optionsOut.payload.subclasses.find(
    (entry) => entry && String(entry.id || "").toLowerCase() === normalizedOptionId
  );

  if (!subclass) {
    return {
      ok: false,
      event_type: "class_option_lookup_failed",
      payload: { option_data: null },
      error: "class option not found"
    };
  }

  return {
    ok: true,
    event_type: "class_option_found",
    payload: {
      option_type: "subclass",
      option_data: subclass
    },
    error: null
  };
}

function getClassRule(class_id) {
  const out = getClassData(class_id);
  if (!out.ok) {
    return {
      ok: false,
      event_type: "class_rule_lookup_failed",
      payload: { class_rule: null },
      error: out.error
    };
  }

  return {
    ok: true,
    event_type: "class_rule_found",
    payload: { class_rule: out.payload.class_data },
    error: null
  };
}

function applyClassHooks(character, class_id) {
  if (!character || typeof character !== "object") {
    return {
      ok: false,
      event_type: "class_hooks_apply_failed",
      payload: { character: null },
      error: "character object is required"
    };
  }

  const ruleResult = getClassRule(class_id || character.class || "fighter");
  if (!ruleResult.ok) {
    return {
      ok: false,
      event_type: "class_hooks_apply_failed",
      payload: { character: null },
      error: ruleResult.error
    };
  }

  return {
    ok: true,
    event_type: "class_hooks_applied",
    payload: {
      character: Object.assign({}, character, { class: ruleResult.payload.class_rule.id }),
      applied_rule: ruleResult.payload.class_rule
    },
    error: null
  };
}

module.exports = {
  CLASS_RULES,
  getClassData,
  listAvailableClasses,
  getClassOptions,
  getClassOptionData,
  getClassRule,
  applyClassHooks
};
