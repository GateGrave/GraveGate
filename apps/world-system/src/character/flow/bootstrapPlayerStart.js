"use strict";

const { CharacterService } = require("../character.service");
const { CharacterManager, InMemoryCharacterStore } = require("../character.manager");
const { createInventoryRecord } = require("../../../../inventory-system/src/inventory.schema");
const { applyCharacterSelections } = require("./applyCharacterSelections");
const { getClassData, getClassOptionData } = require("../rules/classRules");
const { applyDerivedSavingThrowState } = require("../rules/saveRules");

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

const POINT_BUY_COST_BY_SCORE = Object.freeze({
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9
});

const POINT_BUY_ABILITIES = Object.freeze([
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma"
]);

function buildDefaultCharacterName(playerId, requestedName) {
  if (typeof requestedName === "string" && requestedName.trim() !== "") {
    return requestedName.trim();
  }

  const suffix = String(playerId || "0000").slice(-4);
  return "Adventurer-" + suffix;
}

function normalizeSelectionValue(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim().toLowerCase();
}

function normalizePointBuyStat(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.floor(parsed);
}

function safeStatObject(inputStats) {
  const safeStats = {};
  const stats = inputStats && typeof inputStats === "object" ? inputStats : {};
  for (let i = 0; i < POINT_BUY_ABILITIES.length; i += 1) {
    const ability = POINT_BUY_ABILITIES[i];
    safeStats[ability] = Number(stats[ability]);
  }
  return safeStats;
}

function calculatePointBuyCost(value) {
  const safe = normalizePointBuyStat(value);
  if (safe === null || safe < 8 || safe > 15) {
    return {
      ok: false,
      payload: {
        value: safe,
        cost: null
      },
      error: "each ability score must be between 8 and 15"
    };
  }

  return {
    ok: true,
    payload: {
      value: safe,
      cost: POINT_BUY_COST_BY_SCORE[safe]
    },
    error: null
  };
}

function validatePointBuyStats(inputStats) {
  const stats = safeStatObject(inputStats);
  let usedPoints = 0;
  const breakdown = {};

  for (let i = 0; i < POINT_BUY_ABILITIES.length; i += 1) {
    const ability = POINT_BUY_ABILITIES[i];
    const value = stats[ability];

    if (!Number.isFinite(value)) {
      return {
        ok: false,
        payload: {
          requested_stats: stats,
          ability,
          expected_abilities: POINT_BUY_ABILITIES.slice()
        },
        error: "all six ability scores are required"
      };
    }

    const parsed = normalizePointBuyStat(value);
    if (parsed === null) {
      return {
        ok: false,
        payload: {
          requested_stats: stats,
          ability,
          expected_abilities: POINT_BUY_ABILITIES.slice()
        },
        error: "ability scores must be numeric"
      };
    }

    const costOut = calculatePointBuyCost(parsed);
    if (!costOut.ok) {
      return {
        ok: false,
        payload: {
          requested_stats: stats,
          ability,
          expected_abilities: POINT_BUY_ABILITIES.slice()
        },
        error: costOut.error
      };
    }

    breakdown[ability] = {
      value: costOut.payload.value,
      cost: costOut.payload.cost
    };
    usedPoints += costOut.payload.cost;
  }

  if (usedPoints !== 27) {
    return {
      ok: false,
      payload: {
        requested_stats: stats,
        cost_summary: breakdown,
        used_points: usedPoints,
        remaining_points: 27 - usedPoints
      },
      error: "point buy must spend exactly 27 points"
    };
  }

  return {
    ok: true,
    payload: {
      used_points: usedPoints,
      remaining_points: 0,
      costs: breakdown,
      stats: {
        strength: breakdown.strength.value,
        dexterity: breakdown.dexterity.value,
        constitution: breakdown.constitution.value,
        intelligence: breakdown.intelligence.value,
        wisdom: breakdown.wisdom.value,
        charisma: breakdown.charisma.value
      }
    },
    error: null
  };
}

function getSubclassUnlockLevel(classId) {
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
  return Boolean(classId) && getSubclassUnlockLevel(classId) <= 1;
}

function buildNextCharacterId(accountId, existingCharacters) {
  const safeAccountId = String(accountId || "").trim();
  const safeCharacters = Array.isArray(existingCharacters) ? existingCharacters : [];
  const usedIds = {};
  let maxOrdinal = 0;

  for (let i = 0; i < safeCharacters.length; i += 1) {
    const character = safeCharacters[i] || {};
    const characterId = String(character.character_id || "").trim();
    if (!characterId) {
      continue;
    }
    usedIds[characterId] = true;

    const marker = "-c";
    const markerIndex = characterId.lastIndexOf(marker);
    if (markerIndex === -1) {
      continue;
    }
    const numericPart = characterId.slice(markerIndex + marker.length);
    const parsed = Number.parseInt(numericPart, 10);
    if (Number.isFinite(parsed) && parsed > maxOrdinal) {
      maxOrdinal = parsed;
    }
  }

  let nextOrdinal = maxOrdinal + 1;
  let nextId = safeAccountId + "-c" + String(nextOrdinal);
  while (usedIds[nextId]) {
    nextOrdinal += 1;
    nextId = safeAccountId + "-c" + String(nextOrdinal);
  }

  return {
    character_id: nextId,
    ordinal: nextOrdinal
  };
}

function loadCharactersForBootstrap(context) {
  if (context.characterPersistence && typeof context.characterPersistence.listCharacters === "function") {
    const listed = context.characterPersistence.listCharacters();
    if (!listed.ok) {
      return failure(
        "player_start_bootstrap_failed",
        listed.error || "failed to list characters through persistence bridge"
      );
    }

    const persistenceCharacters = Array.isArray(listed.payload.characters) ? listed.payload.characters : [];
    return success("player_start_characters_loaded", {
      characters: persistenceCharacters,
      source: "characterPersistence"
    });
  }

  if (context.characterRepository && typeof context.characterRepository.listStoredCharacters === "function") {
    const listed = context.characterRepository.listStoredCharacters();
    if (!listed.ok) {
      return failure("player_start_bootstrap_failed", listed.error || "failed to list characters through repository");
    }

    return success("player_start_characters_loaded", {
      characters: listed.payload.characters || [],
      source: "characterRepository"
    });
  }

  return failure(
    "player_start_bootstrap_failed",
    "character persistence/repository is not available in world context"
  );
}

function saveCharacterForBootstrap(context, character) {
  if (context.characterPersistence && typeof context.characterPersistence.saveCharacter === "function") {
    return context.characterPersistence.saveCharacter(character);
  }

  if (context.characterRepository && typeof context.characterRepository.saveCharacter === "function") {
    return context.characterRepository.saveCharacter(character);
  }

  return {
    ok: false,
    error: "character persistence/repository is not available in world context"
  };
}

function ensurePlayerAccount(context, discordUserId) {
  const safeDiscordUserId = String(discordUserId || "").trim();
  if (!safeDiscordUserId) {
    return failure("player_start_bootstrap_failed", "player_id is required to resolve account");
  }

  if (
    context.accountPersistence &&
    typeof context.accountPersistence.findOrCreateAccountByDiscordUserId === "function"
  ) {
    const accountOut = context.accountPersistence.findOrCreateAccountByDiscordUserId({
      discord_user_id: safeDiscordUserId
    });

    if (!accountOut.ok) {
      return failure("player_start_bootstrap_failed", accountOut.error || "failed to resolve account");
    }

    return success("player_start_account_ready", {
      account: accountOut.payload.account,
      created: Boolean(accountOut.payload.created)
    });
  }

  if (
    context.accountService &&
    typeof context.accountService.findOrCreateAccountByDiscordUserId === "function"
  ) {
    const accountOut = context.accountService.findOrCreateAccountByDiscordUserId({
      discord_user_id: safeDiscordUserId
    });

    if (!accountOut.ok) {
      return failure("player_start_bootstrap_failed", accountOut.error || "failed to resolve account");
    }

    return success("player_start_account_ready", {
      account: accountOut.payload.account,
      created: Boolean(accountOut.payload.created)
    });
  }

  return failure(
    "player_start_bootstrap_failed",
    "accountPersistence/accountService is not available in world context"
  );
}

function ensurePlayerInventory(context, playerId, preferredInventoryId) {
  const inventoryPersistence = context.inventoryPersistence;
  if (!inventoryPersistence || typeof inventoryPersistence.listInventories !== "function") {
    return failure("player_start_bootstrap_failed", "inventoryPersistence is not available in world context");
  }

  const listed = inventoryPersistence.listInventories();
  if (!listed.ok) {
    return failure("player_start_bootstrap_failed", listed.error || "failed to list inventories");
  }

  const inventories = Array.isArray(listed.payload.inventories) ? listed.payload.inventories : [];
  const preferredId = String(preferredInventoryId || "").trim();
  const existing = preferredId
    ? inventories.find((inventory) => String(inventory.inventory_id || "") === preferredId)
    : null;
  if (existing) {
    return success("player_start_inventory_ready", {
      inventory: existing,
      created: false
    });
  }

  const inventoryId = preferredId || "inv-" + String(playerId);
  const createdInventory = createInventoryRecord({
    inventory_id: inventoryId,
    owner_type: "player",
    owner_id: String(playerId)
  });

  const saved = inventoryPersistence.saveInventory(createdInventory);
  if (!saved.ok) {
    return failure("player_start_bootstrap_failed", saved.error || "failed to save inventory");
  }

  return success("player_start_inventory_ready", {
    inventory: saved.payload.inventory,
    created: true
  });
}

function bootstrapPlayerStart(input) {
  const data = input || {};
  const playerId = data.player_id;
  const requestedName = data.requested_character_name || null;
  const requestedRaceId = normalizeSelectionValue(data.race_id);
  const requestedRaceOptionId = normalizeSelectionValue(data.race_option_id);
  const requestedBackgroundId = normalizeSelectionValue(data.background_id);
  const requestedClassId = normalizeSelectionValue(data.class_id);
  const requestedClassOptionId = normalizeSelectionValue(data.class_option_id);
  const requestedSecondaryClassId = normalizeSelectionValue(data.secondary_class_id);
  const requestedSecondaryClassOptionId = normalizeSelectionValue(data.secondary_class_option_id);
  const requestedStats = data.stats && typeof data.stats === "object" ? data.stats : null;
  const context = data.context || {};

  if (!playerId || String(playerId).trim() === "") {
    return failure("player_start_bootstrap_failed", "player_id is required");
  }

  const loadedCharacters = loadCharactersForBootstrap(context);
  if (!loadedCharacters.ok) {
    return loadedCharacters;
  }

  const safePlayerId = String(playerId);
  const accountReady = ensurePlayerAccount(context, safePlayerId);
  if (!accountReady.ok) {
    return accountReady;
  }
  const account = accountReady.payload.account;
  const characters = Array.isArray(loadedCharacters.payload.characters) ? loadedCharacters.payload.characters : [];
  const accountCharacters = characters.filter(
    (character) => String(character.account_id || "") === String(account.account_id || "")
  );

  const characterStore = new InMemoryCharacterStore();
  const characterManager = new CharacterManager({ store: characterStore });
  const characterService = context.characterService || new CharacterService({ manager: characterManager });
  const accountService = context.accountService;

  if (!accountService || typeof accountService.ensureCanCreateCharacter !== "function") {
    return failure(
      "player_start_bootstrap_failed",
      "accountService with slot enforcement is required in world context"
    );
  }

  const slotOut = accountService.ensureCanCreateCharacter(String(account.account_id || ""));
  if (!slotOut.ok) {
    return failure(
      "player_start_bootstrap_failed",
      slotOut.error || "failed to validate account character slots"
    );
  }

  const nextCharacterId = buildNextCharacterId(String(account.account_id || ""), accountCharacters);
  const preferredInventoryId = "inv-" + nextCharacterId.character_id;

  let characterStats = null;
  let pointBuySummary = null;

  if (requestedStats) {
    const pointBuyOut = validatePointBuyStats(requestedStats);
    if (!pointBuyOut.ok) {
      return failure(
        "player_start_bootstrap_failed",
        pointBuyOut.error || "invalid point-buy stats",
        {
          point_buy: pointBuyOut.payload || null,
          error: pointBuyOut.error
        }
      );
    }

    characterStats = pointBuyOut.payload.stats;
    pointBuySummary = {
      mode: "point_buy_5e",
      total_cost: pointBuyOut.payload.used_points,
      remaining_points: pointBuyOut.payload.remaining_points,
      abilities: pointBuyOut.payload.stats
    };
  }

  const createdCharacterOut = characterService.createCharacter({
    character_id: nextCharacterId.character_id,
    account_id: String(account.account_id || ""),
    player_id: safePlayerId,
    name: buildDefaultCharacterName(safePlayerId, requestedName),
    race: "unknown",
    class: "unknown",
    level: 1,
    xp: 0,
    inventory_id: preferredInventoryId,
    stats: characterStats || undefined,
    multiclass: requestedSecondaryClassId ? {
      enabled: true,
      classes: [
        { class: requestedClassId || "unknown", level: 1 },
        { class: requestedSecondaryClassId, level: 1 }
      ]
    } : {},
    gestalt_progression: requestedSecondaryClassId ? {
      enabled: true,
      track_a_class_key: requestedClassId || null,
      track_b_class_key: requestedSecondaryClassId,
      track_a_level: 1,
      track_b_level: 1,
      progression_notes: "Gestalt character created through /start."
    } : {},
    metadata: requestedStats && pointBuySummary ? { point_buy: pointBuySummary } : {}
  });
  if (!createdCharacterOut.ok) {
    return failure(
      "player_start_bootstrap_failed",
      createdCharacterOut.error || "failed to create character through character service"
    );
  }

  const ensuredInventory = ensurePlayerInventory(context, safePlayerId, preferredInventoryId);
  if (!ensuredInventory.ok) {
    return ensuredInventory;
  }

  let characterWithInventory = applyDerivedSavingThrowState({
    ...createdCharacterOut.payload.character,
    inventory_id: ensuredInventory.payload.inventory.inventory_id,
    inventory_ref: "inventory:" + ensuredInventory.payload.inventory.inventory_id,
    updated_at: new Date().toISOString()
  });

  const hasAnySelectionInput = Boolean(
    requestedRaceId || requestedRaceOptionId || requestedBackgroundId || requestedClassId || requestedSecondaryClassId
  );
  if (hasAnySelectionInput) {
    if (!requestedRaceId || !requestedBackgroundId || !requestedClassId || !requestedSecondaryClassId) {
      return failure(
        "player_start_bootstrap_failed",
        "race_id, background_id, class_id, and secondary_class_id are required together when applying start selections"
      );
    }
    if (requestedClassId === requestedSecondaryClassId) {
      return failure(
        "player_start_bootstrap_failed",
        "gestalt start requires two different classes"
      );
    }
    if (classNeedsOptionAtStart(requestedClassId) && !requestedClassOptionId) {
      return failure(
        "player_start_bootstrap_failed",
        "track A subclass is required for this class at level 1"
      );
    }
    if (classNeedsOptionAtStart(requestedSecondaryClassId) && !requestedSecondaryClassOptionId) {
      return failure(
        "player_start_bootstrap_failed",
        "track B subclass is required for this class at level 1"
      );
    }
    if (requestedClassOptionId) {
      const primaryOptionOut = getClassOptionData(requestedClassId, requestedClassOptionId);
      if (!primaryOptionOut.ok) {
        return failure(
          "player_start_bootstrap_failed",
          primaryOptionOut.error || "invalid track A subclass"
        );
      }
    }
    if (requestedSecondaryClassOptionId) {
      const secondaryOptionOut = getClassOptionData(requestedSecondaryClassId, requestedSecondaryClassOptionId);
      if (!secondaryOptionOut.ok) {
        return failure(
          "player_start_bootstrap_failed",
          secondaryOptionOut.error || "invalid track B subclass"
        );
      }
    }

    const selectionOut = applyCharacterSelections({
      character: characterWithInventory,
      race_id: requestedRaceId,
      race_option_id: requestedRaceOptionId || null,
      background_id: requestedBackgroundId,
      class_id: requestedClassId,
      class_option_id: requestedClassOptionId || null
    });
    if (!selectionOut.ok) {
      return failure(
        "player_start_bootstrap_failed",
        selectionOut.error || "failed to apply character selections",
        {
          selection_error: selectionOut
        }
      );
    }

    characterWithInventory = applyDerivedSavingThrowState(selectionOut.payload.character_profile);
    characterWithInventory.multiclass = {
      enabled: true,
      classes: [
        { class: requestedClassId, level: 1 },
        { class: requestedSecondaryClassId, level: 1 }
      ]
    };
    characterWithInventory.gestalt_progression = {
      enabled: true,
      track_a_class_key: requestedClassId,
      track_b_class_key: requestedSecondaryClassId,
      track_a_option_id: requestedClassOptionId || null,
      track_b_option_id: requestedSecondaryClassOptionId || null,
      track_a_level: 1,
      track_b_level: 1,
      progression_notes: "Gestalt character created through /start."
    };
    characterWithInventory.metadata = Object.assign({}, characterWithInventory.metadata || {}, {
      start_configuration: {
        mode: "gestalt",
        race_id: requestedRaceId,
        background_id: requestedBackgroundId,
        class_id: requestedClassId,
        class_option_id: requestedClassOptionId || null,
        secondary_class_id: requestedSecondaryClassId,
        secondary_class_option_id: requestedSecondaryClassOptionId || null
      }
    });
  }

  const savedCharacter = saveCharacterForBootstrap(context, characterWithInventory);
  if (!savedCharacter.ok) {
    return failure(
      "player_start_bootstrap_failed",
      savedCharacter.error || "failed to save character through persistence boundary"
    );
  }

  const registerOut = accountService.registerCharacterForAccount(
    String(account.account_id || ""),
    String(characterWithInventory.character_id || "")
  );
  if (!registerOut.ok) {
    return failure(
      "player_start_bootstrap_failed",
      registerOut.error || "failed to register character ownership"
    );
  }

  const activateOut = accountService.setActiveCharacter(
    String(account.account_id || ""),
    String(characterWithInventory.character_id || "")
  );
  if (!activateOut.ok) {
    return failure(
      "player_start_bootstrap_failed",
      activateOut.error || "failed to activate newly created character"
    );
  }

  return success("player_start_bootstrap_completed", {
    bootstrap_status: "created",
    character_created: true,
    inventory_created: ensuredInventory.payload.created,
    account_created: accountReady.payload.created,
    active_character_id: String(characterWithInventory.character_id || ""),
    active_character_set: true,
    slot_status: {
      used_slots: Number(slotOut.payload.character_count || 0) + 1,
      remaining_slots: Math.max(
        0,
        Number(slotOut.payload.max_character_slots || 3) - (Number(slotOut.payload.character_count || 0) + 1)
      ),
      max_character_slots: Number(slotOut.payload.max_character_slots || 3)
    },
    account: activateOut.payload.account || account,
    character: characterWithInventory,
    inventory: ensuredInventory.payload.inventory,
    point_buy_summary: pointBuySummary
  });
}

module.exports = {
  bootstrapPlayerStart
};
