"use strict";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toStringSet(entries, idField) {
  const out = new Set();
  const rows = toArray(entries);
  for (let i = 0; i < rows.length; i += 1) {
    const entry = rows[i];
    if (!isObject(entry)) continue;
    const id = String(entry[idField] || "").trim();
    if (!id) continue;
    out.add(id);
  }
  return out;
}

function addError(errors, input) {
  errors.push({
    content_type: input.content_type || "unknown",
    entry_id: input.entry_id || null,
    field: input.field || null,
    missing_reference: input.missing_reference || null,
    message: input.message || "content cross-reference validation failed"
  });
}

function validateRewardCurve(errors, contentType, entryId, rewardCurve, fieldPrefix) {
  if (!isObject(rewardCurve)) {
    addError(errors, {
      content_type: contentType,
      entry_id: entryId || null,
      field: fieldPrefix,
      missing_reference: null,
      message: fieldPrefix + " must be an object when provided"
    });
    return;
  }

  const checks = [
    {
      key: "quantity_multiplier",
      min: 0.1
    },
    {
      key: "guaranteed_quantity_bonus",
      min: 0
    },
    {
      key: "weighted_bonus_rolls",
      min: 0
    },
    {
      key: "xp_multiplier",
      min: 0.1
    }
  ];

  for (let i = 0; i < checks.length; i += 1) {
    const check = checks[i];
    if (rewardCurve[check.key] === undefined || rewardCurve[check.key] === null) {
      continue;
    }
    if (!Number.isFinite(rewardCurve[check.key]) || Number(rewardCurve[check.key]) < check.min) {
      addError(errors, {
        content_type: contentType,
        entry_id: entryId || null,
        field: fieldPrefix + "." + check.key,
        missing_reference: String(rewardCurve[check.key]),
        message: fieldPrefix + "." + check.key + " must be a finite number >= " + check.min
      });
    }
  }
}

function validateItems(items, errors) {
  const allowedItemTypes = new Set([
    "equipment",
    "consumable",
    "loot_material",
    "stackable",
    "quest_item"
  ]);
  const allowedEquipSlots = new Set([
    "main_hand",
    "off_hand",
    "body",
    "accessory",
    "head",
    "hands",
    "feet"
  ]);
  const allowedCategories = new Set([
    "weapon",
    "armor",
    "shield",
    "consumable",
    "material",
    "utility",
    "quest",
    "misc"
  ]);

  const rows = toArray(items);
  for (let i = 0; i < rows.length; i += 1) {
    const item = rows[i];
    if (!isObject(item)) continue;
    const itemId = String(item.item_id || "").trim();
    const itemType = String(item.item_type || "").trim();
    const equipSlot = String(item.equip_slot || "").trim();
    const category = String(item.metadata && item.metadata.category || "").trim();

    if (itemType && !allowedItemTypes.has(itemType)) {
      addError(errors, {
        content_type: "item",
        entry_id: itemId || null,
        field: "item_type",
        missing_reference: itemType,
        message: "item_type is not in allowed enum"
      });
    }

    if (equipSlot && !allowedEquipSlots.has(equipSlot)) {
      addError(errors, {
        content_type: "item",
        entry_id: itemId || null,
        field: "equip_slot",
        missing_reference: equipSlot,
        message: "equip_slot is not in allowed enum"
      });
    }

    if (category && !allowedCategories.has(category)) {
      addError(errors, {
        content_type: "item",
        entry_id: itemId || null,
        field: "metadata.category",
        missing_reference: category,
        message: "item metadata.category is not in allowed enum"
      });
    }
  }
}

function validateRecipes(recipes, itemIds, errors) {
  const rows = toArray(recipes);
  for (let i = 0; i < rows.length; i += 1) {
    const recipe = rows[i];
    if (!isObject(recipe)) continue;
    const recipeId = String(recipe.recipe_id || "").trim();
    const outputItemId = String(recipe.output_item_id || "").trim();

    if (outputItemId && !itemIds.has(outputItemId)) {
      addError(errors, {
        content_type: "recipe",
        entry_id: recipeId || null,
        field: "output_item_id",
        missing_reference: outputItemId,
        message: "recipe output item does not exist in items content"
      });
    }

    const materials = toArray(recipe.required_materials);
    for (let j = 0; j < materials.length; j += 1) {
      const row = materials[j];
      if (!isObject(row)) continue;
      const materialItemId = String(row.item_id || "").trim();
      if (materialItemId && !itemIds.has(materialItemId)) {
        addError(errors, {
          content_type: "recipe",
          entry_id: recipeId || null,
          field: "required_materials.item_id",
          missing_reference: materialItemId,
          message: "recipe material item does not exist in items content"
        });
      }
    }
  }
}

function validateDungeons(dungeons, monsterIds, itemIds, errors) {
  const allowedDungeonTiers = new Set(["starter", "low", "veteran", "elite"]);
  const rows = toArray(dungeons);
  for (let i = 0; i < rows.length; i += 1) {
    const dungeon = rows[i];
    if (!isObject(dungeon)) continue;
    const dungeonId = String(dungeon.dungeon_id || "").trim();
    const roomRows = toArray(dungeon.rooms);
    const roomIds = toStringSet(roomRows, "room_id");

    const startRoomId = String(dungeon.start_room_id || "").trim();
    if (startRoomId && !roomIds.has(startRoomId)) {
      addError(errors, {
        content_type: "dungeon",
        entry_id: dungeonId || null,
        field: "start_room_id",
        missing_reference: startRoomId,
        message: "dungeon start_room_id does not exist in dungeon rooms"
      });
    }

    const dungeonRewardItemId = String(
      dungeon.metadata && dungeon.metadata.reward_item_id || ""
    ).trim();
    const difficultyTier = String(
      dungeon.metadata && dungeon.metadata.difficulty_tier || ""
    ).trim();
    if (difficultyTier && !allowedDungeonTiers.has(difficultyTier)) {
      addError(errors, {
        content_type: "dungeon",
        entry_id: dungeonId || null,
        field: "metadata.difficulty_tier",
        missing_reference: difficultyTier,
        message: "dungeon difficulty_tier is not in allowed enum"
      });
    }

    if (dungeon.metadata && dungeon.metadata.reward_curve !== undefined) {
      validateRewardCurve(
        errors,
        "dungeon",
        dungeonId || null,
        dungeon.metadata.reward_curve,
        "metadata.reward_curve"
      );
    }

    if (dungeonRewardItemId && !itemIds.has(dungeonRewardItemId)) {
      addError(errors, {
        content_type: "dungeon",
        entry_id: dungeonId || null,
        field: "metadata.reward_item_id",
        missing_reference: dungeonRewardItemId,
        message: "dungeon reward item does not exist in items content"
      });
    }

    for (let j = 0; j < roomRows.length; j += 1) {
      const room = roomRows[j];
      if (!isObject(room)) continue;
      const roomId = String(room.room_id || "").trim();

      const exits = toArray(room.exits);
      for (let k = 0; k < exits.length; k += 1) {
        const exitRef = String(exits[k] || "").trim();
        if (exitRef && !roomIds.has(exitRef)) {
          addError(errors, {
            content_type: "dungeon",
            entry_id: dungeonId || null,
            field: "rooms.exits",
            missing_reference: exitRef,
            message: "dungeon room exit does not exist in dungeon rooms"
          });
        }
      }

      const encounterMonsterId = String(
        room.encounter && room.encounter.monster_id || ""
      ).trim();
      if (encounterMonsterId && !monsterIds.has(encounterMonsterId)) {
        addError(errors, {
          content_type: "dungeon",
          entry_id: dungeonId || null,
          field: "rooms.encounter.monster_id",
          missing_reference: encounterMonsterId,
          message: "dungeon encounter references unknown monster"
        });
      }

      const rewardItemId = String(
        room.reward_item_id ||
        (room.reward && room.reward.item_id) ||
        ""
      ).trim();
      if (rewardItemId) {
        if (rewardItemId.startsWith("room_") && !roomIds.has(rewardItemId)) {
          addError(errors, {
            content_type: "dungeon",
            entry_id: dungeonId || null,
            field: "rooms.reward_item_id",
            missing_reference: rewardItemId,
            message: "dungeon reward room reference is invalid"
          });
        }
        if (rewardItemId.startsWith("item_") && !itemIds.has(rewardItemId)) {
          addError(errors, {
            content_type: "dungeon",
            entry_id: dungeonId || null,
            field: "rooms.reward_item_id",
            missing_reference: rewardItemId,
            message: "dungeon reward item does not exist in items content"
          });
        }
      }

      if (!roomId) {
        addError(errors, {
          content_type: "dungeon",
          entry_id: dungeonId || null,
          field: "rooms.room_id",
          missing_reference: null,
          message: "dungeon room is missing room_id"
        });
      }
    }
  }
}

function validateMonsters(monsters, itemIds, errors) {
  const allowedMonsterTiers = new Set(["starter", "low", "veteran", "elite"]);
  const rows = toArray(monsters);
  for (let i = 0; i < rows.length; i += 1) {
    const monster = rows[i];
    if (!isObject(monster)) continue;
    const monsterId = String(monster.monster_id || "").trim();
    const metadata = isObject(monster.metadata) ? monster.metadata : {};
    const tier = String(metadata.tier || "").trim();
    if (tier && !allowedMonsterTiers.has(tier)) {
      addError(errors, {
        content_type: "monster",
        entry_id: monsterId || null,
        field: "metadata.tier",
        missing_reference: tier,
        message: "monster tier is not in allowed enum"
      });
    }

    if (metadata.reward_curve !== undefined) {
      validateRewardCurve(
        errors,
        "monster",
        monsterId || null,
        metadata.reward_curve,
        "metadata.reward_curve"
      );
    }

    const lootItemId = String(metadata.loot_item_id || "").trim();
    if (lootItemId && !itemIds.has(lootItemId)) {
      addError(errors, {
        content_type: "monster",
        entry_id: monsterId || null,
        field: "metadata.loot_item_id",
        missing_reference: lootItemId,
        message: "monster loot_item_id does not exist in items content"
      });
    }

    const lootItemRefs = toArray(metadata.loot_item_refs);
    for (let j = 0; j < lootItemRefs.length; j += 1) {
      const ref = String(lootItemRefs[j] || "").trim();
      if (ref && !itemIds.has(ref)) {
        addError(errors, {
          content_type: "monster",
          entry_id: monsterId || null,
          field: "metadata.loot_item_refs",
          missing_reference: ref,
          message: "monster loot item ref does not exist in items content"
        });
      }
    }
  }
}

function validateSpells(spells, classIds, errors) {
  const rows = toArray(spells);
  for (let i = 0; i < rows.length; i += 1) {
    const spell = rows[i];
    if (!isObject(spell)) continue;
    const spellId = String(spell.spell_id || spell.id || "").trim();
    const directClassRefs = toArray(spell.class_refs);

    for (let j = 0; j < directClassRefs.length; j += 1) {
      const classRef = String(directClassRefs[j] || "").trim();
      if (classRef && !classIds.has(classRef)) {
        addError(errors, {
          content_type: "spell",
          entry_id: spellId || null,
          field: "class_refs",
          missing_reference: classRef,
          message: "spell class ref does not exist in class content"
        });
      }
    }
  }
}

function validateRaceClassBackgroundStructures(races, classes, backgrounds, errors) {
  const raceRows = toArray(races);
  for (let i = 0; i < raceRows.length; i += 1) {
    const race = raceRows[i];
    if (!isObject(race)) continue;
    const raceId = String(race.id || "").trim();
    const metadata = isObject(race.metadata) ? race.metadata : {};
    const subraces = toArray(metadata.subraces);
    const ancestry = toArray(metadata.draconic_ancestry_options);

    for (let j = 0; j < subraces.length; j += 1) {
      const entry = subraces[j];
      if (!isObject(entry) || String(entry.id || "").trim() === "") {
        addError(errors, {
          content_type: "race",
          entry_id: raceId || null,
          field: "metadata.subraces.id",
          missing_reference: null,
          message: "race subrace option is missing id"
        });
      }
    }

    for (let j = 0; j < ancestry.length; j += 1) {
      const entry = ancestry[j];
      if (!isObject(entry) || String(entry.id || "").trim() === "") {
        addError(errors, {
          content_type: "race",
          entry_id: raceId || null,
          field: "metadata.draconic_ancestry_options.id",
          missing_reference: null,
          message: "race draconic ancestry option is missing id"
        });
      }
    }
  }

  const classRows = toArray(classes);
  for (let i = 0; i < classRows.length; i += 1) {
    const classEntry = classRows[i];
    if (!isObject(classEntry)) continue;
    const classId = String(classEntry.id || "").trim();
    const metadata = isObject(classEntry.metadata) ? classEntry.metadata : {};
    const subclasses = toArray(metadata.subclasses);

    for (let j = 0; j < subclasses.length; j += 1) {
      const subclass = subclasses[j];
      if (!isObject(subclass) || String(subclass.id || "").trim() === "") {
        addError(errors, {
          content_type: "class",
          entry_id: classId || null,
          field: "metadata.subclasses.id",
          missing_reference: null,
          message: "class subclass option is missing id"
        });
      }
    }
  }

  const backgroundRows = toArray(backgrounds);
  for (let i = 0; i < backgroundRows.length; i += 1) {
    const background = backgroundRows[i];
    if (!isObject(background)) continue;
    const backgroundId = String(background.id || "").trim();
    const skillRefs = toArray(background.skill_proficiencies);
    const toolRefs = toArray(background.tool_refs);
    const languageRefs = toArray(background.language_refs);

    const refGroups = [
      { field: "skill_proficiencies", values: skillRefs },
      { field: "tool_refs", values: toolRefs },
      { field: "language_refs", values: languageRefs }
    ];

    for (let j = 0; j < refGroups.length; j += 1) {
      const group = refGroups[j];
      for (let k = 0; k < group.values.length; k += 1) {
        const ref = String(group.values[k] || "").trim();
        if (!ref) {
          addError(errors, {
            content_type: "background",
            entry_id: backgroundId || null,
            field: group.field,
            missing_reference: null,
            message: "background proficiency/language ref cannot be empty"
          });
        }
      }
    }
  }
}

function validateCrossContentReferences(content) {
  const data = isObject(content) ? content : {};
  const errors = [];

  const items = toArray(data.items);
  const monsters = toArray(data.monsters);
  const spells = toArray(data.spells);
  const recipes = toArray(data.recipes);
  const dungeons = toArray(data.dungeons);
  const classes = toArray(data.classes);
  const races = toArray(data.races);
  const backgrounds = toArray(data.backgrounds);

  const itemIds = toStringSet(items, "item_id");
  const monsterIds = toStringSet(monsters, "monster_id");
  const classIds = toStringSet(classes, "id");

  validateItems(items, errors);
  validateRecipes(recipes, itemIds, errors);
  validateDungeons(dungeons, monsterIds, itemIds, errors);
  validateMonsters(monsters, itemIds, errors);
  validateSpells(spells, classIds, errors);
  validateRaceClassBackgroundStructures(races, classes, backgrounds, errors);

  if (errors.length > 0) {
    return {
      ok: false,
      event_type: "content_cross_reference_validation_failed",
      payload: {
        errors
      },
      error: "content cross-reference validation failed"
    };
  }

  return {
    ok: true,
    event_type: "content_cross_reference_validation_passed",
    payload: {
      totals: {
        items: items.length,
        monsters: monsters.length,
        spells: spells.length,
        recipes: recipes.length,
        dungeons: dungeons.length,
        classes: classes.length,
        races: races.length,
        backgrounds: backgrounds.length
      }
    },
    error: null
  };
}

module.exports = {
  validateCrossContentReferences
};
