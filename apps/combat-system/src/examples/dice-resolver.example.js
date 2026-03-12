"use strict";

const {
  ROLL_TYPES,
  resolveDiceRoll,
  rollAttackRoll,
  rollSavingThrow,
  rollAbilityCheck,
  rollSkillCheck,
  rollDamageRoll,
  rollHealingRoll,
  rollDeathSave
} = require("../dice");

function runDiceResolverExamples() {
  const examples = {
    attack_roll_advantage: rollAttackRoll({
      modifier: 7,
      advantage: true
    }),
    saving_throw_disadvantage: rollSavingThrow({
      modifier: 3,
      disadvantage: true
    }),
    ability_check_flat_modifier: rollAbilityCheck({
      modifier: 4
    }),
    skill_check: rollSkillCheck({
      modifier: 6
    }),
    damage_roll_multi_dice: rollDamageRoll({
      formula: "2d6+3"
    }),
    healing_roll_multi_dice: rollHealingRoll({
      formula: "1d8+2"
    }),
    death_save: rollDeathSave({}),
    manual_damage_roll_with_resolver: resolveDiceRoll({
      roll_type: ROLL_TYPES.DAMAGE_ROLL,
      formula: "2d6+1d4+3",
      modifier: 2
    })
  };

  return examples;
}

if (require.main === module) {
  console.log(JSON.stringify(runDiceResolverExamples(), null, 2));
}

module.exports = {
  runDiceResolverExamples
};
