"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toSafeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toSafeArray(value) {
  return Array.isArray(value) ? value.slice() : [];
}

function toNumberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function dedupeStrings(values) {
  return Array.from(new Set(
    toSafeArray(values)
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean)
  ));
}

function isEquippedEntry(entry) {
  const metadata = toSafeObject(entry && entry.metadata);
  return metadata.equipped === true || String(metadata.equipped_slot || "").trim() !== "";
}

function isAttunedEntry(entry) {
  const metadata = toSafeObject(entry && entry.metadata);
  return metadata.is_attuned === true;
}

function itemRequiresAttunement(entry) {
  const metadata = toSafeObject(entry && entry.metadata);
  return metadata.requires_attunement === true;
}

function isMagicalEntry(entry) {
  const metadata = toSafeObject(entry && entry.metadata);
  const itemType = String(entry && entry.item_type || "").trim().toLowerCase();
  return metadata.magical === true || metadata.requires_attunement === true || itemType === "magical";
}

function isActiveItemEffect(entry) {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  if (!isMagicalEntry(entry)) {
    return false;
  }
  if (itemRequiresAttunement(entry)) {
    return isEquippedEntry(entry) && isAttunedEntry(entry);
  }
  return isEquippedEntry(entry);
}

function buildResolvedItemEffectSummary(character, inventory) {
  const safeCharacter = character && typeof character === "object" ? character : {};
  const safeInventory = inventory && typeof inventory === "object" ? inventory : {};
  const equipmentItems = Array.isArray(safeInventory.equipment_items) ? safeInventory.equipment_items : [];
  const activeItems = equipmentItems.filter(isActiveItemEffect);

  const summary = {
    armor_class_bonus: 0,
    saving_throw_bonus: 0,
    attack_bonus: 0,
    spell_save_dc_bonus: 0,
    spell_attack_bonus: 0,
    speed_bonus: 0,
    hitpoint_max_bonus: 0,
    damage_reduction: 0,
    damage_reduction_types: [],
    resistances: [],
    immunities: [],
    vulnerabilities: [],
    on_hit_damage_effects: [],
    reactive_damage_effects: [],
    active_item_ids: [],
    active_item_names: [],
    sources: []
  };

  for (let index = 0; index < activeItems.length; index += 1) {
    const entry = activeItems[index];
    const metadata = toSafeObject(entry.metadata);

    summary.armor_class_bonus += toNumberOrZero(metadata.armor_class_bonus);
    summary.saving_throw_bonus += toNumberOrZero(
      metadata.saving_throw_bonus !== undefined ? metadata.saving_throw_bonus : metadata.all_saves_bonus
    );
    summary.attack_bonus += toNumberOrZero(metadata.attack_bonus);
    summary.spell_save_dc_bonus += toNumberOrZero(metadata.spell_save_dc_bonus);
    summary.spell_attack_bonus += toNumberOrZero(metadata.spell_attack_bonus);
    summary.speed_bonus += toNumberOrZero(metadata.speed_bonus);
    summary.hitpoint_max_bonus += toNumberOrZero(metadata.hitpoint_max_bonus);
    summary.damage_reduction += toNumberOrZero(metadata.damage_reduction);
    summary.damage_reduction_types = dedupeStrings(
      summary.damage_reduction_types.concat(toSafeArray(metadata.damage_reduction_types))
    );

    summary.resistances = dedupeStrings(summary.resistances.concat(toSafeArray(metadata.resistances)));
    summary.immunities = dedupeStrings(summary.immunities.concat(toSafeArray(metadata.immunities)));
    summary.vulnerabilities = dedupeStrings(summary.vulnerabilities.concat(toSafeArray(metadata.vulnerabilities)));

    const itemId = String(entry.item_id || "").trim();
    const itemName = String(entry.item_name || itemId || "").trim();
    const bonusDamageDice = String(metadata.bonus_damage_dice || "").trim();
    const bonusDamageType = String(metadata.bonus_damage_type || "").trim().toLowerCase();
    const reactiveDamageEffects = Array.isArray(metadata.reactive_damage_effects)
      ? metadata.reactive_damage_effects
      : [];
    if (bonusDamageDice && bonusDamageType) {
      summary.on_hit_damage_effects.push({
        item_id: itemId || null,
        item_name: itemName || itemId || null,
        damage_dice: bonusDamageDice,
        damage_type: bonusDamageType
      });
    }
    for (let reactiveIndex = 0; reactiveIndex < reactiveDamageEffects.length; reactiveIndex += 1) {
      const effect = toSafeObject(reactiveDamageEffects[reactiveIndex]);
      const trigger = String(effect.trigger || "").trim().toLowerCase();
      const damageDice = String(effect.damage_dice || "").trim();
      const damageType = String(effect.damage_type || "").trim().toLowerCase();
      const flatModifier = toNumberOrZero(effect.flat_modifier);
      if (!trigger || !damageType || (!damageDice && flatModifier <= 0)) {
        continue;
      }
      summary.reactive_damage_effects.push({
        item_id: itemId || null,
        item_name: itemName || itemId || null,
        trigger,
        damage_dice: damageDice || "0",
        flat_modifier: flatModifier,
        damage_type: damageType
      });
    }
    if (itemId) {
      summary.active_item_ids.push(itemId);
      summary.active_item_names.push(itemName || itemId);
      summary.sources.push({
        item_id: itemId,
        item_name: itemName || itemId,
        equip_slot: String(entry.equip_slot || metadata.equipped_slot || "").trim() || null,
        requires_attunement: itemRequiresAttunement(entry),
        attack_bonus: toNumberOrZero(metadata.attack_bonus),
        damage_reduction: toNumberOrZero(metadata.damage_reduction),
        damage_reduction_types: dedupeStrings(toSafeArray(metadata.damage_reduction_types)),
        reactive_damage_effects: clone(summary.reactive_damage_effects.filter((effect) => effect.item_id === itemId)),
        bonus_damage_dice: bonusDamageDice || null,
        bonus_damage_type: bonusDamageType || null
      });
    }
  }

  summary.active_item_ids = dedupeStrings(summary.active_item_ids);
  summary.active_item_names = Array.from(new Set(summary.active_item_names.filter(Boolean)));
  return summary;
}

function applyResolvedItemEffectState(character, inventory) {
  const safeCharacter = safeCharacterClone(character);
  const summary = buildResolvedItemEffectSummary(safeCharacter, inventory);
  const baseArmorClass = Number.isFinite(Number(safeCharacter.armor_class)) ? Number(safeCharacter.armor_class) : 10;
  const baseSpeed = Number.isFinite(Number(safeCharacter.speed)) ? Number(safeCharacter.speed) : 30;
  const baseMaxHp = Number.isFinite(Number(safeCharacter.hitpoint_max)) ? Number(safeCharacter.hitpoint_max) : 10;
  const baseCurrentHp = Number.isFinite(Number(safeCharacter.current_hitpoints))
    ? Number(safeCharacter.current_hitpoints)
    : baseMaxHp;

  const next = Object.assign({}, safeCharacter, {
    item_effects: clone(summary),
    effective_armor_class: baseArmorClass + summary.armor_class_bonus,
    effective_speed: baseSpeed + summary.speed_bonus,
    effective_hitpoint_max: baseMaxHp + summary.hitpoint_max_bonus
  });

  if (Number.isFinite(summary.hitpoint_max_bonus) && summary.hitpoint_max_bonus !== 0) {
    next.current_hitpoints = Math.min(baseCurrentHp, next.effective_hitpoint_max);
  }

  return next;
}

function safeCharacterClone(character) {
  return character && typeof character === "object" ? clone(character) : {};
}

module.exports = {
  isActiveItemEffect,
  buildResolvedItemEffectSummary,
  applyResolvedItemEffectState
};
