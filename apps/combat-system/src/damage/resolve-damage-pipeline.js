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
  const damageFormula = input.damage_formula || "1d4";
  const flatModifier = Number(input.flat_modifier || 0);

  if (!target || typeof target !== "object") {
    throw new Error("resolveDamagePipeline requires target");
  }

  const profile = getCharacterDamageProfile(target);
  const hasVulnerability = profile.vulnerabilities.includes(damageType);
  const hasResistance = profile.resistances.includes(damageType);
  const hasImmunity = profile.immunities.includes(damageType);

  // 1) roll damage
  const rollResult = resolveDiceRoll({
    roll_type: ROLL_TYPES.DAMAGE_ROLL,
    formula: damageFormula,
    modifier: flatModifier,
    rng: input.rng
  });
  const rolledDamage = Math.max(0, rollResult.final_total);

  // 2) apply vulnerability
  const afterVulnerability = applyVulnerability(rolledDamage, hasVulnerability);

  // 3) apply resistance
  const afterResistance = applyResistance(afterVulnerability, hasResistance);

  // 4) apply immunity
  const afterImmunity = applyImmunity(afterResistance, hasImmunity);

  // 5) calculate final damage
  const finalDamage = Math.max(0, afterImmunity);

  // 6) apply HP reduction
  const hpBefore = Number(target.current_hp || 0);
  const hpAfter = Math.max(0, hpBefore - finalDamage);
  const hpReducedBy = hpBefore - hpAfter;

  return {
    pipeline_order: [
      "roll_damage",
      "apply_vulnerability",
      "apply_resistance",
      "apply_immunity",
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
      calculate_final_damage: {
        final_damage: finalDamage
      },
      apply_hp_reduction: {
        hp_before: hpBefore,
        hp_after: hpAfter,
        hp_reduced_by: hpReducedBy
      }
    },
    final_damage: finalDamage,
    hp_before: hpBefore,
    hp_after: hpAfter
  };
}

module.exports = {
  applyVulnerability,
  applyResistance,
  applyImmunity,
  resolveDamagePipeline
};
