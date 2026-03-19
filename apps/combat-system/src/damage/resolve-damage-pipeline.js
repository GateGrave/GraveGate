"use strict";

const { resolveDiceRoll, ROLL_TYPES } = require("../dice");
const { getCharacterDamageProfile } = require("./character-damage-profile");

function applyVulnerability(amount, hasVulnerability) {
  if (!hasVulnerability) {
    return amount;
  }
  return amount * 2;
}

function applyResistance(amount, hasResistance) {
  if (!hasResistance) {
    return amount;
  }
  return Math.floor(amount / 2);
}

function applyImmunity(amount, hasImmunity) {
  if (!hasImmunity) {
    return amount;
  }
  return 0;
}

function applyDamageReduction(amount, reduction) {
  const numericReduction = Number(reduction);
  if (!Number.isFinite(numericReduction) || numericReduction <= 0) {
    return amount;
  }
  return Math.max(0, amount - Math.floor(numericReduction));
}

/**
 * Resolve typed damage in exact order:
 * 1) roll damage
 * 2) apply vulnerability
 * 3) apply resistance
 * 4) apply immunity
 * 5) calculate final damage
 * 6) apply HP reduction
 *
 * @param {object} input
 * @param {object} input.target
 * @param {string} input.damage_type
 * @param {string} input.damage_formula
 * @param {number} [input.flat_modifier]
 * @param {Function} [input.rng]
 * @returns {object}
 */
function resolveDamagePipeline(input) {
  const target = input.target;
  const damageType = input.damage_type;
  const damageFormula = typeof input.damage_formula === "string" && input.damage_formula.trim()
    ? input.damage_formula.trim()
    : null;
  const flatModifier = Number(input.flat_modifier || 0);

  if (!target || typeof target !== "object") {
    throw new Error("resolveDamagePipeline requires target");
  }

  const profile = getCharacterDamageProfile(target);
  const tempHpBefore = Number.isFinite(Number(target.temporary_hitpoints)) ? Math.max(0, Number(target.temporary_hitpoints)) : 0;
  const hasVulnerability = profile.vulnerabilities.includes(damageType);
  const hasResistance = profile.resistances.includes(damageType);
  const hasImmunity = profile.immunities.includes(damageType);
  const damageReductionTypes = Array.isArray(target.damage_reduction_types)
    ? target.damage_reduction_types.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const damageReductionValue = Number(target.damage_reduction || 0);
  const damageReductionApplies = Number.isFinite(damageReductionValue) && damageReductionValue > 0 && (
    damageReductionTypes.length === 0 || damageReductionTypes.includes(String(damageType || "").trim().toLowerCase())
  );

  // 1) roll damage
  const rollResult = damageFormula
    ? resolveDiceRoll({
        roll_type: ROLL_TYPES.DAMAGE_ROLL,
        formula: damageFormula,
        modifier: flatModifier,
        rng: input.rng
      })
    : {
        roll_type: ROLL_TYPES.DAMAGE_ROLL,
        formula: null,
        modifier: flatModifier,
        rolls: [],
        final_total: flatModifier
      };
  const rolledDamage = Math.max(0, rollResult.final_total);

  // 2) apply vulnerability
  const afterVulnerability = applyVulnerability(rolledDamage, hasVulnerability);

  // 3) apply resistance
  const afterResistance = applyResistance(afterVulnerability, hasResistance);

  // 4) apply immunity
  const afterImmunity = applyImmunity(afterResistance, hasImmunity);

  // 5) apply passive damage reduction
  const afterDamageReduction = applyDamageReduction(afterImmunity, damageReductionApplies ? damageReductionValue : 0);

  // 6) calculate final damage
  const finalDamage = Math.max(0, afterDamageReduction);

  // 7) apply HP reduction
  const hpBefore = Number(target.current_hp || 0);
  const tempHpAfter = Math.max(0, tempHpBefore - finalDamage);
  const remainingDamageAfterTempHp = Math.max(0, finalDamage - tempHpBefore);
  const hpAfter = Math.max(0, hpBefore - remainingDamageAfterTempHp);
  const hpReducedBy = hpBefore - hpAfter;
  const tempHpConsumed = tempHpBefore - tempHpAfter;

  return {
    pipeline_order: [
      "roll_damage",
      "apply_vulnerability",
      "apply_resistance",
      "apply_immunity",
      "apply_damage_reduction",
      "calculate_final_damage",
      "apply_hp_reduction"
    ],
    target_id: target.participant_id || target.character_id || null,
    damage_type: damageType,
    stages: {
      roll_damage: {
        formula: damageFormula,
        roll_result: rollResult,
        rolled_damage_total: rolledDamage
      },
      apply_vulnerability: {
        has_vulnerability: hasVulnerability,
        damage_after_vulnerability: afterVulnerability
      },
      apply_resistance: {
        has_resistance: hasResistance,
        damage_after_resistance: afterResistance
      },
      apply_immunity: {
        has_immunity: hasImmunity,
        damage_after_immunity: afterImmunity
      },
      apply_damage_reduction: {
        has_damage_reduction: damageReductionApplies,
        damage_reduction: damageReductionApplies ? Math.floor(damageReductionValue) : 0,
        damage_reduction_types: damageReductionTypes,
        damage_after_reduction: afterDamageReduction
      },
      calculate_final_damage: {
        final_damage: finalDamage
      },
      apply_hp_reduction: {
        hp_before: hpBefore,
        hp_after: hpAfter,
        hp_reduced_by: hpReducedBy,
        temporary_hp_before: tempHpBefore,
        temporary_hp_after: tempHpAfter,
        temporary_hp_consumed: tempHpConsumed
      }
    },
    final_damage: finalDamage,
    hp_before: hpBefore,
    hp_after: hpAfter,
    temporary_hp_before: tempHpBefore,
    temporary_hp_after: tempHpAfter,
    temporary_hp_consumed: tempHpConsumed
  };
}

module.exports = {
  applyVulnerability,
  applyResistance,
  applyImmunity,
  applyDamageReduction,
  resolveDamagePipeline
};
