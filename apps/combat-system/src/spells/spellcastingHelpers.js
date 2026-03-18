"use strict";

const { rollSavingThrow, rollDiceFormula } = require("../dice");
const { getActiveConditionsForParticipant } = require("../conditions/conditionHelpers");

const SAVE_ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const SUPPORTED_SPELL_TARGET_TYPES = new Set([
  "single_target",
  "single_or_split_target",
  "self",
  "up_to_three_allies",
  "up_to_three_enemies"
]);

const AREA_TEMPLATE_TARGET_TYPES = new Set([
  "cone_15ft",
  "cube_15ft",
  "line_100ft_5ft",
  "sphere_20ft",
  "sphere_10ft",
  "aura_15ft",
  "cylinder_20ft"
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAbilityKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return SAVE_ABILITIES.includes(normalized) ? normalized : null;
}

function getParticipantAbilityScore(participant, ability) {
  const key = normalizeAbilityKey(ability);
  if (!key) return null;

  if (Number.isFinite(participant && participant.stats && participant.stats[key])) {
    return Number(participant.stats[key]);
  }

  if (Number.isFinite(participant && participant[key])) {
    return Number(participant[key]);
  }

  if (
    Number.isFinite(participant && participant.metadata && participant.metadata.stats && participant.metadata.stats[key])
  ) {
    return Number(participant.metadata.stats[key]);
  }

  return null;
}

function computeAbilityModifierFromScore(score) {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.floor((Number(score) - 10) / 2);
}

function getParticipantAbilityModifier(participant, ability) {
  const key = normalizeAbilityKey(ability);
  if (!key) return 0;

  const directModifier = Number(participant && participant[key + "_modifier"]);
  if (Number.isFinite(directModifier)) {
    return directModifier;
  }

  const saveModifier = Number(participant && participant[key + "_save_modifier"]);
  if (Number.isFinite(saveModifier)) {
    return saveModifier;
  }

  const score = getParticipantAbilityScore(participant, key);
  return computeAbilityModifierFromScore(score);
}

function computeSavingThrowModifier(participant, ability) {
  const key = normalizeAbilityKey(ability);
  if (!key) return 0;

  const explicitSaveModifier = Number(participant && participant[key + "_save_modifier"]);
  if (Number.isFinite(explicitSaveModifier)) {
    return explicitSaveModifier;
  }

  return getParticipantAbilityModifier(participant, key);
}

function computeSpellAttackBonus(participant) {
  const direct = Number(participant && participant.spell_attack_bonus);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const spellcastingAttack = Number(participant && participant.spellcasting && participant.spellcasting.attack_bonus);
  if (Number.isFinite(spellcastingAttack)) {
    return spellcastingAttack;
  }

  const attackBonus = Number(participant && participant.attack_bonus);
  if (Number.isFinite(attackBonus)) {
    return attackBonus;
  }

  const spellcastingAbility = participant && participant.spellcasting_ability;
  const proficiencyBonus = Number(participant && participant.proficiency_bonus);
  if (spellcastingAbility && Number.isFinite(proficiencyBonus)) {
    return proficiencyBonus + getParticipantAbilityModifier(participant, spellcastingAbility);
  }

  return 0;
}

function computeSpellSaveDc(participant, spell) {
  const direct = Number(participant && participant.spellsave_dc);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const altDirect = Number(participant && participant.spell_save_dc);
  if (Number.isFinite(altDirect)) {
    return altDirect;
  }

  const fromSpellcasting = Number(participant && participant.spellcasting && participant.spellcasting.save_dc);
  if (Number.isFinite(fromSpellcasting)) {
    return fromSpellcasting;
  }

  const fromSpell = Number(spell && spell.save_dc);
  if (Number.isFinite(fromSpell)) {
    return fromSpell;
  }

  const ability = participant && participant.spellcasting_ability;
  const proficiencyBonus = Number(participant && participant.proficiency_bonus);
  if (ability && Number.isFinite(proficiencyBonus)) {
    return 8 + proficiencyBonus + getParticipantAbilityModifier(participant, ability);
  }

  return 10;
}

function parseSpellRangeFeet(range) {
  const safe = String(range || "").trim().toLowerCase();
  if (!safe) return 5;
  if (safe === "self") return 0;
  if (safe === "touch") return 5;
  const feetMatch = safe.match(/(\d+)\s*feet?/);
  if (!feetMatch) {
    return 5;
  }
  const parsed = Number.parseInt(feetMatch[1], 10);
  return Number.isFinite(parsed) ? parsed : 5;
}

function getSpellTargetType(spell) {
  const directType = spell && spell.target_type ? String(spell.target_type) : "";
  if (directType) {
    return directType;
  }
  const targetingType = spell && spell.targeting && spell.targeting.type ? String(spell.targeting.type) : "";
  return targetingType || "single_target";
}

function getSpellAreaTemplate(spell) {
  const effect = spell && spell.effect && typeof spell.effect === "object" ? spell.effect : {};
  const metadata = spell && spell.metadata && typeof spell.metadata === "object" ? spell.metadata : {};
  const configuredTemplate = metadata.area_template && typeof metadata.area_template === "object"
    ? metadata.area_template
    : effect.area_template && typeof effect.area_template === "object"
      ? effect.area_template
      : null;
  if (configuredTemplate) {
    return clone(configuredTemplate);
  }

  const targetType = getSpellTargetType(spell);
  if (!AREA_TEMPLATE_TARGET_TYPES.has(targetType)) {
    return null;
  }

  if (targetType === "cone_15ft") {
    return {
      shape: "cone",
      size_feet: 15,
      origin: "self"
    };
  }
  if (targetType === "cube_15ft") {
    return {
      shape: "cube",
      size_feet: 15,
      origin: "self"
    };
  }
  if (targetType === "line_100ft_5ft") {
    return {
      shape: "line",
      length_feet: 100,
      width_feet: 5,
      origin: "self"
    };
  }
  if (targetType === "sphere_20ft") {
    return {
      shape: "sphere",
      radius_feet: 20,
      origin: "point_within_range"
    };
  }
  if (targetType === "sphere_10ft") {
    return {
      shape: "sphere",
      radius_feet: 10,
      origin: "point_within_range"
    };
  }
  if (targetType === "aura_15ft") {
    return {
      shape: "aura",
      radius_feet: 15,
      origin: "self"
    };
  }
  if (targetType === "cylinder_20ft") {
    return {
      shape: "cylinder",
      radius_feet: 20,
      origin: "point_within_range"
    };
  }

  return null;
}

function resolveSpellActionCost(spell) {
  const actionCost = spell && spell.action_cost ? String(spell.action_cost).trim().toLowerCase() : "";
  if (actionCost === "action" || actionCost === "bonus_action" || actionCost === "reaction") {
    return actionCost;
  }

  const castingTime = String(spell && spell.casting_time || "").trim().toLowerCase();
  if (castingTime === "1 bonus action") return "bonus_action";
  if (castingTime === "1 reaction") return "reaction";
  return "action";
}

function normalizeSpellLevel(spell) {
  const direct = Number(spell && spell.level);
  if (Number.isFinite(direct)) {
    return Math.max(0, Math.floor(direct));
  }
  const alt = Number(spell && spell.spell_level);
  if (Number.isFinite(alt)) {
    return Math.max(0, Math.floor(alt));
  }
  const metadataLevel = Number(spell && spell.metadata && spell.metadata.level);
  if (Number.isFinite(metadataLevel)) {
    return Math.max(0, Math.floor(metadataLevel));
  }
  return 1;
}

function isCantripSpell(spell) {
  if (!spell || typeof spell !== "object") {
    return false;
  }
  if (spell.is_cantrip === true) {
    return true;
  }
  if (spell.metadata && typeof spell.metadata === "object" && spell.metadata.is_cantrip === true) {
    return true;
  }
  return normalizeSpellLevel(spell) === 0;
}

function getParticipantSpellcastingTurnState(participant) {
  const state = participant && participant.spellcasting_turn_state && typeof participant.spellcasting_turn_state === "object"
    ? participant.spellcasting_turn_state
    : {};
  return {
    bonus_action_spell_cast: state.bonus_action_spell_cast === true,
    action_spell_cast: state.action_spell_cast === true,
    action_spell_was_cantrip: state.action_spell_was_cantrip === true
  };
}

function initializeParticipantSpellcastingTurnState(participant) {
  return Object.assign({}, participant, {
    spellcasting_turn_state: {
      bonus_action_spell_cast: false,
      action_spell_cast: false,
      action_spell_was_cantrip: false
    }
  });
}

function validateSpellKnown(participant, spellId) {
  const wanted = String(spellId || "").trim().toLowerCase();
  if (!wanted) {
    return false;
  }

  const spellbook = participant && participant.spellbook && typeof participant.spellbook === "object"
    ? participant.spellbook
    : null;
  if (!spellbook) {
    return false;
  }

  const knownIds = Array.isArray(spellbook.known_spell_ids) ? spellbook.known_spell_ids : [];
  if (knownIds.some((entry) => String(entry || "").trim().toLowerCase() === wanted)) {
    return true;
  }

  const knownSpells = Array.isArray(spellbook.known_spells) ? spellbook.known_spells : [];
  return knownSpells.some((entry) => {
    const id = entry && (entry.spell_id || entry.id);
    return String(id || "").trim().toLowerCase() === wanted;
  });
}

function validateSpellTargeting(spell, caster, target) {
  const targetType = getSpellTargetType(spell);
  if (!SUPPORTED_SPELL_TARGET_TYPES.has(targetType)) {
    return {
      ok: false,
      error: "spell target type is not supported yet",
      payload: {
        target_type: targetType
      }
    };
  }

  if (targetType === "self") {
    if (!caster || !target || String(caster.participant_id || "") !== String(target.participant_id || "")) {
      return {
        ok: false,
        error: "self-target spell must target the caster"
      };
    }
  } else if (targetType === "up_to_three_allies") {
    if (!target) {
      return {
        ok: false,
        error: "spell requires a valid ally target"
      };
    }
    if (String(caster && caster.team || "") !== String(target && target.team || "")) {
      return {
        ok: false,
        error: "spell requires an allied target"
      };
    }
  } else if (targetType === "up_to_three_enemies") {
    if (!target) {
      return {
        ok: false,
        error: "spell requires a valid enemy target"
      };
    }
    if (String(caster && caster.team || "") === String(target && target.team || "")) {
      return {
        ok: false,
        error: "spell requires a hostile target"
      };
    }
  } else if (!target) {
    return {
      ok: false,
      error: "spell requires a valid target"
    };
  }

  return {
    ok: true,
    payload: {
      target_type: targetType
    },
    error: null
  };
}

function validateSpellActionAvailability(participant, actionCost, spell) {
  if (!participant || typeof participant !== "object") {
    return {
      ok: false,
      error: "participant is required"
    };
  }

  const spellcastingState = getParticipantSpellcastingTurnState(participant);
  const cantrip = isCantripSpell(spell);

  if (actionCost === "bonus_action" && spellcastingState.action_spell_cast === true && spellcastingState.action_spell_was_cantrip !== true) {
    return {
      ok: false,
      error: "cannot cast a bonus action spell after casting a leveled spell this turn"
    };
  }

  if (spellcastingState.bonus_action_spell_cast === true) {
    const validFollowupActionCantrip = actionCost === "action" && cantrip === true;
    if (!validFollowupActionCantrip) {
      return {
        ok: false,
        error: "after casting a bonus action spell, only a cantrip with a 1 action casting time can be cast this turn"
      };
    }
  }

  if (actionCost === "bonus_action") {
    if (participant.bonus_action_available === false) {
      return {
        ok: false,
        error: "bonus action is not available"
      };
    }
    return {
      ok: true,
      error: null
    };
  }

  if (actionCost === "reaction") {
    if (participant.reaction_available !== true) {
      return {
        ok: false,
        error: "reaction is not available"
      };
    }
    return {
      ok: true,
      error: null
    };
  }

  if (participant.action_available === false) {
    return {
      ok: false,
      error: "action is not available"
    };
  }

  return {
    ok: true,
    error: null
  };
}

function consumeSpellAction(participant, actionCost, spell) {
  const next = Object.assign({}, participant);
  next.spellcasting_turn_state = getParticipantSpellcastingTurnState(next);
  if (actionCost === "bonus_action") {
    next.bonus_action_available = false;
    next.spellcasting_turn_state.bonus_action_spell_cast = true;
    return next;
  }
  if (actionCost === "reaction") {
    next.reaction_available = false;
    return next;
  }
  next.action_available = false;
  next.spellcasting_turn_state.action_spell_cast = true;
  next.spellcasting_turn_state.action_spell_was_cantrip = isCantripSpell(spell);
  return next;
}

function resolveConditionDiceValues(conditions, metadataKey, rng) {
  if (!metadataKey) {
    return [];
  }
  const rolls = [];
  for (let index = 0; index < conditions.length; index += 1) {
    const condition = conditions[index];
    const metadata = condition && condition.metadata && typeof condition.metadata === "object"
      ? condition.metadata
      : {};
    const formula = String(metadata[metadataKey] || "").trim();
    if (!formula) {
      continue;
    }
    rolls.push(rollDiceFormula(formula, rng));
  }
  return rolls;
}

function rollConditionDiceModifier(input) {
  const data = input || {};
  const combatState = data.combat_state;
  const participantId = data.participant_id;
  const positiveCondition = String(data.positive_condition || "").trim();
  const negativeCondition = String(data.negative_condition || "").trim();
  const positiveMetadataKey = String(data.positive_metadata_key || "").trim();
  const negativeMetadataKey = String(data.negative_metadata_key || "").trim();
  const rng = data.rng;
  const conditions = getActiveConditionsForParticipant(combatState, participantId);
  const positive = positiveCondition
    ? conditions.find((condition) => String(condition && condition.condition_type || "") === positiveCondition)
    : null;
  const negative = negativeCondition
    ? conditions.find((condition) => String(condition && condition.condition_type || "") === negativeCondition)
    : null;

  let total = 0;
  let positiveRoll = null;
  let negativeRoll = null;
  const positiveRolls = [];
  const negativeRolls = [];

  if (positive) {
    const formula = String(positive.metadata && positive.metadata.dice_bonus || "1d4");
    positiveRoll = rollDiceFormula(formula, rng);
    total += Number(positiveRoll.subtotal || 0);
    positiveRolls.push(positiveRoll);
  }
  if (negative) {
    const formula = String(negative.metadata && negative.metadata.dice_bonus || "1d4");
    negativeRoll = rollDiceFormula(formula, rng);
    total -= Number(negativeRoll.subtotal || 0);
    negativeRolls.push(negativeRoll);
  }

  const metadataPositiveRolls = resolveConditionDiceValues(conditions, positiveMetadataKey, rng);
  for (let index = 0; index < metadataPositiveRolls.length; index += 1) {
    const roll = metadataPositiveRolls[index];
    total += Number(roll.subtotal || 0);
    positiveRolls.push(roll);
  }
  const metadataNegativeRolls = resolveConditionDiceValues(conditions, negativeMetadataKey, rng);
  for (let index = 0; index < metadataNegativeRolls.length; index += 1) {
    const roll = metadataNegativeRolls[index];
    total -= Number(roll.subtotal || 0);
    negativeRolls.push(roll);
  }

  return {
    total,
    positive_roll: positiveRoll,
    negative_roll: negativeRoll,
    positive_rolls: positiveRolls,
    negative_rolls: negativeRolls,
    positive_condition: positive ? positive.condition_type : null,
    negative_condition: negative ? negative.condition_type : null
  };
}

function resolveSavingThrowOutcome(input) {
  const participant = input && input.participant ? input.participant : null;
  const saveAbility = normalizeAbilityKey(input && input.save_ability);
  const dc = Number(input && input.dc);
  const savingThrowFn = typeof input.saving_throw_fn === "function"
    ? input.saving_throw_fn
    : null;

  if (!participant || !saveAbility || !Number.isFinite(dc)) {
    return {
      ok: false,
      error: "participant, valid save_ability, and numeric dc are required"
    };
  }

  const modifier = computeSavingThrowModifier(participant, saveAbility);
  const activeConditions = getActiveConditionsForParticipant(input && input.combat_state, participant && participant.participant_id);
  const participantIsRestrained = activeConditions.some((condition) => String(condition && condition.condition_type || "") === "restrained");
  const participantIsParalyzed = activeConditions.some((condition) => String(condition && condition.condition_type || "") === "paralyzed");
  const participantIsDodging = participant && participant.is_dodging === true ||
    activeConditions.some((condition) => String(condition && condition.condition_type || "") === "dodging");
  const saveDisadvantage = participantIsRestrained && saveAbility === "dexterity";
  const saveAdvantage = participantIsDodging && saveAbility === "dexterity";
  if (participantIsParalyzed && (saveAbility === "strength" || saveAbility === "dexterity")) {
    return {
      ok: true,
      payload: {
        save_ability: saveAbility,
        modifier: computeSavingThrowModifier(participant, saveAbility),
        bonus_modifier: 0,
        flat_condition_bonus: 0,
        advantage: false,
        disadvantage: false,
        dc,
        roll: { final_total: 0, rolled_value: 0 },
        success: false,
        auto_failed: true,
        blessing_roll: null,
        bane_roll: null,
        blessing_rolls: [],
        bane_rolls: []
      },
      error: null
    };
  }
  const conditionBonus = rollConditionDiceModifier({
    combat_state: input && input.combat_state,
    participant_id: participant && participant.participant_id,
    positive_condition: "bless",
    negative_condition: "bane",
    positive_metadata_key: "saving_throw_bonus_dice",
    negative_metadata_key: "saving_throw_penalty_dice",
    rng: input && input.bonus_rng
  });
  const flatConditionBonus = activeConditions.reduce((sum, condition) => {
    const metadata = condition && condition.metadata && typeof condition.metadata === "object" ? condition.metadata : {};
    const genericBonus = Number(metadata.saving_throw_bonus);
    const abilityBonus = Number(
      metadata.save_bonus_by_ability && typeof metadata.save_bonus_by_ability === "object"
        ? metadata.save_bonus_by_ability[saveAbility]
        : metadata[saveAbility + "_save_bonus"]
    );
    const genericPenalty = Number(metadata.saving_throw_penalty);
    const abilityPenalty = Number(
      metadata.save_penalty_by_ability && typeof metadata.save_penalty_by_ability === "object"
        ? metadata.save_penalty_by_ability[saveAbility]
        : metadata[saveAbility + "_save_penalty"]
    );
    return sum
      + (Number.isFinite(genericBonus) ? genericBonus : 0)
      + (Number.isFinite(abilityBonus) ? abilityBonus : 0)
      - (Number.isFinite(genericPenalty) ? genericPenalty : 0)
      - (Number.isFinite(abilityPenalty) ? abilityPenalty : 0);
  }, 0);
  const roll = savingThrowFn
    ? savingThrowFn({
        participant: clone(participant),
        save_ability: saveAbility,
        modifier,
        dc,
        bonus_modifier: conditionBonus.total + flatConditionBonus,
        advantage: saveAdvantage,
        disadvantage: saveDisadvantage
      })
    : rollSavingThrow({
        modifier,
        advantage: saveAdvantage,
        disadvantage: saveDisadvantage
      });

  const finalTotal = Number(roll && roll.final_total);
  if (!Number.isFinite(finalTotal)) {
    return {
      ok: false,
      error: "saving throw resolver returned a non-numeric result"
    };
  }

  return {
    ok: true,
    payload: {
      save_ability: saveAbility,
      modifier,
      bonus_modifier: conditionBonus.total + flatConditionBonus,
      flat_condition_bonus: flatConditionBonus,
      advantage: saveAdvantage,
      disadvantage: saveDisadvantage,
      dc,
      roll,
      success: finalTotal + conditionBonus.total + flatConditionBonus >= dc,
      blessing_roll: conditionBonus.positive_roll,
      bane_roll: conditionBonus.negative_roll,
      blessing_rolls: conditionBonus.positive_rolls,
      bane_rolls: conditionBonus.negative_rolls
    },
    error: null
  };
}

function resolveTargetingProtectionOutcome(input) {
  const combatState = input && input.combat_state;
  const sourceParticipant = input && input.source_participant ? input.source_participant : null;
  const targetParticipant = input && input.target_participant ? input.target_participant : null;
  const protectionKind = String(input && input.protection_kind || "").trim().toLowerCase();
  const savingThrowFn = typeof input.saving_throw_fn === "function"
    ? input.saving_throw_fn
    : null;

  if (!combatState || !sourceParticipant || !targetParticipant || !protectionKind) {
    return {
      ok: true,
      payload: {
        blocked: false,
        gate_result: null,
        gating_condition: null
      },
      error: null
    };
  }

  const activeConditions = getActiveConditionsForParticipant(combatState, targetParticipant.participant_id);
  const metadataKey = protectionKind === "attack"
    ? "blocks_attack_targeting"
    : protectionKind === "harmful_spell"
      ? "blocks_harmful_spell_targeting"
      : "";
  if (!metadataKey) {
    return {
      ok: true,
      payload: {
        blocked: false,
        gate_result: null,
        gating_condition: null
      },
      error: null
    };
  }

  for (let index = 0; index < activeConditions.length; index += 1) {
    const condition = activeConditions[index];
    const metadata = condition && condition.metadata && typeof condition.metadata === "object"
      ? condition.metadata
      : {};
    if (metadata[metadataKey] !== true) {
      continue;
    }

    const saveAbility = normalizeAbilityKey(metadata.targeting_save_ability || "wisdom");
    const dc = Number(metadata.targeting_save_dc);
    if (!saveAbility || !Number.isFinite(dc)) {
      continue;
    }

    const saveOut = resolveSavingThrowOutcome({
      combat_state: combatState,
      participant: sourceParticipant,
      save_ability: saveAbility,
      dc,
      saving_throw_fn: savingThrowFn,
      bonus_rng: input && input.bonus_rng
    });
    if (!saveOut.ok) {
      return saveOut;
    }

    return {
      ok: true,
      payload: {
        blocked: saveOut.payload.success !== true,
        gate_result: clone(saveOut.payload),
        gating_condition: clone(condition)
      },
      error: null
    };
  }

  return {
    ok: true,
    payload: {
      blocked: false,
      gate_result: null,
      gating_condition: null
    },
    error: null
  };
}

module.exports = {
  SAVE_ABILITIES,
  SUPPORTED_SPELL_TARGET_TYPES,
  normalizeAbilityKey,
  getParticipantAbilityScore,
  computeAbilityModifierFromScore,
  getParticipantAbilityModifier,
  computeSavingThrowModifier,
  computeSpellAttackBonus,
  computeSpellSaveDc,
  parseSpellRangeFeet,
  getSpellTargetType,
  getSpellAreaTemplate,
  resolveSpellActionCost,
  normalizeSpellLevel,
  isCantripSpell,
  getParticipantSpellcastingTurnState,
  initializeParticipantSpellcastingTurnState,
  validateSpellKnown,
  validateSpellTargeting,
  validateSpellActionAvailability,
  consumeSpellAction,
  resolveSavingThrowOutcome,
  rollConditionDiceModifier,
  resolveTargetingProtectionOutcome
};
