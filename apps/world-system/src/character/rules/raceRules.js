"use strict";

const { loadRaceContent } = require("../../content/contentLoader");

const FALLBACK_RACE_RULES = {
  human: {
    id: "human",
    name: "Human",
    stat_modifiers: {},
    features: ["adaptive"],
    metadata: {
      source: "scaffold",
      notes: ["Flexible ancestry scaffold", "No fixed mechanical bonuses yet"]
    }
  },
  elf: {
    id: "elf",
    name: "Elf",
    stat_modifiers: {},
    features: ["keen_senses"],
    metadata: {
      source: "scaffold",
      notes: ["Graceful ancestry scaffold", "No fixed mechanical bonuses yet"]
    }
  },
  dwarf: {
    id: "dwarf",
    name: "Dwarf",
    stat_modifiers: {},
    features: ["sturdy"],
    metadata: {
      source: "scaffold",
      notes: ["Sturdy ancestry scaffold", "No fixed mechanical bonuses yet"]
    }
  }
};

let cachedRaceRules = null;

function buildRaceRuleMap(entries) {
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

function getRaceRulesMap() {
  if (cachedRaceRules) {
    return cachedRaceRules;
  }

  const loaded = loadRaceContent();
  if (loaded.ok) {
    const mapped = buildRaceRuleMap(loaded.payload.entries);
    if (Object.keys(mapped).length > 0) {
      cachedRaceRules = mapped;
      return cachedRaceRules;
    }
  }

  cachedRaceRules = FALLBACK_RACE_RULES;
  return cachedRaceRules;
}

const RACE_RULES = getRaceRulesMap();

function normalizeRaceId(race_id) {
  return String(race_id || "").trim().toLowerCase();
}

function getRaceData(race_id) {
  const id = normalizeRaceId(race_id);
  if (!id) {
    return {
      ok: false,
      event_type: "race_data_lookup_failed",
      payload: { race_data: null },
      error: "race_id is required"
    };
  }

  const race_data = getRaceRulesMap()[id] || null;
  if (!race_data) {
    return {
      ok: false,
      event_type: "race_data_lookup_failed",
      payload: { race_data: null },
      error: "race data not found"
    };
  }

  return {
    ok: true,
    event_type: "race_data_found",
    payload: { race_data },
    error: null
  };
}

function listAvailableRaces() {
  return {
    ok: true,
    event_type: "race_rules_listed",
    payload: {
      races: Object.values(getRaceRulesMap())
    },
    error: null
  };
}

function getRaceOptions(race_id) {
  const raceOut = getRaceData(race_id);
  if (!raceOut.ok) {
    return {
      ok: false,
      event_type: "race_options_lookup_failed",
      payload: {
        race_id: normalizeRaceId(race_id),
        subraces: [],
        ancestry_options: []
      },
      error: raceOut.error
    };
  }

  const race = raceOut.payload.race_data;
  const metadata = race.metadata && typeof race.metadata === "object" ? race.metadata : {};

  return {
    ok: true,
    event_type: "race_options_found",
    payload: {
      race_id: race.id,
      subraces: Array.isArray(metadata.subraces) ? metadata.subraces : [],
      ancestry_options: Array.isArray(metadata.draconic_ancestry_options)
        ? metadata.draconic_ancestry_options
        : []
    },
    error: null
  };
}

function getRaceOptionData(race_id, option_id) {
  const optionsOut = getRaceOptions(race_id);
  if (!optionsOut.ok) {
    return {
      ok: false,
      event_type: "race_option_lookup_failed",
      payload: { option_data: null },
      error: optionsOut.error
    };
  }

  const normalizedOptionId = String(option_id || "").trim().toLowerCase();
  if (!normalizedOptionId) {
    return {
      ok: false,
      event_type: "race_option_lookup_failed",
      payload: { option_data: null },
      error: "option_id is required"
    };
  }

  const subrace = optionsOut.payload.subraces.find(
    (entry) => entry && String(entry.id || "").toLowerCase() === normalizedOptionId
  );
  if (subrace) {
    return {
      ok: true,
      event_type: "race_option_found",
      payload: {
        option_type: "subrace",
        option_data: subrace
      },
      error: null
    };
  }

  const ancestry = optionsOut.payload.ancestry_options.find(
    (entry) => entry && String(entry.id || "").toLowerCase() === normalizedOptionId
  );
  if (ancestry) {
    return {
      ok: true,
      event_type: "race_option_found",
      payload: {
        option_type: "draconic_ancestry",
        option_data: ancestry
      },
      error: null
    };
  }

  return {
    ok: false,
    event_type: "race_option_lookup_failed",
    payload: { option_data: null },
    error: "race option not found"
  };
}

function getRaceRule(race_id) {
  const out = getRaceData(race_id);
  if (!out.ok) {
    return {
      ok: false,
      event_type: "race_rule_lookup_failed",
      payload: { race: null },
      error: out.error
    };
  }

  return {
    ok: true,
    event_type: "race_rule_found",
    payload: { race: out.payload.race_data },
    error: null
  };
}

function applyRaceHooks(character, race_id) {
  if (!character || typeof character !== "object") {
    return {
      ok: false,
      event_type: "race_hooks_apply_failed",
      payload: { character: null },
      error: "character object is required"
    };
  }

  const ruleResult = getRaceRule(race_id || character.race || "human");
  if (!ruleResult.ok) {
    return {
      ok: false,
      event_type: "race_hooks_apply_failed",
      payload: { character: null },
      error: ruleResult.error
    };
  }

  return {
    ok: true,
    event_type: "race_hooks_applied",
    payload: {
      character: Object.assign({}, character, { race: ruleResult.payload.race.id }),
      applied_rule: ruleResult.payload.race
    },
    error: null
  };
}

module.exports = {
  RACE_RULES,
  getRaceData,
  listAvailableRaces,
  getRaceOptions,
  getRaceOptionData,
  getRaceRule,
  applyRaceHooks
};
