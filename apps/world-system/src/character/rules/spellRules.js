"use strict";

const { loadSpellContent } = require("../../content/contentLoader");

let cachedSpellMap = null;

function toSafeArray(value) {
  return Array.isArray(value) ? value.slice() : [];
}

function normalizeId(value) {
  return String(value || "").trim().toLowerCase();
}

function isAlphaSelectableSpell(spell) {
  const metadata = spell && spell.metadata && typeof spell.metadata === "object" ? spell.metadata : {};
  return metadata.alpha_selectable !== false;
}

function buildSpellMap(entries) {
  const map = {};
  const safeEntries = Array.isArray(entries) ? entries : [];
  for (let i = 0; i < safeEntries.length; i += 1) {
    const entry = safeEntries[i];
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const id = normalizeId(entry.spell_id || entry.id);
    if (!id) {
      continue;
    }
    map[id] = entry;
  }
  return map;
}

function getSpellRulesMap() {
  if (cachedSpellMap) {
    return cachedSpellMap;
  }

  const loaded = loadSpellContent();
  if (loaded.ok) {
    const mapped = buildSpellMap(loaded.payload.entries);
    if (Object.keys(mapped).length > 0) {
      cachedSpellMap = mapped;
      return cachedSpellMap;
    }
  }

  cachedSpellMap = {};
  return cachedSpellMap;
}

function getSpellData(spell_id) {
  const id = normalizeId(spell_id);
  if (!id) {
    return {
      ok: false,
      event_type: "spell_data_lookup_failed",
      payload: { spell_data: null },
      error: "spell_id is required"
    };
  }

  const spellData = getSpellRulesMap()[id] || null;
  if (!spellData) {
    return {
      ok: false,
      event_type: "spell_data_lookup_failed",
      payload: { spell_data: null },
      error: "spell data not found"
    };
  }

  return {
    ok: true,
    event_type: "spell_data_found",
    payload: { spell_data: spellData },
    error: null
  };
}

function listAvailableSpells() {
  return {
    ok: true,
    event_type: "spell_rules_listed",
    payload: {
      spells: Object.values(getSpellRulesMap()).filter(isAlphaSelectableSpell)
    },
    error: null
  };
}

function listSpellsForClass(class_id) {
  const classId = normalizeId(class_id);
  if (!classId) {
    return {
      ok: false,
      event_type: "class_spell_list_failed",
      payload: { class_id: null, spells: [] },
      error: "class_id is required"
    };
  }

  const allSpells = Object.values(getSpellRulesMap());
  const matched = allSpells.filter((spell) => {
    if (!isAlphaSelectableSpell(spell)) {
      return false;
    }
    const directRefs = toSafeArray(spell.class_refs).map((entry) => normalizeId(entry));
    const metadataRefs = toSafeArray(spell && spell.metadata && spell.metadata.class_refs)
      .map((entry) => normalizeId(entry));
    return directRefs.includes(classId) || metadataRefs.includes(classId);
  });

  return {
    ok: true,
    event_type: "class_spell_listed",
    payload: {
      class_id: classId,
      spells: matched
    },
    error: null
  };
}

module.exports = {
  getSpellData,
  listAvailableSpells,
  listSpellsForClass
};
