"use strict";

const { getRaceData, getRaceOptions, getRaceOptionData } = require("../rules/raceRules");
const { getClassData, getClassOptionData } = require("../rules/classRules");
const { getBackgroundData } = require("../rules/backgroundRules");

function fail(event_type, error, payload) {
  return {
    ok: false,
    event_type,
    payload: payload || {},
    error
  };
}

function ok(event_type, payload) {
  return {
    ok: true,
    event_type,
    payload: payload || {},
    error: null
  };
}

function toSafeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeId(value) {
  return String(value || "").trim().toLowerCase();
}

function arrayFrom(value) {
  return Array.isArray(value) ? value.slice() : [];
}

function mergeStatModifiers() {
  const merged = {};
  for (let i = 0; i < arguments.length; i += 1) {
    const source = toSafeObject(arguments[i]);
    const keys = Object.keys(source);
    for (let j = 0; j < keys.length; j += 1) {
      const key = keys[j];
      const amount = Number(source[key]);
      if (!Number.isFinite(amount)) {
        continue;
      }
      merged[key] = (merged[key] || 0) + amount;
    }
  }
  return merged;
}

function dedupeStrings(values) {
  const out = [];
  const seen = {};
  const safeValues = Array.isArray(values) ? values : [];
  for (let i = 0; i < safeValues.length; i += 1) {
    const entry = String(safeValues[i] || "").trim();
    if (!entry || seen[entry]) {
      continue;
    }
    seen[entry] = true;
    out.push(entry);
  }
  return out;
}

function normalizeStatsBlock(inputStats) {
  const raw = toSafeObject(inputStats);
  const keys = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
  const out = {};
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const value = Number(raw[key]);
    out[key] = Number.isFinite(value) ? Math.floor(value) : 10;
  }
  return out;
}

function applyModifiersToStats(baseStats, modifiers) {
  const normalizedBase = normalizeStatsBlock(baseStats);
  const normalizedMods = toSafeObject(modifiers);
  const keys = Object.keys(normalizedBase);
  const out = {};
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const modValue = Number(normalizedMods[key]);
    out[key] = normalizedBase[key] + (Number.isFinite(modValue) ? Math.floor(modValue) : 0);
  }
  return out;
}

function mergeProficiencies(existing, patch) {
  const base = toSafeObject(existing);
  const next = toSafeObject(patch);
  return {
    saving_throws: dedupeStrings(arrayFrom(base.saving_throws).concat(arrayFrom(next.saving_throws))),
    armor: dedupeStrings(arrayFrom(base.armor).concat(arrayFrom(next.armor))),
    weapons: dedupeStrings(arrayFrom(base.weapons).concat(arrayFrom(next.weapons))),
    tools: dedupeStrings(arrayFrom(base.tools).concat(arrayFrom(next.tools))),
    skills: dedupeStrings(arrayFrom(base.skills).concat(arrayFrom(next.skills))),
    languages: dedupeStrings(arrayFrom(base.languages).concat(arrayFrom(next.languages)))
  };
}

function applyRaceSelection(characterProfile, raceId, optionId) {
  const character = toSafeObject(characterProfile);
  const race_id = normalizeId(raceId);
  const race_option_id = normalizeId(optionId);

  if (!race_id) {
    return fail("character_race_selection_failed", "race_id is required", {
      reason: "missing_race_id"
    });
  }

  const raceOut = getRaceData(race_id);
  if (!raceOut.ok) {
    return fail("character_race_selection_failed", raceOut.error, {
      reason: "invalid_race_id",
      race_id
    });
  }

  const raceOptionsOut = getRaceOptions(race_id);
  const hasSubraceOptions =
    raceOptionsOut.ok && Array.isArray(raceOptionsOut.payload.subraces) && raceOptionsOut.payload.subraces.length > 0;
  const hasAncestryOptions =
    raceOptionsOut.ok &&
    Array.isArray(raceOptionsOut.payload.ancestry_options) &&
    raceOptionsOut.payload.ancestry_options.length > 0;
  const raceHasOptions = hasSubraceOptions || hasAncestryOptions;

  if (raceHasOptions && !race_option_id) {
    return fail("character_race_selection_failed", "race_option_id is required for this race", {
      reason: "missing_required_race_option",
      race_id
    });
  }

  let raceOptionData = null;
  let raceOptionType = null;
  if (race_option_id) {
    const raceOptionOut = getRaceOptionData(race_id, race_option_id);
    if (!raceOptionOut.ok) {
      return fail("character_race_selection_failed", raceOptionOut.error, {
        reason: "invalid_race_option",
        race_id,
        race_option_id
      });
    }
    raceOptionData = raceOptionOut.payload.option_data;
    raceOptionType = raceOptionOut.payload.option_type || null;
  }

  const raceData = raceOut.payload.race_data;
  const mergedStatModifiers = mergeStatModifiers(
    character.applied_stat_modifiers,
    raceData.stat_modifiers,
    raceOptionData ? raceOptionData.stat_modifiers : {}
  );
  const mergedFeatureRefs = dedupeStrings(
    arrayFrom(character.applied_feature_refs)
      .concat(arrayFrom(raceData.features))
      .concat(raceOptionData ? arrayFrom(raceOptionData.features) : [])
  );

  const baseStats = normalizeStatsBlock(character.base_stats || character.stats);
  const effectiveStats = applyModifiersToStats(baseStats, mergedStatModifiers);
  const metadata = toSafeObject(character.metadata);
  const selectionApplication = toSafeObject(metadata.selection_application);
  const nextProfile = Object.assign({}, character, {
    base_stats: baseStats,
    stats: effectiveStats,
    race_id,
    race_option_id: race_option_id || null,
    race: race_id,
    applied_stat_modifiers: mergedStatModifiers,
    applied_feature_refs: mergedFeatureRefs,
    race_selection: {
      race_id,
      race_name: raceData.name || race_id,
      race_metadata: toSafeObject(raceData.metadata),
      option_id: race_option_id || null,
      option_type: raceOptionType,
      option_name: raceOptionData ? raceOptionData.name || race_option_id : null,
      option_metadata: raceOptionData ? toSafeObject(raceOptionData.metadata) : null,
      stat_modifiers: mergeStatModifiers(raceData.stat_modifiers, raceOptionData ? raceOptionData.stat_modifiers : {}),
      feature_refs: dedupeStrings(
        arrayFrom(raceData.features).concat(raceOptionData ? arrayFrom(raceOptionData.features) : [])
      )
    },
    selection: Object.assign({}, toSafeObject(character.selection), {
      race: {
        id: race_id,
        option_id: race_option_id || null,
        option_type: raceOptionType
      }
    }),
    feature_scaffolds: Object.assign({}, toSafeObject(character.feature_scaffolds), {
      race: {
        race_id,
        option_id: race_option_id || null,
        feature_refs: dedupeStrings(
          arrayFrom(raceData.features).concat(raceOptionData ? arrayFrom(raceOptionData.features) : [])
        )
      }
    }),
    metadata: Object.assign({}, metadata, {
      selection_application: Object.assign({}, selectionApplication, {
        source: "content_srd_5_1_scaffold",
        race_name: raceData.name || race_id,
        race_option_name: raceOptionData ? raceOptionData.name || race_option_id : null,
        updated_at: new Date().toISOString()
      })
    })
  });

  return ok("character_race_selection_applied", {
    character_profile: nextProfile
  });
}

function applyClassSelection(characterProfile, classId, optionId) {
  const character = toSafeObject(characterProfile);
  const class_id = normalizeId(classId);
  const class_option_id = normalizeId(optionId);

  if (!class_id) {
    return fail("character_class_selection_failed", "class_id is required", {
      reason: "missing_class_id"
    });
  }

  const classOut = getClassData(class_id);
  if (!classOut.ok) {
    return fail("character_class_selection_failed", classOut.error, {
      reason: "invalid_class_id",
      class_id
    });
  }

  let classOptionData = null;
  let classOptionType = null;
  if (class_option_id) {
    const classOptionOut = getClassOptionData(class_id, class_option_id);
    if (!classOptionOut.ok) {
      return fail("character_class_selection_failed", classOptionOut.error, {
        reason: "invalid_class_option",
        class_id,
        class_option_id
      });
    }
    classOptionData = classOptionOut.payload.option_data;
    classOptionType = classOptionOut.payload.option_type || null;
  }

  const classData = classOut.payload.class_data;
  const classMetadata = toSafeObject(classData.metadata);
  const mergedFeatureRefs = dedupeStrings(
    arrayFrom(character.applied_feature_refs)
      .concat(arrayFrom(classData.features))
      .concat(classOptionData ? arrayFrom(classOptionData.features) : [])
  );
  const mergedProficiencies = mergeProficiencies(character.applied_proficiencies, {
    saving_throws: arrayFrom(classMetadata.saving_throws),
    armor: arrayFrom(classMetadata.armor_proficiencies),
    weapons: arrayFrom(classMetadata.weapon_proficiencies),
    tools: arrayFrom(classMetadata.tool_proficiencies),
    skills: [],
    languages: []
  });

  const metadata = toSafeObject(character.metadata);
  const selectionApplication = toSafeObject(metadata.selection_application);
  const nextProfile = Object.assign({}, character, {
    class_id,
    class_option_id: class_option_id || null,
    class: class_id,
    applied_feature_refs: mergedFeatureRefs,
    applied_proficiencies: mergedProficiencies,
    class_selection: {
      class_id,
      class_name: classData.name || class_id,
      hit_die: classData.hit_die || classMetadata.hit_die || null,
      primary_abilities: arrayFrom(classData.primary_abilities || classMetadata.primary_abilities),
      saving_throws: arrayFrom(classMetadata.saving_throws),
      armor_proficiencies: arrayFrom(classMetadata.armor_proficiencies),
      weapon_proficiencies: arrayFrom(classMetadata.weapon_proficiencies),
      tool_proficiencies: arrayFrom(classMetadata.tool_proficiencies),
      spellcasting_ability:
        classData.spellcasting_ability || classMetadata.spellcasting_ability || character.spellcasting_ability || null,
      notes: arrayFrom(classMetadata.notes),
      class_metadata: classMetadata,
      option_id: class_option_id || null,
      option_type: classOptionType,
      option_name: classOptionData ? classOptionData.name || class_option_id : null,
      option_metadata: classOptionData ? toSafeObject(classOptionData.metadata) : null,
      feature_refs: dedupeStrings(
        arrayFrom(classData.features).concat(classOptionData ? arrayFrom(classOptionData.features) : [])
      )
    },
    selection: Object.assign({}, toSafeObject(character.selection), {
      class: {
        id: class_id,
        option_id: class_option_id || null,
        option_type: classOptionType
      }
    }),
    feature_scaffolds: Object.assign({}, toSafeObject(character.feature_scaffolds), {
      class: {
        class_id,
        option_id: class_option_id || null,
        feature_refs: dedupeStrings(
          arrayFrom(classData.features).concat(classOptionData ? arrayFrom(classOptionData.features) : [])
        )
      }
    }),
    spellcasting_ability:
      classData.spellcasting_ability || classMetadata.spellcasting_ability || character.spellcasting_ability || null,
    metadata: Object.assign({}, metadata, {
      selection_application: Object.assign({}, selectionApplication, {
        source: "content_srd_5_1_scaffold",
        class_name: classData.name || class_id,
        class_option_name: classOptionData ? classOptionData.name || class_option_id : null,
        updated_at: new Date().toISOString()
      })
    })
  });

  return ok("character_class_selection_applied", {
    character_profile: nextProfile
  });
}

function applyBackgroundSelection(characterProfile, backgroundId) {
  const normalizedBackgroundId = normalizeId(backgroundId);
  if (!normalizedBackgroundId) {
    return ok("character_background_selection_skipped", {
      character_profile: Object.assign({}, toSafeObject(characterProfile), {
        background_id: null,
        background: null
      })
    });
  }

  const backgroundOut = getBackgroundData(normalizedBackgroundId);
  if (!backgroundOut.ok) {
    return fail("character_selection_finalize_failed", backgroundOut.error, {
      reason: "invalid_background_id",
      background_id: normalizedBackgroundId
    });
  }

  const profile = toSafeObject(characterProfile);
  const backgroundData = backgroundOut.payload.background_data;
  const backgroundMetadata = toSafeObject(backgroundData.metadata);
  const baseStats = normalizeStatsBlock(profile.base_stats || profile.stats);
  const mergedStatModifiers = mergeStatModifiers(
    profile.applied_stat_modifiers,
    backgroundData.stat_modifiers
  );
  const effectiveStats = applyModifiersToStats(baseStats, mergedStatModifiers);
  const mergedFeatureRefs = dedupeStrings(
    arrayFrom(profile.applied_feature_refs)
      .concat(arrayFrom(backgroundData.features))
      .concat(arrayFrom(backgroundMetadata.feature_refs))
  );
  const mergedProficiencies = mergeProficiencies(profile.applied_proficiencies, {
    skills: dedupeStrings(arrayFrom(backgroundData.skill_proficiencies).concat(arrayFrom(backgroundMetadata.skill_proficiencies))),
    tools: dedupeStrings(arrayFrom(backgroundData.tool_refs).concat(arrayFrom(backgroundMetadata.tool_refs))),
    languages: dedupeStrings(arrayFrom(backgroundData.language_refs).concat(arrayFrom(backgroundMetadata.language_refs)))
  });

  const metadata = toSafeObject(profile.metadata);
  const selectionApplication = toSafeObject(metadata.selection_application);
  const nextProfile = Object.assign({}, profile, {
    base_stats: baseStats,
    stats: effectiveStats,
    background_id: normalizedBackgroundId,
    background: normalizedBackgroundId,
    applied_stat_modifiers: mergedStatModifiers,
    applied_feature_refs: mergedFeatureRefs,
    applied_proficiencies: mergedProficiencies,
    background_selection: {
      background_id: normalizedBackgroundId,
      background_name: backgroundData.name || normalizedBackgroundId,
      feature_refs: dedupeStrings(arrayFrom(backgroundData.features).concat(arrayFrom(backgroundMetadata.feature_refs))),
      metadata: backgroundMetadata
    },
    selection: Object.assign({}, toSafeObject(profile.selection), {
      background: {
        id: normalizedBackgroundId
      }
    }),
    feature_scaffolds: Object.assign({}, toSafeObject(profile.feature_scaffolds), {
      background: {
        background_id: normalizedBackgroundId,
        feature_refs: dedupeStrings(
          arrayFrom(backgroundData.features).concat(arrayFrom(backgroundMetadata.feature_refs))
        )
      }
    }),
    metadata: Object.assign({}, metadata, {
      selection_application: Object.assign({}, selectionApplication, {
        source: "content_srd_5_1_scaffold",
        background_name: backgroundData.name || normalizedBackgroundId,
        updated_at: new Date().toISOString()
      })
    })
  });

  return ok("character_background_selection_applied", {
    character_profile: nextProfile
  });
}

function finalizeCharacterProfile(baseProfile, selections) {
  // Audit note:
  // Canonical insertion point is this file because bootstrapPlayerStart already depends on
  // applyCharacterSelections() from here. Extending this module keeps one selection assembly path.
  const character = toSafeObject(baseProfile);
  if (!selections || typeof selections !== "object" || Array.isArray(selections)) {
    return fail("character_selection_finalize_failed", "selections must be an object", {
      reason: "malformed_selection_payload"
    });
  }
  const selectionData = toSafeObject(selections);

  const race_id = normalizeId(selectionData.race_id || selectionData.raceId);
  const race_option_id = normalizeId(selectionData.race_option_id || selectionData.raceOptionId);
  const class_id = normalizeId(selectionData.class_id || selectionData.classId);
  const class_option_id = normalizeId(selectionData.class_option_id || selectionData.classOptionId);
  const background_id = normalizeId(selectionData.background_id || selectionData.backgroundId);

  if (!race_id || !class_id) {
    return fail("character_selection_finalize_failed", "race_id and class_id are required", {
      reason: "missing_required_selection_ids"
    });
  }

  const raceApplied = applyRaceSelection(character, race_id, race_option_id);
  if (!raceApplied.ok) {
    return fail("character_selection_finalize_failed", raceApplied.error, raceApplied.payload);
  }

  const classApplied = applyClassSelection(
    raceApplied.payload.character_profile,
    class_id,
    class_option_id
  );
  if (!classApplied.ok) {
    return fail("character_selection_finalize_failed", classApplied.error, classApplied.payload);
  }

  const backgroundApplied = applyBackgroundSelection(classApplied.payload.character_profile, background_id);
  if (!backgroundApplied.ok) {
    return backgroundApplied;
  }

  const finalizedProfile = Object.assign({}, backgroundApplied.payload.character_profile, {
    // Shape lock note:
    // `selection`, `race_selection`, `class_selection`, `background_selection`, and `feature_scaffolds`
    // are the canonical assembled selection fields. Legacy ids are retained for downstream compatibility.
    selection: Object.assign({}, toSafeObject(backgroundApplied.payload.character_profile.selection), {
      race: toSafeObject(backgroundApplied.payload.character_profile.selection).race || {
        id: race_id,
        option_id: race_option_id || null
      },
      class: toSafeObject(backgroundApplied.payload.character_profile.selection).class || {
        id: class_id,
        option_id: class_option_id || null
      },
      background: toSafeObject(backgroundApplied.payload.character_profile.selection).background || {
        id: background_id || null
      }
    })
  });

  return ok("character_profile_finalized", {
    character_profile: finalizedProfile,
    selection_summary: {
      race_id,
      race_option_id: race_option_id || null,
      class_id,
      class_option_id: class_option_id || null,
      background_id: background_id || null
    }
  });
}

function applyCharacterSelections(input) {
  const data = toSafeObject(input);
  const character = toSafeObject(data.character);
  const out = finalizeCharacterProfile(character, {
    race_id: data.race_id,
    race_option_id: data.race_option_id,
    class_id: data.class_id,
    class_option_id: data.class_option_id,
    background_id: data.background_id
  });

  if (!out.ok) {
    return fail("character_selection_apply_failed", out.error, out.payload);
  }

  return ok("character_selection_applied", out.payload);
}

module.exports = {
  applyRaceSelection,
  applyClassSelection,
  finalizeCharacterProfile,
  applyCharacterSelections
};
