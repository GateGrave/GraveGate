"use strict";

const { rollSavingThrow } = require("../dice");

const SAVE_ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const SUPPORTED_SPELL_TARGET_TYPES = new Set([
  "single_target",
  "single_or_split_target",
  "self"
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

function validateSpellActionAvailability(participant, actionCost) {
  if (!participant || typeof participant !== "object") {
    return {
      ok: false,
      error: "participant is required"
    };
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

function consumeSpellAction(participant, actionCost) {
  const next = Object.assign({}, participant);
  if (actionCost === "bonus_action") {
    next.bonus_action_available = false;
    return next;
  }
  if (actionCost === "reaction") {
    next.reaction_available = false;
    return next;
  }
  next.action_available = false;
  return next;
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
  const roll = savingThrowFn
    ? savingThrowFn({
        participant: clone(participant),
        save_ability: saveAbility,
        modifier,
        dc
      })
    : rollSavingThrow({ modifier });

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
      dc,
      roll,
      success: finalTotal >= dc
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
  resolveSpellActionCost,
  validateSpellKnown,
  validateSpellTargeting,
  validateSpellActionAvailability,
  consumeSpellAction,
  resolveSavingThrowOutcome
};
