"use strict";

const { defaultCharacterService } = require("../character.defaults");
const { getClassData, getClassOptionData } = require("../rules/classRules");
const { listSpellsForClass } = require("../rules/spellRules");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {},
    error: null
  };
}

function failure(eventType, message, payload) {
  return {
    ok: false,
    event_type: eventType,
    payload: payload || {},
    error: message
  };
}

const XP_THRESHOLDS = [
  { level: 1, min_xp: 0 },
  { level: 2, min_xp: 300 },
  { level: 3, min_xp: 900 },
  { level: 4, min_xp: 2700 },
  { level: 5, min_xp: 6500 },
  { level: 6, min_xp: 14000 },
  { level: 7, min_xp: 23000 },
  { level: 8, min_xp: 34000 },
  { level: 9, min_xp: 48000 },
  { level: 10, min_xp: 64000 },
  { level: 11, min_xp: 85000 },
  { level: 12, min_xp: 100000 },
  { level: 13, min_xp: 120000 },
  { level: 14, min_xp: 140000 },
  { level: 15, min_xp: 165000 },
  { level: 16, min_xp: 195000 },
  { level: 17, min_xp: 225000 },
  { level: 18, min_xp: 265000 },
  { level: 19, min_xp: 305000 },
  { level: 20, min_xp: 355000 }
];

function getLevelForXp(xp) {
  const safeXp = Math.max(0, Math.floor(Number(xp || 0)));
  let level = 1;
  for (let i = 0; i < XP_THRESHOLDS.length; i += 1) {
    const threshold = XP_THRESHOLDS[i];
    if (safeXp >= threshold.min_xp) {
      level = threshold.level;
    }
  }
  return level;
}

function getProficiencyBonus(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level || 1)));
  return 2 + Math.floor((safeLevel - 1) / 4);
}

function getCasterSpellLevelCap(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level || 1)));
  return Math.max(1, Math.min(9, Math.floor((safeLevel + 1) / 2)));
}

function buildSpellProgression(classId, level, characterSpellbook) {
  const spellsOut = listSpellsForClass(classId);
  if (!spellsOut.ok) {
    return {
      ok: false,
      error: spellsOut.error || "failed to list class spells"
    };
  }

  const cap = getCasterSpellLevelCap(level);
  const availableSpells = spellsOut.payload.spells.filter((spell) => {
    const spellLevel = Number.isFinite(spell && spell.level) ? Number(spell.level) : 0;
    return spellLevel === 0 || spellLevel <= cap;
  });

  const knownSpellIds = Array.isArray(characterSpellbook && characterSpellbook.known_spell_ids)
    ? characterSpellbook.known_spell_ids.map((entry) => String(entry))
    : [];
  const cappedKnownSpellIds = knownSpellIds.filter((spellId) => {
    const spell = availableSpells.find((entry) => String(entry.spell_id) === spellId);
    return Boolean(spell);
  });

  return {
    ok: true,
    progression: {
      class_id: classId,
      max_spell_level: cap,
      available_spell_ids: availableSpells.map((entry) => String(entry.spell_id)),
      available_spells_count: availableSpells.length,
      known_spell_ids: cappedKnownSpellIds,
      updated_at: new Date().toISOString()
    }
  };
}

function updateCharacterProgress(input) {
  const data = input || {};
  const characterService = data.character_service || defaultCharacterService;
  const characterId = data.character_id;

  if (!characterService || typeof characterService.getCharacterById !== "function") {
    return failure("character_progress_update_failed", "character service is required");
  }
  if (!characterId || String(characterId).trim() === "") {
    return failure("character_progress_update_failed", "character_id is required");
  }

  const found = characterService.getCharacterById(characterId);
  if (!found.ok) {
    return failure("character_progress_update_failed", found.error, {
      character_id: String(characterId)
    });
  }

  const character = found.payload.character;
  const currentXp = Number.isFinite(character.xp) ? Math.floor(Number(character.xp)) : 0;
  const xpDelta = Number.isFinite(data.xp_delta) ? Math.floor(Number(data.xp_delta)) : 0;
  const requestedOptionId = data.class_option_id ? String(data.class_option_id).trim() : "";
  const levelUpRequest = Boolean(data.level_up_request);
  const explicitLevelProvided = Number.isFinite(data.level);

  let nextXp = currentXp + xpDelta;
  if (nextXp < 0) {
    nextXp = 0;
  }

  const currentLevel = Number.isFinite(character.level) ? Math.max(1, Math.floor(Number(character.level))) : 1;
  const levelFromXp = getLevelForXp(nextXp);

  if (levelUpRequest && levelFromXp <= currentLevel) {
    return failure("character_progress_update_failed", "xp threshold not met for level up", {
      character_id: String(characterId),
      current_level: currentLevel,
      current_xp: currentXp,
      next_xp: nextXp
    });
  }

  let nextLevel = Math.max(currentLevel, levelFromXp);
  if (explicitLevelProvided) {
    const requestedLevel = Math.max(1, Math.floor(Number(data.level)));
    if (requestedLevel > levelFromXp) {
      return failure("character_progress_update_failed", "requested level exceeds xp threshold", {
        character_id: String(characterId),
        requested_level: requestedLevel,
        max_level_for_xp: levelFromXp
      });
    }
    nextLevel = Math.max(currentLevel, requestedLevel);
  }

  const classId = String(data.class_id || character.class || "").trim().toLowerCase();
  const classOut = getClassData(classId);
  const classData = classOut.ok ? classOut.payload.class_data : null;
  const classMetadata = classData && classData.metadata && typeof classData.metadata === "object"
    ? classData.metadata
    : {};
  const subclassUnlockLevel = Number.isFinite(classMetadata.subclass_unlock_level)
    ? Math.max(1, Math.floor(Number(classMetadata.subclass_unlock_level)))
    : 3;
  const subclassAvailable = nextLevel >= subclassUnlockLevel;

  if (requestedOptionId && !subclassAvailable) {
    return failure("character_progress_update_failed", "subclass unlock level not reached", {
      character_id: String(characterId),
      class_option_id: requestedOptionId,
      required_level: subclassUnlockLevel,
      current_level: nextLevel
    });
  }

  let nextClassOptionId = String(character.class_option_id || "");
  if (requestedOptionId) {
    const optionOut = getClassOptionData(classId, requestedOptionId);
    if (!optionOut.ok) {
      return failure("character_progress_update_failed", optionOut.error || "invalid class option", {
        character_id: String(characterId),
        class_id: classId,
        class_option_id: requestedOptionId
      });
    }
    nextClassOptionId = requestedOptionId;
  }

  let spellProgression = character.spell_progression && typeof character.spell_progression === "object"
    ? clone(character.spell_progression)
    : null;
  if (classData && classMetadata.spellcasting_ability) {
    const spellOut = buildSpellProgression(classId, nextLevel, character.spellbook);
    if (!spellOut.ok) {
      return failure("character_progress_update_failed", spellOut.error || "failed building spell progression", {
        character_id: String(characterId),
        class_id: classId
      });
    }
    spellProgression = spellOut.progression;
  }

  const patch = {
    xp: nextXp,
    level: nextLevel,
    proficiency_bonus: getProficiencyBonus(nextLevel),
    class_option_id: nextClassOptionId || null,
    progression: {
      subclass_unlock_level: subclassUnlockLevel,
      subclass_available: subclassAvailable,
      updated_at: new Date().toISOString()
    },
    spell_progression: spellProgression
  };

  const updated = characterService.updateCharacter({
    character_id: String(characterId),
    patch
  });

  if (!updated.ok) {
    return failure("character_progress_update_failed", updated.error, {
      character_id: String(characterId)
    });
  }

  return success("character_progress_updated", {
    character: clone(updated.payload.character),
    xp_delta: xpDelta,
    previous_xp: currentXp,
    current_xp: nextXp,
    previous_level: currentLevel,
    current_level: nextLevel,
    subclass_available: subclassAvailable,
    spell_progression: spellProgression
  });
}

function updateCharacterStats(input) {
  const data = input || {};
  const characterService = data.character_service || defaultCharacterService;
  const characterId = data.character_id;
  const statsPatch = data.stats_patch && typeof data.stats_patch === "object" ? data.stats_patch : null;

  if (!characterService || typeof characterService.getCharacterById !== "function") {
    return failure("character_stats_update_failed", "character service is required");
  }
  if (!characterId || String(characterId).trim() === "") {
    return failure("character_stats_update_failed", "character_id is required");
  }
  if (!statsPatch) {
    return failure("character_stats_update_failed", "stats_patch object is required");
  }

  const found = characterService.getCharacterById(characterId);
  if (!found.ok) {
    return failure("character_stats_update_failed", found.error, {
      character_id: String(characterId)
    });
  }

  const character = found.payload.character;
  const nextStats = {
    ...(character.stats && typeof character.stats === "object" ? character.stats : {}),
    ...statsPatch
  };

  const updated = characterService.updateCharacter({
    character_id: String(characterId),
    patch: {
      stats: nextStats
    }
  });

  if (!updated.ok) {
    return failure("character_stats_update_failed", updated.error, {
      character_id: String(characterId)
    });
  }

  return success("character_stats_updated", {
    character: clone(updated.payload.character),
    applied_stats_patch: clone(statsPatch)
  });
}

module.exports = {
  updateCharacterProgress,
  updateCharacterStats
};
